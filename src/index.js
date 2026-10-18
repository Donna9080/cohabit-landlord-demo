// coHabit Worker. Static pages in ./public are served by Cloudflare directly;
// only /api/* reaches this code (see run_worker_first in wrangler.jsonc).
//
//   /api/auth/*   Google sign-in; email sign-up, sign-in, email confirmation and password reset; sign-out, session
//                 (Better Auth, allowlisted paths only, each request rebuilt from checked fields)
//   /api/me       who is signed in; one-time landlord/renter choice; delete my account
//   /api/landlord/units[/<id>]   a landlord's own units
//   /api/landlord/interests      renters who said "I'm interested" in this landlord's units
//   /api/renter/interests        a renter's own "I'm interested" requests
//   /api/listings                active units, listing fields only (public)
//   /api/renter/preferences      a renter's own questionnaire answers
//   /api/renter/matches          active units ranked against those answers (demo listings in Demo mode)
//   /api/renter/roommates        other opted-in renters ranked by lifestyle fit (opt-in, limited fields; demo
//                                profiles in Demo mode)
//   /api/demo/listings, /api/demo/people   the fictional Demo mode data (public; off with DEMO_DATA=off)
//   /api/admin/demo[/cleanup]    Demo mode status, and removing bookmarks to demo cards (admin only)
//   /api/roommates/requests[...]  connect with another renter, accept or decline, message once accepted (src/connections.js)
//   /api/admin/users             read-only user list (admin only)
//   /api/admin/imports[...]      import external listings from an authorized source; roll back (admin only)
//   /api/admin/settings          hide or show sample listings in public search (admin only)
//   /api/assistant[...]          the renter's chat assistant (src/assistant/)
//   /api/admin/assistant         assistant usage totals and estimated cost (admin only)
//   /api/survey                  Quick check-in: optional survey for anyone, coHabit Points once per person (src/survey.js)
//   /api/admin/survey[.csv]      check-in summary, recent responses and spreadsheet export (admin only)
import { DEMO_COUNTS, DEMO_LISTINGS, DEMO_PEOPLE, demoDataOn } from "./assistant/demo-data.js";
import { assistantCleanup, assistantDeleteStatements, assistantUsageReport, demoModeOn, handleAssistant } from "./assistant/routes.js";
import { BRANDEIS, kmBetween } from "./assistant/search.js";
import { getAuth } from "./auth.js";
import { connectionDeleteStatements, demoPersonView, handleConnections, personView, requestsByPerson } from "./connections.js";
import { HttpError, MAX_BODY, assertSameOrigin, json, rateLimit, readJson, withSecurityHeaders } from "./http.js";
import { IMPORT_LIMIT, previewImport } from "./imports.js";
import { activeListings, listingMapper, LISTING_FIELDS, noSamples, sampleListingsHidden } from "./listings.js";
import { rankUnits } from "./match.js";
import { asPrefs, createInterest, loadPreferences, MAX_INTERESTS_PER_RENTER, savePreferences } from "./profile.js";
import { BLOCKER_TEXT, firstNameOf, rankedMatches, roommateBlockers, scoreRoommate } from "./roommates.js";
import { handleSurvey, pointsBalance, surveyCsv, surveyDeleteStatements, surveySummary } from "./survey.js";
import { InvalidInput, isUnitId, parseAccountType, parseEmailOnly, parseInterest, parseNewPassword, parsePreferences, parseSignIn, parseSignup, parseUnit } from "./validate.js";
import { devOutboxOn, passwordAccountsOn, readOutbox } from "./email.js";

const MAX_IMPORT_BODY = 600 * 1024; // admin CSV imports only
const MAX_UNITS_PER_LANDLORD = 50;
const LIMITS = { read: 120, write: 30 }; // requests per minute per user (or per IP when signed out)

// Demo mode data as pages get it. Distances are straight-line from the approximate point, like everywhere else.
const kmFromBrandeis = (u) => Math.round(kmBetween(u.location, BRANDEIS) * 10) / 10;
const DEMO_LISTING_VIEWS = DEMO_LISTINGS.map((u) => ({ ...u, km: kmFromBrandeis(u) }));
const DEMO_SHOWN = DEMO_PEOPLE.filter((p) => p.discoverable);
const demoOther = (p) => ({ userId: p.id, prefs: p, firstName: p.firstName, about: p.about, email: null, sample: false, demo: true });
// A demo profile for a page: the whole fictional profile, plus, when the viewer has saved preferences, the same
// compatibility check as real roommate matching (score, what they share, or why they aren't a match).
function demoProfileFor(mine, p) {
  const m = mine ? scoreRoommate(mine, p) : null;
  const view = demoPersonView(mine, { ...demoOther(p), score: m?.eligible ? m.score : null, fits: m?.eligible ? m.shared : [] });
  return {
    ...view,
    match: m?.eligible ? (m.score >= 90 ? "exact" : "partial") : null,
    compatible: m ? m.eligible : null,
    notMatching: m && !m.eligible ? roommateBlockers(mine, p).map((b) => BLOCKER_TEXT[b]) : [],
    // The answers themselves, for the filters on the demo profile page.
    answers: Object.fromEntries(["sleep_schedule", "cleanliness", "noise", "guests", "pets", "smoking", "chores", "move_in_month", "budget_min", "budget_max", "lease_months", "rooms_needed", "furnished", "looking_in"].map((k) => [k, p[k]])),
    program: p.program,
  };
}

