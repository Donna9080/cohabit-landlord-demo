// Fictional sample data: 6 landlords, 20 units, 30 renters around Waltham, Belmont and Cambridge.
//
//   node scripts/sample-data.mjs
//
// Writes scripts/sample-data.sql (load it with wrangler, see ACCOUNTS_SETUP.md) and
// docs/SAMPLE_MATCHING.md (every sample renter's matches, computed with src/match.js).
//
// Everything sample has a user id starting with "sample-", a name ending in "(sample)" and an
// address at the reserved domain sample.example. Sample people have no Google link and no
// session, so nobody can sign in as them. The app shows a "Sample" tag on their listings and
// in the admin list. Every row passes the same validation as real input (src/validate.js).
// All sample renters have roommate matching turned on; every other one also shares a (fictional) email.
import { mkdirSync, writeFileSync } from "node:fs";
import { parsePreferences, parseUnit } from "../src/validate.js";
import { MIN_SCORE, rankUnits } from "../src/match.js";
import { MIN_ROOMMATE_SCORE, firstNameOf, rankRoommates, scoreRoommate } from "../src/roommates.js";

const landlords = [
  "Riverside Rooms", "Maple House Rentals", "Prospect Hill Homes",
  "Belmont Family Rentals", "Charles View Housing", "Red Line Rooms",
].map((name, i) => ({ id: `sample-landlord-${String(i + 1).padStart(2, "0")}`, name: `${name} (sample)`, email: `landlord${String(i + 1).padStart(2, "0")}@sample.example` }));

// [landlord, name, area, rent per room, rooms available, move-in date, description]
const unitRows = [
  [1, "Sunny 3-bedroom near Brandeis", "Waltham, MA", 950, 2, "2026-11-01", "Two rooms free in a quiet shared house. Ten minute walk to campus, laundry in the basement."],
  [1, "Quiet room in shared house", "South Waltham, MA", 875, 1, "2026-12-01", "One furnished room. Housemates are graduate students. Heat and hot water included."],
  [2, "Renovated 4-bedroom by Moody Street shops", "Waltham, MA (Moody Street area)", 1050, 3, "2027-01-01", "New kitchen, two bathrooms. Restaurants and the commuter rail are a short walk away."],
  [2, "Top-floor room with parking", "Waltham, MA (Banks Square)", 900, 1, "2027-01-15", "Bright top-floor room with one off-street parking spot. Shared kitchen and living room."],
  [3, "Whole 2-bedroom near commuter rail", "Waltham, MA", 1300, 2, "2027-06-01", "Both rooms available together or separately. Dishwasher, small porch, bike storage."],
  [3, "Student house, all utilities included", "Waltham, MA (Bentley area)", 1100, 4, "2027-06-01", "Four rooms for a group. Electricity, heat and internet are included in the rent."],
  [1, "Garden-level room with own entrance", "North Waltham, MA", 1200, 1, "2027-09-01", "Private entrance and half bath. Quiet residential block near the bus."],
  [2, "Large room in Victorian house", "Waltham, MA (Highlands)", 1000, 2, "2027-09-01", "High ceilings, big windows, shared garden. Two rooms opening for the fall."],
  [4, "Bright room near Belmont Center", "Belmont, MA (Belmont Center)", 1150, 1, "2026-11-15", "Walk to the commuter rail and shops. Quiet household, no smoking indoors."],
  [4, "Family home with 3 rooms to share", "Belmont, MA", 1250, 3, "2027-01-01", "Three rooms on the second floor with a shared bathroom and a full kitchen."],
  [4, "Quiet 2-bedroom near Waverley Square", "Belmont, MA (Waverley)", 1350, 2, "2027-02-01", "Two rooms in a calm building near the bus to Harvard. Laundry on site."],
  [5, "Room with private bath", "Belmont, MA (Cushing Square)", 1500, 1, "2027-06-01", "Large room with its own bathroom. Cafes and a grocery store around the corner."],
  [5, "Shared duplex close to the bus line", "Belmont, MA", 1100, 2, "2027-06-15", "Two rooms in a duplex with a yard. Bus to Harvard Square stops nearby."],
  [4, "Newly painted room with backyard access", "Belmont, MA (Payson Park)", 1200, 1, "2027-09-01", "Fresh paint, new floor. Shared backyard and a small home office nook."],
  [6, "Room near Porter Square station", "Cambridge, MA (Porter Square)", 1600, 1, "2026-11-01", "Five minutes to the Red Line. Shared apartment with two working professionals."],
  [6, "3-bedroom walk-up by Central Square", "Cambridge, MA (Central Square)", 1750, 2, "2027-01-01", "Third floor, lots of light. Two rooms free. Close to restaurants and the Red Line."],
  [6, "Compact room near Harvard Square", "Cambridge, MA (Harvard Square)", 1900, 1, "2027-02-01", "Small but well laid out room in a classic building. Heat included."],
  [5, "Shared apartment in Cambridgeport", "Cambridge, MA (Cambridgeport)", 1550, 2, "2027-06-01", "Two rooms in a four-bedroom apartment near the river. Bike room in the basement."],
  [6, "Top-floor 4-bedroom in North Cambridge", "North Cambridge, MA", 1400, 3, "2027-09-01", "Three rooms for the fall. Near the bike path and Alewife station."],
  [5, "Sunny room near Inman Square", "Cambridge, MA (Inman Square)", 1650, 1, "2027-09-01", "South-facing room in a friendly apartment. Shared kitchen with a gas stove."],
];

