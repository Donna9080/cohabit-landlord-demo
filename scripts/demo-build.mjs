// Builds the generated part of the Demo mode data (src/assistant/demo-generated.js): 85 listings and 180 roommate
// profiles around the 15 listings and 20 profiles written by hand in src/assistant/demo-base.js, for 100 and 200 in
// all, every one in Waltham. Then checks the coverage targets with coHabit's own matching code
// (scripts/demo-coverage.mjs) and stops with an error if any is missed.
//
//   node scripts/demo-build.mjs           write the file (the same output every time: fixed seeds, no clock)
//   node scripts/demo-build.mjs --check   rebuild in memory, fail if the file differs or a target is missed
//
// How coverage is reached without bending any rule: the data is built in groups ("cohorts") of people who want the
// same thing (move-in month, lease length, neighborhoods, furnished or not, rooms), with rooms made for that group.
// Each room's rent is within the budget of at least three of them and each person can afford at least three of the
// rooms. Lifestyles are drawn at random per group; anyone left with fewer than three compatible people is drawn
// again. People in different groups still match each other where their answers line up, and many don't.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { HAND_LISTINGS, HAND_PEOPLE, HOODS, PHOTOS } from "../src/assistant/demo-base.js";
import { asListing, asPerson } from "../src/assistant/demo-data.js";
import { BRANDEIS, kmBetween } from "../src/assistant/search.js";
import { coverage, mutualBlockers, summary, TARGET } from "./demo-coverage.mjs";

const OUT = fileURLToPath(new URL("../src/assistant/demo-generated.js", import.meta.url));

