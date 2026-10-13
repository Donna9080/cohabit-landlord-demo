// /api/assistant: the renter's chat assistant. Renters only (checked in src/index.js).
//
//   GET    /api/assistant                 the chat, what it has learned, saved options, mode and limits
//   POST   /api/assistant/messages        send a message; returns the reply (AI or basic mode)
//   POST   /api/assistant/memory          change or forget an answer, or mark it must-have / flexible (no AI call)
//   POST   /api/assistant/clear           delete the chat and what it learned (saved options stay)
//   POST   /api/assistant/actions/<id>    confirm or dismiss a confirmation card
//   POST   /api/assistant/saved           save a room or person from a reply
//   DELETE /api/assistant/saved/<id>      remove a saved option
//
// What is sent to the AI service (Anthropic): the renter's chat messages, what the chat has
// learned, and search results as listing details (name, area, rent, rooms, move-in date,
// description, approximate distance) or, for people, only a label, a score and what is shared.
// Never names, email addresses, street addresses, or anyone's user id.
import { HttpError, readJson, rateLimit } from "../http.js";
import { LISTING_FIELDS, activeListings, listingMapper } from "../listings.js";
import { createInterest, loadPreferences, savePreferences } from "../profile.js";
import { firstNameOf } from "../roommates.js";
import { InvalidInput, isUnitId, parseChatText, parseInterest, parsePreferences } from "../validate.js";
import { AiUnavailable, MODELS, aiConfigured, allowedNumbers, groundReply, modelFor, runAiTurn } from "./ai.js";
import { BASIC_INTRO, CONSIDERATIONS, describeAnswer, describeRoommates, describeRooms, nextQuestion, question, understand } from "./basic.js";
import { LABELS, STRICTNESS_FIELDS, applyUpdates, isRequired, memoryFacts, mergedPreferences, missingBasics, parseMemory, profileChanges } from "./memory.js";
import { BRANDEIS, kmBetween, searchRoommates, searchRooms } from "./search.js";

const HISTORY_FOR_MODEL = 12; // earlier messages replayed to the model as context
const PANEL_ROOMS = 12; // rooms in the results panel (the AI's search tool still gets the top 3)
const PANEL_PEOPLE = 9; // people in the results panel
const SHOW_MESSAGES = 60; // messages returned to the page
const KEEP_MESSAGES = 100; // older messages are deleted
export const INACTIVE_DAYS = 90; // chats untouched this long are deleted by the daily cleanup

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const limitsFor = (env) => ({
  perUserDaily: posInt(env.ASSISTANT_DAILY_PER_USER, 40),
  siteDaily: posInt(env.ASSISTANT_DAILY_SITE, 300),
  perMinute: posInt(env.ASSISTANT_PER_MINUTE, 10), // AI replies only; basic mode has the site-wide write limit
});

const parseJson = (s, fallback) => {
  try {
    return s ? JSON.parse(s) : fallback;
  } catch {
    return fallback;
  }
};
const today = () => new Date().toISOString().slice(0, 10);
const NOT_KNOWN = { budget_max: "budget", move_in_month: "move-in month", areas: "area or distance from campus", rooms_needed: "rooms needed" };

// An error whose message is safe to hand to the model as a tool result.
class ToolRefused extends Error {
  constructor(message, extra = {}) {
    super(message);
    this.publicMessage = message;
    this.extra = extra;
  }
}

// ── Storage ──────────────────────────────────────────────────────────────────

async function loadThread(db, userId) {
  const row = await db.prepare(`SELECT memory, last_results FROM assistant_threads WHERE user_id = ?1`).bind(userId).first();
  // state: what's on screen (refs -> ids, server only) and, for basic mode, the question last asked.
  return { memory: parseMemory(row?.memory), state: parseJson(row?.last_results, {}) };
}

const saveThread = (db, userId, memory, state) =>
  db
    .prepare(
      `INSERT INTO assistant_threads (user_id, memory, last_results, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)
       ON CONFLICT (user_id) DO UPDATE SET memory = excluded.memory, last_results = excluded.last_results, updated_at = excluded.updated_at`
    )
    .bind(userId, JSON.stringify(memory), JSON.stringify(state), Date.now());

async function usageToday(db, userId) {
  const { results } = await db
    .prepare(`SELECT user_id, replies FROM assistant_usage WHERE day = ?1 AND user_id IN (?2, '*')`)
    .bind(today(), userId)
    .all();
  return { user: results.find((r) => r.user_id === userId)?.replies || 0, site: results.find((r) => r.user_id === "*")?.replies || 0 };
}

const addUsage = (db, userId, replies, usage) =>
  [userId, "*"].map((who) =>
    db
      .prepare(
        `INSERT INTO assistant_usage (day, user_id, replies, input_tokens, output_tokens) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT (day, user_id) DO UPDATE SET replies = replies + excluded.replies,
           input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`
      )
      .bind(today(), who, replies, usage.input, usage.output)
  );

// Why the AI is off right now, or null when it can answer.
async function basicReason(env, db, userId) {
  if (!aiConfigured(env)) return "not_configured";
  const limits = limitsFor(env);
  const used = await usageToday(db, userId);
  if (used.user >= limits.perUserDaily) return "user_limit";
  if (used.site >= limits.siteDaily) return "site_limit";
  return null;
}
const BASIC_NOTICES = {
  user_limit: (env) => `You've used today's ${limitsFor(env).perUserDaily} AI replies, so this is the guided chat until tomorrow (UTC).`,
  site_limit: () => "The AI assistant has hit today's limit for coHabit, so this is the guided chat until tomorrow (UTC).",
  unavailable: () => "The AI assistant isn't available right now, so this is the guided chat.",
};

