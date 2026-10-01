// coHabit Worker. Static pages in ./public are served by Cloudflare directly;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
//   /api/auth/*   Google sign-in, sign-out, session (Better Auth, allowlisted paths only)
//   /api/me       who is signed in; one-time landlord/renter choice; delete my account
//   /api/landlord/units[/<id>]   a landlord's own units
//   /api/listings                active units, listing fields only (public)
//   /api/renter/preferences      a renter's own questionnaire answers
//   /api/renter/matches          active units ranked against those answers
//   /api/admin/users             read-only user list (admin only)
import { getAuth } from "./auth.js";
import { rankUnits } from "./match.js";
import { InvalidInput, isUnitId, parseAccountType, parsePreferences, parseUnit } from "./validate.js";

const MAX_BODY = 16 * 1024;
const MAX_UNITS_PER_LANDLORD = 50;
const LIMITS = { read: 120, write: 30 }; // requests per minute per user (or per IP when signed out)

class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const SECURITY_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
};

function json(data, status = 200, setCookies = []) {
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS });
  for (const c of setCookies) headers.append("Set-Cookie", c);
  return new Response(JSON.stringify(data), { status, headers });
}

function withSecurityHeaders(response) {
  const r = new Response(response.body, response);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) r.headers.set(k, v);
  return r;
}

// ── Request helpers ─────────────────────────────────────────────────────────

// Cookie-authenticated writes must come from our own pages.
function assertSameOrigin(request, env) {
  const expected = new URL(env.BETTER_AUTH_URL).origin;
  const origin = request.headers.get("Origin");
  const site = request.headers.get("Sec-Fetch-Site");
  if (origin !== expected || (site && site !== "same-origin")) {
    throw new HttpError(403, "forbidden_origin", "This request must come from the coHabit site.");
  }
}

async function readJson(request) {
  const type = (request.headers.get("Content-Type") || "").toLowerCase();
  if (!type.startsWith("application/json")) throw new HttpError(415, "unsupported_type", "Send JSON.");
  if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) throw new HttpError(413, "too_large", "Request too large.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "invalid_json", "Request body is empty.");
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) {
      await reader.cancel();
      throw new HttpError(413, "too_large", "Request too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    bytes.set(c, at);
    at += c.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "invalid_json", "Request body is not valid JSON.");
  }
}

// Fixed one-minute window counter in D1, shared by every Worker instance.
async function rateLimit(env, key, max) {
  const windowStart = Math.floor(Date.now() / 60000);
  const row = await env.DB.prepare(
    `INSERT INTO app_rate_limits (key, window_start, count) VALUES (?1, ?2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN window_start = ?2 THEN count + 1 ELSE 1 END,
       window_start = ?2
     RETURNING count`
  )
    .bind(key, windowStart)
    .first();
  if (row && row.count > max) throw new HttpError(429, "rate_limited", "Too many requests. Wait a minute and try again.");
}

const hasSessionCookie = (request) => /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(request.headers.get("Cookie") || "");

// Reads the session and user from D1 on every call (no cookie cache), so a
// revoked session or changed role takes effect immediately.
async function getViewer(request, env) {
  if (!hasSessionCookie(request)) return { user: null, setCookies: [] };
  const { headers, response } = await getAuth(env).api.getSession({ headers: request.headers, returnHeaders: true });
  const setCookies = headers?.getSetCookie?.() ?? [];
  if (!response) return { user: null, expired: true, setCookies };
  const u = response.user;
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, accountType: u.accountType ?? null }, setCookies };
}

function requireUser(viewer) {
  if (viewer.user) return viewer.user;
  if (viewer.expired) throw new HttpError(401, "session_expired", "Your session has ended. Sign in again.");
  throw new HttpError(401, "signed_out", "Sign in to continue.");
}

function requireType(viewer, type) {
  const user = requireUser(viewer);
  if (user.accountType !== type) {
    throw new HttpError(403, "wrong_account_type", `This is only available to ${type} accounts.`);
  }
  return user;
}

// ── Auth (Better Auth) ─────────────────────────────────────────────────────

const AUTH_ROUTES = new Set([
  "GET /api/auth/get-session",
  "POST /api/auth/sign-in/social",
  "GET /api/auth/callback/google",
  "POST /api/auth/sign-out",
]);