// ── Deterministic randomness ─────────────────────────────────────────────────
function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h;
}
function rng(seed) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const chance = (r, p) => r() < p;
const weighted = (r, weights) => {
  const entries = Object.entries(weights);
  let x = r() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((x -= w) < 0) return k;
  return entries.at(-1)[0];
};
const shuffle = (r, list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const step50 = (r, lo, hi) => {
  const a = Math.ceil(lo / 50);
  const b = Math.floor(hi / 50);
  return 50 * (b <= a ? a : a + Math.floor(r() * (b - a + 1)));
};
const ceil50 = (n) => Math.ceil(n / 50) * 50;
const floor50 = (n) => Math.floor(n / 50) * 50;

// ── The groups ───────────────────────────────────────────────────────────────
// rooms: [kind, hood, rent, available from, lease months, furnished, rooms available, bedrooms]. Rent is per room,
// except for studios and whole apartments (the whole place). vibe: how the group tends to live. levels: who they are.
const COHORTS = [
  { key: "A", month: "2027-01", lease: 5, areas: ["PH", "HL"], furnished: true, need: 1, add: 5, vibe: "quiet", levels: { phd: 3, masters: 2, senior: 1 }, story: "spring",
    hand: { rooms: ["demo-04"], people: ["demo-p12"] },
    rooms: [["Sublet", "PH", 900, "2027-01-01", 5, true, 1, 3], ["Private room", "HL", 1000, "2027-01-15", 5, true, 1, 4], ["Sublet", "PH", 1050, "2026-12-15", 6, true, 1, 4]] },
  { key: "B", month: "2027-01", lease: 5, areas: ["NB", "WD"], furnished: true, need: 1, add: 7, vibe: "mixed", levels: { phd: 2, masters: 3, senior: 2 }, story: "spring",
    hand: { rooms: [], people: [] },
    rooms: [["Sublet", "NB", 1000, "2027-01-01", 5, true, 1, 4], ["Sublet", "WD", 950, "2027-01-15", 4, true, 1, 3], ["Private room", "NB", 1150, "2027-01-01", 6, true, 1, 3]] },
  { key: "C", month: "2027-02", lease: 7, areas: ["WD", "NB"], furnished: null, need: 1, add: 6, vibe: "mixed", levels: { masters: 3, phd: 2, senior: 1 }, story: "takeover",
    hand: { rooms: ["demo-05"], people: [] },
    rooms: [["Lease takeover", "NB", 1050, "2027-02-01", 7, true, 1, 3], ["Lease takeover", "WD", 1000, "2027-01-15", 8, true, 1, 4]] },
  { key: "D", month: "2027-05", lease: 12, areas: ["NB", "WD"], furnished: null, need: 1, add: 6, vibe: "quiet", levels: { masters: 3, phd: 3, senior: 1 }, story: "may",
    hand: { rooms: [], people: ["demo-p08"] },
    rooms: [["Private room", "NB", 1200, "2027-05-01", 12, false, 1, 3], ["Private room", "WD", 1100, "2027-05-15", 12, true, 1, 4], ["Private room", "NB", 1250, "2027-04-15", 12, true, 1, 3], ["Replacing a roommate", "WD", 1050, "2027-05-01", 12, false, 1, 4]] },
  { key: "E", month: "2027-06", lease: 3, areas: ["MS", "SS"], furnished: true, need: 1, add: 7, vibe: "social", levels: { masters: 3, senior: 2, phd: 2 }, story: "summer",
    hand: { rooms: ["demo-12"], people: [] },
    rooms: [["Sublet", "SS", 950, "2027-06-01", 3, true, 1, 3], ["Sublet", "MS", 1000, "2027-05-15", 3, true, 1, 4], ["Sublet", "SS", 850, "2027-06-01", 2, true, 1, 3]] },
  { key: "F", month: "2027-06", lease: 3, areas: ["NB", "WD"], furnished: null, need: 1, add: 6, vibe: "mixed", levels: { phd: 3, senior: 2, masters: 1 }, story: "summerResearch",
    hand: { rooms: ["demo-07"], people: [] },
    rooms: [["Sublet", "NB", 1000, "2027-06-01", 3, true, 1, 4], ["Sublet", "WD", 900, "2027-06-01", 4, false, 1, 3]] },
  { key: "G", month: "2027-06", lease: 12, areas: ["NB", "WD"], furnished: null, need: 1, add: 9, vibe: "quiet", levels: { phd: 4, masters: 3, senior: 2 }, story: "june12",
    hand: { rooms: [], people: ["demo-p01", "demo-p09", "demo-p16"] },
    rooms: [["Private room", "NB", 1150, "2027-06-01", 12, true, 1, 4], ["Private room", "WD", 1050, "2027-06-01", 12, false, 1, 3], ["Private room", "NB", 1300, "2027-06-01", 12, true, 1, 3], ["Replacing a roommate", "WD", 1000, "2027-05-15", 12, false, 1, 4], ["Private room", "NB", 1250, "2027-06-15", 12, false, 1, 2]] },
  { key: "H", month: "2027-06", lease: 12, areas: ["MS", "SS"], furnished: null, need: 1, add: 6, vibe: "mixed", levels: { masters: 3, phd: 2, senior: 2 }, story: "june12",
    hand: { rooms: ["demo-01", "demo-02"], people: ["demo-p02", "demo-p05", "demo-p13", "demo-p17"] },
    rooms: [["Private room", "SS", 950, "2027-06-01", 12, true, 1, 3], ["Private room", "MS", 1000, "2027-05-15", 12, false, 1, 4], ["Private room", "SS", 1250, "2027-06-01", 12, true, 1, 3]] },
  { key: "I", month: "2027-06", lease: 12, areas: ["MS", "DT"], furnished: null, need: 1, add: 7, vibe: "social", levels: { senior: 3, masters: 2, mba: 2 }, story: "june12",
    hand: { rooms: [], people: ["demo-p04", "demo-p11", "demo-p07"] },
    rooms: [["Private room", "DT", 1000, "2027-06-01", 12, true, 1, 4], ["Private room", "MS", 1100, "2027-06-01", 12, false, 1, 3], ["Replacing a roommate", "DT", 950, "2027-06-01", 12, false, 1, 5], ["Private room", "MS", 1300, "2027-06-01", 12, true, 1, 3]] },
  { key: "J", month: "2027-06", lease: 12, areas: ["SS", "MS"], furnished: null, need: 2, add: 7, vibe: "mixed", levels: { masters: 3, phd: 2, senior: 2 }, story: "pair",
    hand: { rooms: ["demo-06"], people: [] },
    rooms: [["Whole apartment", "MS", 2600, "2027-06-01", 12, false, 2, 2], ["Whole apartment", "SS", 2800, "2027-06-01", 12, false, 2, 2], ["Private room", "MS", 1250, "2027-06-01", 12, false, 2, 4]] },
  { key: "K", month: "2027-06", lease: 12, areas: ["DT", "MS"], furnished: null, need: 3, add: 6, vibe: "social", levels: { senior: 4, masters: 2 }, story: "trio",
    hand: { rooms: ["demo-10"], people: [] },
    rooms: [["Whole apartment", "MS", 3300, "2027-06-01", 12, false, 3, 3], ["Whole apartment", "DT", 3600, "2027-05-15", 12, false, 3, 3], ["Private room", "DT", 1050, "2027-06-01", 12, false, 3, 5]] },
  { key: "L", month: "2027-07", lease: 12, areas: ["DT", "MS"], furnished: null, need: 1, add: 9, vibe: "mixed", levels: { senior: 3, masters: 3, phd: 2 }, story: "july12",
    hand: { rooms: [], people: ["demo-p03"] },
    rooms: [["Private room", "DT", 1100, "2027-07-01", 12, true, 1, 3], ["Private room", "MS", 1150, "2027-07-01", 12, true, 1, 4], ["Private room", "DT", 1000, "2027-06-15", 12, false, 1, 4], ["Lease takeover", "MS", 1200, "2027-07-01", 12, false, 1, 3]] },
  { key: "M", month: "2027-07", lease: 12, areas: ["HL", "PH"], furnished: null, need: 1, add: 6, vibe: "quiet", levels: { phd: 3, masters: 3, senior: 1 }, story: "july12",
    hand: { rooms: ["demo-11"], people: ["demo-p20"] },
    rooms: [["Private room", "HL", 1100, "2027-07-01", 12, true, 1, 3], ["Private room", "PH", 1050, "2027-07-15", 12, false, 1, 4], ["Private room", "HL", 1250, "2027-06-15", 12, true, 1, 3]] },
  { key: "N", month: "2027-07", lease: 12, areas: ["DT", "MS"], furnished: null, need: 1, add: 5, vibe: "quiet", levels: { mba: 2, phd: 2, masters: 1 }, story: "soloHigh",
    hand: { rooms: ["demo-03"], people: [] },
    rooms: [["Studio", "MS", 1550, "2027-07-01", 12, true, 1, 1], ["Studio", "DT", 1700, "2027-07-01", 12, false, 1, 1]] },
  { key: "O", month: "2027-08", lease: 12, areas: ["NB", "WD"], furnished: true, need: 1, add: 9, vibe: "quiet", levels: { masters: 5, phd: 3 }, story: "augIncoming",
    hand: { rooms: ["demo-09"], people: ["demo-p14"] },
    rooms: [["Private room", "NB", 1200, "2027-08-01", 12, true, 1, 3], ["Private room", "WD", 1150, "2027-08-15", 12, true, 1, 4], ["Private room", "NB", 1250, "2027-07-15", 12, true, 1, 3]] },
  { key: "P", month: "2027-08", lease: 12, areas: ["NB", "WD"], furnished: null, need: 1, add: 10, vibe: "social", levels: { senior: 5, masters: 3, phd: 2 }, story: "aug12",
    hand: { rooms: ["demo-14"], people: [] },
    rooms: [["Private room", "WD", 950, "2027-08-01", 12, true, 1, 4], ["Replacing a roommate", "NB", 900, "2027-08-01", 12, false, 1, 5], ["Shared room", "NB", 700, "2027-08-15", 12, true, 1, 3], ["Private room", "WD", 1000, "2027-07-15", 12, false, 1, 3]] },
  { key: "Q", month: "2027-08", lease: 12, areas: ["HL", "PH"], furnished: null, need: 1, add: 9, vibe: "quiet", levels: { phd: 4, masters: 3, senior: 1 }, story: "aug12",
    hand: { rooms: ["demo-13"], people: ["demo-p06"] },
    rooms: [["Private room", "HL", 1100, "2027-08-01", 12, true, 1, 3], ["Private room", "PH", 1050, "2027-08-15", 12, false, 1, 4], ["Private room", "HL", 1200, "2027-07-15", 12, true, 1, 3], ["Lease takeover", "PH", 1150, "2027-08-01", 12, false, 1, 3]] },
  { key: "R", month: "2027-08", lease: 12, areas: ["NB", "WD"], furnished: null, need: 2, add: 7, vibe: "mixed", levels: { masters: 3, phd: 3, senior: 1 }, story: "pair",
    hand: { rooms: [], people: [] },
    rooms: [["Whole apartment", "NB", 2500, "2027-08-01", 12, false, 2, 2], ["Whole apartment", "WD", 2400, "2027-08-15", 12, false, 2, 2], ["Private room", "NB", 1100, "2027-08-01", 12, false, 2, 4], ["Whole apartment", "WD", 2600, "2027-07-15", 12, false, 2, 2]] },
  { key: "S", month: "2027-09", lease: 9, areas: ["DT", "MS"], furnished: null, need: 1, add: 11, vibe: "social", levels: { senior: 8, masters: 2, phd: 1 }, story: "sep9",
    hand: { rooms: ["demo-08"], people: ["demo-p10", "demo-p19"] },
    rooms: [["Private room", "DT", 950, "2027-09-01", 9, true, 1, 4], ["Private room", "MS", 1050, "2027-09-01", 9, false, 1, 4], ["Shared room", "MS", 750, "2027-09-01", 9, true, 1, 3], ["Private room", "DT", 1150, "2027-08-15", 10, true, 1, 3], ["Replacing a roommate", "MS", 900, "2027-09-01", 9, false, 1, 5], ["Private room", "DT", 800, "2027-09-01", 9, false, 1, 5]] },
  { key: "T", month: "2027-09", lease: 12, areas: ["DT", "PH"], furnished: null, need: 1, add: 9, vibe: "mixed", levels: { masters: 4, phd: 3, mba: 1 }, story: "sep12",
    hand: { rooms: [], people: ["demo-p15"] },
    rooms: [["Private room", "DT", 1250, "2027-09-01", 12, false, 1, 3], ["Private room", "PH", 1150, "2027-09-01", 12, true, 1, 4], ["Private room", "DT", 1350, "2027-08-15", 12, true, 1, 3], ["Lease takeover", "PH", 1200, "2027-09-01", 12, false, 1, 3]] },
  { key: "U", month: "2027-09", lease: 12, areas: ["LV", "HL"], furnished: null, need: 1, add: 6, vibe: "quiet", levels: { phd: 4, masters: 2 }, story: "soloHigh",
    hand: { rooms: ["demo-15"], people: [] },
    rooms: [["Studio", "HL", 1600, "2027-09-01", 12, false, 1, 1], ["Whole apartment", "LV", 1850, "2027-08-15", 12, false, 1, 1], ["Private room", "LV", 1150, "2027-09-01", 12, false, 1, 3]] },
  { key: "V", month: "2027-09", lease: 12, areas: ["NB", "WD"], furnished: null, need: 1, add: 10, vibe: "mixed", levels: { masters: 4, phd: 3, senior: 2 }, story: "sep12",
    hand: { rooms: [], people: [] },
    rooms: [["Private room", "NB", 1100, "2027-09-01", 12, true, 1, 4], ["Private room", "WD", 1000, "2027-09-01", 12, false, 1, 3], ["Private room", "NB", 1200, "2027-08-15", 12, true, 1, 3], ["Replacing a roommate", "WD", 950, "2027-09-01", 12, false, 1, 4]] },
  { key: "W", month: "2027-06", lease: 12, areas: ["LV", "PH"], furnished: null, need: 1, add: 5, vibe: "mixed", levels: { senior: 3, masters: 2, phd: 1 }, story: "june12",
    hand: { rooms: [], people: ["demo-p18"] },
    rooms: [["Private room", "LV", 1000, "2027-06-01", 12, true, 1, 4], ["Private room", "PH", 1100, "2027-06-01", 12, false, 1, 3], ["Replacing a roommate", "LV", 950, "2027-05-15", 12, false, 1, 4]] },
  { key: "X", month: "2027-09", lease: 12, areas: ["DT", "SS"], furnished: null, need: 2, add: 6, vibe: "mixed", levels: { masters: 3, mba: 1, phd: 2 }, story: "pair",
    hand: { rooms: [], people: [] },
    rooms: [["Whole apartment", "DT", 2500, "2027-09-01", 12, false, 2, 2], ["Whole apartment", "SS", 2650, "2027-09-01", 12, false, 2, 2], ["Private room", "SS", 1200, "2027-08-15", 12, false, 2, 4]] },
  { key: "Y", month: "2027-08", lease: 9, areas: ["NB", "WD"], furnished: null, need: 1, add: 6, vibe: "social", levels: { senior: 5, masters: 1 }, story: "aug9",
    hand: { rooms: [], people: [] },
    rooms: [["Private room", "NB", 1000, "2027-08-15", 9, true, 1, 4], ["Private room", "WD", 950, "2027-08-01", 10, false, 1, 3], ["Shared room", "NB", 750, "2027-08-15", 9, true, 1, 3]] },
];

// ── Words ────────────────────────────────────────────────────────────────────
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const NUM = ["zero", "one", "two", "three", "four", "five", "six"];
const ORD = ["zeroth", "first", "second", "third", "fourth", "fifth", "sixth"];
const cap = (s) => s[0].toUpperCase() + s.slice(1);

const IN = {
  NB: ["near campus", "a short walk from campus", "near the Brandeis stop"],
  WD: ["in Warrendale"],
  MS: ["off Moody Street", "near Moody Street", "by the Riverwalk"],
  SS: ["on the South Side"],
  DT: ["downtown", "near Waltham Common", "near the commuter rail"],
  HL: ["in the Highlands"],
  PH: ["on Prospect Hill", "near Prospect Hill Park"],
  LV: ["near Hardy Pond", "in Lakeview"],
};
const TRANSIT = {
  NB: ["5-minute walk to campus", "8-minute walk to campus; the Brandeis/Roberts commuter rail stop is nearby", "10-minute walk to campus"],
  WD: ["About 12 minutes' walk to campus; MBTA bus on Main Street", "5 minutes by bike to campus; MBTA bus on Main Street"],
  MS: ["Walk to Moody Street; about 10 minutes by bike to campus", "10-minute walk to the Waltham commuter rail stop; about 10 minutes by bike to campus"],
  SS: ["MBTA bus on Main Street; about 10 minutes by bike to campus", "7-minute walk to Moody Street; about 10 minutes by bike to campus"],
  DT: ["5-minute walk to the Waltham commuter rail stop and Main Street buses; about 12 minutes by bike to campus", "Buses on Main Street; about 12 minutes by bike to campus"],
  HL: ["About 10 minutes by bike to campus; buses on Main Street", "About 10 minutes by bike to campus; quiet side streets"],
  PH: ["About 15 minutes by bike to campus, uphill on the way home", "Near Prospect Hill Park; about 15 minutes by bike to campus"],
  LV: ["About 15 minutes by bike to campus; a car helps for groceries", "Near Hardy Pond; about 15 minutes by bike to campus"],
};
const HOUSEMATES = {
  1: ["a grad student", "a lab technician", "a nurse who works nights", "a quiet postdoc"],
  2: ["two grad students", "two seniors", "a grad student and a nurse", "a PhD student and a teacher", "two young professionals"],
  3: ["three grad students", "three seniors", "two grad students and a nurse", "three easygoing housemates"],
  4: ["four seniors", "four grad students", "four easygoing housemates"],
};
const FEATURES = [
  "Shared kitchen with a dishwasher.", "Small backyard and a porch.", "Big windows and wood floors.", "Quiet street close to buses.",
  "Bike storage in the basement.", "Shared living room with a big table.", "Off-street parking for one car.", "Sunny kitchen and a small garden.",
  "Hardwood floors and a big closet.", "A porch that gets afternoon sun.",
];
const LAUNDRY = ["Washer and dryer in the basement", "Washer and dryer in the apartment", "Laundry room in the building", "Coin laundry in the building", "Laundromat a few minutes' walk away", "Shared laundry in the basement", "Free washer and dryer in the basement"];

function leaseRange(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const mid = d >= 15;
  const endIdx = m - 1 + months - (mid ? 0 : 1);
  const endY = y + Math.floor(endIdx / 12);
  const start = `${mid ? "mid-" : ""}${MONTH_NAMES[m - 1]}`;
  const end = `${mid ? "mid-" : ""}${MONTH_NAMES[endIdx % 12]}`;
  return endY === y ? `${start} to ${end} ${y}` : `${start} ${y} to ${end} ${endY}`;
}
function leaseLabel(kind, date, months) {
  const m = Number(date.slice(5, 7));
  const from = `${Number(date.slice(8, 10)) >= 15 ? "mid-" : ""}${MONTH_NAMES[m - 1]}`;
  const range = leaseRange(date, months);
  if (kind === "Sublet") return months <= 4 && m >= 5 && m <= 7 ? `Summer sublet, ${range}` : m === 12 || m <= 2 ? `Spring sublet, ${range}` : `Sublet, ${range}`;
  if (kind === "Lease takeover") return `Lease takeover, ${range}`;
  if (kind === "Replacing a roommate") return months >= 12 ? `Join the group's lease, ${range}` : `Join the current lease, ${range}`;
  if (months === 9) return `Academic-year lease, ${range}`;
  if (months === 12) return `12-month lease from ${from}`;
  return `${cap(NUM[months] || String(months))}-month lease, ${range}`;
}
function utilities(r, kind, beds) {
  if (kind === "Sublet") return pick(r, ["Utilities and internet included", "Utilities included"]);
  if (kind === "Studio" || kind === "Whole apartment") return pick(r, ["Heat and hot water included", "All utilities extra", "Heat included; electricity and internet extra"]);
  const ways = NUM[beds];
  return pick(r, [`Utilities split ${ways} ways`, `Heat and hot water included; electricity split ${ways} ways`, "Utilities included", "Utilities and internet included", `Utilities and internet split ${ways} ways`]);
}

function roomName(r, kind, hood, furnished, avail, beds, months, date, used) {
  const where = IN[hood];
  const m = Number(date.slice(5, 7));
  let options;
  if (kind === "Shared room") options = ["Shared bedroom", "Bed in a shared room", "Shared room for budget savers"];
  else if (kind === "Studio") options = furnished ? ["Furnished studio", "Small furnished studio"] : ["Studio", "Compact studio", "Bright studio"];
  else if (kind === "Whole apartment") options = beds === 1 ? ["Whole one-bedroom", "Quiet one-bedroom"] : [`Whole ${NUM[beds]}-bedroom`, `${cap(NUM[beds])}-bedroom apartment`];
  else if (kind === "Sublet") options = months <= 4 && m >= 5 && m <= 7 ? ["Summer sublet", "Furnished summer sublet", "Summer room"] : m === 12 || m <= 2 ? ["Spring sublet", "Spring semester sublet"] : ["Sublet"];
  else if (kind === "Lease takeover") options = ["Lease takeover", "Take over a lease", "Room to take over"];
  else if (kind === "Replacing a roommate") {
    // The place goes in the middle: "Housemates near Hardy Pond need a fourth".
    for (const w of shuffle(r, where))
      for (const o of shuffle(r, [`Housemates ${w} need a ${ORD[beds]}`, `Group house ${w} needs a ${ORD[beds]}`, `Join a friendly house ${w}`])) if (!used.has(o)) return o;
    options = ["Join a house"];
  }
  else if (avail > 1) options = [`${cap(NUM[avail])} rooms in a ${NUM[beds]}-bedroom`, `${cap(NUM[avail])} open rooms`];
  else if (furnished) options = ["Furnished room", "Furnished room with a desk", "Bright furnished room", "Furnished corner room"];
  else options = [`Room in a ${NUM[beds]}-bedroom`, "Sunny room", "Quiet room", "Large room", "Top-floor room", "Corner room", "Room with a bay window", "Second-floor room"];
  for (const o of shuffle(r, options)) for (const w of shuffle(r, where)) if (!used.has(`${o} ${w}`)) return `${o} ${w}`;
  for (const o of ["Bright", "Roomy", "Cozy", "Light-filled"]) for (const w of where) if (!used.has(`${o} ${kind.toLowerCase()} ${w}`)) return `${o} ${kind.toLowerCase()} ${w}`;
  throw new Error(`No name left for ${kind} ${hood}`);
}

function roomDescription(r, kind, hood, furnished, avail, beds, months, date) {
  const others = beds - avail;
  const mates = others > 0 ? pick(r, HOUSEMATES[Math.min(others, 4)]) : "";
  const place = beds >= 4 || chance(r, 0.5) ? "house" : "apartment";
  const feature = pick(r, FEATURES);
  const m = Number(date.slice(5, 7));
  let main;
  if (kind === "Shared room") main = "One bed in a large bedroom shared with one other student. The price is for one bed.";
  else if (kind === "Studio")
    main = `${pick(r, ["Compact", "Bright", "Quiet"])} studio with a kitchenette${furnished ? ", a bed and a small table" : ""}, on the ${pick(r, ["first", "second", "top"])} floor of a ${pick(r, ["two-family house", "small building", "walk-up"])}.`;
  else if (kind === "Whole apartment")
    main =
      beds === 1
        ? `Quiet unfurnished one-bedroom ${pick(r, ["in a two-family house", "on a residential street"])}. Good for one person.`
        : beds === 2
          ? `Unfurnished two-bedroom with a living room and ${pick(r, ["a porch", "a big kitchen", "two similar bedrooms"])}. Best for two people moving in together.`
          : `Unfurnished three-bedroom over two floors with ${pick(r, ["a big kitchen", "a backyard", "a porch"])}. For a group of three moving in together.`;
  else if (kind === "Sublet") {
    const when = m >= 5 && m <= 7 ? "for the summer" : m === 12 || m <= 2 ? "for the spring" : "for a few months";
    const why = pick(r, m >= 5 && m <= 7 ? ["do fieldwork", "intern in New York", "teach abroad"] : ["study abroad", "do fieldwork", "teach abroad"]);
    main = furnished
      ? `A ${pick(r, ["grad student", "senior"])}'s furnished room is free ${when} while they ${why}. ${cap(mates || "the housemates")} ${/^(a|one) /.test(mates) && !/ and /.test(mates) ? "is" : "are"} around ${when === "for the summer" ? "all summer" : "the whole time"}.`
      : `A senior's room is free ${when} while they ${why}. It's unfurnished, so bring your own things.`;
  } else if (kind === "Lease takeover")
    main = `The current tenant is ${pick(r, ["moving for a job", "graduating early", "moving in with a partner", "transferring"])}. Take over their ${furnished ? "furnished" : "unfurnished"} room and the rest of the lease${months >= 12 ? "; the landlord is open to renewing" : ""}.`;
  else if (kind === "Replacing a roommate")
    main = `${cap(mates || "the housemates")} replacing a housemate who's ${pick(r, ["graduating", "moving out", "starting a job in another city"])}. ${pick(r, ["They cook together on Sundays.", "They keep a chore chart.", "Quiet on weeknights, social on weekends.", "They share groceries for basics."])}`;
  else if (avail > 1)
    main = `${cap(NUM[avail])} unfurnished rooms open in a ${NUM[beds]}-bedroom ${place}${mates ? ` with ${mates}` : ""}. Good for friends moving in together.`;
  else main = furnished ? `Furnished room (bed, desk and dresser) in a ${NUM[beds]}-bedroom ${place}${mates ? `, shared with ${mates}` : ""}.` : `Unfurnished room in a ${NUM[beds]}-bedroom ${place}${mates ? ` with ${mates}` : ""}.`;
  const withFeature = `${main} ${feature}`;
  return withFeature.length <= 200 && !["Shared room", "Studio"].includes(kind) ? withFeature : main;
}

// ── People ───────────────────────────────────────────────────────────────────
const NAMES = `Abby Adaeze Aditi Ahmed Aiko Aisha Alma Amara Amir Anaya Andre Anika Arjun Asha Aurora Ayumi Bao Basil Bianca Bilal Bruno Calla
Camila Carmen Cedric Chen Chiara Chidi Clara Cyrus Dalia Dana Daniela Darius Daria Diego Dina Dmitri Eamon Eden Elena Elif Emeka Emil Enzo Esme
Esther Ezra Farah Felix Femi Finn Freya Gabe Gemma Gia Gideon Grace Hamza Hannah Harper Hiro Hugo Ibrahim Ilana Imani Ines Isaac Isla Ivan Jade
Jamal Javier Jaya Jin Joaquin Jonah Joon Kavya Keiko Kenji Kiara Kofi Laila Lars Leah Leila Leo Liam Lina Lior Lucia Luis Luka Mabel Maya Mei
Mateo Malik Mara Marco Mariam Mina Mira Moses Nadia Naomi Nate Nia Niko Nina Nolan Oren Olu Owen Paloma Paolo Petra Priya Rafael Rahul Rania
Ravi Reza Rhea Rina Rio Ruth Saanvi Sana Santiago Sara Selin Shira Simone Sofia Sora Stella Sunny Tal Tamar Tariq Tess Thea Tomas Uma Valentina
Vera Victor Wen Wren Xavier Yara Yasmin Yuki Yusuf Zain Zara Zoe Zuri Ada Beto Cleo Dami Ellis Fatima Gael Hollis Idris Juno Lucas Mehmet Noa
Odile Pedro Ren Soren Tobi Ulises Yael Zev Anya Bryn Dov Eun Galen Hedda Iris Jasper Kemal Lucy Marisol Nell Orla Pilar Rowan Sami Taye Uri`
  .split(/\s+/)
  .filter(Boolean);

const PHD_FIELDS = ["neuroscience", "chemistry", "physics", "biochemistry", "computer science", "economics", "history", "English", "sociology", "psychology", "music composition", "anthropology", "politics", "molecular and cell biology", "mathematics", "Near Eastern and Judaic studies", "biophysics", "social policy", "structural biology", "philosophy"];
const MASTERS_FIELDS = ["global health policy", "sustainable international development", "public policy", "conflict resolution and coexistence", "biotechnology", "computer science", "international economics and finance", "business analytics", "Jewish professional leadership", "social impact management", "genetic counseling", "computational linguistics", "data science", "nonprofit management", "teaching"];
const MAJORS = ["computer science", "economics", "biology", "psychology", "neuroscience", "politics", "history", "English", "environmental studies", "health science", "film and media", "business", "mathematics", "chemistry", "sociology", "international and global studies", "anthropology", "studio art", "music", "theater arts", "Hispanic studies", "East Asian studies", "African and African American studies", "physics", "philosophy", "education studies"];
const INTERESTS = ["Trail running", "Baking", "Board games", "Yoga", "Podcasts", "Thrift shopping", "Jazz", "Cooking", "Pickup basketball", "Soccer", "Hosting dinners", "Hiking", "Film photography", "Houseplants", "Cycling", "Rock climbing", "Mystery novels", "Guitar", "Swimming", "Journaling", "Poetry", "Long walks", "Tea", "Concerts", "Video games", "Archives", "Running", "Knitting", "Chess", "Badminton", "Museums", "Gym", "Photography", "Birding", "Pottery", "Theater", "Volleyball", "Movies", "Filmmaking", "Skateboarding", "Live music", "Tennis", "Painting", "Sketching", "Ultimate frisbee", "Crosswords", "Gardening", "Kayaking", "Salsa dancing", "Choir", "Violin", "Cello", "Piano", "Coffee brewing", "Vegetarian cooking", "Spicy food", "Meditation", "Sci-fi novels", "Anime", "K-dramas", "Language exchange", "Volunteering", "Robotics", "Side coding projects", "Fantasy football", "Baseball", "Hockey", "Fencing", "Rowing", "Bouldering", "Drawing comics", "Calligraphy", "Embroidery", "Sourdough", "Farmers markets", "Stand-up comedy", "Trivia nights", "Debate", "Dancing", "Camping"];
const PLACES = ["Seoul", "Lagos", "Mumbai", "Toronto", "Shanghai", "Nairobi", "Istanbul", "Lima", "Hanoi", "Accra", "Chicago", "Denver", "Austin", "Madrid", "Taipei", "Cairo", "Santiago", "Manila"];

function program(r, level, story) {
  const incoming = ["augIncoming", "sep12", "may"].includes(story) && chance(r, 0.45);
  const visiting = story === "spring" && chance(r, 0.35);
  if (level === "phd") {
    const f = pick(r, PHD_FIELDS);
    const year = ["1st", "2nd", "3rd", "4th", "5th", "6th"][Math.floor(r() * 6)];
    return visiting ? `Visiting PhD student in ${f}` : incoming ? `Incoming PhD student in ${f}` : `PhD student in ${f}, ${year} year`;
  }
  if (level === "masters") {
    const f = pick(r, MASTERS_FIELDS);
    return visiting ? `Visiting master's student in ${f}` : incoming ? `Incoming master's student in ${f}` : `Master's student in ${f}${chance(r, 0.4) ? ", 2nd year" : ""}`;
  }
  if (level === "mba") return incoming ? "Incoming MBA student" : pick(r, ["MBA student, 1st year", "MBA student, 2nd year"]);
  const a = pick(r, MAJORS);
  const b = pick(r, MAJORS);
  return chance(r, 0.2) && a !== b ? `Senior in ${a} and ${b}` : `Senior in ${a}`;
}

const MONTH = (ym) => MONTH_NAMES[Number(ym.slice(5, 7)) - 1];
const STORIES = {
  spring: [(c, lv) => (lv === "phd" ? "Here from January to May to finish my dissertation." : null), () => "Visiting Brandeis for the spring semester only.", () => "On a one-semester exchange, January to May.", () => "Back from fieldwork and need a place for the spring."],
  takeover: [() => "Starting a lab job in February and happy to take over a lease.", () => "Looking to take over a lease from February.", () => "Moving closer to campus in February."],
  may: [() => "My program starts in May, and I'd like a full-year lease.", () => "Moving to Waltham in May for a research position.", () => "Starting a summer lab rotation in May and staying on."],
  summer: [() => "In Waltham for a summer internship, June to August.", () => "Here for a summer program and need a furnished room.", () => "Interning in Boston this summer, June to August."],
  summerResearch: [() => "Doing summer research on campus, June to August.", () => "Staying around campus for summer research.", () => "Teaching a summer course and need a place until August."],
  june12: [() => "Looking for a year-long lease starting in June.", () => "Starting a one-year lease in June.", () => "Moving off campus in June and staying for the year.", () => "My lease ends in May, so I need a place from June."],
  july12: [() => "Starting a summer job in July, then staying for the year.", () => "Looking for a room from July with a full-year lease.", () => "Moving to Waltham in July."],
  augIncoming: [(c, lv, r) => `Arriving from ${pick(r, PLACES)} in August for my program.`, () => "New to Boston and arriving in August.", (c, lv, r) => `Moving from ${pick(r, PLACES)} in August.`],
  aug12: [() => "Need a room from August, ideally close to campus.", () => "Moving off campus in August for the year.", () => "Looking for a full-year lease from August."],
  aug9: [() => "Want an academic-year lease from late August.", () => "Moving off campus for senior year, August to May."],
  sep9: [() => "Want an academic-year lease, September to May.", () => "Moving off campus for senior year, September to May.", () => "Back from a summer internship in September."],
  sep12: [() => "Starting a one-year lease in September.", () => "Moving in September after a summer internship.", (c, lv) => (lv === "senior" ? null : "Arriving in September for my program.")],
  pair: [(c) => `Looking for one roommate to rent a whole two-bedroom from ${MONTH(c.month)}.`, (c) => `Hoping to find a roommate and split a two-bedroom from ${MONTH(c.month)}.`],
  trio: [(c) => `Looking for two roommates to rent a three-bedroom from ${MONTH(c.month)}.`, (c) => `Want to find two others and split a three-bedroom from ${MONTH(c.month)}.`],
  soloHigh: [() => "Open to my own studio or a quiet shared house.", () => "I'd like my own studio, but a shared place works too.", () => "Hoping for a one-bedroom, but a calm shared house works too."],
};
const SLEEP_TXT = { early: ["Early riser", "Up early most days", "Early to bed, early to rise"], flexible: ["Flexible schedule", "My schedule varies"], late: ["Night owl", "Up late most nights"] };
const CLEAN_TXT = { tidy: ["very tidy", "tidy in shared spaces"], average: ["reasonably tidy", "tidy enough"], relaxed: ["relaxed about mess", "not fussy about tidiness"] };
const NOISE_TXT = { quiet: ["I like a quiet home", "I like it quiet"], moderate: ["some noise is fine", "I'm fine with some noise"], lively: ["I love a lively house", "I like a busy, social house"] };

function intro(r, c, level, life, wantsFurnished) {
  const story = pick(r, STORIES[c.story].map((f) => f(c, level, r)).filter(Boolean));
  const style = `${pick(r, SLEEP_TXT[life.sleep_schedule])}, ${pick(r, CLEAN_TXT[life.cleanliness])}, and ${pick(r, NOISE_TXT[life.noise])}.`;
  const extras = [];
  if (wantsFurnished && !/furnished/.test(story)) extras.push("I need a furnished room.");
  if (life.pets === "have_pets") extras.push(pick(r, ["My cat comes with me.", "My small dog comes with me.", "My calm cat comes with me."]));
  if (life.smoking === "smoker") extras.push("I smoke, but only outside.");
  if (life.smoking === "outside_ok") extras.push("Fine with smoking outside.");
  if (life.pets === "no_pets") extras.push("No pets, please.");
  if (life.guests === "often") extras.push("Friends come over often.");
  if (life.guests === "rarely") extras.push("I rarely have guests.");
  extras.push({ rotating_schedule: "I like a chore schedule.", split_by_task: "Happy to split chores by task.", as_needed: "Chores as needed works for me." }[life.chores]);
  let text = `${story} ${style}`;
  for (const e of extras) if (`${text} ${e}`.length <= 160 && text.split(". ").length < 4) text = `${text} ${e}`;
  return text;
}

const VIBES = { quiet: { quiet: 0.6, balanced: 0.35, social: 0.05 }, mixed: { quiet: 0.3, balanced: 0.5, social: 0.2 }, social: { quiet: 0.1, balanced: 0.4, social: 0.5 } };
const STYLES = {
  quiet: { sleep_schedule: { early: 0.6, flexible: 0.3, late: 0.1 }, cleanliness: { tidy: 0.6, average: 0.35, relaxed: 0.05 }, noise: { quiet: 0.7, moderate: 0.3 }, guests: { rarely: 0.5, sometimes: 0.5 } },
  balanced: { sleep_schedule: { early: 0.3, flexible: 0.4, late: 0.3 }, cleanliness: { tidy: 0.3, average: 0.55, relaxed: 0.15 }, noise: { quiet: 0.25, moderate: 0.6, lively: 0.15 }, guests: { rarely: 0.2, sometimes: 0.6, often: 0.2 } },
  social: { sleep_schedule: { late: 0.6, flexible: 0.3, early: 0.1 }, cleanliness: { average: 0.5, relaxed: 0.35, tidy: 0.15 }, noise: { lively: 0.55, moderate: 0.45 }, guests: { often: 0.6, sometimes: 0.4 } },
};
function lifestyle(r, vibe) {
  const s = STYLES[weighted(r, VIBES[vibe])];
  return {
    sleep_schedule: weighted(r, s.sleep_schedule),
    cleanliness: weighted(r, s.cleanliness),
    noise: weighted(r, s.noise),
    guests: weighted(r, s.guests),
    pets: weighted(r, { no_pets: 0.3, ok_with_pets: 0.6, have_pets: 0.1 }),
    smoking: weighted(r, { no_smoking: 0.86, outside_ok: 0.11, smoker: 0.03 }),
    chores: weighted(r, { rotating_schedule: 0.35, split_by_task: 0.4, as_needed: 0.25 }),
  };
}

const SKINS = ["#f5d0b5", "#eac0a0", "#d9a27e", "#c68863", "#a86b47", "#8a5536", "#6b4027"];
const HAIRS = ["short", "side", "buzz", "wavy", "long", "bob", "bun", "curly", "scarf"];
const HAIR_COLORS = ["#1c1c1c", "#2b1d16", "#4a2f1d", "#7a4b2a", "#b07a43", "#d9b26f", "#a33d1f", "#5b5b5b"];
const SCARVES = ["#2c7a7b", "#6b46c1", "#c05621", "#1e3a6e", "#9b2c5f"];
const SHIRTS = ["#2f855a", "#9b2c5f", "#1d4fbf", "#c05621", "#2c7a7b", "#4a5568", "#b7791f", "#1e3a6e", "#6b46c1"];
const BGS = ["#e9f6ef", "#f3ecfb", "#eaf1fb", "#fdf1e2", "#eef2f9", "#fdeaea"];
function avatar(r) {
  const hair = weighted(r, { short: 2, side: 1.5, buzz: 1, wavy: 1.5, long: 2, bob: 1.2, bun: 1, curly: 1.5, scarf: 0.6 });
  return {
    skin: pick(r, SKINS),
    hair,
    hairColor: hair === "scarf" ? pick(r, SCARVES) : pick(r, HAIR_COLORS),
    shirt: pick(r, SHIRTS),
    bg: pick(r, BGS),
    glasses: chance(r, 0.3),
    beard: hair !== "scarf" && hair !== "long" && hair !== "bob" && chance(r, 0.18),
  };
}

const ADJACENT = { NB: ["WD"], WD: ["NB", "HL"], MS: ["SS", "DT"], SS: ["MS"], DT: ["MS"], HL: ["PH", "WD"], PH: ["HL", "LV"], LV: ["PH", "HL"] };
const LIFE_FIELDS = ["sleep_schedule", "cleanliness", "noise", "guests", "pets", "smoking", "chores"];

// ── Building ─────────────────────────────────────────────────────────────────
const shareCost = (u, need) => (u.rent_basis === "unit" ? Math.round(u.monthly_rent / Math.max(1, Math.min(need, u.bedrooms))) : u.monthly_rent);

export function build() {
  const listings = [];
  const people = [];
  const handNames = new Set(HAND_PEOPLE.map((p) => p.firstName));
  const names = shuffle(rng("names"), [...new Set(NAMES)].filter((n) => !handNames.has(n)));
  const needPeople = COHORTS.reduce((s, c) => s + c.add, 0);
  if (names.length < needPeople) throw new Error(`Only ${names.length} names for ${needPeople} people`);
  const usedNames = new Set(HAND_LISTINGS.map((u) => u.name));
  const photoUse = new Map(Object.keys(PHOTOS).map((k) => [k, 0]));
  for (const u of HAND_LISTINGS) photoUse.set(u.photo, photoUse.get(u.photo) + 1);
  const byHandId = new Map(HAND_LISTINGS.map((u) => [u.id, u]));

  // Rooms first (ids are given out later in a shuffled order, so they don't group by cohort).
  const rooms = [];
  for (const c of COHORTS) {
    const r = rng(`rooms:${c.key}`);
    c.roomRefs = c.hand.rooms.map((id) => byHandId.get(id));
    for (const [kind, hood, rent, date, months, furnished, avail, beds] of c.rooms) {
      const unit = ["Studio", "Whole apartment"].includes(kind);
      const name = roomName(r, kind, hood, furnished, avail, beds, months, date, usedNames);
      usedNames.add(name);
      const [lat0, lng0] = HOODS[hood].center;
      const u = {
        id: null,
        name,
        kind,
        area: `Waltham, MA (${HOODS[hood].name})`,
        monthly_rent: rent,
        rent_basis: unit ? "unit" : "room",
        rooms_available: avail,
        bedrooms: beds,
        move_in_date: date,
        lease: { months, label: leaseLabel(kind, date, months) },
        utilities: utilities(r, kind, beds),
        furnished,
        laundry: pick(r, LAUNDRY),
        transit: pick(r, TRANSIT[hood]),
        description: roomDescription(r, kind, hood, furnished, avail, beds, months, date),
        location: [+(lat0 + (r() - 0.5) * 0.0044).toFixed(4), +(lng0 + (r() - 0.5) * 0.006).toFixed(4)],
        photo: null,
      };
      // Photo: the least-used one of the right kind, at most three listings each.
      const kinds = kind === "Studio" ? ["studio"] : kind === "Shared room" ? ["shared"] : furnished ? ["bedroom"] : ["empty", "kitchen", "living"];
      const choices = Object.entries(PHOTOS).filter(([k, p]) => kinds.includes(p.kind) && photoUse.get(k) < 3);
      if (!choices.length) throw new Error(`No photo left for ${kind}`);
      const least = Math.min(...choices.map(([k]) => photoUse.get(k)));
      const key = pick(r, choices.filter(([k]) => photoUse.get(k) === least))[0];
      photoUse.set(key, photoUse.get(key) + 1);
      u.photo = key;
      rooms.push(u);
      c.roomRefs.push(u);
    }
  }
  shuffle(rng("room-ids"), rooms).forEach((u, i) => (u.id = `demo-${String(16 + i).padStart(2, "0")}`));
  listings.push(...rooms.sort((a, b) => Number(a.id.slice(5)) - Number(b.id.slice(5))));

  // People.
  let nameIx = 0;
  const made = [];
  for (const c of COHORTS) {
    const r = rng(`people:${c.key}`);
    const costs = c.roomRefs.map((u) => shareCost(u, c.need)).sort((a, b) => a - b);
    const c3 = costs[Math.min(TARGET, costs.length) - 1];
    const cmax = costs.at(-1);
    c.members = [];
    for (let i = 0; i < c.add; i++) {
      const level = weighted(r, c.levels);
      const life = lifestyle(r, c.vibe);
      const budgetMax = i < TARGET ? step50(r, ceil50(cmax), ceil50(cmax) + 200) : step50(r, ceil50(c3), ceil50(cmax) + 150);
      const hi = Math.min(budgetMax - 250, floor50(c3 - 50));
      const lo = Math.max(500, budgetMax - 650);
      const budgetMin = step50(r, Math.min(lo, hi), hi);
      const nearCampus = c.areas.every((a) => a === "NB" || a === "WD");
      const distanceOnly = nearCampus && chance(r, 0.1);
      let lookingIn = distanceOnly ? [] : shuffle(r, c.areas);
      if (!distanceOnly && chance(r, 0.2)) {
        const extra = pick(r, ADJACENT[c.areas[0]].filter((a) => !c.areas.includes(a)).concat(ADJACENT[c.areas[1]].filter((a) => !c.areas.includes(a))));
        if (extra) lookingIn.push(extra);
      }
      lookingIn = lookingIn.map((a) => HOODS[a].name);
      const must = [];
      if (chance(r, 0.3)) must.push("move_in_month");
      if (lookingIn.length && chance(r, 0.25)) must.push("areas");
      const km = distanceOnly ? 2 : nearCampus && chance(r, 0.2) ? 1.5 : null;
      const p = {
        id: null,
        firstName: names[nameIx++],
        program: program(r, level, c.story),
        intro: "",
        interests: shuffle(r, INTERESTS).slice(0, 3),
        looking_in: lookingIn,
        move_in_month: c.month,
        budget_min: budgetMin,
        budget_max: budgetMax,
        lease_months: c.lease,
        rooms_needed: c.need,
        furnished: c.furnished,
        must_haves: must,
        max_distance_km: km,
        ...life,
        avatar: avatar(r),
        discoverable: true,
        _cohort: c,
        _level: level,
        _rerolls: 0,
      };
      p.intro = intro(r, c, level, life, !!c.furnished);
      c.members.push(p);
      made.push(p);
    }
  }
  shuffle(rng("people-ids"), made).forEach((p, i) => (p.id = `demo-p${String(21 + i).padStart(2, "0")}`));
  people.push(...made.sort((a, b) => Number(a.id.slice(6)) - Number(b.id.slice(6))));

  // Lifestyles drawn again until everyone has at least three compatible people.
  const handPeople = HAND_PEOPLE.map(asPerson);
  const cohortOfHand = new Map(COHORTS.flatMap((c) => c.hand.people.map((id) => [id, c])));
  for (let round = 0; ; round++) {
    const all = [...handPeople, ...people.map(asPerson)];
    const cov = coverage([...HAND_LISTINGS, ...listings].map(asListing), all);
    const short = all.filter((p) => cov.perPerson.get(p.id).mates.length < TARGET);
    if (!short.length) break;
    if (round > 400) throw new Error(`Roommate coverage didn't settle: ${short.map((p) => p.id).join(", ")}`);
    for (const s of short) {
      const gen = people.find((p) => p.id === s.id);
      const r = rng(`reroll:${s.id}:${round}`);
      if (gen) {
        gen._rerolls++;
        // At first a fresh draw; after a few tries, a near copy of a cohort-mate who gets along with many.
        let life = lifestyle(r, gen._cohort.vibe);
        if (gen._rerolls > 3) {
          const mates = gen._cohort.members.filter((m) => m !== gen && !mutualBlockers(asPerson(gen), asPerson(m)).some((b) => ["budget", "lease", "month_must_have", "area_must_have"].includes(b)));
          const base = mates.sort((a, b) => cov.perPerson.get(b.id).mates.length - cov.perPerson.get(a.id).mates.length)[0];
          if (base) {
            life = Object.fromEntries(LIFE_FIELDS.map((f) => [f, base[f]]));
            const f = pick(r, ["sleep_schedule", "guests", "chores"]);
            life[f] = lifestyle(r, gen._cohort.vibe)[f];
          }
        }
        Object.assign(gen, life);
        gen.intro = intro(r, gen._cohort, gen._level, life, !!gen._cohort.furnished);
      } else {
        // A hand-written profile is kept as written; one cohort-mate who could suit them is redrawn instead.
        const c = cohortOfHand.get(s.id);
        const candidates = c.members.filter((m) => {
          const why = mutualBlockers(s, asPerson(m));
          return why.length && !why.some((b) => ["budget", "lease", "month_must_have", "area_must_have", "area", "month"].includes(b));
        });
        const m = candidates[Math.floor(r() * candidates.length)];
        if (!m) throw new Error(`No cohort-mate can be adjusted for ${s.id}`);
        const life = Object.fromEntries(LIFE_FIELDS.map((f) => [f, s[f]]));
        life.pets = s.pets === "have_pets" ? pick(r, ["ok_with_pets", "have_pets"]) : s.pets === "no_pets" ? pick(r, ["no_pets", "ok_with_pets"]) : pick(r, ["ok_with_pets", "no_pets"]);
        life.smoking = s.smoking === "smoker" ? pick(r, ["outside_ok", "smoker"]) : pick(r, ["no_smoking", "no_smoking", "outside_ok"]);
        const f = pick(r, ["sleep_schedule", "cleanliness", "guests", "chores"]);
        life[f] = lifestyle(r, c.vibe)[f];
        Object.assign(m, life);
        m.intro = intro(r, c, m._level, life, !!c.furnished);
      }
    }
  }
  const clean = people.map(({ _cohort, _level, _rerolls, ...p }) => p);
  return { listings, people: clean };
}

const line = (x) => `  ${JSON.stringify(x)},`;
export function render({ listings, people }) {
  return [
    "// Written by scripts/demo-build.mjs (fixed seeds, so the same every time). Don't edit by hand: change the script",
    "// and run npm run demo:build. Fictional Demo mode data; see src/assistant/demo-data.js and docs/DEMO_DATA.md.",
    "export const GENERATED_LISTINGS = [",
    ...listings.map(line),
    "];",
    "export const GENERATED_PEOPLE = [",
    ...people.map(line),
    "];",
    "",
  ].join("\n");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const check = process.argv.includes("--check");
  const data = build();
  const text = render(data);
  const listings = [...HAND_LISTINGS, ...data.listings].map(asListing);
  const people = [...HAND_PEOPLE, ...data.people].map(asPerson);
  const s = summary(coverage(listings, people), listings, people);
  const far = listings.filter((u) => kmBetween(u.location, BRANDEIS) > 4).map((u) => u.id);
  console.log(JSON.stringify({ ...s, failures: s.failures.length, farFromBrandeis: far }, null, 1));
  if (s.failures.length || far.length) {
    console.error("Coverage targets missed:\n" + s.failures.join("\n"));
    process.exit(1);
  }
  if (check) {
    const current = readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    if (current !== text) {
      console.error("src/assistant/demo-generated.js differs from what the script builds. Run npm run demo:build.");
      process.exit(1);
    }
    console.log("demo-generated.js is up to date and every target is met.");
  } else {
    writeFileSync(OUT, text);
    console.log(`Wrote ${OUT}: ${data.listings.length} listings, ${data.people.length} profiles.`);
  }
}
