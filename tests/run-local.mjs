// Local end-to-end tests: `npm test`.
// Runs the real Worker in `wrangler dev` against Wrangler's LOCAL D1 (a SQLite file
// under .wrangler/test-state, reset every run). Nothing here talks to Cloudflare or Google.
// Fixture users get signed Better Auth session cookies made with a per-run random secret.
import { spawn, execFileSync } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import { allowedNumbers, groundReply } from "../src/assistant/ai.js";
import { understand } from "../src/assistant/basic.js";
import { applyUpdates, emptyMemory } from "../src/assistant/memory.js";
import { DEMO_LISTINGS, DEMO_PEOPLE } from "../src/assistant/demo-data.js";
import { BRANDEIS, kmBetween, searchRooms } from "../src/assistant/search.js";
import { PHONE, hasAddress } from "../src/validate.js";
import { rankUnits } from "../src/match.js";
import { rankRoommates, scoreRoommate } from "../src/roommates.js";
import { makeHandle } from "../src/connections.js";
import { majorDifferences, roommateDifferences } from "../src/roommates.js";
import { authOptions } from "../src/auth.js";
import { devOutboxOn } from "../src/email.js";
import { startFakeAnthropic } from "./fake-anthropic.mjs";

const PORT = 8788;
const BASE = `http://localhost:${PORT}`;
const STATE = ".wrangler/test-state";
const SECRET = randomBytes(32).toString("base64url");
const WRANGLER = ["node_modules/wrangler/bin/wrangler.js"];
const FAKE_AI_PORT = 8799; // stand-in for the AI service (tests/fake-anthropic.mjs)
const AI_DAILY_PER_USER = 20;

