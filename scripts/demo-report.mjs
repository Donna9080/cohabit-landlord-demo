// Writes docs/DEMO_DATA.md from the Demo mode data: what's in it, how it's managed, coverage, 20 representative
// searches run through coHabit's own matching code, and every listing, photo and profile.
//
//   node scripts/demo-report.mjs   (npm run demo:report)
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PHOTOS } from "../src/assistant/demo-base.js";
import { DEMO_LISTINGS, DEMO_PEOPLE } from "../src/assistant/demo-data.js";
import { BRANDEIS, exclusionCounts, kmBetween, searchRoommates, searchRooms } from "../src/assistant/search.js";
import { rankUnits } from "../src/match.js";
import { BLOCKER_TEXT, roommateBlockers } from "../src/roommates.js";
import { MUTUAL_TEXT, coverage, summary } from "./demo-coverage.mjs";

const OUT = fileURLToPath(new URL("../docs/DEMO_DATA.md", import.meta.url));
const money = (n) => "$" + Number(n).toLocaleString("en-US");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const month = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
const date = (ymd) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;
const hood = (area) => area.replace(/^Waltham, MA \((.*)\)$/, "$1");
const km = (u) => Math.round(kmBetween(u.location, BRANDEIS) * 10) / 10;
const cell = (s) => String(s ?? "").replace(/\|/g, "/");
const shown = DEMO_PEOPLE.filter((p) => p.discoverable);
const cov = coverage(DEMO_LISTINGS, DEMO_PEOPLE);
const sum = summary(cov, DEMO_LISTINGS, DEMO_PEOPLE);
const CONDITION = { rooms: "rooms", budget: "budget", month: "move-in month", area: "area", distance: "distance" };