const safePath = (v, fallback) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&.]*$/.test(v) && v.length <= 200 ? v : fallback);

async function handleAuth(request, env, url) {
  if (!AUTH_ROUTES.has(`${request.method} ${url.pathname}`)) throw new HttpError(404, "not_found", "Not found.");
  const auth = getAuth(env);

  if (url.pathname === "/api/auth/sign-in/social") {
    assertSameOrigin(request, env);
    const body = await readJson(request);
    // Rebuild the body with only what we allow: Google, same-site return paths.
    // Drops fields such as extra scopes or a client-supplied ID token.
    const clean = {
      provider: "google",
      callbackURL: safePath(body?.callbackURL, "/welcome"),
      errorCallbackURL: "/signin-error",
      disableRedirect: true,
    };
    const headers = new Headers(request.headers);
    headers.delete("Content-Length");
    request = new Request(request.url, { method: "POST", headers, body: JSON.stringify(clean) });
  } else if (request.method === "POST") {
    assertSameOrigin(request, env);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) throw new HttpError(413, "too_large", "Request too large.");
  }
  return withSecurityHeaders(await auth.handler(request));
}

// ── App API ─────────────────────────────────────────────────────────────────

const UNIT_OWNER_FIELDS = "id, name, area, monthly_rent, rooms_available, move_in_date, description, status, created_at, updated_at";
// "sample" marks fictional demo listings (owned by users whose id starts with "sample-"; see scripts/sample-data.mjs).
const LISTING_FIELDS = "id, name, area, monthly_rent, rooms_available, move_in_date, description, (landlord_user_id LIKE 'sample-%') AS sample";
const asListing = (u) => ({ ...u, sample: !!u.sample });
const PREF_FIELDS =
  "budget_min, budget_max, move_in_month, area, rooms_needed, sleep_schedule, cleanliness, noise, guests, pets, smoking, updated_at";

