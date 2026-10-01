// Local end-to-end tests: `npm test`.
// Runs the real Worker in `wrangler dev` against Wrangler's LOCAL D1 (a SQLite file
// under .wrangler/test-state, reset every run). Nothing here talks to Cloudflare or Google.
// Fixture users get signed Better Auth session cookies made with a per-run random secret.
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;
const STATE = ".wrangler/test-state";
const SECRET = randomBytes(32).toString("base64url");
const WRANGLER = ["node_modules/wrangler/bin/wrangler.js"];

// ── Fixtures ────────────────────────────────────────────────────────────────
const people = {
  landlordA: { id: "t_landlord_a", name: "Test Landlord A", email: "landlord-a@example.test", type: "landlord" },
  landlordB: { id: "t_landlord_b", name: "Test Landlord B", email: "landlord-b@example.test", type: "landlord" },
  renterA: { id: "t_renter_a", name: "Test Renter A", email: "renter-a@example.test", type: "renter" },
  renterB: { id: "t_renter_b", name: "Test Renter B", email: "renter-b@example.test", type: "renter" },
  newbie: { id: "t_new", name: "Test Newcomer", email: "new@example.test", type: null },
  admin: { id: "t_admin", name: "Test Admin (disposable)", email: "admin@example.test", type: null, role: "admin" },
  rater: { id: "t_rate", name: "Test Rate Limit", email: "rate@example.test", type: "renter" },
};
const future = new Date(Date.now() + 86400_000).toISOString();
const past = new Date(Date.now() - 60_000).toISOString();
const now = new Date().toISOString();
const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

const cookieFor = (token) => {
  const sig = createHmac("sha256", SECRET).update(token).digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${token}.${sig}`)}`;
};

let sql = "";
for (const p of Object.values(people)) {
  p.token = randomBytes(24).toString("base64url");
  p.cookie = cookieFor(p.token);
  sql += `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",role,account_type) VALUES (${q(p.id)},${q(p.name)},${q(p.email)},1,${q(now)},${q(now)},${q(p.role || "user")},${q(p.type)});\n`;
  sql += `INSERT INTO "session" (id,"expiresAt",token,"createdAt","updatedAt","userId") VALUES (${q("s_" + p.id)},${q(future)},${q(p.token)},${q(now)},${q(now)},${q(p.id)});\n`;
}
const expiredToken = randomBytes(24).toString("base64url");
sql += `INSERT INTO "session" (id,"expiresAt",token,"createdAt","updatedAt","userId") VALUES ('s_expired',${q(past)},${q(expiredToken)},${q(now)},${q(now)},'t_landlord_a');\n`;