// Statements that remove everything the assistant stored about a user (used when an account is deleted).
export const assistantDeleteStatements = (db, userId) => [
  db.prepare(`DELETE FROM assistant_messages WHERE user_id = ?1`).bind(userId),
  db.prepare(`DELETE FROM assistant_actions WHERE user_id = ?1`).bind(userId),
  db.prepare(`DELETE FROM assistant_threads WHERE user_id = ?1`).bind(userId),
  db.prepare(`DELETE FROM saved_options WHERE user_id = ?1 OR (kind = 'person' AND target_id = ?1)`).bind(userId),
  db.prepare(`DELETE FROM assistant_usage WHERE user_id = ?1`).bind(userId),
  db.prepare(`DELETE FROM app_rate_limits WHERE key = ?1`).bind(`a:u:${userId}`),
];

// Daily cleanup: chats unused for INACTIVE_DAYS, unanswered confirmation cards after 7 days,
// per-renter usage after 7 days (site totals after 90).
export function assistantCleanup(db, nowMs) {
  const stale = nowMs - INACTIVE_DAYS * 86400_000;
  const day = (n) => new Date(nowMs - n * 86400_000).toISOString().slice(0, 10);
  return [
    db.prepare(`DELETE FROM assistant_messages WHERE user_id IN (SELECT user_id FROM assistant_threads WHERE updated_at < ?1)`).bind(stale),
    db.prepare(`DELETE FROM assistant_actions WHERE user_id IN (SELECT user_id FROM assistant_threads WHERE updated_at < ?1)`).bind(stale),
    db.prepare(`DELETE FROM assistant_threads WHERE updated_at < ?1`).bind(stale),
    db.prepare(`UPDATE assistant_actions SET status = 'dismissed', decided_at = ?2 WHERE status = 'pending' AND created_at < ?1`).bind(nowMs - 7 * 86400_000, nowMs),
    db.prepare(`DELETE FROM assistant_usage WHERE (user_id != '*' AND day < ?1) OR day < ?2`).bind(day(7), day(90)),
  ];
}

// ── What the page gets back ──────────────────────────────────────────────────

// Turns stored cards (ids on the server) into what the page shows, with current listing details.
// A room that is no longer listed, or a person who turned roommate matching off, is shown as gone.
async function hydrate(db, env, user, messages, savedRows) {
  const cardsOf = (m) => parseJson(m.cards, null);
  const unitIds = new Set();
  const personIds = new Set();
  const actionIds = new Set();
  for (const m of messages) {
    const c = cardsOf(m);
    for (const it of c?.items || []) (it.kind === "room" ? unitIds : personIds).add(it.targetId);
    for (const id of c?.actions || []) actionIds.add(id);
  }
  for (const s of savedRows) (s.kind === "room" ? unitIds : personIds).add(s.target_id);

  const json = (set) => JSON.stringify([...set]);
  const [units, people, actions, mine, interests, saved] = await Promise.all([
    unitIds.size
      ? db.prepare(`SELECT ${LISTING_FIELDS} FROM units WHERE status = 'active' AND id IN (SELECT value FROM json_each(?1))`).bind(json(unitIds)).all()
      : { results: [] },
    personIds.size
      ? db
          .prepare(
            `SELECT p.user_id, p.share_email, u.name, u.email, (u.id LIKE 'sample-%') AS sample FROM match_preferences p JOIN "user" u ON u.id = p.user_id
             WHERE p.roommate_visible = 1 AND u.account_type = 'renter' AND p.user_id IN (SELECT value FROM json_each(?1))`
          )
          .bind(json(personIds))
          .all()
      : { results: [] },
    actionIds.size
      ? db.prepare(`SELECT id, kind, payload, status FROM assistant_actions WHERE user_id = ?1 AND id IN (SELECT value FROM json_each(?2))`).bind(user.id, json(actionIds)).all()
      : { results: [] },
    personIds.size ? db.prepare(`SELECT roommate_visible FROM match_preferences WHERE user_id = ?1`).bind(user.id).first() : null,
    unitIds.size ? db.prepare(`SELECT unit_id FROM unit_interests WHERE renter_user_id = ?1`).bind(user.id).all() : { results: [] },
    db.prepare(`SELECT id, kind, target_id FROM saved_options WHERE user_id = ?1`).bind(user.id).all(),
  ]);
  const unitById = new Map(units.results.map((u) => [u.id, listingMapper(env)(u)]));
  // You only see other renters while your own roommate matching is on (same rule as /api/renter/roommates).
  const personById = new Map(mine?.roommate_visible ? people.results.map((p) => [p.user_id, p]) : []);
  const sent = new Set(interests.results.map((i) => i.unit_id));
  const savedId = new Map(saved.results.map((s) => [`${s.kind}:${s.target_id}`, s.id]));

  const card = (it) => {
    const base = { kind: it.kind, ref: it.ref, fits: it.fits || [], misses: it.misses || [], savedId: savedId.get(`${it.kind}:${it.targetId}`) || null };
    if (it.kind === "room") {
      const u = unitById.get(it.targetId);
      return u
        ? { ...base, available: true, unit: u, km: u.location ? Math.round(kmBetween(u.location, BRANDEIS) * 10) / 10 : null, interestSent: sent.has(u.id) }
        : { ...base, available: false };
    }
    const p = personById.get(it.targetId);
    return p
      ? { ...base, available: true, firstName: firstNameOf(p.name), score: it.score ?? null, email: p.share_email ? p.email : null, sample: !!p.sample }
      : { ...base, available: false };
  };
  const actionById = new Map(actions.results.map((a) => [a.id, a]));
  const action = (id) => {
    const a = actionById.get(id);
    if (!a) return null;
    const p = parseJson(a.payload, {});
    return a.kind === "save_profile"
      ? { id: a.id, kind: a.kind, status: a.status, roommateOptIn: !!p.roommateOptIn, changes: p.changes || [] }
      : { id: a.id, kind: a.kind, status: a.status, unitName: p.unitName, note: p.note || "" };
  };

  return {
    messages: messages.map((m) => {
      const c = cardsOf(m) || {};
      return {
        id: m.id,
        role: m.role,
        text: m.content,
        mode: m.mode,
        createdAt: m.created_at,
        cards: (c.items || []).map(card),
        actions: (c.actions || []).map(action).filter(Boolean),
        quickReplies: c.quick || [],
        notice: c.notice || null,
      };
    }),
    saved: savedRows.map((s) => ({ id: s.id, ...card({ kind: s.kind, targetId: s.target_id, ...parseJson(s.note, {}) }), savedId: s.id })),
  };
}

