// Roommate connections: what one renter may see about another, and requests to connect (with messages once
// accepted). Renters only (checked in src/index.js).
//
//   GET  /api/roommates/requests                 your requests: incoming, outgoing, connected, closed
//   POST /api/roommates/requests                 { handle, intro }  ask someone to connect
//   POST /api/roommates/requests/<id>            { action: "withdraw" | "accept" | "decline" }
//   GET  /api/roommates/requests/<id>/messages   messages, once accepted (both people only)
//   POST /api/roommates/requests/<id>/messages   { body }
//
// The browser never gets another renter's user id. Each person comes with a "handle": their id encrypted for the
// renter looking at them, so it can't be read, reused by someone else, or turned back into an id in the browser.
import { HttpError, readJson } from "./http.js";
import { fmtMonth, money } from "./assistant/memory.js";
import { loadPreferences } from "./profile.js";
import { firstNameOf, lifestyleTags, majorDifferences, roommateDifferences, scoreRoommate, topShared } from "./roommates.js";
import { InvalidInput, isUnitId, parseIntro, parseRoommateMessage } from "./validate.js";

const MAX_OPEN_OUTGOING = 10;
const MAX_MESSAGES = 500;

// ── Handles ──────────────────────────────────────────────────────────────────
const enc = new TextEncoder();
const dec = new TextDecoder();
let keyCache = { secret: null, key: null };
async function handleKey(env) {
  const secret = env.BETTER_AUTH_SECRET || "";
  if (keyCache.secret !== secret) {
    const raw = await crypto.subtle.digest("SHA-256", enc.encode(`cohabit roommate handle|${secret}`));
    keyCache = { secret, key: await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]) };
  }
  return keyCache.key;
}
const toB64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

export async function makeHandle(env, viewerId, targetId) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await handleKey(env), enc.encode(`${viewerId}\n${targetId}`)));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return "h_" + toB64u(out);
}

// The target's user id, or null if the handle is malformed, tampered with, or was made for someone else.
export async function readHandle(env, viewerId, handle) {
  if (typeof handle !== "string" || !/^h_[A-Za-z0-9_-]{30,400}$/.test(handle)) return null;
  try {
    const bytes = fromB64u(handle.slice(2));
    const text = dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12) }, await handleKey(env), bytes.slice(12)));
    const [viewer, target] = text.split("\n");
    return viewer === viewerId && target ? target : null;
  } catch {
    return null;
  }
}

// ── What one renter may see about another ──────────────────────────────────
const budgetText = (p) => (p.budget_min ? `${money(p.budget_min)}–${money(p.budget_max)} a month` : `Up to ${money(p.budget_max)} a month`);
export const profileDetails = (p) => ({ budget: budgetText(p), moveIn: fmtMonth(p.move_in_month), area: p.area, lifestyle: lifestyleTags(p) });

// Their latest request with each person (user id -> { id, status, direction }); withdrawn ones don't count.
export async function requestsByPerson(db, viewerId) {
  const { results } = await db
    .prepare(
      `SELECT id, from_user_id, to_user_id, status FROM roommate_requests
       WHERE (from_user_id = ?1 OR to_user_id = ?1) AND status != 'withdrawn' ORDER BY created_at DESC LIMIT 300`
    )
    .bind(viewerId)
    .all();
  const map = new Map();
  for (const r of results) {
    const other = r.from_user_id === viewerId ? r.to_user_id : r.from_user_id;
    if (!map.has(other)) map.set(other, { id: r.id, status: r.status, direction: r.from_user_id === viewerId ? "out" : "in" });
  }
  return map;
}