// ── Harness ─────────────────────────────────────────────────────────────────
const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : "  → " + detail}`);
}

function wrangler(args, opts = {}) {
  return execFileSync(process.execPath, [...WRANGLER, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts });
}
function d1(sqlText) {
  return wrangler(["d1", "execute", "DB", "--local", "--persist-to", STATE, "--json", "--command", sqlText]);
}
const d1rows = (sqlText) => JSON.parse(d1(sqlText))[0].results;

async function api(path, { method = "GET", as, body, origin = BASE, headers = {}, raw } = {}) {
  const h = { ...headers };
  if (as) h.Cookie = typeof as === "string" ? as : as.cookie;
  if (method !== "GET" && origin) h.Origin = origin;
  if (body !== undefined && !raw) h["Content-Type"] = h["Content-Type"] || "application/json";
  const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)), redirect: "manual" });
  let data = null;
  const text = await res.text();
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }
  return { status: res.status, data, headers: res.headers };
}

const unitBody = (over = {}) => ({
  name: "Test Unit",
  area: "Waltham, MA",
  monthly_rent: 1200,
  rooms_available: 2,
  move_in_date: "2027-06-01",
  description: "Sunny rooms near the commuter rail.",
  status: "active",
  ...over,
});
const prefsBody = (over = {}) => ({
  budget_min: 900,
  budget_max: 1400,
  move_in_month: "2027-06",
  area: "Waltham",
  rooms_needed: 1,
  sleep_schedule: "early",
  cleanliness: "tidy",
  noise: "quiet",
  guests: "sometimes",
  pets: "ok_with_pets",
  smoking: "no_smoking",
  ...over,
});

// ── Setup ───────────────────────────────────────────────────────────────────
rmSync(STATE, { recursive: true, force: true });
console.log("Applying migrations to LOCAL test D1 …");
wrangler(["d1", "migrations", "apply", "DB", "--local", "--persist-to", STATE]);
writeFileSync(`${STATE}/fixtures.sql`, sql);
wrangler(["d1", "execute", "DB", "--local", "--persist-to", STATE, "--file", `${STATE}/fixtures.sql`]);

console.log("Starting local Worker …");
const dev = spawn(
  process.execPath,
  [...WRANGLER, "dev", "--port", String(PORT), "--persist-to", STATE, "--test-scheduled",
    "--var", `BETTER_AUTH_URL:${BASE}`, "--var", `BETTER_AUTH_SECRET:${SECRET}`,
    "--var", "GOOGLE_CLIENT_ID:local-test-client.apps.googleusercontent.com", "--var", "GOOGLE_CLIENT_SECRET:local-test-only"],
  { stdio: ["ignore", "pipe", "pipe"] }
);
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE + "/")).ok) break;
  } catch {}
  await sleep(500);
}

const { landlordA, landlordB, renterA, renterB, newbie, admin, rater } = people;

try {
  // ── Public pages ──────────────────────────────────────────────────────────
  for (const p of ["/", "/how-it-works", "/listings", "/sample", "/properties/14-elm-street"]) {
    const r = await fetch(BASE + p);
    check(`Public page ${p} loads without login`, r.status === 200 && (await r.text()).includes('id="app"'));
  }
  let r = await api("/api/me");
  check("Visitor /api/me → user null", r.status === 200 && r.data.user === null);
  check("API responses are private, no-store", (r.headers.get("cache-control") || "").includes("no-store"));

  // ── Google sign-in start ──────────────────────────────────────────────────
  r = await api("/api/auth/sign-in/social", { method: "POST", body: { provider: "google", callbackURL: "/welcome", scopes: ["https://www.googleapis.com/auth/drive"], idToken: { token: "forged" } } });
  const gUrl = r.data?.url ? new URL(r.data.url) : null;
  check("Sign-in returns a Google authorization URL", r.status === 200 && gUrl?.host === "accounts.google.com", JSON.stringify(r.data));
  if (gUrl) {
    const scope = gUrl.searchParams.get("scope");
    check("Scopes are exactly openid email profile (injected Drive scope dropped)", scope.split(" ").sort().join(" ") === "email openid profile", scope);
    check("PKCE S256 + state present", gUrl.searchParams.get("code_challenge_method") === "S256" && !!gUrl.searchParams.get("code_challenge") && !!gUrl.searchParams.get("state"));
    check("No offline access requested", gUrl.searchParams.get("access_type") !== "offline");
    check("Redirect URI is /api/auth/callback/google", gUrl.searchParams.get("redirect_uri") === `${BASE}/api/auth/callback/google`);
  }
  r = await api("/api/auth/sign-in/social", { method: "POST", body: { provider: "google" }, origin: "https://evil.example" });
  check("Sign-in from another origin → 403", r.status === 403);
  r = await api("/api/auth/callback/google?code=fake&state=forged");
  check("Callback with forged state is rejected (redirect to error page)", r.status === 302 && (r.headers.get("location") || "").includes("error"), `${r.status} ${r.headers.get("location")}`);
  for (const [m, p] of [["POST", "/api/auth/update-user"], ["POST", "/api/auth/delete-user"], ["GET", "/api/auth/list-sessions"], ["POST", "/api/auth/sign-up/email"], ["POST", "/api/auth/link-social"]]) {
    r = await api(p, { method: m, as: landlordA, body: m === "POST" ? { name: "x", role: "admin" } : undefined });
    check(`Better Auth endpoint ${m} ${p} is not exposed (404)`, r.status === 404);
  }

  // ── Account type ──────────────────────────────────────────────────────────
  r = await api("/api/me", { as: newbie });
  check("New user has no account type yet", r.data.user?.accountType === null && r.data.user?.isAdmin === false);
  r = await api("/api/landlord/units", { as: newbie });
  check("User without account type cannot use landlord API", r.status === 403);
  r = await api("/api/me/account-type", { method: "POST", as: newbie, body: { accountType: "landlord", role: "admin", isAdmin: true } });
  check("Newcomer picks landlord", r.status === 200 && r.data.accountType === "landlord");
  r = await api("/api/me", { as: newbie });
  check("Picking an account type never grants admin (forged role ignored)", r.data.user.accountType === "landlord" && r.data.user.isAdmin === false);
  check("DB role is still 'user'", d1rows(`SELECT role FROM "user" WHERE id='t_new'`)[0].role === "user");
  r = await api("/api/me/account-type", { method: "POST", as: newbie, body: { accountType: "renter" } });
  check("Account type cannot be changed afterwards (409)", r.status === 409);
  r = await api("/api/me/account-type", { method: "POST", as: renterB, body: { accountType: "admin" } });
  check("Invalid account type value rejected", r.status === 400);
  let triggerBlocked = false;
  try {
    d1(`UPDATE "user" SET account_type='renter' WHERE id='t_new'`);
  } catch {
    triggerBlocked = true;
  }
  check("DB trigger blocks changing account_type even with direct SQL", triggerBlocked);

  // ── Landlord units ────────────────────────────────────────────────────────
  r = await api("/api/landlord/units", { method: "POST", as: landlordA, body: unitBody({ landlord_user_id: "t_landlord_b", id: "forged", created_at: 1 }) });
  const unitA = r.data.unit;
  check("Landlord A creates a unit", r.status === 201 && unitA?.name === "Test Unit", JSON.stringify(r.data));
  check("Forged owner/id ignored: unit belongs to Landlord A", d1rows(`SELECT landlord_user_id FROM units WHERE id='${unitA.id}'`)[0].landlord_user_id === "t_landlord_a" && unitA.id !== "forged");
  r = await api("/api/landlord/units", { as: landlordA });
  check("Landlord A reload sees the unit", r.data.units.some((u) => u.id === unitA.id));
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Test Unit (edited)", monthly_rent: 1150 }) });
  check("Landlord A edits the unit", r.status === 200 && r.data.unit.name === "Test Unit (edited)" && r.data.unit.monthly_rent === 1150);
  r = await api("/api/landlord/units", { method: "POST", as: landlordA, body: unitBody({ name: "Temp unit to delete" }) });
  const tempId = r.data.unit.id;
  r = await api(`/api/landlord/units/${tempId}`, { method: "DELETE", as: landlordA });
  check("Landlord A deletes a test unit", r.status === 200);
  r = await api(`/api/landlord/units/${tempId}`, { as: landlordA });
  check("Deleted unit is gone", r.status === 404);

  r = await api("/api/landlord/units", { as: landlordB });
  check("Landlord B's dashboard does not list A's units", r.status === 200 && !r.data.units.some((u) => u.id === unitA.id));
  r = await api(`/api/landlord/units/${unitA.id}`, { as: landlordB });
  check("Landlord B cannot view A's unit by ID (404)", r.status === 404);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: landlordB, body: unitBody({ name: "Hijacked" }) });
  check("Landlord B cannot edit A's unit (404)", r.status === 404);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "DELETE", as: landlordB });
  check("Landlord B cannot delete A's unit (404)", r.status === 404);
  check("A's unit unchanged after B's attempts", d1rows(`SELECT name FROM units WHERE id='${unitA.id}'`)[0].name === "Test Unit (edited)");

  r = await api("/api/landlord/units", { method: "POST", as: renterA, body: unitBody() });
  check("Renter cannot create units (403)", r.status === 403);
  r = await api("/api/landlord/units", { as: renterA });
  check("Renter cannot list landlord units (403)", r.status === 403);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: renterA, body: unitBody() });
  check("Renter cannot edit units (403)", r.status === 403);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "DELETE", as: renterA });
  check("Renter cannot delete units (403)", r.status === 403);
  r = await api("/api/landlord/units", { method: "POST", body: unitBody() });
  check("Visitor cannot create units (401)", r.status === 401);

  // ── Listings / inactive units ─────────────────────────────────────────────
  r = await api("/api/landlord/units", { method: "POST", as: landlordA, body: unitBody({ name: "Hidden inactive unit", status: "inactive" }) });
  const inactiveId = r.data.unit.id;
  r = await api("/api/listings");
  check("Visitor listings include active unit", r.data.listings.some((u) => u.id === unitA.id));
  check("Inactive unit never in public listings", !r.data.listings.some((u) => u.id === inactiveId));
  const listingKeys = Object.keys(r.data.listings[0] || {}).sort().join(",");
  check("Listings expose only listing fields (no landlord id/email/status)", listingKeys === "area,description,id,monthly_rent,move_in_date,name,rooms_available", listingKeys);

  // ── Renter preferences & matches ──────────────────────────────────────────
  r = await api("/api/renter/preferences", { as: renterA });
  check("Renter A starts with no preferences", r.status === 200 && r.data.preferences === null);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody({ user_id: "t_renter_b" }) });
  check("Renter A saves preferences", r.status === 200 && r.data.preferences.budget_max === 1400);
  check("Forged user_id ignored: saved for Renter A only", d1rows(`SELECT user_id FROM match_preferences`).map((x) => x.user_id).join() === "t_renter_a");
  r = await api("/api/renter/preferences", { as: renterA });
  check("Renter A reload sees saved preferences", r.data.preferences?.area === "Waltham" && r.data.preferences?.sleep_schedule === "early");
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody({ budget_max: 1300, noise: "moderate" }) });
  check("Renter A edits preferences", r.data.preferences.budget_max === 1300 && r.data.preferences.noise === "moderate");
  r = await api("/api/renter/preferences?user_id=t_renter_a", { as: renterB });
  check("Renter B cannot read A's preferences (gets own: none)", r.status === 200 && r.data.preferences === null);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, user_id: "t_renter_a" }) });
  check("Renter B's save only changes B's record", d1rows(`SELECT budget_max FROM match_preferences WHERE user_id='t_renter_a'`)[0].budget_max === 1300);
  r = await api("/api/renter/preferences", { as: landlordA });
  check("Landlord cannot read renter preferences (403)", r.status === 403);
  r = await api("/api/renter/preferences", { as: admin });
  check("Admin (no renter type) cannot read preferences (403)", r.status === 403);
  r = await api("/api/renter/matches", { as: renterA });
  const matchIds = (r.data.matches || []).map((m) => m.unit.id);
  check("Renter A gets matches including the active Waltham unit", matchIds.includes(unitA.id), JSON.stringify(r.data).slice(0, 200));
  check("Matches never include inactive units", !matchIds.includes(inactiveId));
  check("Match results expose only listing fields", (r.data.matches || []).every((m) => !("landlord_user_id" in m.unit) && !("status" in m.unit)));
  r = await api("/api/renter/matches", { as: landlordA });
  check("Landlord cannot call renter matches (403)", r.status === 403);

  // ── Admin ─────────────────────────────────────────────────────────────────
  r = await api("/api/admin/users");
  check("Visitor cannot open admin API (401)", r.status === 401);
  r = await api("/api/admin/users", { as: renterA });
  check("Renter cannot open admin API (403)", r.status === 403);
  r = await api("/api/admin/users?role=admin", { as: landlordA, headers: { "X-Role": "admin" } });
  check("Landlord with forged role param/header cannot open admin API (403)", r.status === 403);
  const tampered = landlordA.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));
  r = await api("/api/admin/users", { as: tampered });
  check("Tampered session cookie is not accepted", r.status === 401);
  r = await api("/api/me", { as: cookieFor(expiredToken) });
  check("Expired session → signed out, flagged as expired", r.data.user === null && r.data.sessionExpired === true);
  r = await api("/api/landlord/units", { as: cookieFor(expiredToken) });
  check("Expired session cannot use landlord API (401 session_expired)", r.status === 401 && r.data.error === "session_expired");
  r = await api("/api/admin/users", { as: admin });
  check("Admin can open the user list", r.status === 200 && Array.isArray(r.data.users) && r.data.users.length === Object.keys(people).length);
  const adminText = JSON.stringify(r.data);
  const leaked = ["budget", "sleep_schedule", "smoking", "token", "session", "expiresAt", "monthly_rent", "\"id\"", "accountId", "Waltham"].filter((k) => adminText.includes(k));
  check("Admin list contains no questionnaire answers, unit details, ids, tokens or sessions", leaked.length === 0, leaked.join(","));
  const la = r.data.users.find((u) => u.email === landlordA.email);
  const ra = r.data.users.find((u) => u.email === renterA.email);
  const rb = r.data.users.find((u) => u.email === renterB.email);
  check("Admin list shows unit count for landlords and prefs yes/no for renters", la.unitCount === 2 && ra.hasPreferences === true && rb.hasPreferences === true && la.hasPreferences === null);
  r = await api("/api/me/delete", { method: "POST", as: admin, body: { confirm: "DELETE" } });
  check("The only admin cannot delete their own account (409)", r.status === 409 && d1rows(`SELECT COUNT(*) AS n FROM "user" WHERE id='t_admin'`)[0].n === 1);
  d1(`UPDATE "user" SET role='user' WHERE id='t_admin'`);
  r = await api("/api/admin/users", { as: admin });
  check("Demoting the disposable admin removes access immediately (403)", r.status === 403);

  // ── CSRF / origin ─────────────────────────────────────────────────────────
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody(), origin: null });
  check("Write without Origin header → 403", r.status === 403);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody(), origin: "https://evil.example" });
  check("Write from another origin → 403", r.status === 403);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody(), headers: { "Sec-Fetch-Site": "cross-site" } });
  check("Write with Sec-Fetch-Site: cross-site → 403", r.status === 403);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, raw: JSON.stringify(prefsBody()), headers: { "Content-Type": "text/plain" } });
  check("Write with non-JSON content type → 415", r.status === 415);
  r = await fetch(BASE + "/api/listings", { headers: { Origin: "https://evil.example" } });
  check("No permissive CORS header on API", !r.headers.get("access-control-allow-origin"));

  // ── Invalid input / injection ─────────────────────────────────────────────
  const bad = [
    [{ monthly_rent: -5 }, "negative rent"],
    [{ monthly_rent: "abc" }, "non-numeric rent"],
    [{ monthly_rent: 12.5 }, "fractional rent"],
    [{ rooms_available: 0 }, "zero rooms"],
    [{ status: "published" }, "unknown status"],
    [{ move_in_date: "2027-02-30" }, "impossible date"],
    [{ area: "14 Elm Street, Waltham" }, "street address as area"],
    [{ name: "225 South St, Waltham MA 02453" }, "street address as unit name"],
    [{ name: "12 Main street" }, "street address as unit name (no city)"],
    [{ name: "Room in Waltham 02453" }, "ZIP code in unit name"],
    [{ description: "Come by 14 Elm Street any time." }, "street address in description"],
    [{ name: "" }, "empty name"],
    [{ name: "x".repeat(81) }, "name too long"],
    [{ description: "x".repeat(1001) }, "description too long"],
  ];
  for (const [over, label] of bad) {
    r = await api("/api/landlord/units", { method: "POST", as: landlordB, body: unitBody(over) });
    check(`Invalid unit rejected: ${label} (400)`, r.status === 400 && r.data.error === "invalid_input");
  }
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_min: 2000, budget_max: 1000 }) });
  check("Budget min > max rejected", r.status === 400);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ pets: "dragons" }) });
  check("Unknown questionnaire answer rejected", r.status === 400);
  for (const name of ["3 bedroom on Elm Street side of town", "Sunny room, 10 min walk to Main St", "2 rooms near South Street station"]) {
    r = await api("/api/landlord/units", { method: "POST", as: landlordB, body: unitBody({ name }) });
    check(`Normal unit name accepted: ${name}`, r.status === 201, JSON.stringify(r.data));
  }
  const inj = `Robert'); DROP TABLE units;--`;
  r = await api("/api/landlord/units", { method: "POST", as: landlordB, body: unitBody({ name: inj, description: `<script>alert(1)</script>` }) });
  check("SQL injection text stored as plain text", r.status === 201 && r.data.unit.name === inj);
  check("units table still intact", d1rows(`SELECT COUNT(*) AS n FROM units`)[0].n >= 3);
  for (const id of ["' OR 1=1 --", "..%2F..%2Fadmin", unitA.id.toUpperCase()]) {
    r = await api(`/api/landlord/units/${encodeURIComponent(id)}`, { as: landlordB });
    check(`Weird unit id ${JSON.stringify(id)} → 404`, r.status === 404);
  }
  r = await api("/api/landlord/units", { method: "POST", as: landlordB, raw: "{not json", headers: { "Content-Type": "application/json" } });
  check("Malformed JSON → 400", r.status === 400);
  r = await api("/api/landlord/units", { method: "POST", as: landlordB, raw: JSON.stringify(unitBody({ description: "x".repeat(20000) })), headers: { "Content-Type": "application/json" } });
  check("Oversized body → 413", r.status === 413);
  r = await api("/api/landlord/units", { method: "POST", as: landlordB, raw: "[1,2]", headers: { "Content-Type": "application/json" } });
  check("JSON array instead of object → 400", r.status === 400);
  r = await api("/api/does-not-exist", { as: landlordA });
  check("Unknown API path → 404 with generic message", r.status === 404 && !JSON.stringify(r.data).includes("stack"));

  // ── Sign-out ──────────────────────────────────────────────────────────────
  r = await api("/api/auth/sign-out", { method: "POST", as: renterB, body: {} });
  check("Sign-out succeeds", r.status === 200);
  r = await api("/api/me", { as: renterB });
  check("Old cookie no longer works after sign-out (server session deleted)", r.data.user === null);
  check("Session row removed from D1", d1rows(`SELECT COUNT(*) AS n FROM "session" WHERE "userId"='t_renter_b'`)[0].n === 0);
  r = await api("/api/auth/sign-out", { method: "POST", as: renterA, body: {}, origin: "https://evil.example" });
  check("Cross-origin sign-out blocked (403)", r.status === 403);

  // ── Delete my account ─────────────────────────────────────────────────────
  const count = (sqlText) => d1rows(sqlText)[0].n;
  r = await api("/api/me/delete", { method: "POST", body: { confirm: "DELETE" } });
  check("Visitor cannot call delete-account (401)", r.status === 401);
  r = await api("/api/me/delete", { method: "POST", as: landlordB, body: { confirm: "DELETE" }, origin: "https://evil.example" });
  check("Cross-origin delete-account blocked (403)", r.status === 403);
  r = await api("/api/me/delete", { method: "POST", as: landlordB, body: {} });
  check("Delete-account without typed confirmation refused (400)", r.status === 400);
  d1(`INSERT INTO "account" (id,"accountId","providerId","userId","createdAt","updatedAt") VALUES ('acc_b','google-sub-b','google','t_landlord_b','${now}','${now}')`);
  check("Before deleting: Landlord B has units and a Google link", count(`SELECT COUNT(*) AS n FROM units WHERE landlord_user_id='t_landlord_b'`) >= 1 && count(`SELECT COUNT(*) AS n FROM "account" WHERE "userId"='t_landlord_b'`) === 1);
  r = await api("/api/me/delete", { method: "POST", as: landlordB, body: { confirm: "DELETE", userId: "t_landlord_a", id: "t_landlord_a" } });
  check("Landlord B deletes own account (forged other user id ignored)", r.status === 200 && r.data.deleted === true);
  check("Deleted user's row, units, sessions and Google link are gone",
    count(`SELECT (SELECT COUNT(*) FROM "user" WHERE id='t_landlord_b') + (SELECT COUNT(*) FROM units WHERE landlord_user_id='t_landlord_b') + (SELECT COUNT(*) FROM "session" WHERE "userId"='t_landlord_b') + (SELECT COUNT(*) FROM "account" WHERE "userId"='t_landlord_b') AS n`) === 0);
  check("Landlord A and their units are untouched", count(`SELECT COUNT(*) AS n FROM "user" WHERE id='t_landlord_a'`) === 1 && count(`SELECT COUNT(*) AS n FROM units WHERE landlord_user_id='t_landlord_a'`) === 2);
  check("Response clears the session cookie", (r.headers.getSetCookie?.() || []).some((c) => c.startsWith("better-auth.session_token=;") && c.includes("Max-Age=0")));
  r = await api("/api/me", { as: landlordB });
  check("Deleted user's old cookie no longer signs in", r.data.user === null);
  r = await api("/api/listings");
  check("Deleted landlord's units no longer listed", r.data.listings.every((u) => u.name !== inj) && r.data.listings.some((u) => u.id === unitA.id));
  r = await api("/api/me/delete", { method: "POST", as: renterA, body: { confirm: "DELETE" } });
  check("Renter A deletes own account; questionnaire answers are gone", r.status === 200 && count(`SELECT COUNT(*) AS n FROM match_preferences WHERE user_id='t_renter_a'`) === 0 && count(`SELECT COUNT(*) AS n FROM "user" WHERE id='t_renter_a'`) === 0);
  check("Other renters' answers untouched", count(`SELECT COUNT(*) AS n FROM match_preferences WHERE user_id='t_renter_b'`) === 1);

  // ── Rate limits ───────────────────────────────────────────────────────────
  let statuses = [];
  for (let i = 0; i < 32; i++) statuses.push((await api("/api/renter/preferences", { method: "PUT", as: rater, body: prefsBody() })).status);
  check("App write rate limit: 31st write in a minute → 429", statuses.slice(0, 30).every((s) => s === 200) && statuses[30] === 429, statuses.join(","));
  statuses = [];
  for (let i = 0; i < 12; i++) statuses.push((await api("/api/auth/sign-in/social", { method: "POST", body: { provider: "google" } })).status);
  check("Better Auth sign-in rate limit → 429 after 10/min", statuses.includes(429), statuses.join(","));

  // ── Cleanup job ───────────────────────────────────────────────────────────
  await fetch(`${BASE}/__scheduled?cron=17+4+*+*+*`);
  await sleep(500);
  check("Scheduled cleanup deletes expired sessions", d1rows(`SELECT COUNT(*) AS n FROM "session" WHERE id='s_expired'`)[0].n === 0);
} catch (err) {
  check("Test run crashed", false, err.stack);
} finally {
  dev.kill();
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("\nWorker log (tail):\n" + devLog.split("\n").slice(-40).join("\n"));
  process.exitCode = 1;
}
setTimeout(() => process.exit(), 1000);