async function pageState(db, env, user) {
  const [{ results: rows }, { results: savedRows }, thread, prefs, reason, used] = await Promise.all([
    db.prepare(`SELECT id, role, content, cards, mode, created_at FROM assistant_messages WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ${SHOW_MESSAGES}`).bind(user.id).all(),
    db.prepare(`SELECT id, kind, target_id, note FROM saved_options WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30`).bind(user.id).all(),
    loadThread(db, user.id),
    loadPreferences(db, user.id),
    basicReason(env, db, user.id),
    usageToday(db, user.id),
  ]);
  const { messages, saved } = await hydrate(db, env, user, rows.reverse(), savedRows);
  return {
    messages,
    saved,
    results: await liveResults(db, env, user, thread.memory, prefs),
    memory: memoryFacts(thread.memory),
    hasProfile: !!prefs,
    roommateMatching: !!prefs?.roommate_visible,
    mode: reason ? "basic" : "ai",
    basicReason: reason,
    usage: { usedToday: used.user, perUserDaily: limitsFor(env).perUserDaily },
    keepDays: INACTIVE_DAYS,
  };
}

// ── One turn ─────────────────────────────────────────────────────────────────

// The fixed instructions are cached; this note carries everything that changes from turn to turn.
function contextNote(turn, saved, pending) {
  const v = turn.memory.v;
  const strict = STRICTNESS_FIELDS.filter((f) => v[f] != null);
  const lines = [
    "coHabit system note (from coHabit, not from the student).",
    `Today: ${today()}.`,
    ...(turn.state.welcomed ? [] : ['The page greeted the student with "Hey! What are you looking for?" and the buttons A room, A roommate and Both.']),
    `Memory: ${Object.keys(v).length ? JSON.stringify({ values: v, must_have: strict.filter((f) => isRequired(turn.memory, f)), flexible: strict.filter((f) => !isRequired(turn.memory, f)) }) : "nothing yet."}`,
    `Still needed before a room search: ${missingBasics(turn.memory).map((f) => NOT_KNOWN[f]).join(", ") || "nothing"}.`,
    `Saved coHabit profile: ${saved ? `yes, roommate matching ${saved.roommate_visible ? "on" : "off"}` : "no"}.`,
    `On screen now: ${[...(turn.state.rooms || []).map((r) => `${r.ref} "${r.name}"`), ...(turn.state.people || []).map((p) => p.ref)].join(", ") || "no results yet"}.`,
  ];
  if (pending.length) lines.push(`Waiting for the student to confirm: ${pending.map((a) => a.kind.replace(/_/g, " ")).join(", ")}.`);
  return lines.join("\n");
}

async function findRooms(ctx) {
  const listings = await activeListings(ctx.db, ctx.env);
  const found = searchRooms(ctx.turn.memory, listings);
  ctx.turn.found = { kind: "room", found };
  ctx.turn.items = found.results.map((r) => ({ kind: "room", ref: r.ref, targetId: r.unitId, fits: r.fits, misses: r.misses }));
  ctx.turn.state.rooms = found.results.map((r) => ({ ref: r.ref, unitId: r.unitId, name: r.name }));
  ctx.turn.state.people = [];
  return found;
}