// One person as a card and in Details. Budget, move-in month, area, lifestyle tags and differences only when they
// chose to share their profile and the viewer shares theirs too. An email only if they chose to share it.
export async function personView(env, viewerId, mine, p, requests) {
  const consent = !!(p.prefs.share_profile && mine?.share_profile);
  const diffs = roommateDifferences(mine || {}, p.prefs);
  const major = majorDifferences(mine || {}, p.prefs);
  return {
    handle: await makeHandle(env, viewerId, p.userId),
    firstName: p.firstName,
    score: p.score,
    fits: p.fits,
    highlights: topShared(p.fits),
    // The card names one important difference. Without shared details, only how many answers differ (like the score).
    mainMiss: !major.length ? null : consent ? major[0] : `${diffs.length} lifestyle ${diffs.length === 1 ? "answer differs" : "answers differ"}. Details has what you share.`,
    sample: !!p.sample,
    email: p.email || null,
    details: consent ? profileDetails(p.prefs) : null,
    differences: consent ? diffs : null,
    differenceCount: diffs.length,
    theyShare: !!p.prefs.share_profile,
    youShare: !!mine?.share_profile,
    request: requests.get(p.userId) || null,
  };
}

// Demo profiles are made up, so everything is shown; they have no handle and can't be sent a real request.
export function demoPersonView(mine, p) {
  const diffs = roommateDifferences(mine || {}, p.prefs);
  return {
    handle: null,
    demo: true,
    firstName: p.firstName,
    about: p.about || null,
    // Fictional, so the whole profile is shown: a short introduction, interests and an illustrated avatar.
    intro: p.prefs.intro || null,
    interests: p.prefs.interests || [],
    avatar: p.prefs.avatar || null,
    score: p.score,
    fits: p.fits,
    highlights: topShared(p.fits),
    mainMiss: majorDifferences(mine || {}, p.prefs)[0] || null,
    sample: false,
    email: null,
    details: profileDetails(p.prefs),
    differences: diffs,
    differenceCount: diffs.length,
    theyShare: true,
    youShare: true,
    request: null,
  };
}

// ── Requests ─────────────────────────────────────────────────────────────────
async function requestList(env, db, user) {
  const [{ results }, mine] = await Promise.all([
    db
      .prepare(
        `SELECT r.id, r.from_user_id, r.to_user_id, r.intro, r.status, r.created_at, r.decided_at,
           fu.name AS from_name, tu.name AS to_name,
           (SELECT COUNT(*) FROM roommate_messages m WHERE m.request_id = r.id) AS messages
         FROM roommate_requests r JOIN "user" fu ON fu.id = r.from_user_id JOIN "user" tu ON tu.id = r.to_user_id
         WHERE r.from_user_id = ?1 OR r.to_user_id = ?1 ORDER BY r.created_at DESC LIMIT 100`
      )
      .bind(user.id)
      .all(),
    loadPreferences(db, user.id),
  ]);
  // What the other person shares, and what you have in common, for each request.
  const otherIds = [...new Set(results.map((r) => (r.from_user_id === user.id ? r.to_user_id : r.from_user_id)))];
  const prefs = otherIds.length
    ? (
        await db
          .prepare(
            `SELECT user_id, budget_min, budget_max, move_in_month, area, sleep_schedule, cleanliness, noise, guests, pets, smoking, chores, share_profile
             FROM match_preferences WHERE user_id IN (SELECT value FROM json_each(?1))`
          )
          .bind(JSON.stringify(otherIds))
          .all()
      ).results
    : [];
  const prefsOf = new Map(prefs.map((p) => [p.user_id, p]));
  const view = (r) => {
    const out = r.from_user_id === user.id;
    const other = prefsOf.get(out ? r.to_user_id : r.from_user_id);
    const shared = mine && other ? scoreRoommate(mine, other).shared : [];
    const consent = !!(other?.share_profile && mine?.share_profile);
    return {
      id: r.id,
      direction: out ? "out" : "in",
      status: r.status,
      firstName: firstNameOf(out ? r.to_name : r.from_name),
      intro: r.intro,
      createdAt: r.created_at,
      decidedAt: r.decided_at,
      shared,
      details: consent ? profileDetails(other) : null,
      messages: r.messages,
    };
  };
  const all = results.map(view);
  return {
    incoming: all.filter((r) => r.direction === "in" && r.status === "pending"),
    outgoing: all.filter((r) => r.direction === "out" && r.status === "pending"),
    connected: all.filter((r) => r.status === "accepted"),
    closed: all.filter((r) => r.status === "declined" || r.status === "withdrawn").slice(0, 10),
  };
}