// ── The 20 searches ──────────────────────────────────────────────────────────
// m(values, mustHaves, flexible): the assistant's memory, as if the renter had said it in the chat. Budget is a
// must-have unless marked flexible, distance too when given, as in the assistant.
const m = (v, must = [], flexible = []) => ({
  v: { looking_for: "room", ...v },
  req: Object.fromEntries([...must.map((f) => [f, true]), ...flexible.map((f) => [f, false])]),
});
const ROOM_SEARCHES = [
  ["Strong", "A room in Waltham from June 2027, up to $1,300, a 12-month lease", m({ budget_max: 1300, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 1, lease_months: 12 })],
  ["Strong", "Furnished, near Brandeis or Warrendale, from August 2027, up to $1,300, 12 months", m({ budget_max: 1300, move_in_month: "2027-08", areas: ["near Brandeis", "Warrendale"], rooms_needed: 1, lease_months: 12, wishes: ["furnished"] })],
  ["Strong", "Academic year from September 2027, Downtown or Moody Street, up to $1,000", m({ budget_max: 1000, move_in_month: "2027-09", areas: ["Downtown", "Moody Street"], rooms_needed: 1, lease_months: 9 })],
  ["Strong", "Two friends: 2 rooms from June 2027, up to $1,400 each, South Side or Moody Street", m({ budget_max: 1400, move_in_month: "2027-06", areas: ["South Side", "Moody Street"], rooms_needed: 2, lease_months: 12 })],
  ["Strong", "Three friends: 3 rooms from June 2027, up to $1,200 each, Downtown", m({ budget_max: 1200, move_in_month: "2027-06", areas: ["Downtown"], rooms_needed: 3, lease_months: 12 })],
  ["Strong", "Furnished spring sublet from January 2027, about 5 months, up to $1,100, Prospect Hill or the Highlands", m({ budget_max: 1100, move_in_month: "2027-01", areas: ["Prospect Hill", "The Highlands"], rooms_needed: 1, lease_months: 5, wishes: ["furnished"] })],
  ["Partial", "From July 2027 in the Highlands (flexible area), up to $1,200, 12 months", m({ budget_max: 1200, move_in_month: "2027-07", areas: ["The Highlands"], rooms_needed: 1, lease_months: 12 })],
  ["Partial", "Near Brandeis from May 2027 (flexible month), up to $1,250", m({ budget_max: 1250, move_in_month: "2027-05", areas: ["near Brandeis"], rooms_needed: 1, lease_months: 12 })],
  ["Partial", "Moody Street from June 2027, up to $1,300, wants furnished", m({ budget_max: 1300, move_in_month: "2027-06", areas: ["Moody Street"], rooms_needed: 1, lease_months: 12, wishes: ["furnished"] })],
  ["Partial", "South Side from June 2027, budget $1,000 but flexible", m({ budget_max: 1000, move_in_month: "2027-06", areas: ["South Side"], rooms_needed: 1, lease_months: 12 }, [], ["budget_max"])],
  ["Partial", "Summer only (3 months) from June 2027, up to $1,050, Waltham", m({ budget_max: 1050, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 1, lease_months: 3 })],
  ["Strict", "Within 1 km of Brandeis (must-have), from August 2027, up to $1,000", m({ budget_max: 1000, move_in_month: "2027-08", max_distance_km: 1, rooms_needed: 1 })],
  ["Strict", "Lakeview only (must-have area), from June 2027, up to $1,100", m({ budget_max: 1100, move_in_month: "2027-06", areas: ["Lakeview"], rooms_needed: 1, lease_months: 12 }, ["areas"])],
  ["Strict", "February 2027 only (must-have month), up to $1,100, about 7 months", m({ budget_max: 1100, move_in_month: "2027-02", rooms_needed: 1, lease_months: 7 }, ["move_in_month"])],
  ["Strict", "Just for me, Downtown only (must-have), from July 2027, up to $1,700, furnished", m({ budget_max: 1700, move_in_month: "2027-07", areas: ["Downtown"], rooms_needed: 1, lease_months: 12, wishes: ["furnished"] }, ["areas"])],
  ["No match", "Up to $600 in Waltham from June 2027", m({ budget_max: 600, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 1 })],
  ["No match", "Within 1 km of Brandeis (must-have), from June 2027 (must-have), up to $800", m({ budget_max: 800, move_in_month: "2027-06", max_distance_km: 1, rooms_needed: 1 }, ["move_in_month"])],
  ["No match", "Four rooms in one place from June 2027, up to $1,200 each", m({ budget_max: 1200, move_in_month: "2027-06", areas: ["Waltham"], rooms_needed: 4 })],
];
const life = (sleep, clean, noise, guests, pets, smoking) => ({ sleep_schedule: sleep, cleanliness: clean, noise, guests, pets, smoking, chores: null });
const ROOMMATE_SEARCHES = [
  ["Strong", "A roommate for June 2027: early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking, $900–$1,300", { area: "Waltham", move_in_month: "2027-06", budget_min: 900, budget_max: 1300, ...life("early", "tidy", "quiet", "sometimes", "ok_with_pets", "no_smoking") }],
  ["No match", "A roommate moving in November 2027 (nobody in the demo data moves then or a month either side)", { area: "Waltham", move_in_month: "2027-11", budget_min: 800, budget_max: 1200, ...life("flexible", "average", "moderate", "sometimes", "ok_with_pets", "no_smoking") }],
];