// [name, budget from, budget up to, move-in month, area, rooms needed]
const renterRows = [
  ["Maya Chen", 800, 1000, "2026-11", "Waltham", 1],
  ["Jordan Alvarez", 900, 1100, "2027-01", "Waltham", 1],
  ["Priya Nair", 1000, 1300, "2027-06", "Waltham", 2],
  ["Sam O'Connor", 700, 900, "2026-12", "Waltham", 1],
  ["Ethan Brooks", 1000, 1200, "2027-06", "Waltham", 3],
  ["Lina Haddad", 1100, 1300, "2027-09", "Waltham", 1],
  ["Noah Kim", 850, 1050, "2027-01", "Waltham or Belmont", 1],
  ["Ava Thompson", 900, 1000, "2027-09", "Waltham", 2],
  ["Diego Morales", 500, 650, "2026-11", "Waltham", 1],
  ["Grace Liu", 1200, 1400, "2027-06", "Waltham", 2],
  ["Omar Farouk", 1000, 1200, "2026-11", "Belmont", 1],
  ["Hannah Schmidt", 1100, 1300, "2027-01", "Belmont", 2],
  ["Kenji Watanabe", 1300, 1500, "2027-02", "Belmont", 2],
  ["Sofia Rossi", 1400, 1600, "2027-06", "Belmont", 1],
  ["Tunde Adeyemi", 900, 1100, "2027-06", "Belmont", 2],
  ["Chloe Martin", 1100, 1250, "2027-09", "Belmont", 1],
  ["Arjun Mehta", 1200, 1300, "2027-01", "Belmont or Cambridge", 3],
  ["Emily Nguyen", 800, 950, "2027-03", "Belmont", 1],
  ["Lucas Pereira", 1500, 1700, "2026-11", "Cambridge", 1],
  ["Zoe Williams", 1600, 1800, "2027-01", "Cambridge", 2],
  ["Mateo Garcia", 1800, 2000, "2027-02", "Cambridge", 1],
  ["Aisha Khan", 1400, 1600, "2027-06", "Cambridge", 2],
  ["Ben Cohen", 1300, 1450, "2027-09", "Cambridge", 3],
  ["Mei Lin", 1500, 1700, "2027-09", "Cambridge", 1],
  ["Daniel Okafor", 1000, 1200, "2027-01", "Cambridge", 1],
  ["Isabella Silva", 1200, 1500, "2027-06", "Cambridge or Belmont", 1],
  ["Ryan Murphy", 2000, 2500, "2027-04", "Cambridge", 1],
  ["Nadia Petrova", 900, 1200, "2027-05", "Watertown", 1],
  ["Caleb Johnson", 950, 1150, "2026-12", "Waltham or Cambridge", 2],
  ["Yuki Tanaka", 1100, 1400, "2027-08", "Belmont or Waltham", 4],
];
const LIFESTYLE = {
  sleep_schedule: ["early", "flexible", "late"],
  cleanliness: ["tidy", "average", "relaxed"],
  noise: ["quiet", "moderate", "lively"],
  guests: ["rarely", "sometimes", "often"],
  // Repeated entries make an answer more common, roughly as it would be among real renters.
  pets: ["no_pets", "ok_with_pets", "ok_with_pets", "have_pets"],
  smoking: ["no_smoking", "no_smoking", "no_smoking", "outside_ok", "outside_ok", "smoker"],
};