async function handleApi(request, env, url) {
  const method = request.method;
  const path = url.pathname.replace(/\/+$/, "");
  const isWrite = method !== "GET" && method !== "HEAD";
  if (isWrite) assertSameOrigin(request, env);

  const viewer = await getViewer(request, env);
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  await rateLimit(env, `${isWrite ? "w" : "r"}:${viewer.user ? "u:" + viewer.user.id : "ip:" + ip}`, isWrite ? LIMITS.write : LIMITS.read);

  const reply = (data, status = 200) => json(data, status, viewer.setCookies);
  const db = env.DB;

  // Who am I
  if (path === "/api/me" && method === "GET") {
    const u = viewer.user;
    return reply({
      user: u && { name: u.name, email: u.email, accountType: u.accountType, isAdmin: u.role === "admin" },
      sessionExpired: !!viewer.expired,
    });
  }

  // One-time landlord / renter choice. Only ever sets account_type, never role.
  if (path === "/api/me/account-type" && method === "POST") {
    const user = requireUser(viewer);
    const accountType = parseAccountType(await readJson(request));
    const res = await db
      .prepare(`UPDATE "user" SET account_type = ?1, "updatedAt" = ?2 WHERE id = ?3 AND account_type IS NULL`)
      .bind(accountType, new Date().toISOString(), user.id)
      .run();
    if (res.meta.changes !== 1) throw new HttpError(409, "already_chosen", "Your account type is already set.");
    return reply({ accountType });
  }

  // Delete my own account and everything saved with it. Only ever the signed-in user's own row.
  if (path === "/api/me/delete" && method === "POST") {
    const user = requireUser(viewer);
    const body = await readJson(request);
    if (body?.confirm !== "DELETE") throw new InvalidInput("confirm", "Type DELETE to confirm.");
    if (user.role === "admin") {
      const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM "user" WHERE role = 'admin'`).first();
      if (n <= 1) throw new HttpError(409, "last_admin", "You are the only admin, so this account can't be deleted here.");
    }
    // One batch = one transaction in D1. Children first, then the user row.
    await db.batch([
      db.prepare(`DELETE FROM units WHERE landlord_user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM match_preferences WHERE user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM "session" WHERE "userId" = ?1`).bind(user.id),
      db.prepare(`DELETE FROM "account" WHERE "userId" = ?1`).bind(user.id),
      db.prepare(`DELETE FROM app_rate_limits WHERE key IN (?1, ?2)`).bind(`r:u:${user.id}`, `w:u:${user.id}`),
      db.prepare(`DELETE FROM "user" WHERE id = ?1`).bind(user.id),
    ]);
    const gone = "Max-Age=0; Path=/; HttpOnly; SameSite=Lax";
    return json({ deleted: true }, 200, [
      `better-auth.session_token=; ${gone}`,
      `__Secure-better-auth.session_token=; ${gone}; Secure`,
    ]);
  }

  // Landlord: own units only. Owner always comes from the session.
  if (path === "/api/landlord/units") {
    const user = requireType(viewer, "landlord");
    if (method === "GET") {
      const { results } = await db
        .prepare(`SELECT ${UNIT_OWNER_FIELDS} FROM units WHERE landlord_user_id = ?1 ORDER BY created_at DESC LIMIT ${MAX_UNITS_PER_LANDLORD}`)
        .bind(user.id)
        .all();
      return reply({ units: results });
    }
    if (method === "POST") {
      const unit = parseUnit(await readJson(request));
      const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM units WHERE landlord_user_id = ?1`).bind(user.id).first();
      if (n >= MAX_UNITS_PER_LANDLORD) throw new HttpError(409, "too_many_units", `You can list up to ${MAX_UNITS_PER_LANDLORD} units.`);
      const id = crypto.randomUUID();
      const now = Date.now();
      const created = await db
        .prepare(
          `INSERT INTO units (id, landlord_user_id, name, area, monthly_rent, rooms_available, move_in_date, description, status, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10) RETURNING ${UNIT_OWNER_FIELDS}`
        )
        .bind(id, user.id, unit.name, unit.area, unit.monthly_rent, unit.rooms_available, unit.move_in_date, unit.description, unit.status, now)
        .first();
      return reply({ unit: created }, 201);
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  const unitMatch = path.match(/^\/api\/landlord\/units\/([^/]+)$/);
  if (unitMatch) {
    const user = requireType(viewer, "landlord");
    const id = unitMatch[1];
    const notFound = new HttpError(404, "not_found", "Unit not found.");
    if (!isUnitId(id)) throw notFound;
    if (method === "GET") {
      const unit = await db.prepare(`SELECT ${UNIT_OWNER_FIELDS} FROM units WHERE id = ?1 AND landlord_user_id = ?2`).bind(id, user.id).first();
      if (!unit) throw notFound;
      return reply({ unit });
    }
    if (method === "PUT") {
      const unit = parseUnit(await readJson(request));
      const updated = await db
        .prepare(
          `UPDATE units SET name = ?3, area = ?4, monthly_rent = ?5, rooms_available = ?6, move_in_date = ?7,
             description = ?8, status = ?9, updated_at = ?10
           WHERE id = ?1 AND landlord_user_id = ?2 RETURNING ${UNIT_OWNER_FIELDS}`
        )
        .bind(id, user.id, unit.name, unit.area, unit.monthly_rent, unit.rooms_available, unit.move_in_date, unit.description, unit.status, Date.now())
        .first();
      if (!updated) throw notFound;
      return reply({ unit: updated });
    }
    if (method === "DELETE") {
      const res = await db.prepare(`DELETE FROM units WHERE id = ?1 AND landlord_user_id = ?2`).bind(id, user.id).run();
      if (res.meta.changes !== 1) throw notFound;
      return reply({ deleted: true });
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  // Anyone: active units, listing fields only. Never landlord identity.
  if (path === "/api/listings" && method === "GET") {
    const { results } = await db
      .prepare(`SELECT ${LISTING_FIELDS} FROM units WHERE status = 'active' ORDER BY move_in_date, id LIMIT 100`)
      .all();
    return reply({ listings: results.map(asListing) });
  }

  // Renter: own preferences only.
  if (path === "/api/renter/preferences") {
    const user = requireType(viewer, "renter");
    if (method === "GET") {
      const prefs = await db.prepare(`SELECT ${PREF_FIELDS} FROM match_preferences WHERE user_id = ?1`).bind(user.id).first();
      return reply({ preferences: prefs ?? null });
    }
    if (method === "PUT") {
      const p = parsePreferences(await readJson(request));
      const now = Date.now();
      const saved = await db
        .prepare(
          `INSERT INTO match_preferences (user_id, budget_min, budget_max, move_in_month, area, rooms_needed,
             sleep_schedule, cleanliness, noise, guests, pets, smoking, created_at, updated_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13)
           ON CONFLICT (user_id) DO UPDATE SET
             budget_min = excluded.budget_min, budget_max = excluded.budget_max, move_in_month = excluded.move_in_month,
             area = excluded.area, rooms_needed = excluded.rooms_needed, sleep_schedule = excluded.sleep_schedule,
             cleanliness = excluded.cleanliness, noise = excluded.noise, guests = excluded.guests, pets = excluded.pets,
             smoking = excluded.smoking, updated_at = excluded.updated_at
           RETURNING ${PREF_FIELDS}`
        )
        .bind(user.id, p.budget_min, p.budget_max, p.move_in_month, p.area, p.rooms_needed,
          p.sleep_schedule, p.cleanliness, p.noise, p.guests, p.pets, p.smoking, now)
        .first();
      return reply({ preferences: saved });
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  if (path === "/api/renter/matches" && method === "GET") {
    const user = requireType(viewer, "renter");
    const prefs = await db.prepare(`SELECT ${PREF_FIELDS} FROM match_preferences WHERE user_id = ?1`).bind(user.id).first();
    if (!prefs) return reply({ matches: [], needsPreferences: true });
    const { results } = await db
      .prepare(`SELECT ${LISTING_FIELDS} FROM units WHERE status = 'active' ORDER BY move_in_date, id LIMIT 200`)
      .all();
    return reply({ matches: rankUnits(prefs, results.map(asListing)) });
  }

  // Admin: read-only user list. No questionnaire answers, unit details, sessions or tokens.
  if (path === "/api/admin/users" && method === "GET") {
    const user = requireUser(viewer);
    if (user.role !== "admin") throw new HttpError(403, "forbidden", "You don't have access to this page.");
    const { results } = await db
      .prepare(
        `SELECT u.name, u.email, u.account_type AS accountType, u.role, u."createdAt" AS joinedAt, (u.id LIKE 'sample-%') AS isSample,
           CASE WHEN u.account_type = 'landlord'
             THEN (SELECT COUNT(*) FROM units WHERE landlord_user_id = u.id) END AS unitCount,
           CASE WHEN u.account_type = 'renter'
             THEN EXISTS (SELECT 1 FROM match_preferences WHERE user_id = u.id) END AS hasPreferences
         FROM "user" u ORDER BY u."createdAt" DESC LIMIT 500`
      )
      .all();
    return reply({ users: results.map((r) => ({ ...r, isSample: !!r.isSample, hasPreferences: r.hasPreferences == null ? null : !!r.hasPreferences })) });
  }

  throw new HttpError(404, "not_found", "Not found.");
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!url.pathname.startsWith("/api/")) return new Response("Not found", { status: 404 });
      if (url.pathname.startsWith("/api/auth/")) return await handleAuth(request, env, url);
      return await handleApi(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.code, message: err.message }, err.status);
      if (err instanceof InvalidInput) return json({ error: "invalid_input", field: err.field, message: err.message }, 400);
      console.error("Unhandled error", request.method, url.pathname, err?.stack || err);
      return json({ error: "server_error", message: "Something went wrong. Please try again." }, 500);
    }
  },

  // Daily cleanup of expired sessions, OAuth state and old rate-limit counters.
  async scheduled(_event, env) {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM "session" WHERE "expiresAt" < ?1`).bind(nowIso),
      env.DB.prepare(`DELETE FROM "verification" WHERE "expiresAt" < ?1`).bind(nowIso),
      env.DB.prepare(`DELETE FROM "rateLimit" WHERE "lastRequest" < ?1`).bind(nowMs - 3600_000),
      env.DB.prepare(`DELETE FROM app_rate_limits WHERE window_start < ?1`).bind(Math.floor(nowMs / 60000) - 60),
    ]);
  },
};