function roomSearchRow(i, [kind, what, memory]) {
  const found = searchRooms(memory, DEMO_LISTINGS, { limit: DEMO_LISTINGS.length });
  const ex = exclusionCounts(memory, DEMO_LISTINGS);
  const partial = found.totalMatching - found.exactMatching;
  const top = found.results.slice(0, 3).map((r) => `${r.unitId} ${r.name} (${r.match === "exact" ? "matches everything" : `partial: ${r.misses[0]}`})`);
  const hiddenBy = Object.entries(ex.byCondition).filter(([, n]) => n).map(([c, n]) => `${CONDITION[c]} ${n}`).join(", ");
  const must = Object.entries(memory.req).filter(([, on]) => on).map(([f]) => f);
  return [
    `### ${i}. ${kind}: ${what}`,
    "",
    `- **Must-haves:** ${["budget_max", ...(memory.v.max_distance_km != null ? ["max_distance_km"] : []), ...must].filter((f, j, a) => a.indexOf(f) === j && !(memory.req[f] === false)).join(", ") || "none"}${memory.req.budget_max === false ? " (budget flexible)" : ""}; rooms needed always.`,
    `- **Result:** ${found.totalMatching} of ${DEMO_LISTINGS.length} rooms fit the must-haves: ${found.exactMatching} match everything, ${partial} partly.`,
    `- **Hidden by must-haves:** ${ex.hidden} (${hiddenBy || "none"}; a room can fail more than one).`,
    top.length ? `- **First three:** ${top.join("; ")}.` : "- **First three:** none.",
    found.ifRelaxed.length ? `- **Offered, never applied without the renter:** ${found.ifRelaxed.map((o) => `${o.change} (+${o.extraRooms})`).join("; ")}.` : "- **Offered changes:** none needed or none would help.",
    "",
  ].join("\n");
}

function roommateSearchRow(i, [kind, what, me]) {
  const others = shown.map((p) => ({ userId: p.id, prefs: p, firstName: p.firstName, email: null, sample: false, demo: true }));
  const found = searchRoommates({ v: {}, req: {} }, me, others, { limit: others.length });
  const strong = found.results.filter((p) => !p.misses.length).length;
  const reasons = {};
  for (const p of shown) for (const b of roommateBlockers(me, p).slice(0, 1)) reasons[b] = (reasons[b] || 0) + 1;
  const top = found.results.slice(0, 3).map((p) => `${p.userId} ${p.firstName} ${p.score}%`);
  return [
    `### ${i}. ${kind}: ${what}`,
    "",
    `- **Result:** ${found.totalMatching} of ${shown.length} visible profiles are possible roommates: ${strong} strong (90+), ${found.totalMatching - strong} partial. The 3 hidden profiles are never compared.`,
    `- **Not a match (first reason each):** ${Object.entries(reasons).map(([b, n]) => `${BLOCKER_TEXT[b].toLowerCase()} ${n}`).join("; ") || "none"}.`,
    top.length ? `- **First three:** ${top.join("; ")}.` : "- **First three:** none.",
    "",
  ].join("\n");
}

// ── Tables ───────────────────────────────────────────────────────────────────
const perRoom = (u) => cov.perRoom.get(u.id).shown.length;
const listingRows = DEMO_LISTINGS.map(
  (u) =>
    `| ${u.id} | ${cell(u.name)} | ${u.kind} | ${hood(u.area)} | ${km(u)} km | ${money(u.monthly_rent)} ${u.rent_basis === "unit" ? "whole place" : u.kind === "Shared room" ? "per bed" : "per room"} | ${u.rooms_available} of ${u.bedrooms} | ${date(u.move_in_date)} | ${cell(u.lease.label)} | ${u.furnished ? "Furnished" : "Unfurnished"} | ${u.photoKey} | ${perRoom(u)} |`
);
const uses = DEMO_LISTINGS.reduce((acc, u) => ((acc[u.photoKey] = (acc[u.photoKey] || []).concat(u.id)), acc), {});
const ref = "utm_source=cohabit&utm_medium=referral";
const photoRows = Object.entries(PHOTOS).map(
  ([k, p]) => `| ${k} | ${p.kind} | ${cell(p.alt)} | [${cell(p.by)}](https://unsplash.com/@${p.username}?${ref}) | [Photo page](https://unsplash.com/photos/${p.id}?${ref}) | ${(uses[k] || []).join(", ")} |`
);
const LIFE = {
  sleep_schedule: { early: "early", flexible: "flexible sleep", late: "night owl" },
  cleanliness: { tidy: "very tidy", average: "average tidiness", relaxed: "relaxed tidiness" },
  noise: { quiet: "quiet", moderate: "some noise", lively: "lively" },
  guests: { rarely: "guests rarely", sometimes: "guests sometimes", often: "guests often" },
  pets: { no_pets: "no pets", ok_with_pets: "OK with pets", have_pets: "has a pet" },
  smoking: { no_smoking: "no smoking", outside_ok: "smoking outside OK", smoker: "smokes" },
};
const peopleRows = DEMO_PEOPLE.map((p) => {
  const c = cov.perPerson.get(p.id);
  const wants = [`${p.lease_months} mo`, p.rooms_needed > 1 ? `${p.rooms_needed} rooms` : "1 room", p.furnished ? "furnished" : null, p.max_distance_km != null ? `≤${p.max_distance_km} km` : null, ...p.must_haves.map((x) => `must: ${x === "move_in_month" ? "month" : "area"}`)].filter(Boolean).join(", ");
  return `| ${p.id} | ${p.firstName} | ${cell(p.program)} | ${cell(p.looking_in.join(", ") || `within ${p.max_distance_km} km`)} | ${month(p.move_in_month)} | ${money(p.budget_min)}–${money(p.budget_max)} | ${wants} | ${Object.keys(LIFE).map((f) => LIFE[f][p[f]]).join(", ")} | ${c.rooms.length} | ${c.mates.length} | ${p.discoverable ? "Yes" : "No (never shown)"} |`;
});

