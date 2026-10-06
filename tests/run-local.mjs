// Local end-to-end tests: `npm test`.
// Runs the real Worker in `wrangler dev` against Wrangler's LOCAL D1 (a SQLite file
// under .wrangler/test-state, reset every run). Nothing here talks to Cloudflare or Google.
// Fixture users get signed Better Auth session cookies made with a per-run random secret.
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { rankUnits } from "../src/match.js";
import { rankRoommates, scoreRoommate } from "../src/roommates.js";

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
    "--var", "MAPTILER_KEY:test-browser-key", "--var", "GOOGLE_CLIENT_ID:local-test-client.apps.googleusercontent.com", "--var", "GOOGLE_CLIENT_SECRET:local-test-only"],
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
  // ── Matching rules (pure function, no server) ─────────────────────────────
  {
    const want = { budget_min: 900, budget_max: 1000, move_in_month: "2027-06", area: "Waltham", rooms_needed: 2 };
    const unit = (over) => ({ id: "u", name: "n", area: "Waltham, MA", monthly_rent: 1000, rooms_available: 2, move_in_date: "2027-06-01", ...over });
    const shown = (over) => rankUnits(want, [unit(over)]);
    check("Match: budget, area, month and rooms all fit → 100%", shown({})[0]?.score === 100);
    check("Match: up to 10% over budget is shown, labeled slightly over", shown({ monthly_rent: 1100 })[0]?.reasons.includes("Slightly over budget"));
    check("Match: more than 10% over budget is never shown", shown({ monthly_rent: 1101 }).length === 0);
    check("Match: too few rooms is never shown", shown({ rooms_available: 1 }).length === 0);
    check("Match: affordable but wrong area and wrong month is not shown", shown({ area: "Belmont, MA", move_in_date: "2027-01-01" }).length === 0);
    check("Match: affordable, wrong area, exact month is shown", shown({ area: "Belmont, MA" })[0]?.score === 75);
    check("Match: affordable, right area, wrong month is shown", shown({ move_in_date: "2027-01-01" })[0]?.score === 80);
    check("Match: affordable, wrong area, month one off is not shown", shown({ area: "Belmont, MA", move_in_date: "2027-07-01" }).length === 0);
    const ranked = rankUnits(want, [unit({ id: "far", area: "Belmont, MA" }), unit({ id: "best" }), unit({ id: "cheaper", monthly_rent: 950 })]);
    check("Match: sorted by score, then lower rent", ranked.map((m) => m.unit.id).join() === "cheaper,best,far");
    check("Match: result carries only unit, score and reasons", Object.keys(ranked[0]).sort().join() === "reasons,score,unit");
  }

  // ── Roommate rules (pure function, no server) ─────────────────────────────
  {
    const a = { budget_min: 900, budget_max: 1300, move_in_month: "2027-06", area: "Waltham", sleep_schedule: "early", cleanliness: "tidy", noise: "quiet", guests: "rarely", pets: "no_pets", smoking: "no_smoking" };
    const s = (over) => scoreRoommate(a, { ...a, ...over });
    check("Roommate: identical answers → 100%", s({}).score === 100 && s({}).eligible);
    check("Roommate: different area is never a match", !s({ area: "Cambridge" }).eligible);
    check("Roommate: move-in two months apart is never a match", !s({ move_in_month: "2027-08" }).eligible);
    check("Roommate: move-in one month apart is allowed", s({ move_in_month: "2027-07" }).eligible && s({ move_in_month: "2027-07" }).score === 90);
    check("Roommate: has a pet vs no pets is a dealbreaker", !s({ pets: "have_pets" }).eligible);
    check("Roommate: smoker vs no smoking is a dealbreaker", !s({ smoking: "smoker" }).eligible);
    check("Roommate: opposite lifestyle falls below the bar", !s({ sleep_schedule: "late", cleanliness: "relaxed", noise: "lively", guests: "often" }).eligible);
    check("Roommate: 'in common' lists only shared things", !s({ cleanliness: "average", noise: "moderate" }).shared.some((t) => /tid|noise|quiet/i.test(t)) && s({}).shared.includes("Both very tidy"));
    const ranked = rankRoommates(a, [
      { prefs: { ...a, guests: "often" }, firstName: "Lower", email: "lower@example.test", sample: false },
      { prefs: { ...a }, firstName: "Top", email: null, sample: true },
    ]);
    check("Roommate: ranked by score; result has only firstName, score, shared, email, sample", ranked.map((m) => m.firstName).join() === "Top,Lower" && Object.keys(ranked[0]).sort().join() === "email,firstName,sample,score,shared");
  }

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
  d1(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",role,account_type) VALUES ('sample-landlord-99','Sample Landlord (sample)','landlord99@sample.example',0,'${now}','${now}','user','landlord'); INSERT INTO units (id,landlord_user_id,name,area,monthly_rent,rooms_available,move_in_date,description,status,created_at,updated_at) VALUES ('00000000-0000-4000-8000-000000000099','sample-landlord-99','Sample room','Waltham, MA',1000,1,'2027-06-01','','active',1,1)`);
  r = await api("/api/listings");
  check("Sample listings are flagged, real ones are not", r.data.listings.find((u) => u.id === "00000000-0000-4000-8000-000000000099")?.sample === true && r.data.listings.find((u) => u.id === unitA.id)?.sample === false);
  const listingKeys = Object.keys(r.data.listings[0] || {}).sort().join(",");
  check("Listings expose only listing fields (no landlord id/email/status)", listingKeys === "area,description,id,location,monthly_rent,move_in_date,name,rooms_available,sample", listingKeys);

  // ── Location (Massachusetts only; approximate unless the landlord picks exact) ──
  const meters = (a, b) => {
    const r = Math.PI / 180;
    const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lng - a.lng) * r) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(h));
  };
  const TRUE_SPOT = { lat: 42.376512, lng: -71.235634 };
  const elm = { address: "14 Elm Street, Waltham, Massachusetts 02453", ...TRUE_SPOT, state: "Massachusetts" };
  r = await api("/api/config");
  check("Config endpoint gives the browser its map key", r.status === 200 && r.data.maptilerKey === "test-browser-key");
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Test Unit (edited)", monthly_rent: 1150, location: elm }) });
  check("Landlord saves an address and pin; default is approximate", r.status === 200 && r.data.unit.address === elm.address && r.data.unit.lat === TRUE_SPOT.lat && r.data.unit.location_precision === "approximate", JSON.stringify(r.data));
  check("Stored location carries the MapTiler attribution", d1rows(`SELECT geo_source FROM units WHERE id='${unitA.id}'`)[0].geo_source.includes("MapTiler"));
  r = await api("/api/listings");
  let shown = r.data.listings.find((u) => u.id === unitA.id);
  const listingText = JSON.stringify(r.data);
  check("Renters get an approximate point and a 500 m radius, not the exact pin", shown.location.precision === "approximate" && shown.location.radiusM === 500 && (shown.location.lat !== TRUE_SPOT.lat || shown.location.lng !== TRUE_SPOT.lng), JSON.stringify(shown.location));
  check("The true spot is inside the circle renters see", meters(shown.location, TRUE_SPOT) < 500, String(meters(shown.location, TRUE_SPOT)));
  check("Approximate listings never include the street address or exact coordinates", !listingText.includes("Elm Street") && !listingText.includes("42.376512") && !("address" in shown.location));
  const firstPoint = JSON.stringify(shown.location);
  r = await api("/api/listings");
  check("The approximate point is stable between requests", JSON.stringify(r.data.listings.find((u) => u.id === unitA.id).location) === firstPoint);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Test Unit (edited)", monthly_rent: 1150, location: { ...elm, precision: "exact" } }) });
  r = await api("/api/listings");
  shown = r.data.listings.find((u) => u.id === unitA.id);
  check("Exact: renters see the pin and the address", shown.location.precision === "exact" && shown.location.lat === TRUE_SPOT.lat && shown.location.address === elm.address);
  r = await api(`/api/landlord/units/${unitA.id}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Test Unit (edited)", monthly_rent: 1150, location: elm }) });
  check("Switching back to approximate hides the address again", !JSON.stringify((await api("/api/listings")).data).includes("Elm Street"));
  r = await api("/api/landlord/units", { method: "POST", as: newbie, body: unitBody({ location: { address: "1 Main Street, Providence, Rhode Island", lat: 41.824, lng: -71.4128, state: "Rhode Island" } }) });
  check("Address outside Massachusetts refused", r.status === 400 && r.data.field === "address");
  r = await api("/api/landlord/units", { method: "POST", as: newbie, body: unitBody({ location: { ...elm, lat: 40.7128, lng: -74.006 } }) });
  check("Pin outside Massachusetts refused even if the state says Massachusetts", r.status === 400 && r.data.field === "address");
  r = await api("/api/landlord/units", { method: "POST", as: newbie, body: unitBody({ location: { ...elm, lat: "near Boston" } }) });
  check("Malformed coordinates refused", r.status === 400);
  r = await api("/api/landlord/units", { method: "POST", as: newbie, body: unitBody({ location: { ...elm, precision: "street-view" } }) });
  check("Unknown precision value refused", r.status === 400);
  r = await api("/api/landlord/units", { method: "POST", as: newbie, body: unitBody({ name: "14 Elm Street", location: elm }) });
  check("Street address still refused in the unit name", r.status === 400 && r.data.field === "name");
  r = await api(`/api/landlord/units/${unitA.id}`, { as: landlordB });
  check("Another landlord cannot read the exact address (404)", r.status === 404);
  r = await api("/api/landlord/units", { method: "POST", as: landlordA, body: unitBody({ name: "No location unit", status: "inactive" }) });
  check("A unit can still be saved without a location", r.status === 201 && r.data.unit.lat === null && r.data.unit.address === null);
  await api(`/api/landlord/units/${r.data.unit.id}`, { method: "DELETE", as: landlordA });

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

  // ── Roommate matching (opt-in) ────────────────────────────────────────────
  r = await api("/api/renter/roommates");
  check("Visitor cannot call roommates (401)", r.status === 401);
  r = await api("/api/renter/roommates", { as: landlordA });
  check("Landlord cannot call roommates (403)", r.status === 403);
  r = await api("/api/renter/preferences", { as: renterA });
  check("Roommate matching and email sharing are off by default", r.data.preferences.roommate_visible === false && r.data.preferences.share_email === false);
  r = await api("/api/renter/roommates", { as: renterA });
  check("Not opted in → sees nobody", r.status === 200 && r.data.optedIn === false && r.data.roommates.length === 0);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody({ budget_max: 1300, roommate_visible: true }) });
  check("Renter A opts in to roommate matching (email sharing stays off)", r.data.preferences.roommate_visible === true && r.data.preferences.share_email === false);
  r = await api("/api/renter/roommates", { as: renterA });
  check("Opted-in renter does not see a renter who has not opted in", r.data.optedIn === true && r.data.roommates.length === 0);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, share_email: true }) });
  check("Email sharing cannot be on without roommate matching", r.data.preferences.share_email === false && r.data.preferences.roommate_visible === false);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, roommate_visible: "yes" }) });
  check("Non-boolean opt-in value rejected (400)", r.status === 400);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, roommate_visible: true, share_email: true }) });
  check("Renter B opts in and shares email", r.data.preferences.roommate_visible === true && r.data.preferences.share_email === true);
  r = await api("/api/renter/roommates", { as: renterA });
  const seenB = r.data.roommates[0];
  check("Renter A now sees Renter B as a possible roommate", r.data.roommates.length === 1 && seenB.score >= 60 && seenB.firstName === "Test");
  check("B's email is shown because B chose to share it", seenB.email === renterB.email);
  const mateText = JSON.stringify(r.data);
  const mateLeaks = ["Renter B", "t_renter", "budget_", "sleep_schedule", "cleanliness", "user_id", "999", "\"id\""].filter((k) => mateText.includes(k));
  check("Roommate result has no last name, ids, budget figures or raw answers", mateLeaks.length === 0 && Object.keys(seenB).sort().join() === "email,firstName,sample,score,shared", mateLeaks.join(","));
  r = await api("/api/renter/roommates", { as: renterB });
  check("Renter B sees Renter A without an email (A did not share it)", r.data.roommates.length === 1 && r.data.roommates[0].email === null);
  r = await api("/api/renter/roommates?user_id=t_renter_b&share_email=1", { as: rater });
  check("A renter with no saved preferences sees nobody, whatever the query says", r.data.roommates.length === 0 && r.data.optedIn === false);
  r = await api("/api/renter/preferences", { method: "PUT", as: renterA, body: prefsBody({ budget_max: 1300 }) });
  r = await api("/api/renter/roommates", { as: renterB });
  check("Turning it off removes Renter A from others' results immediately", r.data.roommates.length === 0);

  // ── "I'm interested": renter contacts landlord ────────────────────────────
  const SAMPLE_UNIT = "00000000-0000-4000-8000-000000000099";
  const interestCount = (where) => d1rows(`SELECT COUNT(*) AS n FROM unit_interests WHERE ${where}`)[0].n;
  r = await api("/api/renter/interests", { method: "POST", body: { unit_id: unitA.id } });
  check("Visitor cannot send interest (401)", r.status === 401);
  r = await api("/api/renter/interests", { method: "POST", as: landlordB, body: { unit_id: unitA.id } });
  check("Landlord cannot send interest (403)", r.status === 403);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: unitA.id }, origin: "https://evil.example" });
  check("Cross-origin interest request blocked (403)", r.status === 403);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: unitA.id, message: "Hi, I'd love to see the room. Free most evenings.", renter_user_id: "t_renter_b", id: "forged" } });
  check("Renter A sends interest in Landlord A's unit", r.status === 201 && r.data.interest.unitId === unitA.id);
  check("Forged renter id ignored: request belongs to Renter A", interestCount(`renter_user_id='t_renter_a' AND unit_id='${unitA.id}'`) === 1 && interestCount("1=1") === 1);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: unitA.id, message: "again" } });
  check("Second request for the same unit refused (409)", r.status === 409 && r.data.error === "already_sent");
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: inactiveId } });
  check("Cannot send interest in an inactive unit (404)", r.status === 404);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: SAMPLE_UNIT } });
  check("Cannot send interest in a sample listing (409)", r.status === 409 && r.data.error === "sample_listing");
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: "11111111-1111-4111-8111-111111111111" } });
  check("Unknown unit → 404", r.status === 404);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: "' OR 1=1 --" } });
  check("Malformed unit id → 400", r.status === 400);
  r = await api("/api/renter/interests", { method: "POST", as: renterB, body: { unit_id: unitA.id, message: "Call me on (617) 555-0142" } });
  check("Phone number in the note refused (400)", r.status === 400 && r.data.field === "message");
  r = await api("/api/renter/interests", { method: "POST", as: renterB, body: { unit_id: unitA.id, message: "x".repeat(501) } });
  check("Note over 500 characters refused (400)", r.status === 400);

  r = await api("/api/renter/interests", { as: renterA });
  const mine = JSON.stringify(r.data);
  check("Renter A sees own request", r.status === 200 && r.data.interests.length === 1 && r.data.interests[0].unitName === "Test Unit (edited)" && r.data.interests[0].listed === true);
  check("Renter's view never includes the landlord's name, email or id", !["landlord", "Landlord", "example.test", "t_landlord"].some((k) => mine.includes(k)), mine);
  r = await api("/api/renter/interests", { as: renterB });
  check("Renter B does not see Renter A's request", r.data.interests.length === 0);

  r = await api("/api/landlord/interests");
  check("Visitor cannot read landlord requests (401)", r.status === 401);
  r = await api("/api/landlord/interests", { as: renterA });
  check("Renter cannot read landlord requests (403)", r.status === 403);
  r = await api("/api/landlord/interests", { as: landlordA });
  const inbox = r.data.interests || [];
  const inboxText = JSON.stringify(r.data);
  check("Landlord A sees the request with the renter's name, email and note", inbox.length === 1 && inbox[0].renterName === renterA.name && inbox[0].renterEmail === renterA.email && inbox[0].message.startsWith("Hi, I'd love") && inbox[0].unitName === "Test Unit (edited)");
  check("Landlord's view has no questionnaire answers or user ids", !["budget", "sleep_schedule", "smoking", "t_renter", "roommate"].some((k) => inboxText.includes(k)), inboxText);
  r = await api("/api/landlord/interests", { as: landlordB });
  check("Landlord B does not see requests for Landlord A's units", r.status === 200 && r.data.interests.length === 0);
  r = await api(`/api/landlord/interests/${inbox[0].id}`, { method: "DELETE", as: landlordB });
  check("Landlord B cannot remove Landlord A's request (404)", r.status === 404 && interestCount("1=1") === 1);
  r = await api(`/api/renter/interests/${unitA.id}`, { method: "DELETE", as: renterB });
  check("Renter B cannot withdraw Renter A's request (404)", r.status === 404 && interestCount("1=1") === 1);
  r = await api(`/api/landlord/interests/${inbox[0].id}`, { method: "DELETE", as: landlordA });
  check("Landlord A removes the request", r.status === 200 && interestCount("1=1") === 0);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: unitA.id } });
  r = await api(`/api/renter/interests/${unitA.id}`, { method: "DELETE", as: renterA });
  check("Renter A sends again, then withdraws; landlord's list is empty", r.status === 200 && (await api("/api/landlord/interests", { as: landlordA })).data.interests.length === 0);

  r = await api("/api/landlord/units", { method: "POST", as: landlordA, body: unitBody({ name: "Unit that will be deleted" }) });
  const doomedId = r.data.unit.id;
  await api("/api/renter/interests", { method: "POST", as: renterB, body: { unit_id: doomedId, message: "Interested" } });
  r = await api(`/api/landlord/units/${doomedId}`, { method: "DELETE", as: landlordA });
  check("Deleting a unit removes the requests on it", r.status === 200 && interestCount(`unit_id='${doomedId}'`) === 0);
  await api(`/api/landlord/units/${inactiveId}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Hidden inactive unit", status: "active" }) });
  await api("/api/renter/interests", { method: "POST", as: renterB, body: { unit_id: inactiveId } });
  await api(`/api/landlord/units/${inactiveId}`, { method: "PUT", as: landlordA, body: unitBody({ name: "Hidden inactive unit", status: "inactive" }) });
  r = await api("/api/renter/interests", { as: renterB });
  check("A request on a unit that went inactive is shown to the renter as no longer listed", r.data.interests.length === 1 && r.data.interests[0].listed === false);
  r = await api("/api/renter/interests", { method: "POST", as: renterA, body: { unit_id: unitA.id, message: "Still interested" } });
  check("Renter A has one open request before the account-deletion tests", r.status === 201);

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
  check("Admin can open the user list", r.status === 200 && Array.isArray(r.data.users) && r.data.users.length === Object.keys(people).length + 1);
  check("Admin list flags sample accounts", r.data.users.filter((u) => u.isSample).map((u) => u.email).join() === "landlord99@sample.example");
  const adminText = JSON.stringify(r.data);
  const leaked = ["budget", "sleep_schedule", "smoking", "token", "session", "expiresAt", "monthly_rent", "\"id\"", "accountId", "Waltham", "Elm Street", "42.376"].filter((k) => adminText.includes(k));
  check("Admin list contains no questionnaire answers, unit details, ids, tokens or sessions", leaked.length === 0, leaked.join(","));
  const la = r.data.users.find((u) => u.email === landlordA.email);
  const ra = r.data.users.find((u) => u.email === renterA.email);
  const rb = r.data.users.find((u) => u.email === renterB.email);
  check("Admin list shows unit count for landlords and prefs yes/no for renters", la.unitCount === 2 && ra.hasPreferences === true && rb.hasPreferences === true && la.hasPreferences === null);

  // ── Admin import of external listings (TEST rows only, in this throwaway database) ──
  const HEAD = "source_name,source_listing_id,source_url,property_name,address,city,zip,rent,rent_basis,fees,bedrooms,bathrooms,available_date,listing_status,source_posted_date,source_updated_date,retrieved_date,latitude,longitude,coordinates_permitted,photo_url,photo_license";
  const testRow = (n, city, zip, extra = {}) => {
    const v = { source_name: "TEST SOURCE", source_listing_id: "T" + n, source_url: "https://example.test/listing/" + n, property_name: "TEST listing " + n, address: n + " Test Way", city, zip, rent: "2400", rent_basis: "unit", fees: "", bedrooms: "2", bathrooms: "1", available_date: "2026-12-01", listing_status: "active", source_posted_date: "2026-09-20", source_updated_date: "2026-10-01", retrieved_date: "2026-10-02", latitude: "", longitude: "", coordinates_permitted: "", photo_url: "", photo_license: "", ...extra };
    return HEAD.split(",").map((k) => JSON.stringify(String(v[k]))).join(",");
  };
  const testCsv = [HEAD,
    testRow(1, "Waltham", "02453", { latitude: "42.3765", longitude: "-71.2356", coordinates_permitted: "yes", fees: "$50 application fee" }),
    testRow(2, "Cambridge", "02139", { rent_basis: "room", rent: "1450", bedrooms: "studio" }),
    testRow(3, "Boston", "02116", { rent: "", source_updated_date: "" }),
    testRow(4, "Somerville", "02143", { listing_status: "rented" }),
    testRow(5, "Nashua", "03060"),
    testRow(1, "Waltham", "02453"),
  ].join("\n");
  const externalCount = () => d1rows("SELECT COUNT(*) AS n FROM external_listings")[0].n;
  r = await api("/api/admin/imports/preview", { method: "POST", body: { csv: testCsv } });
  check("Visitor cannot preview an import (401)", r.status === 401);
  r = await api("/api/admin/imports/preview", { method: "POST", as: landlordA, body: { csv: testCsv } });
  check("Landlord cannot preview an import (403)", r.status === 403);
  r = await api("/api/admin/imports", { as: renterB });
  check("Renter cannot see imports (403)", r.status === 403);
  r = await api("/api/admin/imports/preview", { method: "POST", as: admin, body: { csv: testCsv } });
  const sum = r.data.summary || {};
  check("Preview sorts rows: 3 ready, 1 rented, 1 outside MA, 1 duplicate", r.status === 200 && sum.ready === 3 && sum.excluded === 1 && sum.invalid === 1 && sum.duplicate === 1, JSON.stringify(sum));
  check("Preview saves nothing", externalCount() === 0 && d1rows("SELECT COUNT(*) AS n FROM import_batches")[0].n === 0);
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, confirm: true } });
  check("Import refused without a permission basis", r.status === 400 && r.data.field === "permission_basis");
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, permission: { basis: "landlord_permission", note: "short" }, confirm: true } });
  check("Import refused without permission details", r.status === 400 && r.data.field === "permission_note");
  const permission = { basis: "landlord_permission", note: "TEST: written permission from test landlords, kept in the test folder" };
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, permission } });
  check("Import refused without the confirmation tick", r.status === 400 && r.data.field === "confirm");
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, permission, confirm: true }, origin: "https://evil.example" });
  check("Cross-origin import blocked (403)", r.status === 403);
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, permission, confirm: true } });
  const batchId = r.data.batchId;
  check("Admin imports the 3 ready rows", r.status === 201 && r.data.imported === 3 && externalCount() === 3, JSON.stringify(r.data));
  check("The import is recorded with its permission and in the audit log", d1rows(`SELECT permission_basis AS b, rows_imported AS n FROM import_batches WHERE id='${batchId}'`)[0].n === 3 && d1rows("SELECT COUNT(*) AS n FROM admin_audit WHERE action='import'")[0].n === 1);
  check("Imported listings belong to no landlord account", d1rows("SELECT COUNT(*) AS n FROM units WHERE name LIKE 'TEST listing%'")[0].n === 0);
  r = await api("/api/listings");
  const ext = r.data.listings.filter((u) => u.external);
  const one = ext.find((u) => u.source.url === "https://example.test/listing/1");
  const two = ext.find((u) => u.source.url === "https://example.test/listing/2");
  const three = ext.find((u) => u.source.url === "https://example.test/listing/3");
  check("Imported listings appear in public listings, labeled external with their source", ext.length === 3 && one.source.name === "TEST SOURCE" && one.source.retrievedDate === "2026-10-02");
  check("Whole-unit and per-room rent are kept apart; missing rent stays blank", one.rent_basis === "unit" && two.rent_basis === "room" && two.bedrooms === 0 && three.monthly_rent === null && three.source.updatedDate === null);
  check("Permitted coordinates give a map pin; none given, no pin", one.location && one.location.lat === 42.3765 && three.location === null);
  check("Imported listings carry no landlord identity", !JSON.stringify(ext).includes("landlord"));
  check("After the import, sample listings are hidden from public listings", !r.data.listings.some((u) => u.id === "00000000-0000-4000-8000-000000000099") && r.data.listings.some((u) => u.id === unitA.id));
  r = await api("/api/renter/matches", { as: renterA });
  check("Renter matches use coHabit listings only (no imported, no hidden samples)", r.status === 200 && !(r.data.matches || []).some((m) => m.unit.external || m.unit.sample));
  r = await api("/api/admin/imports", { method: "POST", as: admin, body: { csv: testCsv, permission, confirm: true } });
  check("Importing the same file again finds only duplicates (409)", r.status === 409 && externalCount() === 3);
  const many = [HEAD].concat(Array.from({ length: 52 }, (_, i) => testRow(100 + i, "Worcester", "01608", { source_updated_date: "2026-09-" + String((i % 28) + 1).padStart(2, "0") })), [testRow(200, "Boston", "02118", { source_updated_date: "2026-08-01" })]).join("\n");
  r = await api("/api/admin/imports/preview", { method: "POST", as: admin, body: { csv: many } });
  const boston = r.data.rows.find((x) => x.listing.city === "Boston");
  check("At most 50 rows are imported; priority cities go first", r.data.summary.ready === 50 && r.data.summary.over_limit === 3 && boston.status === "ready", JSON.stringify(r.data.summary));
  r = await api("/api/admin/imports/preview", { method: "POST", as: admin, raw: JSON.stringify({ csv: "x".repeat(700 * 1024) }), headers: { "Content-Type": "application/json" } });
  check("Oversized import file refused (413)", r.status === 413);
  r = await api("/api/admin/settings", { method: "POST", as: landlordA, body: { hideSampleListings: false } });
  check("Landlord cannot change the sample-listing switch (403)", r.status === 403);
  r = await api(`/api/admin/imports/${batchId}/rollback`, { method: "POST", as: landlordA, body: {} });
  check("Landlord cannot roll back an import (403)", r.status === 403 && externalCount() === 3);
  r = await api(`/api/admin/imports/${batchId}/rollback`, { method: "POST", as: admin, body: {} });
  check("Admin rolls the import back; samples come back when nothing imported is left", r.status === 200 && r.data.removed === 3 && r.data.sampleHidden === false && externalCount() === 0);
  r = await api("/api/listings");
  check("After rollback: no imported listings, sample listings public again", !r.data.listings.some((u) => u.external) && r.data.listings.some((u) => u.id === "00000000-0000-4000-8000-000000000099"));
  r = await api(`/api/admin/imports/${batchId}/rollback`, { method: "POST", as: admin, body: {} });
  check("Rolling back twice is refused (409)", r.status === 409);
  r = await api("/api/admin/settings", { method: "POST", as: admin, body: { hideSampleListings: true } });
  const hiddenNow = !(await api("/api/listings")).data.listings.some((u) => u.id === "00000000-0000-4000-8000-000000000099");
  await api("/api/admin/settings", { method: "POST", as: admin, body: { hideSampleListings: false } });
  check("Admin can hide and show sample listings by hand", r.status === 200 && hiddenNow && (await api("/api/listings")).data.listings.some((u) => u.id === "00000000-0000-4000-8000-000000000099"));
  r = await api("/api/admin/imports", { as: admin });
  check("Past imports list shows the rolled-back import", r.status === 200 && r.data.batches[0].status === "rolled_back" && r.data.externalCount === 0);

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
  check("Deleted renter's requests to landlords are gone; other renters' requests stay", count(`SELECT COUNT(*) AS n FROM unit_interests WHERE renter_user_id='t_renter_a'`) === 0 && count(`SELECT COUNT(*) AS n FROM unit_interests WHERE renter_user_id='t_renter_b'`) === 1);

  // ── Rate limits ───────────────────────────────────────────────────────────
  // The limiter counts per clock minute, so the burst must start and finish inside one minute.
  // If the minute rolls over mid-burst the counter resets; wait for a fresh minute and try once more.
  let statuses = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    if (new Date().getSeconds() > 45) await sleep((61 - new Date().getSeconds()) * 1000);
    const minute = Math.floor(Date.now() / 60000);
    statuses = [];
    for (let i = 0; i < 32; i++) statuses.push((await api("/api/renter/preferences", { method: "PUT", as: rater, body: prefsBody() })).status);
    if (Math.floor(Date.now() / 60000) === minute) break;
  }
  check("App write rate limit: more than 30 writes in a minute → 429", statuses[0] === 200 && statuses.includes(429) && statuses.indexOf(429) <= 30, statuses.join(","));
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
