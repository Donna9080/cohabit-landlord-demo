// Quick check-in: a short survey anyone can send, signed in or not, where every question is optional. Plus
// coHabit Points: pilot participation points with no cash value. Kept apart from matching preferences: nothing
// here is read by matching or the assistant, and nothing there is written here.
//
//   GET  /api/survey             the questions, and for a signed-in person whether they've earned the points
//   POST /api/survey             save one submission; awards the points once per person (enforced here)
//   GET  /api/admin/survey       summary and recent responses (admin only, no names or emails)
//   GET  /api/admin/survey.csv   every response as a spreadsheet (admin only)
import { HttpError, SECURITY_HEADERS, rateLimit, readJson } from "./http.js";
import { EMAIL, InvalidInput, PHONE, SSN, STREET } from "./validate.js";
import { demoDataOn } from "./assistant/demo-data.js";

export const SURVEY_ID = "checkin-2026-10";
export const SURVEY_POINTS = 100;
const REASON = `survey:${SURVEY_ID}`;
const COMMENT_MAX = 500;
const PER_MINUTE = 5;

const q = (key, text, multi, options, exclusive = null) => ({ key, text, multi, exclusive, options: options.map(([value, label]) => ({ value, label })) });
export const SURVEY = {
  id: SURVEY_ID,
  title: "Quick check-in",
  subtitle: "Help shape coHabit. Every question is optional.",
  commentLabel: "Anything else? Share an idea or suggestion.",
  commentMax: COMMENT_MAX,
  points: SURVEY_POINTS,
  questions: [
    q(
      "look_where",
      "Where do you currently look for rooms or roommates?",
      true,
      [
        ["facebook", "Facebook groups"],
        ["group_chats", "WhatsApp or other group chats"],
        ["friends", "Friends or classmates"],
        ["websites", "Housing websites or apps"],
        ["not_yet", "I haven't looked yet"],
      ],
      "not_yet"
    ),
    q("options_work", "How well do your current options work?", false, [
      ["enough", "They're enough for me"],
      ["missing", "They help, but something is missing"],
      ["difficult", "Finding a good fit is difficult"],
      ["not_tried", "I haven't tried yet"],
    ]),
    q("roommate_profile", "Would you create a roommate profile with your budget and lifestyle preferences?", false, [
      ["yes", "Yes"],
      ["maybe", "Maybe, if I control who sees it"],
      ["no", "No, I prefer group chats or introductions"],
      ["not_looking", "I'm not looking for a roommate"],
    ]),
    q(
      "use_for",
      "Which would you use coHabit for?",
      true,
      [
        ["room", "Finding a room"],
        ["roommate", "Finding a compatible roommate"],
        ["chores", "Organizing shared chores"],
        ["bills", "Tracking shared bills"],
        ["none", "None of these"],
      ],
      "none"
    ),
  ],
};
const QUESTION = Object.fromEntries(SURVEY.questions.map((x) => [x.key, x]));
const labelOf = (key, value) => QUESTION[key].options.find((o) => o.value === value)?.label ?? value;

// ── Checking a submission ──

// Made by the browser once per draft (crypto.randomUUID), so a retry sends the same id.
const SUBMISSION_ID = /^[A-Za-z0-9-]{16,64}$/;