const hasSessionCookie = (request) => /(?:^|;\s*)(?:__Secure-)?better-auth\.session_token=/.test(request.headers.get("Cookie") || "");

// Reads the session and user from D1 on every call (no cookie cache), so a
// revoked session or changed role takes effect immediately.
async function getViewer(request, env) {
  if (!hasSessionCookie(request)) return { user: null, setCookies: [] };
  const { headers, response } = await (await getAuth(env)).api.getSession({ headers: request.headers, returnHeaders: true });
  const setCookies = headers?.getSetCookie?.() ?? [];
  if (!response) return { user: null, expired: true, setCookies };
  const u = response.user;
  return { user: { id: u.id, name: u.name, email: u.email, role: u.role, accountType: u.accountType ?? null, occupation: u.occupation ?? null, company: u.company ?? null }, setCookies };
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
  // Email and password accounts (on only when coHabit can send email; see src/email.js)
  "POST /api/auth/sign-up/email",
  "POST /api/auth/sign-in/email",
  "POST /api/auth/send-verification-email",
  "GET /api/auth/verify-email",
  "POST /api/auth/request-password-reset",
  "POST /api/auth/reset-password",
]);
// The link in a reset email: /api/auth/reset-password/<token>?callbackURL=/reset-password
const RESET_LINK = /^\/api\/auth\/reset-password\/[A-Za-z0-9_-]{10,128}$/;
// Where people land after confirming their email: /welcome sends renters to the assistant and landlords to their
// dashboard (and asks the one-time question if neither is set).
const AFTER_CONFIRM = "/welcome";
const PASSWORD_ROUTES = new Set(["/api/auth/sign-up/email", "/api/auth/sign-in/email", "/api/auth/send-verification-email", "/api/auth/request-password-reset", "/api/auth/reset-password"]);
const AUTH_PER_MINUTE = 20; // per network address, for the password endpoints, on top of Better Auth's own limits

const safePath = (v, fallback) => (typeof v === "string" && /^\/(?!\/)[\w\-/?=&.]*$/.test(v) && v.length <= 200 ? v : fallback);

// Better Auth gets a request with only the fields we allow, built from scratch.
const withBody = (request, body) => {
  const headers = new Headers(request.headers);
  headers.delete("Content-Length");
  headers.set("Content-Type", "application/json");
  return new Request(request.url, { method: "POST", headers, body: JSON.stringify(body) });
};
// A reply that keeps Better Auth's cookies (a new session, for example) but not its body.
const replyKeepingCookies = (from, data, status = 200) => {
  const r = json(data, status);
  for (const c of from.headers.getSetCookie?.() ?? []) r.headers.append("Set-Cookie", c);
  return r;
};