// Returns { status, found?, missing? }. Only renters who turned roommate matching on are compared,
// and only for a renter who turned it on too.
async function roommateSearch(db, user, memory, saved, { limit } = {}) {
  const merged = mergedPreferences(memory, saved);
  if (!saved || !saved.roommate_visible) return { status: saved ? "opt_in_required" : "needs_profile", missing: merged.missing || [] };
  if (merged.missing) return { status: "missing_answers", missing: merged.missing };
  const { results } = await db
    .prepare(
      `SELECT p.user_id, p.budget_min, p.budget_max, p.move_in_month, p.area, p.sleep_schedule, p.cleanliness, p.noise, p.guests,
         p.pets, p.smoking, p.chores, p.share_email, u.name, u.email, (u.id LIKE 'sample-%') AS sample
       FROM match_preferences p JOIN "user" u ON u.id = p.user_id
       WHERE p.roommate_visible = 1 AND p.user_id != ?1 AND u.account_type = 'renter'
       ORDER BY p.updated_at DESC LIMIT 500`
    )
    .bind(user.id)
    .all();
  const others = results.map((r) => ({ userId: r.user_id, prefs: r, firstName: firstNameOf(r.name), email: r.share_email ? r.email : null, sample: !!r.sample }));
  return { status: "ok", found: searchRoommates(memory, merged.prefs, others, { limit }) };
}

async function findRoommates(ctx) {
  const { db, user, saved, turn } = ctx;
  const r = await roommateSearch(db, user, turn.memory, saved);
  if (r.status !== "ok") return r;
  const found = r.found;
  turn.found = { kind: "person", found };
  turn.items = found.results.map((r) => ({ kind: "person", ref: r.ref, targetId: r.userId, fits: r.fits, misses: r.misses, score: r.score }));
  turn.state.people = found.results.map((r) => ({ ref: r.ref, userId: r.userId }));
  turn.state.rooms = [];
  return { status: "ok", found };
}

// ── The results panel ────────────────────────────────────────────────────────
// Worked out from the renter's current answers every time they change, separately from the chat, so results
// appear (marked preliminary) once there is enough to go on and refresh as answers change. Must-haves are
// never loosened here: an empty list says which ones are blocking and what loosening each would bring back.
async function liveResults(db, env, user, memory, saved) {
  const goal = memory.v.looking_for || null;
  const out = { goal, rooms: null, people: null };
  if (!goal) return out;
  const [{ results: savedRows }, { results: sentRows }] = await Promise.all([
    db.prepare(`SELECT id, kind, target_id FROM saved_options WHERE user_id = ?1`).bind(user.id).all(),
    db.prepare(`SELECT unit_id FROM unit_interests WHERE renter_user_id = ?1`).bind(user.id).all(),
  ]);
  const savedId = new Map(savedRows.map((s) => [`${s.kind}:${s.target_id}`, s.id]));
  const sent = new Set(sentRows.map((r) => r.unit_id));

  if (goal !== "roommates") {
    const missing = missingBasics(memory);
    const strict = STRICTNESS_FIELDS.filter((f) => memory.v[f] != null && isRequired(memory, f));
    if (missing.length >= 3) out.rooms = { status: "need_more", missing: missing.map((f) => NOT_KNOWN[f]) };
    else {
      const listings = await activeListings(db, env);
      const byId = new Map(listings.map((u) => [u.id, u]));
      const found = searchRooms(memory, listings, { limit: PANEL_ROOMS });
      out.rooms = {
        status: found.results.length ? "ok" : "none",
        preliminary: missing.length > 0,
        missing: missing.map((f) => NOT_KNOWN[f]),
        total: found.totalMatching,
        ifRelaxed: found.ifRelaxed,
        samplesHidden: found.samplesHidden,
        mustHaves: [...(memory.v.rooms_needed > 1 ? ["rooms_needed"] : []), ...strict],
        items: found.results.map((r) => ({
          kind: "room",
          ref: r.ref,
          available: true,
          unit: byId.get(r.unitId),
          km: r.km_from_brandeis,
          fits: r.fits,
          misses: r.misses,
          savedId: savedId.get(`room:${r.unitId}`) || null,
          interestSent: sent.has(r.unitId),
        })),
      };
    }
  }

  if (goal !== "room") {
    const r = await roommateSearch(db, user, memory, saved, { limit: PANEL_PEOPLE });
    out.people =
      r.status !== "ok"
        ? { status: r.status, missing: r.missing.map((f) => LABELS[f] || f) }
        : {
            status: r.found.results.length ? "ok" : "none",
            total: r.found.totalMatching,
            samplesHidden: r.found.samplesHidden,
            // Only what the two have in common, a first name, and an email only if that person chose to share it.
            items: r.found.results.map((p) => ({
              kind: "person",
              ref: p.ref,
              available: true,
              firstName: p.firstName,
              score: p.score,
              fits: p.fits,
              misses: p.misses,
              email: p.email,
              sample: p.sample,
              savedId: savedId.get(`person:${p.userId}`) || null,
            })),
          };
  }
  return out;
}