export function parseSurvey(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new InvalidInput(null, "Send a JSON object.");
  if (typeof body.id !== "string" || !SUBMISSION_ID.test(body.id)) throw new InvalidInput("id", "Reload the page and try again.");
  const raw = body.answers ?? {};
  if (typeof raw !== "object" || Array.isArray(raw)) throw new InvalidInput("answers", "Answers must be an object.");
  for (const key of Object.keys(raw)) if (!QUESTION[key]) throw new InvalidInput("answers", "That question isn't part of this check-in.");

  const answers = {};
  for (const question of SURVEY.questions) {
    const v = raw[question.key];
    if (v == null || v === "" || (Array.isArray(v) && !v.length)) continue; // skipped: every question is optional
    const allowed = question.options.map((o) => o.value);
    if (question.multi) {
      if (!Array.isArray(v) || v.some((x) => !allowed.includes(x)) || new Set(v).size !== v.length) throw new InvalidInput(question.key, "Pick from the listed answers.");
      if (question.exclusive && v.includes(question.exclusive) && v.length > 1)
        throw new InvalidInput(question.key, `“${labelOf(question.key, question.exclusive)}” can't be combined with other answers.`);
      answers[question.key] = allowed.filter((x) => v.includes(x)); // always in the listed order
    } else {
      if (typeof v !== "string" || !allowed.includes(v)) throw new InvalidInput(question.key, "Pick one of the listed answers.");
      answers[question.key] = v;
    }
  }

  const c = body.comment == null ? "" : body.comment;
  if (typeof c !== "string") throw new InvalidInput("comment", "Must be text.");
  const comment = c.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (comment.length > COMMENT_MAX) throw new InvalidInput("comment", `Keep it under ${COMMENT_MAX} characters.`);
  // coHabit doesn't collect contact details, ID or card numbers, or street addresses.
  if (EMAIL.test(comment) || PHONE.test(comment)) throw new InvalidInput("comment", "Please leave out email addresses and phone numbers. We read every comment without them.");
  if (SSN.test(comment)) throw new InvalidInput("comment", "Please leave out ID and card numbers.");
  if (STREET.test(comment)) throw new InvalidInput("comment", "Please leave out street addresses. A town or neighborhood is fine.");

  if (!Object.keys(answers).length && !comment) throw new HttpError(400, "empty", "Nothing to send yet. Answer any question or add a comment, or choose Not now.");

  // Only the first part of the page address, so no ids are stored ("/landlord/units/…" becomes "/landlord").
  const m = typeof body.page === "string" ? body.page.match(/^\/([a-z-]{0,30})(?:[/?#]|$)/) : null;
  return { id: body.id, answers, comment, page: m ? `/${m[1]}` : null };
}

// ── Points ──

export async function pointsBalance(db, userId) {
  const row = await db.prepare(`SELECT COALESCE(SUM(points), 0) AS n FROM points_awards WHERE user_id = ?1`).bind(userId).first();
  return row?.n ?? 0;
}

async function earnedSurveyPoints(db, userId) {
  return !!(await db.prepare(`SELECT 1 FROM points_awards WHERE user_id = ?1 AND reason = ?2`).bind(userId, REASON).first());
}

// Submissions made while Demo mode is on are labeled, so they can be left out of real results. A renter's Demo mode
// is a server setting; anyone else's lives in their browser, so the page says (demo: true). It's only a label.
async function demoModeOn(db, env, user, said) {
  if (!demoDataOn(env)) return false;
  if (user?.accountType !== "renter") return said === true;
  const row = await db.prepare(`SELECT last_results FROM assistant_threads WHERE user_id = ?1`).bind(user.id).first();
  try {
    return JSON.parse(row?.last_results || "{}").demo === true;
  } catch {
    return false;
  }
}

const respondentOf = (user) => (!user ? "guest" : user.accountType === "renter" || user.accountType === "landlord" ? user.accountType : "member");

// ── Routes ──

export async function handleSurvey({ request, env, db, user, path, method, ip, reply }) {
  if (path === "/api/survey" && method === "GET") {
    return reply({
      survey: SURVEY,
      points: user ? { signedIn: true, earned: await earnedSurveyPoints(db, user.id), balance: await pointsBalance(db, user.id) } : { signedIn: false },
    });
  }

  if (path === "/api/survey" && method === "POST") {
    await rateLimit(env, `s:${user ? "u:" + user.id : "ip:" + ip}`, PER_MINUTE, "You've sent a few check-ins just now. Wait a minute and try again.");
    const body = await readJson(request);
    const s = parseSurvey(body);
    const now = Date.now();
    const statements = [
      db
        .prepare(
          `INSERT INTO survey_responses (id, survey, user_id, respondent, demo, page, answers, comment, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) ON CONFLICT (id) DO NOTHING`
        )
        .bind(s.id, SURVEY_ID, user?.id ?? null, respondentOf(user), (await demoModeOn(db, env, user, body.demo)) ? 1 : 0, s.page, JSON.stringify(s.answers), s.comment, now),
    ];
    if (user) {
      // One transaction: the award only if this response is saved and theirs, and only if they have no award for
      // this check-in yet (the unique pair). Then the response notes the points it earned.
      statements.push(
        db
          .prepare(
            `INSERT INTO points_awards (id, user_id, reason, points, source_id, created_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6 WHERE EXISTS (SELECT 1 FROM survey_responses WHERE id = ?5 AND user_id = ?2)
             ON CONFLICT (user_id, reason) DO NOTHING`
          )
          .bind(crypto.randomUUID(), user.id, REASON, SURVEY_POINTS, s.id, now),
        db
          .prepare(
            `UPDATE survey_responses SET points_awarded = (SELECT points FROM points_awards WHERE user_id = ?2 AND source_id = ?1)
             WHERE id = ?1 AND EXISTS (SELECT 1 FROM points_awards WHERE user_id = ?2 AND source_id = ?1)`
          )
          .bind(s.id, user.id)
      );
    }
    const [inserted] = await db.batch(statements);
    // A retry of the same submission gets the same answer as the first try (and saves nothing new).
    const row = await db.prepare(`SELECT user_id, points_awarded FROM survey_responses WHERE id = ?1`).bind(s.id).first();
    if (!row || (row.user_id ?? null) !== (user?.id ?? null)) throw new HttpError(409, "conflict", "This check-in couldn't be saved. Reload the page and try again.");
    return reply(
      { saved: true, awarded: row.points_awarded > 0, points: row.points_awarded, balance: user ? await pointsBalance(db, user.id) : null },
      inserted.meta.changes ? 201 : 200
    );
  }

  throw new HttpError(404, "not_found", "Not found.");
}

export const surveyDeleteStatements = (db, userId) => [
  db.prepare(`DELETE FROM points_awards WHERE user_id = ?1`).bind(userId),
  db.prepare(`DELETE FROM survey_responses WHERE user_id = ?1`).bind(userId),
];

// ── Admin ──

const MAX_ROWS = 5000;
const RECENT = 200;

async function loadResponses(db, filter) {
  const where = filter === "real" ? "AND demo = 0" : filter === "demo" ? "AND demo = 1" : "";
  const { results } = await db
    .prepare(
      `SELECT id, respondent, demo, page, answers, comment, points_awarded, created_at FROM survey_responses
       WHERE survey = ?1 ${where} ORDER BY created_at DESC LIMIT ${MAX_ROWS}`
    )
    .bind(SURVEY_ID)
    .all();
  return results.map((r) => {
    let answers = {};
    try {
      answers = JSON.parse(r.answers);
    } catch {}
    return { id: r.id, respondent: r.respondent, demo: !!r.demo, page: r.page, answers, comment: r.comment, points: r.points_awarded, createdAt: r.created_at };
  });
}

const FILTERS = new Set(["all", "real", "demo"]);
const filterOf = (url) => (FILTERS.has(url.searchParams.get("demo")) ? url.searchParams.get("demo") : "all");

// Counts per answer, who answered, and the newest responses. No names, emails or account ids.
export async function surveySummary(db, url) {
  const filter = filterOf(url);
  const rows = await loadResponses(db, filter);
  const count = (pred) => rows.filter(pred).length;
  return {
    survey: SURVEY,
    filter,
    total: rows.length,
    capped: rows.length === MAX_ROWS,
    respondents: { renter: count((r) => r.respondent === "renter"), landlord: count((r) => r.respondent === "landlord"), member: count((r) => r.respondent === "member"), guest: count((r) => r.respondent === "guest") },
    demo: count((r) => r.demo),
    withComment: count((r) => r.comment),
    pointsAwarded: count((r) => r.points > 0),
    questions: SURVEY.questions.map((question) => {
      const answered = rows.filter((r) => r.answers[question.key] != null);
      return {
        key: question.key,
        answered: answered.length,
        counts: Object.fromEntries(question.options.map((o) => [o.value, answered.filter((r) => [].concat(r.answers[question.key]).includes(o.value)).length])),
      };
    }),
    responses: rows.slice(0, RECENT).map((r) => ({ ...r, id: r.id.slice(0, 8) })),
  };
}

// A spreadsheet cell: quoted, and never read as a formula (=, +, -, @ at the start get a leading apostrophe).
const cell = (v) => {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};

export async function surveyCsv(db, url) {
  const filter = filterOf(url);
  const rows = await loadResponses(db, filter);
  const header = ["Response", "Sent (UTC)", "Respondent", "Demo mode", "Page", ...SURVEY.questions.map((x) => x.text), "Comment", "Points awarded"];
  const lines = [header.map(cell).join(",")];
  for (const r of [...rows].reverse()) {
    lines.push(
      [
        r.id,
        new Date(r.createdAt).toISOString().replace("T", " ").slice(0, 19),
        r.respondent,
        r.demo ? "yes" : "no",
        r.page || "",
        ...SURVEY.questions.map((x) => [].concat(r.answers[x.key] ?? []).map((v) => labelOf(x.key, v)).join("; ")),
        r.comment,
        r.points,
      ]
        .map(cell)
        .join(",")
    );
  }
  const day = new Date().toISOString().slice(0, 10);
  return new Response("﻿" + lines.join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="cohabit-check-in-${filter === "all" ? "" : filter + "-"}${day}.csv"`,
      ...SECURITY_HEADERS,
    },
  });
}