async function handleAuth(request, env, url) {
  const route = `${request.method} ${url.pathname}`;
  const resetLink = request.method === "GET" && RESET_LINK.test(url.pathname);
  if (!AUTH_ROUTES.has(route) && !resetLink) throw new HttpError(404, "not_found", "Not found.");
  // Email and password routes exist only where they can work (an email can be sent and they're switched on).
  if ((PASSWORD_ROUTES.has(url.pathname) || resetLink || url.pathname === "/api/auth/verify-email") && !passwordAccountsOn(env))
    throw new HttpError(404, "not_available", "Email and password sign-in isn't available yet. Continue with Google.");
  // Better Auth is created only after every check below has passed (see getAuth in src/auth.js).
  const handle = async (req) => (await getAuth(env)).handler(req);
  const ip = request.headers.get("CF-Connecting-IP") || "local";

  if (url.pathname === "/api/auth/sign-in/social") {
    assertSameOrigin(request, env);
    const body = await readJson(request);
    // Rebuild the body with only what we allow: Google, same-site return paths.
    // Drops fields such as extra scopes or a client-supplied ID token.
    request = withBody(request, {
      provider: "google",
      callbackURL: safePath(body?.callbackURL, "/welcome"),
      errorCallbackURL: "/signin-error",
      disableRedirect: true,
    });
    return withSecurityHeaders(await handle(request));
  }

  if (PASSWORD_ROUTES.has(url.pathname)) {
    assertSameOrigin(request, env);
    await rateLimit(env, `a:ip:${ip}`, AUTH_PER_MINUTE, "Too many tries. Wait a minute and try again.");
    const body = await readJson(request);

    if (url.pathname === "/api/auth/sign-up/email") {
      const s = parseSignup(body);
      const res = await handle(withBody(request, { ...s, callbackURL: AFTER_CONFIRM }));
      // New or already registered, the answer is the same: check your email (the owner of an existing account
      // gets a "you already have an account" email instead of a confirmation link).
      if (res.ok) return json({ status: "check_email", email: s.email });
      return withSecurityHeaders(res);
    }
    if (url.pathname === "/api/auth/sign-in/email") {
      const s = parseSignIn(body);
      const res = await handle(withBody(request, { ...s, rememberMe: true, callbackURL: AFTER_CONFIRM }));
      if (res.ok) return replyKeepingCookies(res, { signedIn: true });
      return withSecurityHeaders(res);
    }
    if (url.pathname === "/api/auth/send-verification-email") {
      const s = parseEmailOnly(body);
      const res = await handle(withBody(request, { ...s, callbackURL: AFTER_CONFIRM }));
      // Same answer whether or not there is an unconfirmed account for this email.
      return res.status === 429 ? withSecurityHeaders(res) : json({ status: "check_email", email: s.email });
    }
    if (url.pathname === "/api/auth/request-password-reset") {
      const s = parseEmailOnly(body);
      const res = await handle(withBody(request, { ...s, redirectTo: "/reset-password" }));
      // Same answer whether or not an account exists (Better Auth also evens out the timing).
      return res.status === 429 ? withSecurityHeaders(res) : json({ status: "check_email", email: s.email });
    }
    if (url.pathname === "/api/auth/reset-password") {
      const res = await handle(withBody(request, parseNewPassword(body)));
      if (res.ok) return json({ status: "password_changed" });
      return withSecurityHeaders(res);
    }
  }

  if (resetLink) {
    // Always back to coHabit's own reset page, whatever the link says.
    const target = new URL(url);
    target.search = `?callbackURL=${encodeURIComponent("/reset-password")}`;
    request = new Request(target, request);
  } else if (url.pathname === "/api/auth/verify-email") {
    const target = new URL(url);
    target.searchParams.set("callbackURL", AFTER_CONFIRM);
    request = new Request(target, request);
  } else if (request.method === "POST") {
    assertSameOrigin(request, env);
    if (Number(request.headers.get("Content-Length") || 0) > MAX_BODY) throw new HttpError(413, "too_large", "Request too large.");
  }
  return withSecurityHeaders(await handle(request));
}

// ── App API ─────────────────────────────────────────────────────────────────

const UNIT_OWNER_FIELDS =
  "id, name, area, monthly_rent, rooms_available, move_in_date, description, status, created_at, updated_at, address, lat, lng, location_precision";
// Stored with every saved location, as MapTiler's terms ask for databases built from its search results.
const GEO_SOURCE = "© MapTiler © OpenStreetMap contributors";
const locationValues = (unit) =>
  unit.location
    ? [unit.location.address, unit.location.lat, unit.location.lng, unit.location.precision, GEO_SOURCE]
    : [null, null, null, "approximate", null];
// Imported listings: shown with their source, never tied to a landlord, never "approximate"
// (their address is public on the source; coordinates are only stored when the source allows it).
const EXTERNAL_FIELDS =
  "id, source_name, source_url, property_name, address, city, zip, rent, rent_basis, fees, bedrooms, bathrooms, available_date, source_posted_date, source_updated_date, retrieved_date, lat, lng, photo_url, photo_license";