// ── Fixtures ────────────────────────────────────────────────────────────────
const people = {
  landlordA: { id: "t_landlord_a", name: "Test Landlord A", email: "landlord-a@example.test", type: "landlord" },
  landlordB: { id: "t_landlord_b", name: "Test Landlord B", email: "landlord-b@example.test", type: "landlord" },
  renterA: { id: "t_renter_a", name: "Test Renter A", email: "renter-a@example.test", type: "renter" },
  renterB: { id: "t_renter_b", name: "Test Renter B", email: "renter-b@example.test", type: "renter" },
  newbie: { id: "t_new", name: "Test Newcomer", email: "new@example.test", type: null },
  admin: { id: "t_admin", name: "Test Admin (disposable)", email: "admin@example.test", type: null, role: "admin" },
  rater: { id: "t_rate", name: "Test Rate Limit", email: "rate@example.test", type: "renter" },
  chatAi: { id: "t_chat_ai", name: "Chatty Aitester", email: "chat-ai@example.test", type: "renter" },
  chatMate: { id: "t_chat_mate", name: "Mia Chatmate", email: "chat-mate@example.test", type: "renter" },
  chatBasic: { id: "t_chat_basic", name: "Basil Basictester", email: "chat-basic@example.test", type: "renter" },
  chatFresh: { id: "t_chat_fresh", name: "Frankie Freshtester", email: "chat-fresh@example.test", type: "renter" },
  chatPal: { id: "t_chat_pal", name: "Pat Paltester", email: "chat-pal@example.test", type: "renter" },
  outsider: { id: "t_outsider", name: "Oscar Outsider", email: "outsider@example.test", type: "renter" },
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
// A second session for the chat user, as if they signed in again on another device.
{
  const token = randomBytes(24).toString("base64url");
  people.chatAi.cookie2 = cookieFor(token);
  sql += `INSERT INTO "session" (id,"expiresAt",token,"createdAt","updatedAt","userId") VALUES ('s_chat_ai_2',${q(future)},${q(token)},${q(now)},${q(now)},'t_chat_ai');\n`;
}
// This renter has already used today's AI replies, so the assistant answers in basic mode.
sql += `INSERT INTO assistant_usage (day, user_id, replies) VALUES (${q(now.slice(0, 10))}, 't_chat_basic', ${AI_DAILY_PER_USER}), (${q(now.slice(0, 10))}, 't_chat_fresh', ${AI_DAILY_PER_USER});\n`;
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

const fakeAi = startFakeAnthropic(FAKE_AI_PORT);
console.log("Starting local Worker …");
const dev = spawn(
  process.execPath,
  [...WRANGLER, "dev", "--port", String(PORT), "--persist-to", STATE, "--test-scheduled",
    "--var", `BETTER_AUTH_URL:${BASE}`, "--var", `BETTER_AUTH_SECRET:${SECRET}`,
    "--var", "MAPTILER_KEY:test-browser-key", "--var", "GOOGLE_CLIENT_ID:local-test-client.apps.googleusercontent.com", "--var", "GOOGLE_CLIENT_SECRET:local-test-only",
    "--var", "ANTHROPIC_API_KEY:test-key-for-local-tests-only", "--var", `ANTHROPIC_BASE_URL:http://127.0.0.1:${FAKE_AI_PORT}`,
    "--var", `ASSISTANT_DAILY_PER_USER:${AI_DAILY_PER_USER}`, "--var", "ASSISTANT_PER_MINUTE:100", "--var", "DEV_EMAIL_OUTBOX:1"],
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

const { landlordA, landlordB, renterA, renterB, newbie, admin, rater, chatAi, chatMate, chatBasic, chatFresh, chatPal, outsider } = people;

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

  // ── Assistant rules (pure functions, no server) ───────────────────────────
  {
    const today = "2026-10-12";
    const u1 = understand("Hi, I'm looking for a room in Waltham or Newton from September, up to $1,400 a month, just me", today).updates;
    check("Basic mode reads budget, month, towns and rooms from one sentence", u1.budget_max === 1400 && u1.move_in_month === "2027-09" && u1.areas?.join() === "Waltham,Newton" && u1.rooms_needed === 1, JSON.stringify(u1));
    const u2 = understand("June 2027, within 3 km", today).updates;
    check("Basic mode doesn't mistake years or distances for a budget", u2.budget_max === undefined && u2.move_in_month === "2027-06" && u2.max_distance_km === 3, JSON.stringify(u2));
    const u3 = understand("between $900 and $1,200, that's firm", today).updates;
    check("Basic mode reads a budget range and a firm limit", u3.budget_min === 900 && u3.budget_max === 1200 && u3.must_have?.includes("budget_max"), JSON.stringify(u3));
    const u4 = understand("I'm a night owl, very tidy, and I have a cat", today).updates;
    check("Basic mode reads lifestyle answers", u4.sleep_schedule === "late" && u4.cleanliness === "tidy" && u4.pets === "have_pets", JSON.stringify(u4));
    check("Basic mode: wanting \"a room\" isn't a room count", understand("I want a room", today).updates.rooms_needed === undefined);
    const m = applyUpdates(emptyMemory(), { areas: ["12 Main Street"], move_in_month: "2025-01", budget_max: 1200, role: "admin", gender: "female", religion: "any" }, today);
    check("Memory refuses street addresses, past months and anything outside its fields (no role, gender or religion), keeps valid answers", m.memory.v.budget_max === 1200 && !m.memory.v.areas && !m.memory.v.move_in_month && Object.keys(m.memory.v).join() === "budget_max" && m.errors.length === 5, JSON.stringify(m.errors));

    let n = 0;
    const unit = (over) => ({ id: `u${++n}`, name: "n", area: "Waltham, MA", monthly_rent: 1000, rooms_available: 1, move_in_date: "2027-06-01", description: "", sample: false, location: null, ...over });
    const mem = (v, req = {}) => ({ v, req });
    const s1 = searchRooms(mem({ budget_max: 1000 }), [unit({ monthly_rent: 1050 })]);
    check("Search: a must-have budget hides a dearer room, and says what relaxing it would bring back", s1.results.length === 0 && s1.ifRelaxed[0]?.condition === "budget" && s1.ifRelaxed[0].extraRooms === 1);
    const s2 = searchRooms(mem({ budget_max: 1000 }, { budget_max: false }), [unit({ monthly_rent: 1050 })]);
    check("Search: a flexible budget shows it, with the mismatch spelled out", s2.results.length === 1 && s2.results[0].misses[0] === "$1,050 a month, $50 over your $1,000 budget");
    const s3 = searchRooms(mem({ areas: ["Newton"] }), [unit({})]);
    check("Search: a flexible area ranks but doesn't hide", s3.results.length === 1 && s3.results[0].misses[0].startsWith("In Waltham, MA, not one of your areas"));
    const s4 = searchRooms(mem({ areas: ["Newton"] }, { areas: true }), [unit({})]);
    check("Search: a must-have area hides other towns", s4.results.length === 0 && s4.ifRelaxed[0]?.condition === "area");
    const s5 = searchRooms(mem({ max_distance_km: 2 }), [
      unit({ id: "no-location", monthly_rent: 900 }),
      unit({ id: "far", location: { precision: "exact", lat: 42.3601, lng: -71.0589 } }), // downtown Boston, about 16 km
      unit({ id: "near", location: { precision: "approximate", lat: 42.37, lng: -71.245 } }),
    ]);
    check("Search: a must-have distance hides rooms known to be farther from Brandeis", !s5.results.some((r) => r.unitId === "far") && s5.ifRelaxed.some((o) => o.condition === "distance" && o.extraRooms === 1));
    check("Search: a room with no map location still shows, after the ones that fit, marked distance unknown", s5.results.map((r) => r.unitId).join() === "near,no-location" && s5.results[0].fits.some((f) => f.includes("km from Brandeis")) && s5.results[1].misses[0].startsWith("No map location, so the distance to Brandeis is unknown"));
    const s6 = searchRooms(mem({}), [unit({ sample: true })]);
    check("Search: sample listings left out unless asked for, and counted", s6.results.length === 0 && s6.samplesHidden === 1 && searchRooms(mem({ include_samples: true }), [unit({ sample: true })]).results.length === 1);
    check("Search: at most 3 results", searchRooms(mem({}), [1, 2, 3, 4, 5].map(() => unit({}))).results.length === 3);
    const allowed = allowedNumbers(['{"monthly_rent":1250,"km_from_brandeis":1.3}']);
    const g = groundReply("R1 is $1,250 a month and about 1.3 km away. It's also only $999 for parking. A nice choice.", allowed);
    check("Grounding keeps supported numbers and drops invented ones", g.text.includes("$1,250") && g.text.includes("1.3 km") && !g.text.includes("999") && g.text.includes("A nice choice"), g.text);
    check("Grounding drops travel times (coHabit has none)", !groundReply("It's a 10 minute walk. Great spot overall for you.", allowed).text.includes("10 minute"));

    // Demo data (src/assistant/demo-data.js)
    const demoText = JSON.stringify([DEMO_LISTINGS.map(({ photo, ...u }) => u), DEMO_PEOPLE]);
    check("Demo data: 15 listings and 20 roommate profiles, every id starting demo-", DEMO_LISTINGS.length === 15 && DEMO_PEOPLE.length === 20 && [...DEMO_LISTINGS, ...DEMO_PEOPLE].every((x) => x.id.startsWith("demo-") && x.demo === true));
    check("Demo data: no contact details, street addresses or ZIP codes anywhere", !/@|https?:/.test(demoText) && ![...DEMO_LISTINGS.flatMap((u) => [u.name, u.area, u.description, u.transit, u.utilities, u.laundry]), ...DEMO_PEOPLE.flatMap((p) => [p.about, p.area, p.intro, ...p.interests])].some((t) => hasAddress(t) || PHONE.test(t)));
    check("Demo data: profiles have a first name and a town only, never a location", DEMO_PEOPLE.every((p) => /^[A-Z][a-z]+$/.test(p.firstName) && !("location" in p) && !("lat" in p) && !("email" in p)));
    check("Demo data: every listing is an approximate area in a Waltham neighborhood (within 4 km of Brandeis)", DEMO_LISTINGS.every((u) => /^Waltham, MA \((near Brandeis|Moody Street|South Side|Downtown|The Highlands|Prospect Hill|Warrendale|Lakeview)\)$/.test(u.area) && u.location.precision === "approximate" && kmBetween(u.location, BRANDEIS) < 4));
    check("Demo data: every listing says rent basis, utilities, lease, furnishing, laundry and transport", DEMO_LISTINGS.every((u) => ["room", "unit"].includes(u.rent_basis) && u.utilities && u.lease?.label && u.lease.months > 0 && typeof u.furnished === "boolean" && u.laundry && u.transit && u.description.length <= 200));
    check("Demo data: every listing has its own illustrative Unsplash photo with credit and license", DEMO_LISTINGS.every((u) => /^https:\/\/images\.unsplash\.com\/photo-[0-9a-f]+-[0-9a-f]+$/.test(u.photo?.src) && u.photo.alt.startsWith("Illustrative photo: ") && u.photo.license === "Unsplash License" && u.photo.licenseUrl === "https://unsplash.com/license" && /^https:\/\/unsplash\.com\/photos\/[\w-]+\?utm_source=cohabit/.test(u.photo.sourceUrl) && /^https:\/\/unsplash\.com\/@[\w-]+\?utm_source=cohabit/.test(u.photo.creditUrl) && u.photo.credit) && new Set(DEMO_LISTINGS.map((u) => u.photo.src)).size === 15);
    check("Demo data: every profile is a senior or grad student in Waltham with a program, a short intro, 3 interests and an illustrated avatar", DEMO_PEOPLE.every((p) => /^Waltham \(/.test(p.area) && /Senior|PhD|master's|MBA/i.test(p.program) && p.intro.length >= 40 && p.intro.length <= 160 && p.interests.length === 3 && ["skin", "hair", "hairColor", "shirt", "bg"].every((k) => typeof p.avatar[k] === "string")));
    check("Demo data: no gender field anywhere, and names or avatars never change a score", !/gender|pronoun|"sex"/i.test(demoText) && DEMO_PEOPLE.every((p) => scoreRoommate(DEMO_PEOPLE[0], p).score === scoreRoommate(DEMO_PEOPLE[0], { ...p, firstName: "X", avatar: DEMO_PEOPLE[1].avatar }).score));
    const kinds = new Set(DEMO_LISTINGS.map((u) => u.kind));
    check("Demo data: shared rooms, studios, sublets, lease takeovers, whole places and replacing a roommate; furnished and not; per-room and whole-place rent", ["Shared room", "Studio", "Sublet", "Lease takeover", "Whole apartment", "Replacing a roommate", "Private room"].every((k) => kinds.has(k)) && DEMO_LISTINGS.some((u) => u.furnished) && DEMO_LISTINGS.some((u) => !u.furnished) && DEMO_LISTINGS.some((u) => u.rent_basis === "unit") && DEMO_LISTINGS.some((u) => u.rent_basis === "room"));
    check("Demo data: some profiles chose not to be found", DEMO_PEOPLE.filter((p) => !p.discoverable).length === 3);
    const pair = searchRooms(mem({ budget_max: 1400, rooms_needed: 2 }), DEMO_LISTINGS, { limit: 20 }).results.find((r) => r.unitId === "demo-06");
    check("Rent for a whole place is split between the people moving in together", pair?.fits.includes("$2,700 a month for the whole place, $1,350 each for 2, within your $1,400 budget") && pair.you_would_pay === 1350, JSON.stringify(pair?.fits));
    const solo = searchRooms(mem({ budget_max: 1500 }, { budget_max: false }), DEMO_LISTINGS, { limit: 20 }).results.find((r) => r.unitId === "demo-03");
    check("One person pays the whole rent of a studio, and the mismatch says so", solo?.misses.includes("$1,650 a month for the whole place, $150 over your $1,500 budget"), JSON.stringify(solo?.misses));
    const sublet = searchRooms(mem({ budget_max: 1100, move_in_month: "2027-01", rooms_needed: 1, lease_months: 5 }), DEMO_LISTINGS, { limit: 20 });
    check("A spring-sublet search finds the spring sublet first, with its lease", sublet.results[0]?.unitId === "demo-04" && sublet.results[0].fits.some((f) => f.startsWith("Spring sublet")));
    const strong = searchRooms(mem({ budget_max: 1300, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 1 }), DEMO_LISTINGS, { limit: 20 });
    check("Demo data covers strong and partial matches for a typical Waltham search", strong.results[0].misses.length === 0 && strong.results.some((r) => r.misses.length > 0));
    check("Demo data covers no-match cases (a $600 budget finds nothing)", searchRooms(mem({ budget_max: 600, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 1 }), DEMO_LISTINGS).results.length === 0);
    check("Real listings without these details are matched exactly as before", searchRooms(mem({ budget_max: 1000, lease_months: 5, wishes: ["furnished"] }), [unit({ monthly_rent: 900 })]).results[0].fits.join() === "1 room available,$900 a month, within your $1,000 budget");
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
  for (const [m, p] of [["POST", "/api/auth/update-user"], ["POST", "/api/auth/delete-user"], ["GET", "/api/auth/list-sessions"], ["POST", "/api/auth/change-password"], ["POST", "/api/auth/change-email"], ["POST", "/api/auth/set-password"], ["POST", "/api/auth/link-social"], ["POST", "/api/auth/forget-password"]]) {
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
  check("Roommate result has no last name, ids, budget figures or raw answers (B didn't choose to share details)", mateLeaks.length === 0 && seenB.details === null && seenB.differences === null && /^h_[A-Za-z0-9_-]+$/.test(seenB.handle) && Object.keys(seenB).sort().join() === "details,differenceCount,differences,email,firstName,fits,handle,highlights,mainMiss,request,sample,score,theyShare,youShare", mateLeaks.join(",") + " " + Object.keys(seenB).sort().join());
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

  // ── Assistant (chat) ──────────────────────────────────────────────────────
  // The AI service is the stand-in in tests/fake-anthropic.mjs: it follows [[directives]] in the message.
  {
    const fake = fakeAi.state;
    const sentToAi = () => fake.requests.map((x) => x.raw).join("\n");
    const lastToolResult = () => JSON.stringify(fake.requests.at(-1).body.messages.at(-1));
    const say = (who, text) => api("/api/assistant/messages", { method: "POST", as: who, body: { text } });
    const replyOf = (res) => res.data?.messages?.find((m) => m.role === "assistant") || {};
    const count = (sqlText) => d1rows(sqlText)[0].n;
    const ROOM_NEAR = "a1000000-0000-4000-8000-000000000001";
    const ROOM_NEWTON = "a1000000-0000-4000-8000-000000000002";
    const ROOM_SAMPLE = "a1000000-0000-4000-8000-000000000003";
    const ROOM_OFF = "a1000000-0000-4000-8000-000000000004";
    // Test data for this section: one landlord with two active units and one inactive, a sample landlord's unit,
    // and four renters: two who chose to be found as roommates, one who didn't, and one sample person.
    const u = (id, name, email, type) => `INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",role,account_type) VALUES (${q(id)},${q(name)},${q(email)},1,${q(now)},${q(now)},'user',${q(type)});`;
    const unit = (id, owner, name, area, rent, rooms, date, status, loc) =>
      `INSERT INTO units (id,landlord_user_id,name,area,monthly_rent,rooms_available,move_in_date,description,status,created_at,updated_at,address,lat,lng,location_precision) VALUES (${q(id)},${q(owner)},${q(name)},${q(area)},${rent},${rooms},${q(date)},'Sunny room. Heat included.',${q(status)},1,1,${loc ? `'415 Fake Test Street, Waltham, MA',${loc[0]},${loc[1]}` : "NULL,NULL,NULL"},'approximate');`;
    const prefs = (id, sleep, clean, noise, visible, share) =>
      `INSERT INTO match_preferences (user_id,budget_min,budget_max,move_in_month,area,rooms_needed,sleep_schedule,cleanliness,noise,guests,pets,smoking,created_at,updated_at,roommate_visible,share_email,chores) VALUES (${q(id)},900,1400,'2027-06','Waltham',1,${q(sleep)},${q(clean)},${q(noise)},'sometimes','ok_with_pets','no_smoking',1,1,${visible},${share},'rotating_schedule');`;
    writeFileSync(
      `${STATE}/assistant.sql`,
      [
        u("t_landlord_c", "Test Landlord C", "landlord-c@example.test", "landlord"),
        u("sample-landlord-c", "Sample Landlord C (sample)", "landlord-c@sample.example", "landlord"),
        unit(ROOM_NEAR, "t_landlord_c", "Chat Test Room near campus", "Waltham, MA", 1250, 1, "2027-06-01", "active", [42.37, -71.245]),
        unit(ROOM_NEWTON, "t_landlord_c", "Chat Test Room in Newton", "Newton, MA", 1450, 2, "2027-07-01", "active", null),
        unit(ROOM_SAMPLE, "sample-landlord-c", "Sample Chat Room", "Waltham, MA", 1100, 1, "2027-06-01", "active", null),
        unit(ROOM_OFF, "t_landlord_c", "Chat Test Room inactive", "Waltham, MA", 900, 1, "2027-06-01", "inactive", null),
        u("t_mate_a", "Alexandra Mateone", "alexandra@example.test", "renter"),
        u("t_mate_b", "Bartholomew Matetwo", "bart@example.test", "renter"),
        u("t_mate_hidden", "Hidden Matethree", "hidden@example.test", "renter"),
        u("sample-renter-c", "Sammy Sample (sample)", "sammy@sample.example", "renter"),
        prefs("t_mate_a", "early", "tidy", "quiet", 1, 1),
        prefs("t_mate_b", "late", "average", "moderate", 1, 0),
        prefs("t_mate_hidden", "early", "tidy", "quiet", 0, 0),
        prefs("sample-renter-c", "early", "tidy", "quiet", 1, 0),
      ].join("\n")
    );
    wrangler(["d1", "execute", "DB", "--local", "--persist-to", STATE, "--file", `${STATE}/assistant.sql`]);

    r = await api("/api/assistant");
    check("Assistant: visitor must sign in (401)", r.status === 401);
    r = await api("/api/assistant", { as: landlordA });
    check("Assistant: landlords can't use it (403)", r.status === 403);
    r = await api("/api/assistant", { as: chatAi });
    check("Assistant: a renter starts with an empty chat, AI mode on", r.status === 200 && r.data.mode === "ai" && r.data.messages.length === 0 && r.data.memory.length === 0 && r.data.keepDays === 90);

    let before = fake.requests.length;
    for (const [text, why] of [
      ["Call me at (617) 555-0142", "phone number"],
      ["my email is me@example.test", "email address"],
      ["I live at 12 Main Street", "street address"],
      ["x".repeat(801), "over 800 characters"],
    ]) {
      r = await say(chatAi, text);
      check(`Assistant: message with ${why} refused before it is saved or sent (400)`, r.status === 400 && r.data.field === "text");
    }
    check("Assistant: refused messages were neither stored nor sent to the AI service", count(`SELECT COUNT(*) AS n FROM assistant_messages WHERE user_id='t_chat_ai'`) === 0 && fake.requests.length === before);
    r = await api("/api/assistant/messages", { method: "POST", as: chatAi, body: { text: "hi" }, origin: "https://evil.example" });
    check("Assistant: message from another site blocked (403)", r.status === 403);

    before = fake.requests.length;
    r = await say(chatAi, `Hi! A room for June 2027 in Waltham, up to $1,300. [[update_memory {"looking_for":"room","budget_max":1300,"move_in_month":"2027-06","areas":["Waltham"],"rooms_needed":1}]] [[search_rooms]] [[reply Here are the best fits. R1 looks strongest.]]`);
    let reply = replyOf(r);
    check("Assistant (AI): the model's reply comes back, after two tool calls", r.status === 200 && reply.mode === "ai" && reply.text === "Here are the best fits. R1 looks strongest." && fake.requests.length - before === 3, JSON.stringify(r.data).slice(0, 300));
    const rooms = reply.cards || [];
    check("Assistant (AI): 1 to 3 rooms shown, all real, active and within budget", rooms.length >= 1 && rooms.length <= 3 && rooms.every((c) => c.kind === "room" && c.available && !c.unit.sample && c.unit.monthly_rent <= 1300), JSON.stringify(rooms).slice(0, 300));
    check("Assistant (AI): the near-campus room is shown with why it fits", rooms.some((c) => c.unit.id === ROOM_NEAR && c.fits.includes("$1,250 a month, within your $1,300 budget")));
    check("Assistant (AI): inactive, sample and over-budget rooms are not shown", !rooms.some((c) => [ROOM_OFF, ROOM_SAMPLE, ROOM_NEWTON, "00000000-0000-4000-8000-000000000099"].includes(c.unit.id)));
    check("Assistant (AI): what it learned is listed, budget as a must-have", r.data.memory.find((f) => f.field === "budget_max")?.mustHave === true && r.data.memory.some((f) => f.field === "areas" && f.value === "Waltham"));
    let res = r.data.results;
    check("Results panel: goal is a room; rooms worked out from the answers, all real, active and within budget", res.goal === "room" && res.rooms.status === "ok" && res.rooms.preliminary === false && res.people === null && res.rooms.items.length >= 1 && res.rooms.items.length <= 12 && res.rooms.items.every((c) => !c.unit.sample && c.unit.monthly_rent <= 1300 && c.fits.length));
    check("Results panel: the first results match the cards the AI was shown", res.rooms.items.slice(0, 3).map((c) => c.unit.id).join() === rooms.map((c) => c.unit.id).join());
    check("Room cards: at most two reasons and one mismatch, labeled exact or partial, with counts that add up", res.rooms.items.every((c) => c.highlights.length <= 2 && c.highlights.every((h) => c.fits.includes(h)) && (c.mainMiss === null || c.misses.includes(c.mainMiss)) && c.match === (c.misses.length ? "partial" : "exact")) && res.rooms.exact === res.rooms.items.filter((c) => c.match === "exact").length);
    r = await api("/api/assistant", { as: chatAi });
    check("Results panel: the same results come back when the page is opened again", r.data.results.rooms.items.map((c) => c.unit.id).join() === res.rooms.items.map((c) => c.unit.id).join());
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "budget_max", value: 1200, mustHave: true } });
    check("Editing an answer from its chip refreshes the results (no AI call)", r.status === 200 && r.data.memory.find((f) => f.field === "budget_max")?.value === "$1,200 a month" && r.data.results.rooms.items.every((c) => c.unit.monthly_rent <= 1200));
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "budget_max", value: 300, mustHave: true } });
    check("A must-have that nothing meets gives an empty list naming it; nothing is loosened silently", r.data.results.rooms.status === "none" && r.data.results.rooms.items.length === 0 && r.data.results.rooms.mustHaves.includes("budget_max") && Array.isArray(r.data.results.rooms.ifRelaxed) && r.data.memory.find((f) => f.field === "budget_max")?.mustHave === true, JSON.stringify(r.data.results.rooms).slice(0, 200));
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "budget_max", value: "lots" } });
    check("An invalid chip value is refused (400) and the answer is kept", r.status === 400 && r.data.field === "value");
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "budget_max", value: 1300, mustHave: true } });
    r = await api("/api/assistant/saved", { method: "POST", as: chatAi, body: { kind: "room", unitId: ROOM_NEAR } });
    check("Save a room from the results panel by its listing id", r.status === 201 && r.data.saved.some((s) => s.kind === "room" && s.unit?.id === ROOM_NEAR && s.fits.length));
    r = await api("/api/assistant/saved", { method: "POST", as: chatAi, body: { kind: "room", unitId: ROOM_OFF } });
    check("An inactive room can't be saved (409)", r.status === 409);
    await api(`/api/assistant/saved/${(await api("/api/assistant", { as: chatAi })).data.saved.find((s) => s.kind === "room").id}`, { method: "DELETE", as: chatAi });
    const first = fake.requests[before];
    check("AI request: model, low effort, cached instructions, 4 tools, tool use optional", first.body.model === "claude-opus-5-5" && first.body.output_config?.effort === "low" && first.body.system?.[0]?.cache_control?.type === "ephemeral" && first.body.tools.length === 4 && first.body.tool_choice?.type === "auto" && first.body.max_tokens === 4000);
    check("AI request: refusal fallback turned on", first.body.fallbacks === "default" && String(first.headers["anthropic-beta"]).includes("server-side-fallback-2026-07-01"));
    check("AI request: this turn's facts arrive as a system note after the student's message", first.body.messages.at(-1).role === "system" && first.body.messages.at(-1).content.includes("Today: ") && first.body.messages.at(-2).role === "user");
    check("AI request: search results go back to the model as tool results", lastToolResult().includes("tool_result") && lastToolResult().includes("within your $1,300 budget"));
    check("AI request: the key travels only in the header", first.headers["x-api-key"] === "test-key-for-local-tests-only" && !sentToAi().includes("test-key-for-local"));
    const privateBits = [chatAi.email, chatAi.name, "Aitester", "t_chat_ai", "t_landlord_", "landlord_user_id", "Fake Test Street", landlordA.email, ROOM_NEAR, "example.test"];
    check("AI request: no names, emails, user or unit ids, or street addresses are sent", privateBits.every((w) => !sentToAi().includes(w)), privateBits.filter((w) => sentToAi().includes(w)).join(","));

    r = await say(chatAi, `How much is R1? [[invented_price]]`);
    check("Assistant (AI): an invented price is removed from the reply", !replyOf(r).text.includes("7,777") && replyOf(r).text.includes("commuter rail"), replyOf(r).text);
    r = await say(chatAi, `Compare them. [[search_rooms]] [[only_invented]]`);
    check("Assistant (AI): a reply with nothing true left is rewritten from the search results", !replyOf(r).text.includes("8,888") && /rooms? fits? your must-haves/.test(replyOf(r).text) && replyOf(r).text.includes("Top pick: R1 · "), replyOf(r).text);

    r = await api("/api/assistant", { as: chatAi.cookie2 });
    const chatOnly = r.data.messages.filter((m) => !m.event);
    check("Assistant: after signing in again the chat continues, in order (plus notes for answers changed outside the chat)", chatOnly.length === 6 && chatOnly[0].role === "user" && chatOnly[1].text === "Here are the best fits. R1 looks strongest." && r.data.messages.some((m) => m.event && /^Budget up to: \$1,\d00 a month \(must-have\)\. Results updated\.$/.test(m.text)) && r.data.memory.some((f) => f.field === "budget_max"), r.data.messages.filter((m) => m.event).map((m) => m.text).join(" | ") + " / " + chatOnly.length);
    check("Assistant: earlier result cards come back with current listing details", r.data.messages[1].cards.length === rooms.length && r.data.messages[1].cards.every((c) => c.available && c.unit?.name));

    r = await say(chatAi, `Actually I can do $1,500. [[update_memory {"budget_max":1500}]] [[reply Updated.]]`);
    check("Assistant (AI): a correction replaces the earlier answer", r.data.memory.find((f) => f.field === "budget_max")?.value === "$1,500 a month");
    r = await say(chatAi, `[[update_memory {"areas":["Waltham 02453"],"budget_max":-5,"move_in_month":"2020-01"}]] [[reply Noted.]]`);
    check("Assistant (AI): invalid values from the model are refused; memory unchanged", r.data.memory.find((f) => f.field === "budget_max")?.value === "$1,500 a month" && r.data.memory.find((f) => f.field === "areas")?.value === "Waltham" && lastToolResult().includes("refused") && lastToolResult().includes("already passed"));

    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "budget_max", mustHave: false } });
    check("Assistant: the renter can mark the budget flexible (no AI call)", r.status === 200 && r.data.memory.find((f) => f.field === "budget_max")?.mustHave === false);
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "rooms_needed", mustHave: false } });
    check("Assistant: rooms needed can't be made flexible (400)", r.status === 400);
    r = await api("/api/assistant/memory", { method: "POST", as: chatAi, body: { field: "areas", forget: true } });
    check("Assistant: the renter can make it forget an answer", r.status === 200 && !r.data.memory.some((f) => f.field === "areas"));

    r = await say(chatAi, `Show me sample listings too. [[update_memory {"include_samples":true,"areas":["Waltham"],"budget_max":1150}]] [[search_rooms]] [[reply Sample listings included.]]`);
    let sampleCard = replyOf(r).cards.find((c) => c.unit?.sample);
    check("Assistant (AI): sample listings appear only when asked for, flagged as samples", !!sampleCard, JSON.stringify(replyOf(r).cards).slice(0, 300));
    r = await say(chatAi, `[[propose_action {"kind":"contact_landlord","ref":"${sampleCard?.ref}","note":"Hi"}]] [[reply ok]]`);
    check("Assistant (AI): no contact card for a sample listing", replyOf(r).actions.length === 0 && lastToolResult().includes("sample (fictional) listing"));

    r = await say(chatAi, `[[update_memory {"include_samples":false,"budget_max":1300,"max_distance_km":2}]] [[search_rooms]] [[propose_action {"kind":"contact_landlord","ref":"R1","note":"Hi, TEST note from the assistant tests."}]] [[reply A card is waiting for you.]]`);
    reply = replyOf(r);
    const contact = reply.actions[0];
    const target = reply.cards[0]?.unit;
    check("Assistant (AI): contacting a landlord shows a card; nothing is sent yet", contact?.kind === "contact_landlord" && contact.status === "pending" && contact.unitName === target?.name && contact.note === "Hi, TEST note from the assistant tests." && count(`SELECT COUNT(*) AS n FROM unit_interests WHERE renter_user_id='t_chat_ai'`) === 0);
    r = await api(`/api/assistant/actions/${contact.id}`, { method: "POST", as: chatMate, body: { decision: "confirm" } });
    check("Assistant: another renter can't confirm someone's card (404)", r.status === 404);
    r = await api(`/api/assistant/actions/${contact.id}`, { method: "POST", as: chatAi, body: { decision: "confirm", note: "Call me at (617) 555-0142" } });
    check("Assistant: a phone number in the edited note is refused (400); nothing sent", r.status === 400 && count(`SELECT COUNT(*) AS n FROM unit_interests WHERE renter_user_id='t_chat_ai'`) === 0);
    r = await api(`/api/assistant/actions/${contact.id}`, { method: "POST", as: chatAi, body: { decision: "confirm", note: "Hi, TEST note, edited by me." } });
    check("Assistant: Confirm sends the request with the renter's own note", r.status === 200 && d1rows(`SELECT message FROM unit_interests WHERE renter_user_id='t_chat_ai' AND unit_id=${q(target.id)}`)[0]?.message === "Hi, TEST note, edited by me.");
    r = await api(`/api/assistant/actions/${contact.id}`, { method: "POST", as: chatAi, body: { decision: "confirm" } });
    check("Assistant: a card can only be answered once (409)", r.status === 409);

    r = await api("/api/assistant/saved", { method: "POST", as: chatAi, body: { messageId: reply.id, ref: "R1" } });
    check("Assistant: save a room from the chat", r.status === 201 && r.data.saved.some((s) => s.kind === "room" && s.unit?.id === target.id && s.interestSent === true));
    const savedRoom = r.data.saved.find((s) => s.kind === "room");
    r = await api("/api/assistant/saved", { method: "POST", as: chatMate, body: { messageId: reply.id, ref: "R1" } });
    check("Assistant: can't save from someone else's chat (404)", r.status === 404);
    r = await api(`/api/assistant/saved/${savedRoom.id}`, { method: "DELETE", as: chatAi });
    check("Assistant: remove a saved room", r.status === 200 && (await api("/api/assistant", { as: chatAi })).data.saved.length === 0);
    await api("/api/assistant/demo", { method: "POST", as: chatAi, body: { on: true } });
    r = await say(chatAi, `[[search_rooms]] [[propose_action {"kind":"contact_landlord","ref":"R1","note":"Hi"}]] [[reply ok]]`);
    check("Demo mode (AI): no contact card for a demo listing", replyOf(r).actions.length === 0 && lastToolResult().includes("demo listing"));
    check("Demo mode (AI): the model is told results are demo, with each one's rent basis and share", fake.requests.at(-3).body.messages.at(-1).content.includes("Demo mode is on") && JSON.stringify(fake.requests.at(-2).body.messages.at(-1)).includes('\\"demo\\":true') && JSON.stringify(fake.requests.at(-2).body.messages.at(-1)).includes("you_would_pay"));
    await api("/api/assistant/demo", { method: "POST", as: chatAi, body: { on: false } });

    // Roommates: only people who chose to be found; the student must opt in first.
    r = await say(chatMate, `[[update_memory {"looking_for":"roommates","budget_max":1300,"move_in_month":"2027-06","areas":["Waltham"],"rooms_needed":1}]] [[search_roommates]] [[reply Roommate matching is off for you.]]`);
    check("Assistant (AI): no roommates until the student turns matching on", replyOf(r).cards.length === 0 && lastToolResult().includes("needs_profile"));
    r = await say(chatMate, `[[propose_action {"kind":"turn_on_roommate_matching"}]] [[reply ok]]`);
    check("Assistant (AI): matching can't be turned on before the lifestyle answers", replyOf(r).actions.length === 0 && lastToolResult().includes("Ask for these first"));
    r = await say(chatMate, `[[update_memory {"sleep_schedule":"early","cleanliness":"tidy","noise":"quiet","guests":"sometimes","pets":"ok_with_pets","smoking":"no_smoking","chores":"rotating_schedule"}]] [[propose_action {"kind":"turn_on_roommate_matching"}]] [[reply A card is waiting for you.]]`);
    const optIn = replyOf(r).actions[0];
    check("Assistant (AI): the opt-in card lists what will be saved; nothing saved yet", optIn?.kind === "save_profile" && optIn.roommateOptIn && optIn.changes.some((c) => c.label === "Roommate matching" && c.to === "On") && count(`SELECT COUNT(*) AS n FROM match_preferences WHERE user_id='t_chat_mate'`) === 0);
    r = await api(`/api/assistant/actions/${optIn.id}`, { method: "POST", as: chatMate, body: { decision: "confirm" } });
    check("Assistant: Confirm saves the profile with matching on and email not shared", r.status === 200 && r.data.preferences.roommate_visible === true && r.data.preferences.share_email === false && r.data.preferences.chores === "rotating_schedule");
    r = await say(chatMate, `[[search_roommates]] [[reply Here are people who fit.]]`);
    reply = replyOf(r);
    const mates = reply.cards || [];
    check("Assistant (AI): only renters who chose to be found are shown, by first name", mates.length >= 2 && mates.every((c) => c.kind === "person" && c.available) && !mates.some((c) => c.firstName === "Hidden") && mates.some((c) => c.firstName === "Alexandra") && mates.some((c) => c.firstName === "Bartholomew"), JSON.stringify(mates).slice(0, 300));
    check("Assistant (AI): sample people are left out unless asked for", !mates.some((c) => c.sample));
    check("Assistant (AI): an email is shown only if that person chose to share it", mates.find((c) => c.firstName === "Alexandra")?.email === "alexandra@example.test" && mates.find((c) => c.firstName === "Bartholomew")?.email === null);
    const people = r.data.results.people;
    check("Results panel: roommates shown with first names and shared traits only; no ids or answers", people.status === "ok" && people.items.length >= 2 && people.items.every((p) => p.firstName && p.fits.length && !("userId" in p) && !("prefs" in p)) && !JSON.stringify(people).includes("t_mate_"));
    const alexandra = people.items.find((p) => p.firstName === "Alexandra");
    r = await api("/api/assistant/saved", { method: "POST", as: chatMate, body: { kind: "person", ref: alexandra.ref, firstName: "Somebody" } });
    check("Saving a person needs their current label and first name (404 otherwise)", r.status === 404);
    check("AI request: other renters' names, emails and ids are never sent", !["Alexandra", "Bartholomew", "Mateone", "alexandra@", "t_mate_"].some((w) => sentToAi().includes(w)));
    r = await api("/api/assistant/saved", { method: "POST", as: chatMate, body: { messageId: reply.id, ref: mates.find((c) => c.firstName === "Alexandra").ref } });
    check("Assistant: save a person", r.status === 201 && r.data.saved.some((s) => s.kind === "person" && s.firstName === "Alexandra"));
    d1(`UPDATE match_preferences SET roommate_visible = 0 WHERE user_id = 't_mate_a'`);
    r = await api("/api/assistant", { as: chatMate });
    const gone = r.data.saved.find((s) => s.kind === "person");
    check("Assistant: someone who turns matching off disappears from saved options and old replies", gone?.available === false && !("firstName" in gone) && !JSON.stringify(r.data).includes("Alexandra"));

    {
      const me = { sleep_schedule: "late", cleanliness: "tidy", pets: "ok_with_pets", smoking: "no_smoking", chores: "rotating_schedule" };
      const them = { sleep_schedule: "flexible", cleanliness: "relaxed", pets: "have_pets", smoking: "no_smoking", chores: "split_by_task" };
      check("Cards name only important differences; Details lists them all", roommateDifferences(me, them).length === 4 && JSON.stringify(majorDifferences(me, them)) === JSON.stringify(["Tidiness: you said very tidy, they said relaxed"]));
    }
    // Connect (roommate requests). chatMate has roommate matching on; renterB is discoverable; chatPal joins below.
    const handleFor = (list, name) => list.find((p) => p.firstName === name)?.handle;
    const reqCount = (where) => count(`SELECT COUNT(*) AS n FROM roommate_requests WHERE ${where}`);
    r = await api("/api/renter/roommates", { as: chatMate });
    let mm = r.data.roommates;
    const bart = mm.find((p) => p.firstName === "Bartholomew");
    check("My matches: each person has a private handle, two highlights, and no ids, raw answers or unshared email", mm.length >= 2 && mm.every((p) => /^h_/.test(p.handle) && p.highlights.length <= 2 && p.details === null) && bart.email === null && !/t_mate_|t_renter_|"user_?id"|sleep_schedule|budget_max/.test(JSON.stringify(r.data)));
    d1(`UPDATE match_preferences SET share_profile = 1 WHERE user_id = 't_mate_b'`);
    r = await api("/api/renter/roommates", { as: chatMate });
    check("Profile details stay hidden until both sides share them (Bart shares, the viewer doesn't)", r.data.roommates.find((p) => p.firstName === "Bartholomew").details === null && r.data.youShare === false);
    r = await api("/api/renter/preferences", { method: "PUT", as: chatMate, body: prefsBody({ budget_max: 1300, roommate_visible: true, share_profile: true, chores: "rotating_schedule" }) });
    check("A renter can choose to share their details (needs roommate matching on)", r.status === 200 && r.data.preferences.share_profile === true);
    r = await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, share_profile: true }) });
    check("Sharing details can't be on without roommate matching", r.data.preferences.share_profile === false);
    await api("/api/renter/preferences", { method: "PUT", as: renterB, body: prefsBody({ budget_max: 999, roommate_visible: true, share_email: true }) });
    r = await api("/api/renter/roommates", { as: chatMate });
    mm = r.data.roommates;
    const bartNow = mm.find((p) => p.firstName === "Bartholomew");
    check("With both sharing: budget, move-in, area, lifestyle tags and differences in Details", bartNow.details?.budget === "$900–$1,400 a month" && bartNow.details.moveIn === "Jun 2027" && bartNow.details.area === "Waltham" && bartNow.details.lifestyle.includes("Night owl") && bartNow.differences.some((d) => d.startsWith("Sleep: you said early bird, they said night owl")));
    r = await api("/api/assistant", { as: chatMate });
    const bartInChat = r.data.results.people?.items?.find((p) => p.firstName === "Bartholomew");
    check("Assistant results show the same Details once both share (and no ids)", r.data.results.people?.status === "ok" && bartInChat?.details?.area === "Waltham" && bartInChat.differences.length > 0 && !/t_mate_|"userId"/.test(JSON.stringify(r.data.results.people)), r.data.results.people?.status);
    check("An email shows only for someone who chose to share it", mm.find((p) => p.firstName === "Test")?.email === renterB.email && bartNow.email === null);

    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: handleFor(mm, "Test"), intro: "Hi! TEST intro. Call me at (617) 555-0142" } });
    check("Connect: a phone number in the introduction is refused (400)", r.status === 400 && r.data.field === "intro");
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: handleFor(mm, "Test").slice(0, -4) + "AAAA", intro: "Hi" } });
    check("Connect: a tampered handle is refused (404)", r.status === 404);
    const env = { BETTER_AUTH_SECRET: SECRET };
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: await makeHandle(env, "t_chat_mate", "t_chat_mate"), intro: "Hi me" } });
    check("Connect: nobody can send a request to themself (400)", r.status === 400 && reqCount("1=1") === 0);
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: await makeHandle(env, "t_chat_mate", "t_mate_hidden"), intro: "Hi" } });
    check("Connect: only people who chose to be found can be asked (404)", r.status === 404);
    r = await api("/api/roommates/requests", { method: "POST", as: outsider, body: { handle: await makeHandle(env, "t_outsider", "t_renter_b"), intro: "Hi" } });
    check("Connect: you need roommate matching on yourself (409)", r.status === 409 && r.data.error === "opt_in_required");
    await api("/api/renter/preferences", { method: "PUT", as: outsider, body: prefsBody({ budget_max: 1300, roommate_visible: true }) });
    r = await api("/api/roommates/requests", { method: "POST", as: outsider, body: { handle: handleFor(mm, "Test"), intro: "Hi" } });
    check("Connect: a handle made for one renter doesn't work for another (404, nothing created)", r.status === 404 && reqCount("1=1") === 0);
    r = await api("/api/roommates/requests", { as: landlordA });
    check("Connect: landlords can't use it (403)", r.status === 403);
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: handleFor(mm, "Test"), intro: "Hi! TEST intro from Mia." }, origin: "https://evil.example" });
    check("Connect: requests from another site are blocked (403)", r.status === 403);

    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: handleFor(mm, "Test"), intro: "Hi! TEST intro from Mia." } });
    const toB = r.data.request?.id;
    check("Connect: a request is created, pending, only after Send", r.status === 201 && r.data.request.status === "pending" && reqCount("from_user_id='t_chat_mate' AND to_user_id='t_renter_b' AND status='pending'") === 1);
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: (await api("/api/renter/roommates", { as: chatMate })).data.roommates.find((p) => p.firstName === "Test").handle, intro: "Again" } });
    check("Connect: no duplicate requests (409)", r.status === 409 && r.data.error === "already_requested");
    r = await api("/api/renter/roommates", { as: chatMate });
    check("The sender sees the request as pending on that person's card", r.data.roommates.find((p) => p.firstName === "Test").request?.status === "pending" && r.data.roommates.find((p) => p.firstName === "Test").request.direction === "out");
    r = await api("/api/roommates/requests", { as: renterB });
    const inB = r.data.incoming[0];
    check("The recipient sees the first name, the introduction and what they share; no email or ids", inB?.firstName === "Mia" && inB.intro === "Hi! TEST intro from Mia." && inB.shared.length > 0 && !/@example\.test|t_chat_|t_renter_/.test(JSON.stringify(r.data)));
    r = await api(`/api/roommates/requests/${toB}/messages`, { as: chatMate });
    check("No messages before the request is accepted (409)", r.status === 409);
    r = await api(`/api/roommates/requests/${toB}`, { method: "POST", as: renterB, body: { action: "withdraw" } });
    check("Only the sender can withdraw (403)", r.status === 403);
    r = await api(`/api/roommates/requests/${toB}`, { method: "POST", as: chatMate, body: { action: "accept" } });
    check("Only the recipient can accept (403)", r.status === 403);
    r = await api(`/api/roommates/requests/${toB}`, { method: "POST", as: outsider, body: { action: "decline" } });
    check("Someone else can't touch the request (404)", r.status === 404);
    r = await api(`/api/roommates/requests/${toB}`, { method: "POST", as: renterB, body: { action: "decline" } });
    check("The recipient declines", r.status === 200 && r.data.status === "declined");
    r = await api(`/api/roommates/requests/${toB}`, { method: "POST", as: renterB, body: { action: "accept" } });
    check("A declined request can't be accepted later (409)", r.status === 409);
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: (await api("/api/renter/roommates", { as: chatMate })).data.roommates.find((p) => p.firstName === "Test").handle, intro: "Please?" } });
    check("After a decline, the sender can't ask again (409)", r.status === 409 && r.data.error === "declined");

    // Accept and message: Pat joins roommate matching
    await api("/api/renter/preferences", { method: "PUT", as: chatPal, body: prefsBody({ budget_max: 1300, roommate_visible: true }) });
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: (await api("/api/renter/roommates", { as: chatMate })).data.roommates.find((p) => p.firstName === "Pat").handle, intro: "Hi Pat! TEST" } });
    const toF = r.data.request?.id;
    r = await api(`/api/roommates/requests/${toF}`, { method: "POST", as: chatMate, body: { action: "withdraw" } });
    check("The sender can withdraw while it's pending", r.status === 200 && r.data.status === "withdrawn");
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: (await api("/api/renter/roommates", { as: chatMate })).data.roommates.find((p) => p.firstName === "Pat").handle, intro: "Hi again Pat! TEST" } });
    const toF2 = r.data.request?.id;
    check("After withdrawing, a new request can be sent", r.status === 201);
    r = await api(`/api/roommates/requests/${toF2}`, { method: "POST", as: chatPal, body: { action: "accept" } });
    check("The recipient accepts", r.status === 200 && r.data.status === "accepted");
    r = await api(`/api/roommates/requests/${toF2}/messages`, { method: "POST", as: chatMate, body: { body: "Hi Pat, TEST message. When do you want to tour places?" } });
    check("Connected renters can message each other", r.status === 201 && r.data.messages.length === 1 && r.data.messages[0].mine === true && r.data.with === "Pat");
    r = await api(`/api/roommates/requests/${toF2}/messages`, { as: chatPal });
    check("The other person sees the message as theirs to read", r.status === 200 && r.data.messages[0].mine === false && r.data.with === "Mia");
    r = await api(`/api/roommates/requests/${toF2}/messages`, { method: "POST", as: chatPal, body: { body: "My number is 617 555 0142" } });
    check("Messages with phone numbers are refused (400)", r.status === 400);
    r = await api(`/api/roommates/requests/${toF2}/messages`, { as: renterB });
    check("Nobody else can read the conversation (404)", r.status === 404);
    r = await api("/api/roommates/requests", { as: chatMate });
    check("Requests list: connected, earlier (declined/withdrawn), none waiting", r.data.connected.length === 1 && r.data.connected[0].firstName === "Pat" && r.data.connected[0].messages === 1 && r.data.closed.length >= 2 && r.data.outgoing.length === 0);
    r = await api("/api/assistant/demo", { method: "POST", as: chatMate, body: { on: true } });
    check("Demo profiles have no handle, so no real request can be made to them", r.data.results.people?.status !== "ok" || r.data.results.people.items.every((p) => p.handle === null && p.demo === true));
    r = await api("/api/roommates/requests", { method: "POST", as: chatMate, body: { handle: null, intro: "Hi demo" } });
    check("A request without a valid handle is refused (404)", r.status === 404);
    await api("/api/assistant/demo", { method: "POST", as: chatMate, body: { on: false } });

    // ── Quick check-in survey and coHabit Points ──
    const sid = () => randomBytes(16).toString("hex");
    const surveyRows = (where = "1=1") => count(`SELECT COUNT(*) AS n FROM survey_responses WHERE ${where}`);
    const resetSurveyLimits = () => d1(`DELETE FROM app_rate_limits WHERE key LIKE 's:%'`);
    const prefsBefore = JSON.stringify(d1rows(`SELECT * FROM match_preferences ORDER BY user_id`));
    r = await api("/api/survey");
    check("Check-in: anyone can load the questions (4 questions, a 500-character comment)", r.status === 200 && r.data.survey.questions.length === 4 && r.data.survey.commentMax === 500 && r.data.survey.title === "Quick check-in" && r.data.points.signedIn === false);
    check("Check-in: exclusive answers are marked (I haven't looked yet, None of these)", r.data.survey.questions[0].exclusive === "not_yet" && r.data.survey.questions[3].exclusive === "none" && !r.data.survey.questions[1].multi && !r.data.survey.questions[2].multi);
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { look_where: [], options_work: null }, comment: "   " } });
    check("Check-in: a blank submission is refused and nothing is stored", r.status === 400 && r.data.error === "empty" && surveyRows() === 0);
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { options_work: "difficult" }, page: "/listings" } });
    check("Check-in: a guest can send a single answer without an account, with no points claimed", r.status === 201 && r.data.saved === true && r.data.awarded === false && r.data.points === 0 && r.data.balance === null && surveyRows("respondent = 'guest' AND user_id IS NULL") === 1);
    r = await api("/api/survey", { method: "POST", body: { id: sid(), comment: "=HYPERLINK(\"http://x\") A shared grocery list would help." } });
    check("Check-in: a comment alone is enough", r.status === 201 && surveyRows("comment LIKE '%grocery%'") === 1);
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { look_where: ["not_yet", "friends"] } } });
    check("Check-in: “I haven't looked yet” can't be combined with other answers (400)", r.status === 400 && r.data.field === "look_where");
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { use_for: ["room", "none"] } } });
    check("Check-in: “None of these” can't be combined with other answers (400)", r.status === 400 && r.data.field === "use_for");
    resetSurveyLimits();
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { options_work: ["enough", "missing"] } } });
    check("Check-in: a choose-one question takes one answer (400)", r.status === 400 && r.data.field === "options_work");
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { roommate_profile: "absolutely" } } });
    check("Check-in: only the listed answers are accepted (400)", r.status === 400 && r.data.field === "roommate_profile");
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { budget_max: 900 } } });
    check("Check-in: questions that aren't in the survey are refused (no matching answers here)", r.status === 400 && r.data.field === "answers");
    r = await api("/api/survey", { method: "POST", body: { id: sid(), comment: "x".repeat(501) } });
    check("Check-in: comments are limited to 500 characters (400)", r.status === 400 && r.data.field === "comment");
    r = await api("/api/survey", { method: "POST", body: { id: sid(), comment: "Text me at (617) 555-0142 or me@example.com" } });
    check("Check-in: comments with phone numbers or emails are refused (400)", r.status === 400 && r.data.field === "comment");
    resetSurveyLimits();
    r = await api("/api/survey", { method: "POST", body: { id: sid(), answers: { options_work: "enough" } }, origin: "https://evil.example" });
    check("Check-in: sends from another site are blocked (403)", r.status === 403);
    r = await api("/api/survey", { method: "POST", body: { answers: { options_work: "enough" } } });
    check("Check-in: a submission needs its id (so a retry can't save twice)", r.status === 400 && r.data.field === "id");
    check("Check-in: refused submissions stored nothing", surveyRows() === 2);

    r = await api("/api/survey", { as: chatMate });
    check("Check-in: a signed-in renter sees they haven't earned the points yet", r.data.points.signedIn === true && r.data.points.earned === false && r.data.points.balance === 0);
    const firstSurvey = sid();
    r = await api("/api/survey", { method: "POST", as: chatMate, body: { id: firstSurvey, answers: { look_where: ["facebook", "group_chats"], use_for: ["roommate", "chores", "room"] }, comment: "TEST: love the roommate details.", page: "/assistant" } });
    check("Check-in: a signed-in renter's first submission earns 100 coHabit Points", r.status === 201 && r.data.awarded === true && r.data.points === 100 && r.data.balance === 100);
    check("Check-in: answers are stored in the listed order, apart from matching preferences", JSON.parse(d1rows(`SELECT answers FROM survey_responses WHERE id = '${firstSurvey}'`)[0].answers).use_for.join() === "room,roommate,chores");
    r = await api("/api/survey", { method: "POST", as: chatMate, body: { id: firstSurvey, answers: { look_where: ["facebook", "group_chats"] } } });
    check("Check-in: retrying the same submission saves nothing new and awards nothing new", r.status === 200 && r.data.awarded === true && r.data.balance === 100 && surveyRows(`id = '${firstSurvey}'`) === 1 && count(`SELECT COUNT(*) AS n FROM points_awards WHERE user_id = 't_chat_mate'`) === 1);
    r = await api("/api/survey", { method: "POST", as: chatMate, body: { id: sid(), answers: { options_work: "missing" } } });
    check("Check-in: a later submission is saved but earns no more points", r.status === 201 && r.data.awarded === false && r.data.points === 0 && r.data.balance === 100 && surveyRows("user_id = 't_chat_mate'") === 2);
    r = await api("/api/me", { as: chatMate });
    check("Check-in: the balance shows on the account (100)", r.data.user.points === 100);
    r = await api("/api/survey", { as: chatMate });
    check("Check-in: next time the drawer says the points were already earned", r.data.points.earned === true && r.data.points.balance === 100);
    r = await api("/api/survey", { method: "POST", as: outsider, body: { id: firstSurvey, answers: { options_work: "enough" } } });
    check("Check-in: someone else's submission id can't be reused (409, no points)", r.status === 409 && count(`SELECT COUNT(*) AS n FROM points_awards WHERE user_id = 't_outsider'`) === 0);
    const twin = await Promise.all([1, 2].map(() => api("/api/survey", { method: "POST", as: renterB, body: { id: sid(), answers: { roommate_profile: "maybe" } } })));
    check("Check-in: two submissions at once award the points only once", twin.every((x) => x.status === 201) && twin.filter((x) => x.data.awarded).length === 1 && count(`SELECT COALESCE(SUM(points), 0) AS n FROM points_awards WHERE user_id = 't_renter_b'`) === 100);
    r = await api("/api/survey", { method: "POST", as: landlordA, body: { id: sid(), answers: { use_for: ["none"] }, page: "/landlord/units/abc-123" } });
    check("Check-in: landlords can answer too, and only the first part of the page is kept (no ids)", r.status === 201 && r.data.awarded === true && d1rows(`SELECT respondent, page FROM survey_responses WHERE user_id = 't_landlord_a'`)[0].page === "/landlord");
    await api("/api/assistant/demo", { method: "POST", as: chatMate, body: { on: true } });
    r = await api("/api/survey", { method: "POST", as: chatMate, body: { id: sid(), answers: { roommate_profile: "yes" } } });
    await api("/api/assistant/demo", { method: "POST", as: chatMate, body: { on: false } });
    check("Check-in: submissions made in Demo mode are labeled", r.status === 201 && surveyRows("demo = 1 AND user_id = 't_chat_mate'") === 1 && surveyRows("demo = 1") === 1);
    r = await api("/api/survey", { method: "POST", as: chatPal, body: { id: sid(), answers: { options_work: "enough" } } });
    check("Check-in: another renter's first submission earns their own points", r.data.awarded === true && r.data.balance === 100);
    check("Check-in: matching preferences are untouched by the survey", JSON.stringify(d1rows(`SELECT * FROM match_preferences ORDER BY user_id`)) === prefsBefore);

    r = await api("/api/admin/survey");
    const r2 = await api("/api/admin/survey", { as: chatMate });
    const r3 = await api("/api/admin/survey.csv", { as: landlordA });
    check("Check-in results: admin only (guest 401, renter 403, landlord 403 for the CSV)", r.status === 401 && r2.status === 403 && r3.status === 403);
    d1(`UPDATE "user" SET role='admin' WHERE id='t_admin'`);
    r = await api("/api/admin/survey", { as: admin });
    const total = surveyRows();
    check("Check-in results: totals, who answered, Demo mode and points", r.status === 200 && r.data.total === total && r.data.respondents.guest === 2 && r.data.respondents.landlord === 1 && r.data.demo === 1 && r.data.pointsAwarded === 4 && r.data.withComment === 2);
    const useFor = r.data.questions.find((x) => x.key === "use_for");
    check("Check-in results: counts per answer", useFor.answered === 2 && useFor.counts.room === 1 && useFor.counts.none === 1 && r.data.questions.find((x) => x.key === "options_work").counts.enough === 1);
    check("Check-in results: no names, emails or account ids", !/t_chat_|t_renter_|t_landlord_|user_id|@example\.test|Mia|Chatmate/.test(JSON.stringify(r.data)));
    r = await api("/api/admin/survey?demo=real", { as: admin });
    const rDemo = await api("/api/admin/survey?demo=demo", { as: admin });
    check("Check-in results: Demo mode responses can be left out or shown alone", r.data.total === total - 1 && r.data.demo === 0 && rDemo.data.total === 1 && rDemo.data.responses[0].demo === true);
    r = await api("/api/admin/survey.csv", { as: admin });
    const csvLines = String(r.data).trim().split("\r\n");
    check("Check-in results: CSV export with one row per response and readable answers", r.status === 200 && /^text\/csv/.test(r.headers.get("content-type")) && /attachment; filename="cohabit-check-in-/.test(r.headers.get("content-disposition")) && csvLines.length === total + 1 && csvLines[0].includes("Where do you currently look for rooms or roommates?") && String(r.data).includes("Finding a room; Finding a compatible roommate; Organizing shared chores"));
    check("Check-in results: CSV cells can't run as spreadsheet formulas", String(r.data).includes("\"'=HYPERLINK(") && !/(^|,)"=/m.test(String(r.data)));
    d1(`UPDATE "user" SET role='user' WHERE id='t_admin'`);
    check("Check-in results: the CSV has no names, emails or account ids", !/t_chat_|t_renter_|t_landlord_|@example\.test/.test(String(r.data)));
    resetSurveyLimits();
    const burst = [];
    for (let i = 0; i < 6; i++) burst.push((await api("/api/survey", { method: "POST", as: outsider, body: { id: sid(), answers: { options_work: "enough" } } })).status);
    check("Check-in: at most 5 submissions a minute per person (then 429)", burst.slice(0, 5).every((x) => x === 201) && burst[5] === 429, burst.join(","));
    resetSurveyLimits();

    // Fallbacks: the AI service down, or the model declining, still gets an answer.
    // This renter has made many writes in the last minute; start a fresh rate-limit window so the next checks test the fallback.
    d1(`DELETE FROM app_rate_limits WHERE key = 'w:u:t_chat_ai'`);
    fake.mode = "down";
    r = await say(chatAi, "June 2027 please");
    check("Assistant: AI service down → answered in basic mode, with a notice", r.status === 200 && replyOf(r).mode === "basic" && /isn't available/.test(replyOf(r).notice || "") && r.data.mode === "basic");
    fake.mode = "ok";
    r = await say(chatAi, "[[refuse]]");
    check("Assistant: model declines → basic mode answers instead", r.status === 200 && replyOf(r).mode === "basic");

    // Basic mode: this renter has used up today's AI replies (set in the fixtures).
    before = fake.requests.length;
    r = await api("/api/assistant", { as: chatBasic });
    check("Assistant: over the daily AI limit → basic mode", r.data.mode === "basic" && r.data.basicReason === "user_limit");
    r = await say(chatBasic, "hello");
    reply = replyOf(r);
    check("Guided chat: a greeting gets \"Hey!\" and the opening question once, with answer buttons and why it's guided", reply.text === "Hey!\nWhat are you looking for?" && reply.quickReplies.join() === "A room,A roommate,Both" && /today's 20 AI replies/.test(reply.notice || ""), JSON.stringify(reply));
    const basicTexts = [];
    for (const [text, expect] of [
      ["A room", /^What's your max rent per month\?$/],
      ["Up to $1,300", /^Noted: budget up to \$1,300\.\nWhen do you want to move in\?$/], // not one of the buttons, so it counts as typed
      ["June 2027", /^Where do you want to live\? Pick a town, or how far from campus works\.$/],
      ["Waltham", /^How many rooms do you need\?$/],
    ]) {
      r = await say(chatBasic, text);
      basicTexts.push(replyOf(r).text);
      check(`Guided chat: "${text}" → the next question (echoed only when typed)`, expect.test(replyOf(r).text), replyOf(r).text);
      if (text === "Up to $1,300") check("Results panel: with one answer, rooms wait for more", r.data.results.rooms.status === "need_more" && r.data.results.rooms.missing.length === 3);
      if (text === "June 2027") check("Results panel: with two answers, early results appear, marked preliminary", r.data.results.rooms.status === "ok" && r.data.results.rooms.preliminary === true && r.data.results.rooms.items.every((c) => c.unit.monthly_rent <= 1300));
    }
    r = await say(chatBasic, "Just me");
    basicTexts.push(replyOf(r).text);
    reply = replyOf(r);
    check("Basic mode: with the basics, it shows real rooms within budget", reply.cards.length >= 1 && reply.cards.every((c) => c.available && !c.unit.sample && c.unit.monthly_rent <= 1300), reply.text);
    check("Guided chat: results summed up in short, exact and partial matches counted separately", /^\d+ rooms? fits? your must-haves: (it matches everything|all match everything|a partial match|all partial matches|\d+ match(es)? everything, \d+ partly)\./.test(reply.text) && /Top pick: R1 · .+, \$[\d,]+ a month\./.test(reply.text), reply.text);
    check("Basic mode: matching sample listings are mentioned, not shown", /sample \(fictional\) listing/.test(reply.text));
    r = await api("/api/assistant/saved", { method: "POST", as: chatBasic, body: { messageId: reply.id, ref: "R1" } });
    const keptSaved = r.status === 201;
    r = await say(chatBasic, "Actually my budget is $1,000 max");
    reply = replyOf(r);
    basicTexts.push(reply.text);
    check("Guided chat: a typed answer gets a short \"Noted\" so the student sees what was understood", reply.text.startsWith("Noted: budget up to $1,000."), reply.text);
    check("Basic mode: accepts corrections and searches again", r.data.memory.find((f) => f.field === "budget_max")?.value === "$1,000 a month" && (reply.text.includes("No rooms match all your must-haves") || reply.cards.every((c) => c.unit.monthly_rent <= 1000)), reply.text);
    r = await say(chatBasic, "What should I consider?");
    check("Basic mode: lists things to consider", /security deposit/.test(replyOf(r).text));
    basicTexts.push(replyOf(r).text);
    check("Guided chat: never says \"Got it\"", basicTexts.every((t) => !/got it/i.test(t)), basicTexts.join(" | "));
    r = await say(chatFresh, "A room");
    check("Guided chat: the first tap answers the opening question (looking for a room), then the next question", r.data.memory.find((f) => f.field === "looking_for")?.raw === "room" && replyOf(r).text === "What's your max rent per month?" && r.data.results.goal === "room", replyOf(r).text);

    // Demo mode
    r = await api("/api/assistant/demo", { method: "POST", as: chatFresh, body: { on: "yes" } });
    check("Demo mode: the switch takes true or false only (400)", r.status === 400);
    r = await api("/api/assistant/demo", { method: "POST", as: chatFresh, body: { on: true } });
    check("Demo mode: turning it on is remembered", r.status === 200 && r.data.demo === true && (await api("/api/assistant", { as: chatFresh })).data.demo === true);
    for (const [field, value] of [["budget_max", 1300], ["move_in_month", "2027-06"], ["areas", ["Waltham"]], ["rooms_needed", 1]]) {
      r = await api("/api/assistant/memory", { method: "POST", as: chatFresh, body: { field, value } });
    }
    let demoRooms = r.data.results.rooms;
    check("Demo mode: room results are demo listings only, each labeled demo", r.data.results.demo === true && demoRooms.status === "ok" && demoRooms.items.length >= 3 && demoRooms.items.every((c) => c.unit.id.startsWith("demo-") && c.unit.demo === true));
    check("Demo mode: strong and partial matches, with scores never shown for rooms", demoRooms.items[0].misses.length === 0 && demoRooms.items.some((c) => c.misses.length) && demoRooms.items.every((c) => !("score" in c)));
    r = await api("/api/assistant/saved", { method: "POST", as: chatFresh, body: { kind: "room", unitId: demoRooms.items[0].unit.id } });
    check("Demo mode: demo listings can't be saved (409)", r.status === 409 && r.data.error === "demo");
    r = await api("/api/listings");
    check("Demo listings never appear in public listings", !JSON.stringify(r.data).includes("demo-"));
    r = await say(chatFresh, "show rooms");
    check("Demo mode: the guided chat searches the demo listings too", /rooms? fits? your must-haves/.test(replyOf(r).text) && replyOf(r).cards.every((c) => c.unit?.demo === true), replyOf(r).text);
    r = await api("/api/assistant/memory", { method: "POST", as: chatFresh, body: { field: "looking_for", value: "both" } });
    check("Demo mode: roommates need the student's lifestyle answers first", r.data.results.people.status === "missing_answers");
    for (const [field, value] of [["sleep_schedule", "early"], ["cleanliness", "tidy"], ["noise", "quiet"], ["guests", "sometimes"], ["pets", "ok_with_pets"], ["smoking", "no_smoking"]]) {
      r = await api("/api/assistant/memory", { method: "POST", as: chatFresh, body: { field, value } });
    }
    const demoPeople = r.data.results.people;
    const names = (demoPeople.items || []).map((p) => p.firstName);
    check("Demo mode: demo roommate profiles with scores worked out by coHabit and what they share", demoPeople.status === "ok" && demoPeople.items.length >= 5 && demoPeople.items.every((p) => p.demo === true && p.email === null && p.fits.length && p.score >= 60), JSON.stringify(names));
    check("Demo mode: profiles that didn't choose to be found are never shown, nor dealbreakers (a smoker for a no-smoking student)", !["Pia", "Quinn", "Theo", "Gus"].some((n) => names.includes(n)) && names.includes("Ari"));
    check("Demo mode: real renters never appear among demo profiles", !["Alexandra", "Bartholomew", "Test", "Riley"].some((n) => names.includes(n)));
    r = await api("/api/assistant/demo", { method: "POST", as: chatFresh, body: { on: false } });
    check("Demo mode off: results are real again, with no demo listings or profiles", r.data.demo === false && !JSON.stringify(r.data.results).includes("demo-") && r.data.results.people.status !== "ok");
    check("Basic mode: never calls the AI service", fake.requests.length === before);

    r = await api("/api/assistant/clear", { method: "POST", as: chatBasic, body: {} });
    const cleared = await api("/api/assistant", { as: chatBasic });
    check("Assistant: Clear chat deletes the messages and what it learned; saved options stay", r.status === 200 && cleared.data.messages.length === 0 && cleared.data.memory.length === 0 && keptSaved && cleared.data.saved.length === 1);

    d1(`UPDATE "user" SET role='admin' WHERE id='t_admin'`);
    r = await api("/api/admin/assistant", { as: admin });
    check("Admin sees AI use today with an estimated cost, and no chats", r.status === 200 && r.data.aiConfigured === true && r.data.model === "claude-opus-5-5" && r.data.today?.replies >= 10 && r.data.today.estimatedUsd > 0 && !JSON.stringify(r.data).includes("TEST note"));
    d1(`UPDATE "user" SET role='user' WHERE id='t_admin'`);
    r = await api("/api/admin/assistant", { as: chatAi });
    check("Renters can't see assistant usage (403)", r.status === 403);

    r = await api("/api/me/delete", { method: "POST", as: chatBasic, body: { confirm: "DELETE" } });
    check("Deleting an account deletes its chat, memory, cards, saved options and usage", r.status === 200 && count(`SELECT (SELECT COUNT(*) FROM assistant_messages WHERE user_id='t_chat_basic') + (SELECT COUNT(*) FROM assistant_threads WHERE user_id='t_chat_basic') + (SELECT COUNT(*) FROM assistant_actions WHERE user_id='t_chat_basic') + (SELECT COUNT(*) FROM saved_options WHERE user_id='t_chat_basic') + (SELECT COUNT(*) FROM assistant_usage WHERE user_id='t_chat_basic') AS n`) === 0);
    r = await api("/api/me/delete", { method: "POST", as: chatPal, body: { confirm: "DELETE" } });
    check("Deleting an account deletes its roommate requests and messages", r.status === 200 && count(`SELECT COUNT(*) AS n FROM roommate_requests WHERE from_user_id = 't_chat_pal' OR to_user_id = 't_chat_pal'`) === 0 && count(`SELECT COUNT(*) AS n FROM roommate_messages`) === 0);
    check("Deleting an account deletes its check-in answers and coHabit Points", count(`SELECT COUNT(*) AS n FROM survey_responses WHERE user_id = 't_chat_pal'`) === 0 && count(`SELECT COUNT(*) AS n FROM points_awards WHERE user_id = 't_chat_pal'`) === 0);
  }

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

  // ── Email and password accounts (local test inbox instead of real email) ──
  {
    const count = (q) => d1rows(q)[0].n;
    const resetAuthLimits = () => d1(`DELETE FROM "rateLimit"; DELETE FROM app_rate_limits WHERE key LIKE 'a:%'`);
    const inbox = async (to) => (await api(`/api/dev/outbox?to=${encodeURIComponent(to)}`)).data.messages;
    const linkIn = (m) => ((m && m.body.match(/http:\/\/\S+/)) || [])[0];
    const cookieFrom = (res) => ((res.headers.get("set-cookie") || "").match(/better-auth\.session_token=[^;]+/) || [])[0] || null;
    const signIn = (email, password) => api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
    const PASS = "correct horse battery";
    resetAuthLimits();

    r = await api("/api/config");
    check("Accounts: email and password is on locally (test inbox), and off anywhere coHabit can't send email", r.data.passwordSignIn === true && r.data.devInbox === true && authOptions({ BETTER_AUTH_URL: "https://cohabit.example", DB: {} }).emailAndPassword.enabled === false && !devOutboxOn({ DEV_EMAIL_OUTBOX: "1", BETTER_AUTH_URL: "https://cohabit.example" }));

    // Renter: first name, email, password, Student + Working
    const maya = "maya.renter@example.test";
    r = await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "renter", name: " Maya ", email: "Maya.Renter@Example.test", password: PASS, occupation: ["working", "student"], role: "admin", accountType: "landlord", emailVerified: true, image: "https://example.test/me.png", company: "Ignored LLC" } });
    const mayaRow = d1rows(`SELECT id, name, role, account_type, occupation, company, "emailVerified" AS v, image FROM "user" WHERE email = '${maya}'`)[0];
    check("Sign-up (renter): saved as a renter with Student and Working; role, confirmed email, photo and company can't be set", r.status === 200 && r.data.status === "check_email" && mayaRow?.name === "Maya" && mayaRow.account_type === "renter" && mayaRow.occupation === "student,working" && mayaRow.role === "user" && mayaRow.v === 0 && mayaRow.image === null && mayaRow.company === null, JSON.stringify(mayaRow));
    check("Sign-up: the reply is the same short message for everyone (no id, no account)", Object.keys(r.data).sort().join() === "email,status" && !JSON.stringify(r.data).includes(mayaRow.id));
    const hash = d1rows(`SELECT password FROM "account" WHERE "userId" = '${mayaRow.id}' AND "providerId" = 'credential'`)[0]?.password || "";
    check("Sign-up: the password is kept only as a salted PBKDF2 hash", /^pbkdf2-sha256\$100000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/.test(hash) && !hash.includes(PASS));
    let mail = await inbox(maya);
    const verifyLink = linkIn(mail[0]);
    check("Sign-up: one confirmation email with a link back to coHabit", mail.length === 1 && /Confirm your email/.test(mail[0].subject) && /expires in 24 hours/.test(mail[0].body) && /^http:\/\/localhost:\d+\/api\/auth\/verify-email\?token=[\w.-]+&callbackURL=%2Fwelcome$/.test(verifyLink || ""), verifyLink);
    r = await signIn(maya, PASS);
    check("Signing in before confirming is refused, and sends a fresh link", r.status === 403 && r.data.code === "EMAIL_NOT_VERIFIED" && (await inbox(maya)).length === 2);
    let res = await fetch(verifyLink, { redirect: "manual" });
    const mayaCookie = cookieFrom(res);
    check("Confirming the email signs in and opens /welcome, which sends renters to the assistant", res.status === 302 && new URL(res.headers.get("location"), BASE).pathname === "/welcome" && !!mayaCookie);
    r = await api("/api/me", { as: mayaCookie });
    check("Role routing: a confirmed renter has the assistant; landlord pages are refused", r.data.user?.accountType === "renter" && r.data.user.occupation === "student,working" && (await api("/api/assistant", { as: mayaCookie })).status === 200 && (await api("/api/landlord/units", { as: mayaCookie })).status === 403);
    res = await fetch(verifyLink, { redirect: "manual" });
    check("A used confirmation link doesn't sign anyone in again", res.status === 302 && !cookieFrom(res));
    r = await signIn("MAYA.renter@example.test", PASS);
    const mayaCookie2 = cookieFrom(r);
    check("Sign-in with email and password (any capitalization); the reply holds no account details", r.status === 200 && r.data.signedIn === true && Object.keys(r.data).join() === "signedIn" && !!mayaCookie2 && (await api("/api/me", { as: mayaCookie2 })).data.user?.email === maya);
    r = await signIn(maya, "not the password");
    const unknown = await signIn("nobody@example.test", "not the password");
    check("A wrong password and an unknown email get the same answer (401)", r.status === 401 && unknown.status === 401 && r.data.code === "INVALID_EMAIL_OR_PASSWORD" && unknown.data.code === r.data.code && r.data.message === unknown.data.message);

    // Landlord: name, email, password, optional company
    resetAuthLimits();
    const dana = "dana.landlord@example.test";
    r = await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "landlord", name: "Dana Okafor", email: dana, password: PASS, company: "Okafor Rentals", occupation: ["student"] } });
    const danaRow = d1rows(`SELECT account_type, company, occupation FROM "user" WHERE email = '${dana}'`)[0];
    check("Sign-up (landlord): saved as a landlord with the company; renter answers ignored", r.status === 200 && danaRow?.account_type === "landlord" && danaRow.company === "Okafor Rentals" && danaRow.occupation === null);
    res = await fetch(linkIn((await inbox(dana))[0]), { redirect: "manual" });
    const danaCookie = cookieFrom(res);
    check("Role routing: a confirmed landlord has the dashboard; renter pages are refused", !!danaCookie && (await api("/api/landlord/units", { as: danaCookie })).status === 200 && (await api("/api/assistant", { as: danaCookie })).status === 403 && (await api("/api/me", { as: danaCookie })).data.user.company === "Okafor Rentals");

    // Validation
    resetAuthLimits();
    const fieldOf = async (body) => (await api("/api/auth/sign-up/email", { method: "POST", body })).data.field;
    const fields = [
      await fieldOf({ signupAs: "renter", name: "", email: "ann@example.test", password: PASS }),
      await fieldOf({ signupAs: "renter", name: "R2-D2", email: "ann@example.test", password: PASS }),
      await fieldOf({ signupAs: "renter", name: "Ann", email: "not-an-email", password: PASS }),
      await fieldOf({ signupAs: "renter", name: "Ann", email: "ann@example.test", password: "short" }),
      await fieldOf({ signupAs: "admin", name: "Ann", email: "ann@example.test", password: PASS }),
      await fieldOf({ signupAs: "renter", name: "Ann", email: "ann@example.test", password: PASS, occupation: ["other", "student"] }),
      await fieldOf({ signupAs: "landlord", name: "Ann", email: "ann@example.test", password: PASS, company: "Call 617-555-0142" }),
    ];
    check("Sign-up checks each field (name, email, password, path, Other alone, company) and creates nothing", fields.join() === "name,name,email,password,signupAs,occupation,company" && count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'ann@example.test'`) === 0, fields.join());
    r = await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "renter", name: "Ann", email: "ann@example.test", password: PASS }, origin: "https://evil.example" });
    check("Sign-up from another site is blocked (403)", r.status === 403);

    // Same email again: no new account, same answer, the owner is emailed instead
    r = await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "landlord", name: "Someone Else", email: maya, password: "another passphrase" } });
    mail = await inbox(maya);
    check("Signing up with an email that has an account: same answer, nothing changes, the owner is told by email", r.status === 200 && r.data.status === "check_email" && count(`SELECT COUNT(*) AS n FROM "user" WHERE email = '${maya}'`) === 1 && /already have a coHabit account/.test(mail[0].subject) && d1rows(`SELECT account_type FROM "user" WHERE email = '${maya}'`)[0].account_type === "renter");
    r = await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "renter", name: "Copy", email: renterB.email, password: PASS } });
    check("…also for someone who signed up with Google (no password is added to their account)", r.status === 200 && count(`SELECT COUNT(*) AS n FROM "account" WHERE "userId" = 't_renter_b' AND "providerId" = 'credential'`) === 0 && /already have/.test((await inbox(renterB.email))[0]?.subject || ""));

    // Forgot password → email → reset page → new password
    resetAuthLimits();
    r = await api("/api/auth/request-password-reset", { method: "POST", body: { email: maya } });
    const nobody = await api("/api/auth/request-password-reset", { method: "POST", body: { email: "nobody-here@example.test" } });
    check("Forgot password: the same answer whether or not the account exists, and no email to unknown addresses", r.status === 200 && nobody.status === 200 && JSON.stringify(Object.keys(r.data)) === JSON.stringify(Object.keys(nobody.data)) && r.data.status === nobody.data.status && (await inbox("nobody-here@example.test")).length === 0);
    mail = await inbox(maya);
    const resetLink = linkIn(mail[0]);
    check("Forgot password: an email with a one-time link that expires in 1 hour", /Reset your coHabit password/.test(mail[0].subject) && /expires in 1 hour/.test(mail[0].body) && /^http:\/\/localhost:\d+\/api\/auth\/reset-password\/[A-Za-z0-9_-]+\?callbackURL=%2Freset-password$/.test(resetLink || ""), resetLink);
    const expiry = d1rows(`SELECT "expiresAt" AS e FROM verification WHERE identifier LIKE 'reset-password:%' AND value = '${mayaRow.id}'`)[0]?.e;
    const expiryMs = /^\d+$/.test(String(expiry)) ? Number(expiry) : new Date(expiry).getTime();
    check("…and the token stored on the server really expires about an hour from now", Math.abs(expiryMs - Date.now() - 3600_000) < 180_000, String(expiry));
    res = await fetch(resetLink, { redirect: "manual" });
    const token = new URL(res.headers.get("location") || "/", BASE).searchParams.get("token");
    check("The reset link opens coHabit's own reset page with the token", res.status === 302 && new URL(res.headers.get("location"), BASE).pathname === "/reset-password" && !!token);
    res = await fetch(resetLink.replace("%2Freset-password", encodeURIComponent("https://evil.example/steal")), { redirect: "manual" });
    check("A reset link can't be sent on to another site", res.status === 302 && new URL(res.headers.get("location"), BASE).origin === BASE);
    r = await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword: "short" } });
    check("The new password is checked too (too short → 400)", r.status === 400 && r.data.field === "newPassword");
    r = await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword: "a brand new passphrase" } });
    check("Reset: password changed, and every session for that account is signed out", r.status === 200 && r.data.status === "password_changed" && (await api("/api/me", { as: mayaCookie2 })).data.user === null);
    r = await api("/api/auth/reset-password", { method: "POST", body: { token, newPassword: "yet another passphrase" } });
    check("A reset link works only once", r.status === 400 && r.data.code === "INVALID_TOKEN");
    check("After the reset the old password fails and the new one works", (await signIn(maya, PASS)).status === 401 && (await signIn(maya, "a brand new passphrase")).status === 200);
    await api("/api/auth/request-password-reset", { method: "POST", body: { email: maya } });
    const staleLink = linkIn((await inbox(maya))[0]);
    const stale = /^\d+$/.test(String(expiry)) ? String(Date.now() - 60_000) : `'${new Date(Date.now() - 60_000).toISOString()}'`;
    d1(`UPDATE verification SET "expiresAt" = ${stale} WHERE identifier LIKE 'reset-password:%' AND value = '${mayaRow.id}'`);
    res = await fetch(staleLink, { redirect: "manual" });
    check("An expired reset link says so instead of opening the form", res.status === 302 && new URL(res.headers.get("location"), BASE).searchParams.get("error") === "INVALID_TOKEN");

    // A Google user can set a password through "Forgot password?" (the email proves it's them)
    resetAuthLimits();
    d1(`INSERT INTO "user" (id,name,email,"emailVerified","createdAt","updatedAt",role,account_type) VALUES ('t_google_only','Gia Google','gia.google@example.test',1,'${now}','${now}','user','renter'); INSERT INTO "account" (id,"accountId","providerId","userId","createdAt","updatedAt") VALUES ('a_gia','google-sub-gia','google','t_google_only','${now}','${now}')`);
    await api("/api/auth/request-password-reset", { method: "POST", body: { email: "gia.google@example.test" } });
    res = await fetch(linkIn((await inbox("gia.google@example.test"))[0]), { redirect: "manual" });
    r = await api("/api/auth/reset-password", { method: "POST", body: { token: new URL(res.headers.get("location"), BASE).searchParams.get("token"), newPassword: "gia's new passphrase" } });
    check("A Google user can add a password with “Forgot password?”, keeping the same account and type", r.status === 200 && (await signIn("gia.google@example.test", "gia's new passphrase")).status === 200 && count(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'gia.google@example.test'`) === 1 && count(`SELECT COUNT(*) AS n FROM "account" WHERE "userId" = 't_google_only'`) === 2);

    // Limits, deleting a password account
    resetAuthLimits();
    const tries = [];
    for (let i = 0; i < 22; i++) tries.push((await signIn("nobody@example.test", "not the password")).status);
    check("Password sign-in is rate limited per network address (429)", tries.includes(429) && tries.slice(0, 9).every((x) => x === 401), tries.join(","));
    resetAuthLimits();
    r = await api("/api/me/delete", { method: "POST", as: danaCookie, body: { confirm: "DELETE" } });
    check("Deleting a password account deletes its password and any reset links", r.status === 200 && count(`SELECT COUNT(*) AS n FROM "user" WHERE email = '${dana}'`) === 0 && count(`SELECT COUNT(*) AS n FROM "account" WHERE "userId" NOT IN (SELECT id FROM "user")`) === 0);
    // For the cleanup job below: an unconfirmed sign-up from 8 days ago, and a fresh one
    await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "renter", name: "Old", email: "old.unconfirmed@example.test", password: PASS } });
    await api("/api/auth/sign-up/email", { method: "POST", body: { signupAs: "renter", name: "New", email: "new.unconfirmed@example.test", password: PASS } });
    d1(`UPDATE "user" SET "createdAt" = '${new Date(Date.now() - 8 * 86400_000).toISOString()}' WHERE email = 'old.unconfirmed@example.test'`);
    resetAuthLimits();
  }

  // ── Cleanup job ───────────────────────────────────────────────────────────
  d1(`UPDATE assistant_threads SET updated_at = 0 WHERE user_id = 't_chat_mate'`);
  // /__scheduled would be served the site's page (only /api/* reaches the Worker first), so use the local trigger.
  r = await fetch(`${BASE}/cdn-cgi/local/scheduled?cron=17+4+*+*+*`);
  check("The daily cleanup job runs", r.ok && !(r.headers.get("content-type") || "").includes("text/html"), `${r.status} ${r.headers.get("content-type")}`);
  await sleep(500);
  check("Scheduled cleanup deletes expired sessions", d1rows(`SELECT COUNT(*) AS n FROM "session" WHERE id='s_expired'`)[0].n === 0);
  check("Scheduled cleanup deletes password sign-ups never confirmed within 7 days, and only those", d1rows(`SELECT COUNT(*) AS n FROM "user" WHERE email = 'old.unconfirmed@example.test'`)[0].n === 0 && d1rows(`SELECT COUNT(*) AS n FROM "user" WHERE email IN ('new.unconfirmed@example.test', 'maya.renter@example.test', 'gia.google@example.test')`)[0].n === 3);
  check("Scheduled cleanup deletes chats unused for 90 days, and only those", d1rows(`SELECT COUNT(*) AS n FROM assistant_messages WHERE user_id='t_chat_mate'`)[0].n === 0 && d1rows(`SELECT COUNT(*) AS n FROM assistant_messages WHERE user_id='t_chat_ai'`)[0].n > 0);
} catch (err) {
  check("Test run crashed", false, err.stack);
} finally {
  dev.kill();
  fakeAi.close();
}

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length) {
  console.log("\nWorker log (tail):\n" + devLog.split("\n").slice(-40).join("\n"));
  process.exitCode = 1;
}
setTimeout(() => process.exit(), 1000);
