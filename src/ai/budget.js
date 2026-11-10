// Keeping AI use inside OpenRouter's free tier, and the admin's on/off switches (docs/OPENROUTER_PLAN.md).
//
// OpenRouter allows 50 free requests a day for the whole account. coHabit splits them by use (a chat reply is
// usually 2-3 requests) and counts its own requests per UTC day in assistant_usage, under the ids "or:chat",
// "or:helper" and "or:admin" (no user data). Each person's helper uses are counted under "h:<user id>". OpenRouter's
// own counter is checked too; after it says the limit is reached (429), AI pauses until the next UTC day.
// No database change was needed: switches and the pause live in app_settings.
import { keyStatus, openRouterConfigured } from "./openrouter.js";

const posInt = (v, d) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : d);
export const aiBudget = (env) => ({
  chat: posInt(env.AI_DAILY_CHAT, 34), // requests a day for the assistant (about 12-17 replies)
  helper: posInt(env.AI_DAILY_HELPERS, 10), // requests a day for the writing and search helpers
  admin: posInt(env.AI_DAILY_ADMIN, 6), // requests a day for the admin's model check and check-in themes
  helperPerUser: posInt(env.AI_HELPER_PER_USER, 3), // helper uses per person a day
  perMinute: posInt(env.AI_SITE_PER_MINUTE, 6), // AI chat replies a minute for the whole site (OpenRouter: 20 requests)
});
export const CHAT_REQUESTS_PER_REPLY = 3; // reserved before a chat reply starts

const today = () => new Date().toISOString().slice(0, 10);
const SETTINGS = ["ai_chat", "ai_helpers", "ai_paused_until", "ai_last_model", "ai_last_check"];

export const setSetting = (db, key, value) =>
  db
    .prepare(
      `INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, String(value), Date.now());

export async function aiSettings(db) {
  const { results } = await db
    .prepare(`SELECT key, value FROM app_settings WHERE key IN (${SETTINGS.map((k) => `'${k}'`).join(",")})`)
    .all();
  const v = Object.fromEntries(results.map((r) => [r.key, r.value]));
  const paused = v.ai_paused_until && Date.parse(v.ai_paused_until) > Date.now() ? v.ai_paused_until : null;
  let lastCheck = null;
  try {
    lastCheck = v.ai_last_check ? JSON.parse(v.ai_last_check) : null;
  } catch {}
  return { chat: v.ai_chat === "1", helpers: v.ai_helpers === "1", pausedUntil: paused, lastModel: v.ai_last_model || null, lastCheck };
}

// After OpenRouter's 429: wait as long as it says, or until the next UTC day (when the free count resets).
export function pauseStatement(db, retryAfterSeconds) {
  const midnight = new Date();
  midnight.setUTCHours(24, 0, 0, 0);
  const until = retryAfterSeconds ? new Date(Math.min(Date.now() + retryAfterSeconds * 1000, midnight.getTime())) : midnight;
  return setSetting(db, "ai_paused_until", until.toISOString());
}

export const countRequests = (db, use, n, usage = { input: 0, output: 0 }) =>
  db
    .prepare(
      `INSERT INTO assistant_usage (day, user_id, replies, input_tokens, output_tokens) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (day, user_id) DO UPDATE SET replies = replies + excluded.replies,
         input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens`
    )
    .bind(today(), `or:${use}`, n, usage.input || 0, usage.output || 0);

export const countHelperUse = (db, userId) =>
  db
    .prepare(
      `INSERT INTO assistant_usage (day, user_id, replies) VALUES (?1, ?2, 1)
       ON CONFLICT (day, user_id) DO UPDATE SET replies = replies + 1`
    )
    .bind(today(), `h:${userId}`);

export async function requestsToday(db) {
  const { results } = await db
    .prepare(`SELECT user_id, replies, input_tokens, output_tokens FROM assistant_usage WHERE day = ?1 AND user_id LIKE 'or:%'`)
    .bind(today())
    .all();
  const out = { chat: 0, helper: 0, admin: 0, tokens: { input: 0, output: 0 } };
  for (const r of results) {
    out[r.user_id.slice(3)] = r.replies;
    out.tokens.input += r.input_tokens;
    out.tokens.output += r.output_tokens;
  }
  return out;
}

export async function helperUsesToday(db, userId) {
  const row = await db.prepare(`SELECT replies FROM assistant_usage WHERE day = ?1 AND user_id = ?2`).bind(today(), `h:${userId}`).first();
  return row?.replies || 0;
}

// Why AI can't be used for this right now, or null when it can.
// not_configured: no key. off: the admin's switch is off. paused: OpenRouter's free limit was reached today.
// site_limit: coHabit's own share for this use is used up today.
export async function aiBlock(env, db, use, need = 1) {
  if (!openRouterConfigured(env)) return "not_configured";
  const s = await aiSettings(db);
  if ((use === "chat" && !s.chat) || (use === "helper" && !s.helpers)) return "off";
  if (s.pausedUntil) return "paused";
  const used = (await requestsToday(db))[use] || 0;
  if (used + need > aiBudget(env)[use]) return "site_limit";
  const k = await keyStatus(env);
  if (k?.ok && k.freeToday.remaining != null && k.freeToday.remaining < need) return "paused";
  return null;
}