const kinds = DEMO_LISTINGS.reduce((acc, u) => ((acc[u.kind] = (acc[u.kind] || 0) + 1), acc), {});
const hoods = DEMO_LISTINGS.reduce((acc, u) => ((acc[hood(u.area)] = (acc[hood(u.area)] || 0) + 1), acc), {});
const casey = rankUnits({ budget_min: 900, budget_max: 1300, move_in_month: "2027-06", area: "Waltham", rooms_needed: 1 }, DEMO_LISTINGS, 100);
const offMonth = casey.filter((x) => Math.abs((Number(x.unit.move_in_date.slice(0, 4)) - 2027) * 12 + Number(x.unit.move_in_date.slice(5, 7)) - 6) > 1).length;

const doc = `# Demo data (Demo mode)

Demo mode lets anyone try coHabit with made-up listings and roommates. This file is written by
\`npm run demo:report\` (scripts/demo-report.mjs) from the data itself, so the numbers below are the data's.

- **What:** ${DEMO_LISTINGS.length} fictional room listings and ${DEMO_PEOPLE.length} fictional roommate profiles, all in Waltham
  (${shown.length} profiles shown; ${DEMO_PEOPLE.length - shown.length} chose not to be found, which shows that rule working).
- **Where it lives:** in code, never in the database: the first 15 listings and 20 profiles are written by hand in
  [\`src/assistant/demo-base.js\`](../src/assistant/demo-base.js); the other ${DEMO_LISTINGS.length - 15} listings and ${DEMO_PEOPLE.length - 20} profiles are written to
  [\`src/assistant/demo-generated.js\`](../src/assistant/demo-generated.js) by [\`scripts/demo-build.mjs\`](../scripts/demo-build.mjs). Every id starts with \`demo-\`.
- **Where it shows:** only while Demo mode is on, always labeled Demo: Listings (all demo listings with filters, map, Details
  and Save), My matches (demo rooms and roommates that fit your saved preferences, plus "Browse all demo profiles"), the
  demo profile page (\`/demo/people\`) and the assistant. Never in real listings, real matches, requests, the admin user
  list or any count.
- **One switch:** a renter's Demo mode is saved on the server, so Listings, My matches and the assistant always agree;
  switching never touches chats, answers, preferences, requests or real saved options. For guests and landlords it's
  remembered in their browser only.
- **Safety:** no real places, people, addresses or contact details, and no sign-in accounts for anyone fictional. A request
  to a demo listing or profile is a preview that says "Demo only, nothing sent"; nothing is sent and nobody is notified.
  Locations are made-up points shown as 500 m approximate areas. There is no gender field, so it can't affect matching.
- **Matching:** coHabit's own matching code, unchanged except for two bug fixes (below). Nothing in the demo data scores
  anything itself.

## Managing it

| Task | How |
| --- | --- |
| Rebuild the generated part | \`npm run demo:build\` (the same output every time: fixed seeds, no clock) |
| Check it (repeatable, targets met) | \`npm run demo:check\`: fails if the file differs from what the script builds or a target is missed; \`npm test\` runs the same checks |
| Rewrite this file | \`npm run demo:report\` |
| Turn Demo mode off everywhere | Set the Worker variable \`DEMO_DATA=off\` (the switch disappears, \`/api/demo/*\` answers 404, nothing else changes) |
| Remove demo records from the database | The only ones are renters' saved demo cards (bookmarks to demo ids). Admin page, "Remove saved demo cards", or \`POST /api/admin/demo/cleanup\` with \`{"confirm":"REMOVE"}\`. Real saved options are never touched; the action is recorded in \`admin_audit\`. |
| Remove the demo data itself | Delete it from the two files above and deploy; nothing in the database depends on it |

No seeding into the database, so it can't be duplicated. Check-in answers given in Demo mode are labeled \`demo\` and can be
left out of results (admin survey page).

## Coverage (checked with the matching code)

Definitions (in [\`scripts/demo-coverage.mjs\`](../scripts/demo-coverage.mjs)):

- **A room suits a profile** when the assistant's room search returns it as matching everything for that profile's own
  answers: within budget (split for a whole place), enough rooms, available in the move-in month or a month earlier, in one
  of their areas, within their distance, a lease within a month of what they want, furnished if they asked. Their own
  must-haves apply; nothing is loosened.
- **Two profiles are mutually compatible roommates** when the roommate matching code says they're a possible match (shared
  area, move-in within a month, no pet or smoking dealbreaker, score 60+) and, checked both ways, their budgets overlap,
  their leases are within a month, a must-have move-in month means the same month, and a must-have area is shared. Only
  profiles that chose to be found count as candidates.

| Target | Result (min / median / max) |
| --- | --- |
| Each profile has 3+ suitable rooms | ${sum.roomsPerProfile.min} / ${sum.roomsPerProfile.median} / ${sum.roomsPerProfile.max} rooms per profile (plus ${sum.partialRoomsPerProfile.median} partial matches at the median) |
| Each profile has 3+ mutually compatible roommates | ${sum.matesPerProfile.min} / ${sum.matesPerProfile.median} / ${sum.matesPerProfile.max} (the matching code alone allows ${sum.engineMatesPerProfile.min} / ${sum.engineMatesPerProfile.median} / ${sum.engineMatesPerProfile.max}) |
| Each room suits 3+ demo renters | ${sum.rentersPerRoom.min} / ${sum.rentersPerRoom.median} / ${sum.rentersPerRoom.max} visible profiles per room |
| Targets missed | ${sum.failures.length} |

Not everyone matches everyone. Of the ${Object.values(sum.pairReasons).reduce((a, b) => a + b, 0).toLocaleString("en-US")} reasons counted across pairs of visible profiles
(a pair can have several), ${(sum.pairReasons.compatible || 0).toLocaleString("en-US")} pairs are compatible; the rest fail on:
${Object.entries(sum.pairReasons)
  .filter(([k]) => k !== "compatible")
  .sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `${(BLOCKER_TEXT[k] || MUTUAL_TEXT[k]).toLowerCase()} (${n.toLocaleString("en-US")})`)
  .join(", ")}.

Listings by kind: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(", ")}. By neighborhood: ${Object.entries(hoods).map(([k, n]) => `${k} ${n}`).join(", ")}.

How coverage is reached without bending rules: the data is built in groups of people who want the same thing (month,
lease, neighborhoods, furnishing, rooms), with rooms made for each group; rents are set so each room is within budget for
at least three of them and each person can afford at least three rooms. Lifestyles are drawn at random per group and
redrawn for anyone left with fewer than three compatible people. Groups overlap where answers line up.

## Bugs found and fixed

1. **My matches hid whole apartments from people moving in together.** It compared a whole place's rent with one
   person's budget (a $2,700 two-bedroom against a $1,400 budget). It now splits a whole place's rent across the rooms
   needed, up to its bedrooms, as the assistant already did (\`src/match.js\`). Real coHabit units are priced per room,
   so their matches don't change.
2. **"Unfurnished" counted as wanting furnished.** The assistant treated any wish containing "furnish" as wanting a
   furnished place. A wish for unfurnished now prefers unfurnished places (\`src/assistant/search.js\`).
3. **Saving was blocked for demo cards,** so Save didn't work in Demo mode. Demo cards can now be saved from any page and
   show under Saved only in Demo mode.

## Found, not changed (owner's decision)

- **My matches lets a listing through without the right month when it's in your area.** Its rule shows a room scoring 70+,
  and within budget (40) + in your area (25) + enough rooms (15) = 80, so the move-in month doesn't matter then. With the
  area "Waltham", every Waltham listing is "in your area": for a June renter with a $1,300 budget, ${casey.length} of ${DEMO_LISTINGS.length} demo
  listings match, ${offMonth} of them more than a month from June (all at 80%). The assistant doesn't do this (it needs the month
  within a month, or within three months when the month is flexible). This is the documented rule in \`src/match.js\` and
  affects real matches too, so it's left as is; requiring the month within a month would fix it.

## 20 representative searches

Room searches use the assistant's search with the answers shown (budget a must-have unless flexible; a distance is a
must-have when given; area and month flexible unless marked). "Partly" means the room meets every must-have but misses
something flexible, and the card says what. Roommate searches compare the answers with the ${shown.length} visible profiles.

${ROOM_SEARCHES.map((s, i) => roomSearchRow(i + 1, s)).join("\n")}
${ROOMMATE_SEARCHES.map((s, i) => roommateSearchRow(ROOM_SEARCHES.length + i + 1, s)).join("\n")}
## Listings

"Suits" counts the visible demo profiles for whom the room matches everything.

| Id | Name | Kind | Area | From Brandeis | Rent | Rooms free | Available | Lease | Furnishing | Photo | Suits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${listingRows.join("\n")}

## Listing photos (sources and licenses)

Illustrative stock photos of ordinary rooms; none shows the listing it's on or any real Waltham property, and each is
labeled "Illustrative demo photo" with a credit in Details. All are free photos under the
[Unsplash License](https://unsplash.com/license) (not Unsplash+), each checked on its photo page (the first 15 on
2026-10-14, the other 26 on 2026-10-17). They load from Unsplash's image server, resized for the card or dialog; nothing
is downloaded into this project, and if a photo can't load the card shows coHabit's drawing instead. Furnished rooms use
bedroom photos, unfurnished places empty rooms, kitchens or living rooms, studios studio photos and shared rooms photos
with two beds. No photo is used for more than three listings.

| Key | Kind | What it shows | Photographer | Source | Used by |
| --- | --- | --- | --- | --- | --- |
${photoRows.join("\n")}

## Roommate profiles

Fictional seniors and graduate students. Avatars are illustrations drawn by coHabit's own code from a few settings, not
photos or likenesses of anyone. No contact details, references, verification or testimonials. "Rooms" counts rooms that
match everything for them; "Roommates" counts visible profiles mutually compatible with them.

| Id | Name | Program | Looking in | Move-in | Budget | Wants | Lifestyle | Rooms | Roommates | Shown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${peopleRows.join("\n")}
`;
writeFileSync(OUT, doc);
console.log(`Wrote ${OUT} (${doc.length} characters).`);