// Creates a confirmation card. Values come from memory and the database, never from the model.
async function proposeAction(ctx, kind, { ref, note } = {}) {
  const { db, user, saved, turn } = ctx;
  let payload;
  let dbKind = kind;
  if (kind === "save_profile" || kind === "turn_on_roommate_matching") {
    const merged = mergedPreferences(turn.memory, saved);
    if (merged.missing) throw new ToolRefused(`Ask for these first: ${merged.missing.map((f) => LABELS[f] || f).join(", ")}.`, { missing: merged.missing });
    const prefs = merged.prefs;
    const optIn = kind === "turn_on_roommate_matching";
    if (optIn) prefs.roommate_visible = true;
    // When turning matching on, email sharing is a separate tick box on the card, so it isn't listed as a change.
    const changes = profileChanges(saved, prefs).filter((c) => !(optIn && c.field === "share_email"));
    if (!changes.length) throw new ToolRefused(optIn ? "Roommate matching is already on and the profile is up to date." : "The saved profile already matches. Nothing to save.");
    payload = { prefs, changes, roommateOptIn: optIn };
    dbKind = "save_profile";
  } else if (kind === "contact_landlord") {
    const room = (turn.state.rooms || []).find((r) => r.ref === ref);
    if (!room) throw new ToolRefused("Use the label of a room card that is on screen (R1-R3).");
    const draft = typeof note === "string" ? note.slice(0, 400) : "";
    let checked;
    try {
      checked = parseInterest({ unit_id: room.unitId, message: draft });
    } catch (e) {
      if (e instanceof InvalidInput) throw new ToolRefused(`Note refused: ${e.message}`);
      throw e;
    }
    const unit = await db
      .prepare(`SELECT name, (landlord_user_id LIKE 'sample-%') AS sample FROM units WHERE id = ?1 AND status = 'active'`)
      .bind(room.unitId)
      .first();
    if (!unit) throw new ToolRefused("That room is no longer listed.");
    if (unit.sample) throw new ToolRefused("That is a sample (fictional) listing, so there is no landlord to contact.");
    const sentBefore = await db.prepare(`SELECT 1 FROM unit_interests WHERE unit_id = ?1 AND renter_user_id = ?2`).bind(room.unitId, user.id).first();
    if (sentBefore) throw new ToolRefused("The student already contacted this landlord.");
    payload = { unitId: room.unitId, unitName: unit.name, note: checked.message };
  } else throw new ToolRefused("Unknown action.");

  const id = crypto.randomUUID();
  await db.batch([
    // A newer card replaces an unanswered one of the same kind.
    db.prepare(`UPDATE assistant_actions SET status = 'dismissed', decided_at = ?3 WHERE user_id = ?1 AND kind = ?2 AND status = 'pending'`).bind(user.id, dbKind, Date.now()),
    db
      .prepare(`INSERT INTO assistant_actions (id, user_id, message_id, kind, payload, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`)
      .bind(id, user.id, ctx.assistantId, dbKind, JSON.stringify(payload), Date.now()),
  ]);
  turn.actions.push(id);
  return id;
}

function aiTools(ctx) {
  const { turn } = ctx;
  return {
    async update_memory(input) {
      const r = applyUpdates(turn.memory, input, today());
      turn.memory = r.memory;
      return { recorded: r.changed, refused: r.errors, memory: memoryFacts(r.memory), still_needed_for_search: missingBasics(r.memory).map((f) => NOT_KNOWN[f]) };
    },
    async search_rooms() {
      const found = await findRooms(ctx);
      return {
        results: found.results.map(({ unitId, ...r }) => r),
        total_matching: found.totalMatching,
        if_relaxed: found.ifRelaxed,
        sample_listings_hidden: found.samplesHidden,
        not_yet_known: missingBasics(turn.memory).map((f) => NOT_KNOWN[f]),
      };
    },
    async search_roommates() {
      const r = await findRoommates(ctx);
      if (r.status !== "ok") {
        const why = {
          needs_profile: "The student has no saved profile. Once you know the basics and lifestyle answers, offer turn_on_roommate_matching.",
          opt_in_required: "Roommate matching is off for this student. Offer turn_on_roommate_matching (it shows a confirmation card).",
          missing_answers: "Ask for the missing lifestyle answers first.",
        }[r.status];
        return { status: r.status, explanation: why, missing: r.missing.map((f) => LABELS[f] || f) };
      }
      return {
        status: "ok",
        results: r.found.results.map((p) => ({ ref: p.ref, compatibility_score: p.score, in_common: p.fits, note: p.misses[0] || null, sample: p.sample })),
        total_matching: r.found.totalMatching,
        sample_people_hidden: r.found.samplesHidden,
      };
    },
    async propose_action({ kind, ref, note }) {
      try {
        const id = await proposeAction(ctx, kind, { ref, note });
        return { status: "card_shown", action_id: id, tell_student: "A confirmation card is waiting for them. Nothing happens unless they click Confirm." };
      } catch (e) {
        if (e instanceof ToolRefused) return { status: "not_shown", reason: e.message, ...e.extra };
        throw e;
      }
    },
  };
}