// Small seeded random generator, so the sample is varied but identical on every run.
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = seeded(20261001);
const seenLifestyles = new Set();
function lifestyle() {
  for (;;) {
    const life = Object.fromEntries(Object.entries(LIFESTYLE).map(([k, opts]) => [k, opts[Math.floor(random() * opts.length)]]));
    const key = Object.values(life).join("|");
    if (seenLifestyles.has(key)) continue; // every sample renter gets a different combination
    seenLifestyles.add(key);
    return life;
  }
}

// Build and validate with the server's own rules.
// Rough centers of each unit's neighborhood (not real addresses). Shown to renters as approximate areas.
const AREA_POINTS = [
  [42.3656, -71.2588], [42.3625, -71.2405], [42.3707, -71.237], [42.3745, -71.229], [42.374, -71.236],
  [42.3855, -71.221], [42.401, -71.252], [42.382, -71.247], [42.3959, -71.1787], [42.393, -71.185],
  [42.387, -71.1905], [42.4015, -71.172], [42.3985, -71.165], [42.3905, -71.168], [42.3884, -71.1191],
  [42.3654, -71.1037], [42.3736, -71.119], [42.3594, -71.1083], [42.396, -71.133], [42.374, -71.1006],
];
if (AREA_POINTS.length !== unitRows.length) throw new Error("one area point per sample unit");

const units = unitRows.map(([landlord, name, area, monthly_rent, rooms_available, move_in_date, description], i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
  landlord_user_id: landlords[landlord - 1].id,
  ...parseUnit({ name, area, monthly_rent, rooms_available, move_in_date, description, status: "active" }),
  lat: AREA_POINTS[i][0],
  lng: AREA_POINTS[i][1],
}));
const renters = renterRows.map(([name, budget_min, budget_max, move_in_month, area, rooms_needed], i) => {
  const life = lifestyle();
  const n = String(i + 1).padStart(2, "0");
  return { id: `sample-renter-${n}`, name: `${name} (sample)`, email: `renter${n}@sample.example`, prefs: parsePreferences({ budget_min, budget_max, move_in_month, area, rooms_needed, ...life, roommate_visible: true, share_email: i % 2 === 0 }) };
});