async function createRequest({ request, env, db, user }) {
  const body = await readJson(request);
  const intro = parseIntro(body);
  const mine = await loadPreferences(db, user.id);
  if (!mine?.roommate_visible) throw new HttpError(409, "opt_in_required", "Turn on roommate matching first, so the people you contact can find you too.");
  const targetId = await readHandle(env, user.id, body?.handle);
  if (!targetId) throw new HttpError(404, "not_found", "This person isn't available to connect with.");
  if (targetId === user.id) throw new InvalidInput("handle", "You can't send a request to yourself.");
  const target = await db
    .prepare(
      `SELECT u.name FROM match_preferences p JOIN "user" u ON u.id = p.user_id
       WHERE p.user_id = ?1 AND p.roommate_visible = 1 AND u.account_type = 'renter'`
    )
    .bind(targetId)
    .first();
  if (!target) throw new HttpError(404, "not_found", "This person is no longer looking for roommates.");
  const [{ results: between }, { n }] = await Promise.all([
    db
      .prepare(
        `SELECT id, from_user_id, status FROM roommate_requests
         WHERE (from_user_id = ?1 AND to_user_id = ?2) OR (from_user_id = ?2 AND to_user_id = ?1) ORDER BY created_at DESC`
      )
      .bind(user.id, targetId)
      .all(),
    db.prepare(`SELECT COUNT(*) AS n FROM roommate_requests WHERE from_user_id = ?1 AND status = 'pending'`).bind(user.id).first(),
  ]);
  const open = between.find((r) => r.status === "pending" || r.status === "accepted");
  if (open?.status === "accepted") throw new HttpError(409, "already_connected", "You're already connected.");
  if (open) throw new HttpError(409, "already_requested", open.from_user_id === user.id ? "You already sent a request." : "They already sent you a request. Check your requests.");
  if (between.some((r) => r.from_user_id === user.id && r.status === "declined")) throw new HttpError(409, "declined", "They declined an earlier request, so you can't send another.");
  if (n >= MAX_OPEN_OUTGOING) throw new HttpError(409, "too_many", `You can have up to ${MAX_OPEN_OUTGOING} requests waiting. Withdraw one first.`);
  const id = crypto.randomUUID();
  try {
    await db
      .prepare(`INSERT INTO roommate_requests (id, from_user_id, to_user_id, intro, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(id, user.id, targetId, intro, Date.now())
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e?.message))) throw new HttpError(409, "already_requested", "There's already a request between you two.");
    throw e;
  }
  return { request: { id, status: "pending", direction: "out", firstName: firstNameOf(target.name) } };
}

const ACTIONS = {
  withdraw: { who: "from_user_id", to: "withdrawn", done: "Request withdrawn." },
  accept: { who: "to_user_id", to: "accepted", done: "Connected. You can message each other now." },
  decline: { who: "to_user_id", to: "declined", done: "Request declined." },
};

async function decide({ request, db, user }, id) {
  const body = await readJson(request);
  const act = ACTIONS[body?.action];
  if (!act) throw new InvalidInput("action", "Choose withdraw, accept or decline.");
  const row = await db.prepare(`SELECT from_user_id, to_user_id, status FROM roommate_requests WHERE id = ?1 AND (from_user_id = ?2 OR to_user_id = ?2)`).bind(id, user.id).first();
  if (!row) throw new HttpError(404, "not_found", "Request not found.");
  if (row[act.who] !== user.id) throw new HttpError(403, "not_allowed", act.who === "from_user_id" ? "Only the person who sent it can withdraw it." : "Only the person it was sent to can accept or decline it.");
  // The status check is repeated in the update, so two clicks at once can't both succeed.
  const res = await db
    .prepare(`UPDATE roommate_requests SET status = ?3, decided_at = ?4 WHERE id = ?1 AND ${act.who} = ?2 AND status = 'pending'`)
    .bind(id, user.id, act.to, Date.now())
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, "not_pending", "This request was already answered or withdrawn.");
  return { status: act.to, message: act.done };
}

async function connection(db, user, id) {
  const row = await db
    .prepare(
      `SELECT r.id, r.status, r.from_user_id, fu.name AS from_name, tu.name AS to_name FROM roommate_requests r
       JOIN "user" fu ON fu.id = r.from_user_id JOIN "user" tu ON tu.id = r.to_user_id
       WHERE r.id = ?1 AND (r.from_user_id = ?2 OR r.to_user_id = ?2)`
    )
    .bind(id, user.id)
    .first();
  if (!row) throw new HttpError(404, "not_found", "Conversation not found.");
  if (row.status !== "accepted") throw new HttpError(409, "not_connected", "You can message each other once the request is accepted.");
  return { ...row, withName: firstNameOf(row.from_user_id === user.id ? row.to_name : row.from_name) };
}

async function messages(db, user, id) {
  const c = await connection(db, user, id);
  const { results } = await db
    .prepare(`SELECT id, sender_user_id, body, created_at FROM roommate_messages WHERE request_id = ?1 ORDER BY created_at ASC LIMIT ${MAX_MESSAGES}`)
    .bind(id)
    .all();
  return { with: c.withName, messages: results.map((m) => ({ id: m.id, mine: m.sender_user_id === user.id, body: m.body, createdAt: m.created_at })) };
}

async function sendMessage({ request, db, user }, id) {
  const body = parseRoommateMessage(await readJson(request));
  await connection(db, user, id);
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM roommate_messages WHERE request_id = ?1`).bind(id).first();
  if (n >= MAX_MESSAGES) throw new HttpError(409, "too_many", "This conversation is full.");
  await db
    .prepare(`INSERT INTO roommate_messages (id, request_id, sender_user_id, body, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
    .bind(crypto.randomUUID(), id, user.id, body, Date.now())
    .run();
  return messages(db, user, id);
}

export async function handleConnections({ request, env, db, user, path, method, reply }) {
  const ctx = { request, env, db, user };
  if (path === "/api/roommates/requests" && method === "GET") return reply(await requestList(env, db, user));
  if (path === "/api/roommates/requests" && method === "POST") return reply(await createRequest(ctx), 201);
  const one = path.match(/^\/api\/roommates\/requests\/([^/]+)$/);
  if (one && method === "POST") {
    if (!isUnitId(one[1])) throw new HttpError(404, "not_found", "Request not found.");
    return reply(await decide(ctx, one[1]));
  }
  const msgs = path.match(/^\/api\/roommates\/requests\/([^/]+)\/messages$/);
  if (msgs) {
    if (!isUnitId(msgs[1])) throw new HttpError(404, "not_found", "Conversation not found.");
    if (method === "GET") return reply(await messages(db, user, msgs[1]));
    if (method === "POST") return reply(await sendMessage(ctx, msgs[1]), 201);
  }
  throw new HttpError(404, "not_found", "Not found.");
}

// Removes a user's requests and messages (used when an account is deleted).
export const connectionDeleteStatements = (db, userId) => [
  db.prepare(`DELETE FROM roommate_messages WHERE request_id IN (SELECT id FROM roommate_requests WHERE from_user_id = ?1 OR to_user_id = ?1)`).bind(userId),
  db.prepare(`DELETE FROM roommate_requests WHERE from_user_id = ?1 OR to_user_id = ?1`).bind(userId),
];