// Basic mode: the rule-based reply (see src/assistant/basic.js).
async function basicTurn(ctx, text) {
  const { turn } = ctx;
  const state = turn.state;
  // The page opens with "What are you looking for?" (A room / A roommate / Both), so that's the first question.
  const asked = state.asked ?? (state.welcomed ? null : "looking_for");
  state.welcomed = true;
  const { updates, intents } = understand(text, today(), asked);
  const skipped = new Set(state.skipped || []);
  if (intents.has("skip") && asked) skipped.add(asked);
  // A tapped answer button needs no echo; a typed answer gets a short "Noted" so the student sees what was understood.
  const tapped = !!asked && question(asked, today(), turn.memory).options.some((o) => o.toLowerCase() === text.trim().toLowerCase());
  const r = applyUpdates(turn.memory, updates, today());
  turn.memory = r.memory;
  const v = turn.memory.v;
  const wantsRoommates = intents.has("roommates") || v.looking_for === "roommates" || v.looking_for === "both";
  const wantsRooms = v.looking_for !== "roommates";
  const understood = r.changed.length || r.errors.length || [...intents].some((i) => i !== "greeting");
  const lines = [];

  if (intents.has("greeting")) lines.push("Hey!");
  else if (!understood) lines.push(`Sorry, I didn't catch that. ${BASIC_INTRO}`);
  const said = r.changed.map((f) => describeAnswer(f, v[f])).filter(Boolean);
  if (said.length && !tapped) lines.push(`Noted: ${said.join(", ")}.`);
  for (const e of r.errors) lines.push(e.message);
  if (intents.has("considerations")) lines.push(CONSIDERATIONS);

  // What to ask next: first whether it's a room or a roommate (once), then the basics.
  let ask = null;
  if (v.looking_for == null && !state.lookingForAsked && !intents.has("roommates") && !intents.has("search")) {
    ask = "looking_for";
    state.lookingForAsked = true;
  } else ask = nextQuestion(turn.memory, { skipped: [...skipped] });

  if (!ask) {
    const basicsChanged = r.changed.some((f) => ["budget_max", "move_in_month", "areas", "max_distance_km", "rooms_needed", "include_samples"].includes(f.split(":")[0]));
    const roommatesOnly = intents.has("roommates") && !basicsChanged && !intents.has("search");
    if (wantsRooms && !roommatesOnly && (basicsChanged || intents.has("search") || !state.searched)) {
      lines.push(describeRooms(await findRooms(ctx)));
      state.searched = true;
    }
    if (wantsRoommates) {
      const life = nextQuestion(turn.memory, { wantsRoommates: true, skipped: [...skipped] });
      if (life) ask = life;
      else {
        const rm = await findRoommates(ctx);
        if (rm.status === "ok") lines.push(describeRoommates(rm.found));
        else if (rm.status === "missing_answers") ask = rm.missing[0];
        else if (!state.optInOffered || intents.has("roommates")) {
          try {
            await proposeAction(ctx, "turn_on_roommate_matching");
            lines.push("To see roommates, turn on roommate matching. Students who did will see your first name and what you have in common. Nothing changes until you confirm below.");
            state.optInOffered = true;
          } catch (e) {
            if (!(e instanceof ToolRefused)) throw e;
            if (e.extra.missing?.length) ask = e.extra.missing[0];
            else lines.push(e.message);
          }
        }
      }
    }
  }
  if (intents.has("save")) {
    try {
      await proposeAction(ctx, "save_profile");
      lines.push("Here's what would go on your profile. Confirm below if it looks right.");
    } catch (e) {
      if (!(e instanceof ToolRefused)) throw e;
      if (e.extra.missing?.length) ask ??= e.extra.missing[0];
      else lines.push(e.message);
    }
  }

  let quick = [];
  if (ask) {
    const q = question(ask, today(), turn.memory);
    lines.push(q.text);
    quick = q.options;
  } else if (!turn.items && !turn.actions.length) {
    lines.push("Anything else? Tap an option or type a change.");
    quick = ["Show rooms", "Find a roommate", "What should I consider?"];
  }
  state.asked = ask || null;
  state.skipped = [...skipped];
  turn.quick = quick;
  return lines.join("\n");
}

// When the model's reply can't be used, say the same thing from the search results instead.
function factualSummary(ctx) {
  const f = ctx.turn.found;
  if (f?.kind === "room") return describeRooms(f.found);
  if (f?.kind === "person") return describeRoommates(f.found);
  const next = nextQuestion(ctx.turn.memory, {});
  return next ? question(next, today(), ctx.turn.memory).text : "Sorry, I couldn't put that answer together. Could you say it another way?";
}