// ── SQL ─────────────────────────────────────────────────────────────────────
const q = (v) => (typeof v === "number" ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const nowIso = "2026-10-01T12:00:00.000Z";
const nowMs = Date.parse(nowIso);
const lines = [
  "-- Fictional sample data for coHabit. Generated by scripts/sample-data.mjs; do not edit by hand.",
  "-- Safe to run again: it replaces earlier sample rows and touches nothing else.",
  `DELETE FROM units WHERE landlord_user_id LIKE 'sample-%';`,
  `DELETE FROM match_preferences WHERE user_id LIKE 'sample-%';`,
  `DELETE FROM "user" WHERE id LIKE 'sample-%';`,
];
const userRow = (u, type) =>
  `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt", role, account_type) VALUES (${q(u.id)}, ${q(u.name)}, ${q(u.email)}, 0, ${q(nowIso)}, ${q(nowIso)}, 'user', ${q(type)});`;
for (const l of landlords) lines.push(userRow(l, "landlord"));
for (const r of renters) lines.push(userRow(r, "renter"));
for (const u of units)
  lines.push(
    `INSERT INTO units (id, landlord_user_id, name, area, monthly_rent, rooms_available, move_in_date, description, status, created_at, updated_at, lat, lng, location_precision, geo_source) VALUES (${[u.id, u.landlord_user_id, u.name, u.area, u.monthly_rent, u.rooms_available, u.move_in_date, u.description, u.status, nowMs, nowMs, u.lat, u.lng, "approximate", "Sample: neighborhood center, set by hand"].map(q).join(", ")});`
  );
for (const r of renters) {
  const p = r.prefs;
  lines.push(
    `INSERT INTO match_preferences (user_id, budget_min, budget_max, move_in_month, area, rooms_needed, sleep_schedule, cleanliness, noise, guests, pets, smoking, created_at, updated_at, roommate_visible, share_email) VALUES (${[r.id, p.budget_min, p.budget_max, p.move_in_month, p.area, p.rooms_needed, p.sleep_schedule, p.cleanliness, p.noise, p.guests, p.pets, p.smoking, nowMs, nowMs, p.roommate_visible ? 1 : 0, p.share_email ? 1 : 0].map(q).join(", ")});`
  );
}
writeFileSync(new URL("./sample-data.sql", import.meta.url), lines.join("\n") + "\n");

// ── Matching report ─────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const money = (n) => "$" + n.toLocaleString("en-US");
const results = renters.map((r) => ({ r, matches: rankUnits(r.prefs, units) }));
const withMatches = results.filter((x) => x.matches.length);
const perfect = results.filter((x) => x.matches[0]?.score === 100);

let md = `# How matching works, shown with the sample data

Generated by \`node scripts/sample-data.mjs\` from the app's real matching code (\`src/match.js\`).
All people and units here are fictional.

## The rules

Each active unit gets a score out of 100 for a renter:

| Rule | Points |
| --- | --- |
| Rent is at or under the renter's "budget up to" | 40 |
| Rent is over budget, but by 10% or less | 15 |
| Unit's area shares a word with the renter's area (for example "Belmont") | 25 |
| Move-in is the same month the renter wants | 20 |
| Move-in is one month earlier or later | 10 |
| Unit has at least as many rooms as the renter needs | 15 |

A unit is shown only if all three of these hold:

1. **Affordable:** rent is no more than 10% over the renter's "budget up to".
2. **Big enough:** it has at least as many rooms as the renter needs.
3. **Relevant:** it scores ${MIN_SCORE} or more. An affordable, big-enough unit starts at 55 (or 30 if slightly over budget),
   so it also has to be in the renter's area or available in the exact month they want.

Results are sorted by score, then by lower rent, and the top 20 are shown. The "budget from" figure
and the lifestyle answers (sleep, cleanliness, noise, guests, pets, smoking) are saved but not used
yet; they are for future roommate matching.

## Summary

- ${units.length} sample units: ${["Waltham", "Belmont", "Cambridge"].map((c) => `${units.filter((u) => u.area.includes(c)).length} in ${c}`).join(", ")}. Rent ${money(Math.min(...units.map((u) => u.monthly_rent)))} to ${money(Math.max(...units.map((u) => u.monthly_rent)))} per room.
- ${renters.length} sample renters. ${withMatches.length} get at least one match; ${perfect.length} have a 100% top match; ${renters.length - withMatches.length} get none.

## What tightening the rules changed

${(() => {
  const all = results.flatMap(({ r, matches }) => matches.map((m) => ({ r, m })));
  const over = all.filter(({ r, m }) => m.unit.monthly_rent > r.prefs.budget_max);
  const wayOver = all.filter(({ r, m }) => m.unit.monthly_rent > r.prefs.budget_max * 1.1);
  const offArea = all.filter(({ m }) => !m.reasons.includes("In your area"));
  const topOver = results.filter(({ r, matches }) => matches[0] && matches[0].unit.monthly_rent > r.prefs.budget_max);
  const avg = (all.length / renters.length).toFixed(1);
  const tooSmall = all.filter(({ r, m }) => m.unit.rooms_available < r.prefs.rooms_needed);
  const none = results.filter((x) => !x.matches.length);
  const why = ({ r }) => {
    const p = r.prefs;
    const affordable = units.filter((u) => u.monthly_rent <= p.budget_max * 1.1 && u.rooms_available >= p.rooms_needed);
    if (!affordable.length) return "no unit is within 10% of the budget with enough rooms";
    return "units they can afford are neither in their area nor free in their month";
  };
  const pct = (n) => `${Math.round((n / all.length) * 100)}%`;
  return `The first version of the rules showed any unit scoring 40 or more, with no limits. Same data, before and after:

| | Before (score 40+) | Now |
| --- | --- | --- |
| Units shown per renter, on average (out of ${units.length}) | 14.1 | ${avg} |
| Matches outside the area the renter asked for | 209 of 424 (49%) | ${offArea.length} of ${all.length} (${pct(offArea.length)}) |
| Matches over the renter's budget | 84 | ${over.length} |
| Matches more than 10% over budget | 52 | ${wayOver.length} |
| Matches with too few rooms | not checked | ${tooSmall.length} |
| Renters whose top match is over budget | 1 | ${topOver.length} |
| Renters with a 100% top match | 23 | ${perfect.length} |
| Renters with no match | 0 | ${none.length} |

- Over-budget matches still shown (${over.length}) are within 10% of the budget and are labeled "Slightly over budget".
- Out-of-area matches still shown (${offArea.length}) are affordable, big enough, and free in the exact month the renter wants.
${none.length ? `- Renters who now get no match, and why:\n${none.map((x) => `  - **${x.r.name.replace(" (sample)", "")}** (${x.r.prefs.area}, up to ${money(x.r.prefs.budget_max)}, ${month(x.r.prefs.move_in_month)}, ${x.r.prefs.rooms_needed} room${x.r.prefs.rooms_needed === 1 ? "" : "s"}): ${why(x)}.`).join("\n")}\n  The site tells them to widen their budget or area, or browse all listings.` : ""}`;
})()}

## The units

| # | Unit | Area | Rent | Rooms | Move-in |
| --- | --- | --- | --- | --- | --- |
${units.map((u, i) => `| ${i + 1} | ${u.name} | ${u.area} | ${money(u.monthly_rent)} | ${u.rooms_available} | ${u.move_in_date} |`).join("\n")}

## Every renter's top matches

| Renter | Wants | Matches | Best match | Score | Why |
| --- | --- | --- | --- | --- | --- |
${results
  .map(({ r, matches }) => {
    const p = r.prefs;
    const wants = `${p.area}, up to ${money(p.budget_max)}, ${month(p.move_in_month)}, ${p.rooms_needed} room${p.rooms_needed === 1 ? "" : "s"}`;
    const best = matches[0];
    return `| ${r.name.replace(" (sample)", "")} | ${wants} | ${matches.length} | ${best ? `${best.unit.name} (${best.unit.area}, ${money(best.unit.monthly_rent)})` : "none"} | ${best ? best.score + "%" : ""} | ${best ? best.reasons.join("; ") : "No unit passes all three checks"} |`;
  })
  .join("\n")}

## Second and third choices

${results
  .filter((x) => x.matches.length > 1)
  .map(({ r, matches }) => `- **${r.name.replace(" (sample)", "")}:** ${matches.slice(1, 3).map((m) => `${m.unit.name} (${m.score}%)`).join(", ")}`)
  .join("\n")}
`;
// ── Roommate matching section ───────────────────────────────────────────────
const asOther = (r) => ({ prefs: r.prefs, firstName: firstNameOf(r.name), email: r.prefs.share_email ? r.email : null, sample: true });
const mates = renters.map((r) => ({ r, list: rankRoommates(r.prefs, renters.filter((o) => o !== r).map(asOther)) }));
const pairs = [];
for (let i = 0; i < renters.length; i++) for (let j = i + 1; j < renters.length; j++) pairs.push([renters[i], renters[j]]);
const clash = (a, b, field, x, y) => [a.prefs[field], b.prefs[field]].includes(x) && [a.prefs[field], b.prefs[field]].includes(y);
const petClashes = pairs.filter(([a, b]) => clash(a, b, "pets", "no_pets", "have_pets")).length;
const smokeClashes = pairs.filter(([a, b]) => clash(a, b, "smoking", "no_smoking", "smoker")).length;
const goodPairs = pairs.filter(([a, b]) => scoreRoommate(a.prefs, b.prefs).eligible).length;
const withMates = mates.filter((m) => m.list.length);
const LABELS = {
  sleep_schedule: { early: "early bird", flexible: "flexible sleep", late: "night owl" },
  cleanliness: { relaxed: "relaxed", average: "average tidiness", tidy: "very tidy" },
  noise: { quiet: "quiet", moderate: "some noise ok", lively: "lively" },
  guests: { rarely: "guests rarely", sometimes: "guests sometimes", often: "guests often" },
  pets: { no_pets: "no pets", ok_with_pets: "ok with pets", have_pets: "has a pet" },
  smoking: { no_smoking: "no smoking", outside_ok: "smoking outside ok", smoker: "smokes" },
};
const lifestyleOf = (p) => Object.keys(LABELS).map((k) => LABELS[k][p[k]]).join(", ");

md += `
# Roommate matching

Roommate matching compares renters with each other using the lifestyle answers. It is opt-in:
a renter is only compared and shown after ticking "Show me to compatible renters", and only sees
people who ticked it too. All ${renters.length} sample renters have it on; every other one also shares a
(fictional) email address.

## The rules

Two renters are a possible match only if all of these hold:

1. **Same area:** their areas share a word (for example both say "Waltham").
2. **Same timing:** their move-in months are the same or one month apart.
3. **No dealbreaker:** not "has a pet" with "no pets, please", and not "I smoke" with "no smoking".
4. **Compatible:** the score is ${MIN_ROOMMATE_SCORE} or more out of 100.

| Part of the score | Points |
| --- | --- |
| Cleanliness: same answer 20, one step apart 10, opposite 0 | up to 20 |
| Sleep schedule: same 15, one of you flexible 10, early bird with night owl 0 | up to 15 |
| Noise at home: same 15, one step apart 7.5, opposite 0 | up to 15 |
| Guests: same 10, one step apart 5, opposite 0 | up to 10 |
| Pets: no clash | 10 |
| Smoking: same answer 10, one step apart 6 | up to 10 |
| Budget ranges overlap | 10 |
| Same move-in month | 10 |

## What another renter sees

Only this: first name, the score, and the things the two have in common. Never the last name,
never an answer the two do not share, and the email only if that person ticked the separate box.

## Summary

- ${pairs.length} possible pairs among ${renters.length} renters. ${goodPairs} pairs pass all four checks.
- ${withMates.length} renters have at least one possible roommate; ${renters.length - withMates.length} have none (nobody else wants their area in their month, or the lifestyle fit is too low).
- Dealbreakers removed ${petClashes} pairs for pets and ${smokeClashes} pairs for smoking, before area and timing were even considered.

## Every renter's best roommate match

| Renter | Looking for | Lifestyle | Possible roommates | Best fit | Score | What they have in common |
| --- | --- | --- | --- | --- | --- | --- |
${mates
  .map(({ r, list }) => {
    const p = r.prefs;
    const best = list[0];
    return `| ${firstNameOf(r.name)} | ${p.area}, ${month(p.move_in_month)} | ${lifestyleOf(p)} | ${list.length} | ${best ? best.firstName : "none"} | ${best ? best.score + "%" : ""} | ${best ? best.shared.join("; ") : ""} |`;
  })
  .join("\n")}

The "Lifestyle" column is shown here only because this is fictional data. On the site a renter never
sees another renter's full answers, only the last column.
`;

mkdirSync(new URL("../docs/", import.meta.url), { recursive: true });
writeFileSync(new URL("../docs/SAMPLE_MATCHING.md", import.meta.url), md);

console.log(`${landlords.length} landlords, ${units.length} units, ${renters.length} renters -> scripts/sample-data.sql, docs/SAMPLE_MATCHING.md`);
console.log(`${withMatches.length} renters with matches, ${perfect.length} with a 100% top match, ${renters.length - withMatches.length} with none`);
console.log(`roommates: ${goodPairs} compatible pairs of ${pairs.length}; ${withMates.length} renters have at least one`);
for (const { r, matches } of results) console.log(`${r.name.padEnd(28)} ${String(matches.length).padStart(2)} matches  top: ${matches[0] ? matches[0].score + "% " + matches[0].unit.name : "-"}`);