const asExternal = (e) => ({
  id: e.id,
  external: true,
  sample: false,
  name: e.property_name || e.address || `Listing on ${e.source_name}`,
  area: `${e.city ? e.city + ", " : ""}MA${e.zip ? " " + e.zip : ""}`,
  address: e.address,
  monthly_rent: e.rent,
  rent_basis: e.rent_basis,
  fees: e.fees,
  bedrooms: e.bedrooms,
  bathrooms: e.bathrooms,
  move_in_date: e.available_date,
  description: "",
  source: { name: e.source_name, url: e.source_url, postedDate: e.source_posted_date, updatedDate: e.source_updated_date, retrievedDate: e.retrieved_date },
  photo: e.photo_url ? { url: e.photo_url, license: e.photo_license } : null,
  location: e.lat != null ? { precision: "exact", lat: e.lat, lng: e.lng, address: e.address } : null,
});
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

  // Public settings for the browser. The map key is a browser key restricted to this site's address.
  if (path === "/api/config" && method === "GET") {
    return reply({ maptilerKey: env.MAPTILER_KEY || null, passwordSignIn: passwordAccountsOn(env), devInbox: devOutboxOn(env), demoData: demoDataOn(env), demoCounts: DEMO_COUNTS });
  }

  // Local development only: emails coHabit would have sent (src/email.js). Not available anywhere else.
  if (path === "/api/dev/outbox" && method === "GET") {
    if (!devOutboxOn(env)) throw new HttpError(404, "not_found", "Not found.");
    return reply({ messages: await readOutbox(db, url.searchParams.get("to")) });
  }

  // Who am I
  if (path === "/api/me" && method === "GET") {
    const u = viewer.user;
    return reply({
      user: u && { name: u.name, email: u.email, accountType: u.accountType, isAdmin: u.role === "admin", points: await pointsBalance(db, u.id), occupation: u.occupation, company: u.company },
      // Renters' Demo mode switch lives on the server so Listings, My matches and the assistant agree.
      demo: u?.accountType === "renter" ? await demoModeOn(db, env, u.id) : false,
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

  // Quick check-in: anyone may answer, signed in or not. Points are awarded on the server, once per person.
  if (path === "/api/survey") {
    return handleSurvey({ request, env, db, user: viewer.user, path, method, ip, reply });
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
      ...assistantDeleteStatements(db, user.id),
      ...connectionDeleteStatements(db, user.id),
      ...surveyDeleteStatements(db, user.id),
      db.prepare(`DELETE FROM unit_interests WHERE renter_user_id = ?1 OR unit_id IN (SELECT id FROM units WHERE landlord_user_id = ?1)`).bind(user.id),
      db.prepare(`DELETE FROM units WHERE landlord_user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM match_preferences WHERE user_id = ?1`).bind(user.id),
      db.prepare(`DELETE FROM "session" WHERE "userId" = ?1`).bind(user.id),
      db.prepare(`DELETE FROM "account" WHERE "userId" = ?1`).bind(user.id),
      db.prepare(`DELETE FROM "verification" WHERE value = ?1`).bind(user.id),
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
          `INSERT INTO units (id, landlord_user_id, name, area, monthly_rent, rooms_available, move_in_date, description, status, created_at, updated_at,
             address, lat, lng, location_precision, geo_source)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10, ?11, ?12, ?13, ?14, ?15) RETURNING ${UNIT_OWNER_FIELDS}`
        )
        .bind(id, user.id, unit.name, unit.area, unit.monthly_rent, unit.rooms_available, unit.move_in_date, unit.description, unit.status, now, ...locationValues(unit))
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
             description = ?8, status = ?9, updated_at = ?10,
             address = ?11, lat = ?12, lng = ?13, location_precision = ?14, geo_source = ?15
           WHERE id = ?1 AND landlord_user_id = ?2 RETURNING ${UNIT_OWNER_FIELDS}`
        )
        .bind(id, user.id, unit.name, unit.area, unit.monthly_rent, unit.rooms_available, unit.move_in_date, unit.description, unit.status, Date.now(), ...locationValues(unit))
        .first();
      if (!updated) throw notFound;
      return reply({ unit: updated });
    }
    if (method === "DELETE") {
      const [, res] = await db.batch([
        db.prepare(`DELETE FROM unit_interests WHERE unit_id IN (SELECT id FROM units WHERE id = ?1 AND landlord_user_id = ?2)`).bind(id, user.id),
        db.prepare(`DELETE FROM units WHERE id = ?1 AND landlord_user_id = ?2`).bind(id, user.id),
      ]);
      if (res.meta.changes !== 1) throw notFound;
      return reply({ deleted: true });
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  // Landlord: renters who said "I'm interested" in this landlord's own units. This is the one place a
  // landlord sees a renter's name and email, and only because that renter chose to send the request.
  if (path === "/api/landlord/interests" && method === "GET") {
    const user = requireType(viewer, "landlord");
    const { results } = await db
      .prepare(
        `SELECT i.id, i.unit_id AS unitId, un.name AS unitName, i.message, i.created_at AS createdAt,
           r.name AS renterName, r.email AS renterEmail
         FROM unit_interests i
         JOIN units un ON un.id = i.unit_id
         JOIN "user" r ON r.id = i.renter_user_id
         WHERE un.landlord_user_id = ?1
         ORDER BY i.created_at DESC LIMIT 200`
      )
      .bind(user.id)
      .all();
    return reply({ interests: results });
  }

  const landlordInterest = path.match(/^\/api\/landlord\/interests\/([^/]+)$/);
  if (landlordInterest && method === "DELETE") {
    const user = requireType(viewer, "landlord");
    const id = landlordInterest[1];
    const res = isUnitId(id)
      ? await db
          .prepare(`DELETE FROM unit_interests WHERE id = ?1 AND unit_id IN (SELECT id FROM units WHERE landlord_user_id = ?2)`)
          .bind(id, user.id)
          .run()
      : null;
    if (!res || res.meta.changes !== 1) throw new HttpError(404, "not_found", "Request not found.");
    return reply({ deleted: true });
  }

  // Renter: own "I'm interested" requests. The renter never receives the landlord's identity.
  if (path === "/api/renter/interests") {
    const user = requireType(viewer, "renter");
    if (method === "GET") {
      const { results } = await db
        .prepare(
          `SELECT i.unit_id AS unitId, i.message, i.created_at AS createdAt, un.name AS unitName, un.area AS unitArea,
             (un.status = 'active') AS listed
           FROM unit_interests i JOIN units un ON un.id = i.unit_id
           WHERE i.renter_user_id = ?1 ORDER BY i.created_at DESC LIMIT ${MAX_INTERESTS_PER_RENTER}`
        )
        .bind(user.id)
        .all();
      return reply({ interests: results.map((r) => ({ ...r, listed: !!r.listed })) });
    }
    if (method === "POST") {
      const { unit_id, message } = parseInterest(await readJson(request));
      return reply({ interest: await createInterest(db, user.id, unit_id, message) }, 201);
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  const renterInterest = path.match(/^\/api\/renter\/interests\/([^/]+)$/);
  if (renterInterest && method === "DELETE") {
    const user = requireType(viewer, "renter");
    const unitId = renterInterest[1];
    const res = isUnitId(unitId)
      ? await db.prepare(`DELETE FROM unit_interests WHERE unit_id = ?1 AND renter_user_id = ?2`).bind(unitId, user.id).run()
      : null;
    if (!res || res.meta.changes !== 1) throw new HttpError(404, "not_found", "Request not found.");
    return reply({ deleted: true });
  }

  // Anyone: active units, listing fields only. Never landlord identity.
  if (path === "/api/listings" && method === "GET") {
    const hidden = await sampleListingsHidden(db);
    const [{ results }, { results: external }] = await Promise.all([
      db.prepare(`SELECT ${LISTING_FIELDS} FROM units WHERE status = 'active'${noSamples(hidden)} ORDER BY move_in_date, id LIMIT 100`).all(),
      db.prepare(`SELECT ${EXTERNAL_FIELDS} FROM external_listings ORDER BY COALESCE(source_updated_date, source_posted_date) DESC, id LIMIT 200`).all(),
    ]);
    return reply({ listings: results.map(listingMapper(env)).concat(external.map(asExternal)) });
  }

  // Anyone: the fictional Demo mode data. Never mixed into /api/listings or real matches.
  if (path === "/api/demo/listings" || path === "/api/demo/people") {
    if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Not allowed.");
    if (!demoDataOn(env)) throw new HttpError(404, "demo_off", "Demo mode isn't available right now.");
    if (path === "/api/demo/listings") return reply({ demo: true, total: DEMO_LISTING_VIEWS.length, listings: DEMO_LISTING_VIEWS });
    const mine = viewer.user?.accountType === "renter" ? await loadPreferences(db, viewer.user.id) : null;
    const people = DEMO_SHOWN.map((p) => demoProfileFor(mine, p));
    return reply({ demo: true, total: DEMO_COUNTS.people, shown: DEMO_COUNTS.shown, hidden: DEMO_COUNTS.people - DEMO_COUNTS.shown, compared: !!mine, people });
  }

  // Renter: own preferences only.
  if (path === "/api/renter/preferences") {
    const user = requireType(viewer, "renter");
    if (method === "GET") {
      const prefs = await loadPreferences(db, user.id);
      return reply({ preferences: asPrefs(prefs) ?? null });
    }
    if (method === "PUT") {
      const p = parsePreferences(await readJson(request));
      return reply({ preferences: await savePreferences(db, user.id, p) });
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
  }

  if (path === "/api/renter/matches" && method === "GET") {
    const user = requireType(viewer, "renter");
    const [prefs, demo] = await Promise.all([loadPreferences(db, user.id), demoModeOn(db, env, user.id)]);
    if (!prefs) return reply({ matches: [], needsPreferences: true, demo });
    // Demo mode: the same ranking over the demo listings, all of them that fit (not just the top 20), with the total.
    if (demo) return reply({ demo: true, total: DEMO_LISTINGS.length, matches: rankUnits(prefs, DEMO_LISTINGS, DEMO_LISTINGS.length).map((m) => ({ ...m, km: kmFromBrandeis(m.unit) })) });
    return reply({ matches: rankUnits(prefs, await activeListings(db, env)) });
  }

  // Renter: possible roommates. Opt-in on both sides: you must have turned it on to see anyone,
  // and only renters who turned it on are compared. Returns first name, score, what the two have
  // in common, and an email only if that person chose to share it. Never ids or raw answers.
  if (path === "/api/renter/roommates" && method === "GET") {
    const user = requireType(viewer, "renter");
    const [mine, demo] = await Promise.all([loadPreferences(db, user.id), demoModeOn(db, env, user.id)]);
    if (!mine) return reply({ roommates: [], needsPreferences: true, optedIn: false, demo });
    // Demo mode: the same matching over the fictional profiles that chose to be found. Seeing made-up people doesn't
    // need the renter's own opt-in, and nobody real sees the renter.
    if (demo) {
      const roommates = rankedMatches(mine, DEMO_SHOWN.map(demoOther), DEMO_SHOWN.length).map(({ o }) => demoProfileFor(mine, o.prefs));
      return reply({ demo: true, roommates, optedIn: true, total: DEMO_COUNTS.shown, youShare: true });
    }
    if (!mine.roommate_visible) return reply({ roommates: [], optedIn: false });
    const { results } = await db
      .prepare(
        `SELECT p.user_id, p.budget_min, p.budget_max, p.move_in_month, p.area, p.sleep_schedule, p.cleanliness, p.noise, p.guests,
           p.pets, p.smoking, p.chores, p.share_email, p.share_profile, u.name, u.email, (u.id LIKE 'sample-%') AS sample
         FROM match_preferences p JOIN "user" u ON u.id = p.user_id
         WHERE p.roommate_visible = 1 AND p.user_id != ?1 AND u.account_type = 'renter'
         ORDER BY p.updated_at DESC LIMIT 500`
      )
      .bind(user.id)
      .all();
    const others = results.map((r) => ({ userId: r.user_id, prefs: r, firstName: firstNameOf(r.name), email: r.share_email ? r.email : null, sample: !!r.sample }));
    const requests = await requestsByPerson(db, user.id);
    const roommates = await Promise.all(
      rankedMatches(mine, others).map(({ o, score, shared }) =>
        personView(env, user.id, mine, { ...o, score, fits: shared, misses: score < 90 ? ["Not every lifestyle answer matches. Talk through sleep, guests and chores before deciding."] : [] }, requests)
      )
    );
    return reply({ roommates, optedIn: true, youShare: !!mine.share_profile });
  }

  // Admin: import external listings from an authorized source, roll an import back, and hide or show
  // sample listings. Every write is recorded in admin_audit.
  if (path.startsWith("/api/admin/imports") || path === "/api/admin/settings") {
    const admin = requireUser(viewer);
    if (admin.role !== "admin") throw new HttpError(403, "forbidden", "You don't have access to this page.");
    const today = new Date().toISOString().slice(0, 10);
    const audit = (action, detail) =>
      db
        .prepare(`INSERT INTO admin_audit (id, admin_user_id, action, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5)`)
        .bind(crypto.randomUUID(), admin.id, action, detail, Date.now());
    const setSamplesHidden = (on) =>
      db
        .prepare(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('hide_sample_listings', ?1, ?2)
           ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
        )
        .bind(on ? "1" : "0", Date.now());
    const runPreview = async (body) => {
      if (typeof body?.csv !== "string" || !body.csv.trim()) throw new InvalidInput("csv", "Choose a CSV file or paste its contents.");
      const sourceName = typeof body.sourceName === "string" && body.sourceName.trim() ? body.sourceName.trim().slice(0, 80) : null;
      const { results } = await db.prepare(`SELECT source_url, source_name, source_listing_id FROM external_listings`).all();
      const existing = {
        urls: new Set(results.map((r) => r.source_url)),
        ids: new Set(results.filter((r) => r.source_listing_id).map((r) => `${r.source_name.toLowerCase()}|${r.source_listing_id}`)),
      };
      const result = previewImport(body.csv, { today, defaultSource: sourceName, existing });
      if (result.error) throw new InvalidInput("csv", result.error);
      return { ...result, sourceName };
    };

    if (path === "/api/admin/imports" && method === "GET") {
      const [{ results: batches }, counts, hidden] = await Promise.all([
        db
          .prepare(
            `SELECT b.id, b.source_name AS sourceName, b.permission_basis AS permissionBasis, b.permission_note AS permissionNote,
               b.created_at AS createdAt, b.rows_received AS rowsReceived, b.rows_imported AS rowsImported, b.status,
               b.rolled_back_at AS rolledBackAt, u.name AS createdBy
             FROM import_batches b LEFT JOIN "user" u ON u.id = b.created_by ORDER BY b.created_at DESC LIMIT 50`
          )
          .all(),
        db.prepare(`SELECT (SELECT COUNT(*) FROM external_listings) AS external, (SELECT COUNT(*) FROM units WHERE landlord_user_id LIKE 'sample-%') AS sample`).first(),
        sampleListingsHidden(db),
      ]);
      return reply({ batches, externalCount: counts.external, sampleCount: counts.sample, sampleHidden: hidden, limit: IMPORT_LIMIT });
    }

    if (path === "/api/admin/imports/preview" && method === "POST") {
      return reply(await runPreview(await readJson(request, MAX_IMPORT_BODY)));
    }

    if (path === "/api/admin/imports" && method === "POST") {
      const body = await readJson(request, MAX_IMPORT_BODY);
      const basis = body?.permission?.basis;
      if (!["publisher_authorization", "licensed_provider", "landlord_permission"].includes(basis)) {
        throw new InvalidInput("permission_basis", "Choose what gives coHabit permission to publish these listings.");
      }
      const note = typeof body.permission.note === "string" ? body.permission.note.trim() : "";
      if (note.length < 10 || note.length > 500) {
        throw new InvalidInput("permission_note", "Describe the permission in 10 to 500 characters: who granted it, when, and where it's recorded.");
      }
      if (body.confirm !== true) throw new InvalidInput("confirm", "Confirm that coHabit may republish these listings.");
      const result = await runPreview(body);
      const ready = result.rows.filter((r) => r.status === "ready");
      if (!ready.length) throw new HttpError(409, "nothing_to_import", "No rows are ready to import. Check the preview.");
      const batchId = crypto.randomUUID();
      const now = Date.now();
      const batchSource = result.sourceName || ready[0].listing.source_name;
      await db.batch([
        db
          .prepare(
            `INSERT INTO import_batches (id, source_name, permission_basis, permission_note, created_by, created_at, rows_received, rows_imported)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`
          )
          .bind(batchId, batchSource, basis, note, admin.id, now, result.summary.received, ready.length),
        ...ready.map(({ listing: l }) =>
          db
            .prepare(
              `INSERT INTO external_listings (id, batch_id, source_name, source_listing_id, source_url, property_name, address, city, zip,
                 rent, rent_basis, fees, bedrooms, bathrooms, available_date, source_posted_date, source_updated_date, retrieved_date,
                 lat, lng, photo_url, photo_license, created_at)
               VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)`
            )
            .bind(
              crypto.randomUUID(), batchId, l.source_name, l.source_listing_id, l.source_url, l.property_name, l.address, l.city, l.zip,
              l.rent, l.rent_basis, l.fees, l.bedrooms, l.bathrooms, l.available_date, l.source_posted_date, l.source_updated_date,
              l.retrieved_date, l.lat, l.lng, l.photo_url, l.photo_license, now
            )
        ),
        audit("import", JSON.stringify({ batchId, source: batchSource, basis, summary: result.summary })),
        setSamplesHidden(true),
      ]);
      return reply({ batchId, imported: ready.length, summary: result.summary, sampleHidden: true }, 201);
    }

    const rollback = path.match(/^\/api\/admin\/imports\/([^/]+)\/rollback$/);
    if (rollback && method === "POST") {
      const id = rollback[1];
      const batch = isUnitId(id) ? await db.prepare(`SELECT id, status FROM import_batches WHERE id = ?1`).bind(id).first() : null;
      if (!batch) throw new HttpError(404, "not_found", "Import not found.");
      if (batch.status === "rolled_back") throw new HttpError(409, "already_rolled_back", "This import was already rolled back.");
      const [removed] = await db.batch([
        db.prepare(`DELETE FROM external_listings WHERE batch_id = ?1`).bind(id),
        db.prepare(`UPDATE import_batches SET status = 'rolled_back', rolled_back_at = ?2 WHERE id = ?1`).bind(id, Date.now()),
        audit("import_rollback", JSON.stringify({ batchId: id })),
      ]);
      // With no imported listings left, bring the sample listings back so the site isn't empty.
      const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM external_listings`).first();
      let sampleHidden = await sampleListingsHidden(db);
      if (n === 0 && sampleHidden) {
        await db.batch([setSamplesHidden(false), audit("show_sample_listings", "No imported listings left after a rollback")]);
        sampleHidden = false;
      }
      return reply({ removed: removed.meta.changes, sampleHidden });
    }

    if (path === "/api/admin/settings" && method === "POST") {
      const body = await readJson(request);
      if (typeof body?.hideSampleListings !== "boolean") throw new InvalidInput("hideSampleListings", "Must be true or false.");
      await db.batch([setSamplesHidden(body.hideSampleListings), audit(body.hideSampleListings ? "hide_sample_listings" : "show_sample_listings", null)]);
      return reply({ sampleHidden: body.hideSampleListings });
    }
    throw new HttpError(404, "not_found", "Not found.");
  }

  // Renter: connect with another renter (src/connections.js). Renters only.
  if (path.startsWith("/api/roommates/")) {
    const user = requireType(viewer, "renter");
    return handleConnections({ request, env, db, user, path, method, reply });
  }

  // Renter: the chat assistant (src/assistant/). Renters only; every write is checked like the forms.
  if (path === "/api/assistant" || path.startsWith("/api/assistant/")) {
    const user = requireType(viewer, "renter");
    return handleAssistant({ request, env, db, user, path, method, reply });
  }

  // Admin: AI assistant use today and over the last 7 days, with an estimated cost. Totals only, no chats.
  if (path === "/api/admin/assistant" && method === "GET") {
    const user = requireUser(viewer);
    if (user.role !== "admin") throw new HttpError(403, "forbidden", "You don't have access to this page.");
    return reply(await assistantUsageReport(env, db));
  }

  // Admin: Quick check-in summary and export. Answers only, never names, emails or account ids.
  if (path === "/api/admin/survey" || path === "/api/admin/survey.csv") {
    const user = requireUser(viewer);
    if (user.role !== "admin") throw new HttpError(403, "forbidden", "You don't have access to this page.");
    if (method !== "GET") throw new HttpError(405, "method_not_allowed", "Not allowed.");
    return path.endsWith(".csv") ? surveyCsv(db, url) : reply(await surveySummary(db, url));
  }

  // Admin: Demo mode status, and removing what renters saved from demo cards (the only demo records in the database:
  // bookmarks pointing at demo ids). Real saved options, listings and accounts are never touched.
  if (path === "/api/admin/demo" || path === "/api/admin/demo/cleanup") {
    const admin = requireUser(viewer);
    if (admin.role !== "admin") throw new HttpError(403, "forbidden", "You don't have access to this page.");
    const savedDemo = () => db.prepare(`SELECT COUNT(*) AS n FROM saved_options WHERE target_id LIKE 'demo-%'`).first();
    if (path === "/api/admin/demo" && method === "GET") {
      const [{ n }, { m }] = await Promise.all([
        savedDemo(),
        db.prepare(`SELECT COUNT(*) AS m FROM assistant_threads WHERE json_extract(last_results, '$.demo') = 1`).first(),
      ]);
      return reply({ on: demoDataOn(env), counts: DEMO_COUNTS, savedDemoCards: n, rentersWithDemoOn: m });
    }
    if (path === "/api/admin/demo/cleanup" && method === "POST") {
      const body = await readJson(request);
      if (body?.confirm !== "REMOVE") throw new InvalidInput("confirm", "Type REMOVE to confirm.");
      const res = await db.batch([
        db.prepare(`DELETE FROM saved_options WHERE target_id LIKE 'demo-%'`),
        db
          .prepare(`INSERT INTO admin_audit (id, admin_user_id, action, detail, created_at) VALUES (?1, ?2, 'remove_demo_saves', NULL, ?3)`)
          .bind(crypto.randomUUID(), admin.id, Date.now()),
      ]);
      return reply({ removed: res[0].meta.changes });
    }
    throw new HttpError(405, "method_not_allowed", "Not allowed.");
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

  // Daily cleanup of expired sessions, OAuth state, old rate-limit counters and unused assistant chats.
  async scheduled(_event, env) {
    const nowIso = new Date().toISOString();
    const nowMs = Date.now();
    await env.DB.batch([
      env.DB.prepare(`DELETE FROM "session" WHERE "expiresAt" < ?1`).bind(nowIso),
      env.DB.prepare(`DELETE FROM "verification" WHERE "expiresAt" < ?1`).bind(nowIso),
      env.DB.prepare(`DELETE FROM "rateLimit" WHERE "lastRequest" < ?1`).bind(nowMs - 3600_000),
      env.DB.prepare(`DELETE FROM app_rate_limits WHERE window_start < ?1`).bind(Math.floor(nowMs / 60000) - 60),
      ...assistantCleanup(env.DB, nowMs),
      // Password sign-ups never confirmed within 7 days, so an unconfirmed sign-up can't hold someone's email.
      env.DB.prepare(
        `DELETE FROM "user" WHERE "emailVerified" = 0 AND "createdAt" < ?1
           AND EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = "user".id AND a."providerId" = 'credential')
           AND NOT EXISTS (SELECT 1 FROM "account" a WHERE a."userId" = "user".id AND a."providerId" != 'credential')`
      ).bind(new Date(nowMs - 7 * 86400_000).toISOString()),
    ]);
  },
};