async function handleMessage({ request, env, db, user }) {
  const text = parseChatText(await readJson(request));
  const limits = limitsFor(env);
  const [thread, saved, { results: recentDesc }, reason, { results: pending }] = await Promise.all([
    loadThread(db, user.id),
    loadPreferences(db, user.id),
    db.prepare(`SELECT role, content FROM assistant_messages WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ${HISTORY_FOR_MODEL}`).bind(user.id).all(),
    basicReason(env, db, user.id),
    db.prepare(`SELECT kind FROM assistant_actions WHERE user_id = ?1 AND status = 'pending'`).bind(user.id).all(),
  ]);
  // A per-minute cap on AI replies (they cost money); basic mode is only under the site-wide write limit.
  if (!reason) await rateLimit(env, `a:u:${user.id}`, limits.perMinute, "You're sending messages quickly. Wait a moment and try again.");
  const now = Date.now();
  const userMsg = { id: crypto.randomUUID(), role: "user", content: text, cards: null, mode: null, created_at: now };
  await db
    .prepare(`INSERT INTO assistant_messages (id, user_id, role, content, created_at) VALUES (?1, ?2, 'user', ?3, ?4)`)
    .bind(userMsg.id, user.id, text, now)
    .run();

  const turn = { memory: thread.memory, state: { ...thread.state }, items: null, actions: [], quick: [], found: null };
  const ctx = { db, env, user, saved, turn, assistantId: crypto.randomUUID() };
  const writes = [];
  let mode = "basic";
  let notice = reason && reason !== "not_configured" ? BASIC_NOTICES[reason](env) : null;
  let reply;

  if (!reason) {
    // Replay earlier messages as plain text; the history must start with the student.
    const history = recentDesc.reverse().map((m) => ({ role: m.role, content: m.content }));
    while (history.length && history[0].role !== "user") history.shift();
    const note = contextNote(turn, saved, pending);
    try {
      const out = await runAiTurn({ env, history, text, note, tools: aiTools(ctx) });
      const allowed = allowedNumbers([text, note, JSON.stringify(turn.memory.v), ...history.filter((m) => m.role === "user").map((m) => m.content), ...out.toolLog.map((t) => JSON.stringify(t.result))]);
      const grounded = groundReply(out.reply, allowed);
      if (grounded.removed) console.warn("Assistant reply had unsupported numbers; sentences removed:", grounded.removed);
      reply = grounded.ok ? grounded.text : factualSummary(ctx);
      mode = "ai";
      turn.state.asked = null;
      turn.state.welcomed = true;
      writes.push(...addUsage(db, user.id, 1, out.usage));
    } catch (e) {
      if (!(e instanceof AiUnavailable)) throw e;
      console.error("Assistant AI unavailable:", e.reason, e.cause?.status || "", e.cause?.message || "");
      if (e.usage?.input || e.usage?.output) writes.push(...addUsage(db, user.id, 0, e.usage));
      notice = BASIC_NOTICES.unavailable();
    }
  }
  if (mode === "basic") reply = await basicTurn(ctx, text);

  const cards = { items: turn.items || [], actions: turn.actions, quick: turn.quick, notice };
  const assistantMsg = { id: ctx.assistantId, role: "assistant", content: reply.slice(0, 4000), cards: JSON.stringify(cards), mode, created_at: now + 1 };
  await db.batch([
    db
      .prepare(`INSERT INTO assistant_messages (id, user_id, role, content, cards, mode, created_at) VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6)`)
      .bind(assistantMsg.id, user.id, assistantMsg.content, assistantMsg.cards, mode, assistantMsg.created_at),
    saveThread(db, user.id, turn.memory, turn.state),
    db
      .prepare(`DELETE FROM assistant_messages WHERE user_id = ?1 AND id NOT IN (SELECT id FROM assistant_messages WHERE user_id = ?1 ORDER BY created_at DESC LIMIT ${KEEP_MESSAGES})`)
      .bind(user.id),
    ...writes,
  ]);

  const { results: savedRows } = await db.prepare(`SELECT id, kind, target_id, note FROM saved_options WHERE user_id = ?1 ORDER BY created_at DESC LIMIT 30`).bind(user.id).all();
  const { messages, saved: savedList } = await hydrate(db, env, user, [userMsg, assistantMsg], savedRows);
  const nowReason = mode === "ai" ? await basicReason(env, db, user.id) : reason || "unavailable";
  return {
    messages,
    saved: savedList,
    results: await liveResults(db, env, user, turn.memory, saved),
    memory: memoryFacts(turn.memory),
    mode: nowReason ? "basic" : "ai",
    basicReason: nowReason,
    usage: { usedToday: (await usageToday(db, user.id)).user, perUserDaily: limits.perUserDaily },
  };
}

// ── Confirmations and saved options ──────────────────────────────────────────

async function decideAction({ request, db, user }, id) {
  const body = await readJson(request);
  if (!["confirm", "dismiss"].includes(body?.decision)) throw new InvalidInput("decision", "Choose confirm or dismiss.");
  const a = isUnitId(id) ? await db.prepare(`SELECT id, kind, payload, status FROM assistant_actions WHERE id = ?1 AND user_id = ?2`).bind(id, user.id).first() : null;
  if (!a) throw new HttpError(404, "not_found", "This confirmation is no longer available.");
  if (a.status !== "pending") throw new HttpError(409, "already_decided", a.status === "done" ? "This was already confirmed." : "This was dismissed or replaced by a newer card.");
  const payload = parseJson(a.payload, {});
  const result = {};
  if (body.decision === "confirm") {
    if (a.kind === "save_profile") {
      const p = parsePreferences({
        ...payload.prefs,
        roommate_visible: payload.roommateOptIn ? true : !!payload.prefs.roommate_visible,
        share_email: payload.roommateOptIn ? body.shareEmail === true : !!payload.prefs.share_email,
      });
      result.preferences = await savePreferences(db, user.id, p);
    } else {
      const { unit_id, message } = parseInterest({ unit_id: payload.unitId, message: typeof body.note === "string" ? body.note : payload.note });
      result.interest = await createInterest(db, user.id, unit_id, message);
    }
  }
  const res = await db
    .prepare(`UPDATE assistant_actions SET status = ?3, decided_at = ?4 WHERE id = ?1 AND user_id = ?2 AND status = 'pending'`)
    .bind(id, user.id, body.decision === "confirm" ? "done" : "dismissed", Date.now())
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, "already_decided", "This was already handled.");
  return { status: body.decision === "confirm" ? "done" : "dismissed", ...result };
}

async function saveOption({ request, env, db, user }) {
  const body = await readJson(request);
  let it;
  if (body?.kind === "room" || body?.kind === "person") {
    // From the results panel. Fits and misses are worked out again here, never taken from the request.
    const { memory } = await loadThread(db, user.id);
    if (body.kind === "room" && isUnitId(body.unitId)) {
      const found = searchRooms(memory, await activeListings(db, env), { limit: 200 });
      const r = found.results.find((x) => x.unitId === body.unitId);
      it = { kind: "room", ref: r?.ref || "", targetId: body.unitId, fits: r?.fits || [], misses: r?.misses || [] };
    } else if (body.kind === "person" && typeof body.ref === "string") {
      const r = await roommateSearch(db, user, memory, await loadPreferences(db, user.id), { limit: PANEL_PEOPLE });
      const p = r.status === "ok" ? r.found.results.find((x) => x.ref === body.ref && x.firstName === body.firstName) : null;
      if (p) it = { kind: "person", ref: p.ref, targetId: p.userId, fits: p.fits, misses: p.misses, score: p.score };
    }
  } else {
    const m = isUnitId(body?.messageId)
      ? await db.prepare(`SELECT cards FROM assistant_messages WHERE id = ?1 AND user_id = ?2 AND role = 'assistant'`).bind(body.messageId, user.id).first()
      : null;
    it = parseJson(m?.cards, {}).items?.find((x) => x.ref === body?.ref);
  }
  if (!it) throw new HttpError(404, "not_found", "That result is no longer available.");
  const still =
    it.kind === "room"
      ? await db.prepare(`SELECT 1 FROM units WHERE id = ?1 AND status = 'active'`).bind(it.targetId).first()
      : await db.prepare(`SELECT 1 FROM match_preferences WHERE user_id = ?1 AND roommate_visible = 1`).bind(it.targetId).first();
  if (!still) throw new HttpError(409, "gone", it.kind === "room" ? "This room is no longer listed." : "This person is no longer looking for roommates.");
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM saved_options WHERE user_id = ?1`).bind(user.id).first();
  if (n >= 30) throw new HttpError(409, "too_many_saved", "You can save up to 30 options. Remove one first.");
  await db
    .prepare(
      `INSERT INTO saved_options (id, user_id, kind, target_id, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
       ON CONFLICT (user_id, kind, target_id) DO UPDATE SET note = excluded.note`
    )
    .bind(crypto.randomUUID(), user.id, it.kind, it.targetId, JSON.stringify({ ref: it.ref, fits: it.fits, misses: it.misses, score: it.score }), Date.now())
    .run();
  return { saved: true };
}

// ── Router ───────────────────────────────────────────────────────────────────

export async function handleAssistant({ request, env, db, user, path, method, reply }) {
  const ctx = { request, env, db, user };
  if (path === "/api/assistant" && method === "GET") return reply(await pageState(db, env, user));
  if (path === "/api/assistant/messages" && method === "POST") return reply(await handleMessage(ctx));

  if (path === "/api/assistant/memory" && method === "POST") {
    const body = await readJson(request);
    const field = body?.field;
    if (typeof field !== "string") throw new InvalidInput("field", "Choose an answer to change.");
    const input = {};
    if (body.forget === true) input.forget = [field];
    else {
      if ("value" in body) input[field] = body.value;
      if (body.mustHave === true) input.must_have = [field];
      if (body.mustHave === false) input.flexible = [field];
    }
    if (!Object.keys(input).length) throw new InvalidInput("field", "Nothing to change.");
    const [thread, prefs] = await Promise.all([loadThread(db, user.id), loadPreferences(db, user.id)]);
    const r = applyUpdates(thread.memory, input, today());
    if (r.errors.length) throw new InvalidInput("value", r.errors[0].message);
    await saveThread(db, user.id, r.memory, thread.state).run();
    return reply({ memory: memoryFacts(r.memory), results: await liveResults(db, env, user, r.memory, prefs) });
  }

  if (path === "/api/assistant/clear" && method === "POST") {
    await db.batch([
      db.prepare(`DELETE FROM assistant_messages WHERE user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM assistant_actions WHERE user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM assistant_threads WHERE user_id = ?1`).bind(user.id),
    ]);
    return reply({ cleared: true });
  }

  const action = path.match(/^\/api\/assistant\/actions\/([^/]+)$/);
  if (action && method === "POST") return reply(await decideAction(ctx, action[1]));

  if (path === "/api/assistant/saved" && method === "POST") {
    await saveOption(ctx);
    return reply(await pageState(db, env, user).then((s) => ({ saved: s.saved })), 201);
  }
  const savedMatch = path.match(/^\/api\/assistant\/saved\/([^/]+)$/);
  if (savedMatch && method === "DELETE") {
    const res = isUnitId(savedMatch[1]) ? await db.prepare(`DELETE FROM saved_options WHERE id = ?1 AND user_id = ?2`).bind(savedMatch[1], user.id).run() : null;
    if (!res || res.meta.changes !== 1) throw new HttpError(404, "not_found", "Saved option not found.");
    return reply({ deleted: true });
  }
  throw new HttpError(404, "not_found", "Not found.");
}

// For the admin page: today's and the last 7 days' AI use, with an estimated cost.
export async function assistantUsageReport(env, db) {
  const model = modelFor(env);
  const [inPrice, outPrice] = MODELS[model].price;
  const { results } = await db
    .prepare(`SELECT day, replies, input_tokens, output_tokens FROM assistant_usage WHERE user_id = '*' AND day >= ?1 ORDER BY day DESC`)
    .bind(new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10))
    .all();
  const days = results.map((r) => ({ ...r, estimatedUsd: Math.round(((r.input_tokens * inPrice + r.output_tokens * outPrice) / 1e6) * 100) / 100 }));
  return { aiConfigured: aiConfigured(env), model, limits: limitsFor(env), today: days.find((d) => d.day === today()) || null, last7Days: days };
}
