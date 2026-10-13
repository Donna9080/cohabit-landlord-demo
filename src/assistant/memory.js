// What the assistant has learned from the chat ("memory"), stored per renter in assistant_threads.
// Every value is checked here, whether it came from the AI model or the basic (rule-based) mode,
// so nothing the model writes can bypass the same limits the questionnaire has.
//
// Shape: { v: { field: value }, req: { field: true | false } }
//   v    the answers (see FIELDS)
//   req  must-have (true) or flexible (false) for the fields in STRICTNESS_FIELDS
import { CHORE_CHOICES, PREFERENCE_CHOICES, PHONE, hasAddress, parsePreferences } from "../validate.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtMonth = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
export const fmtDate = (ymd) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}, ${ymd.slice(0, 4)}`;
export const money = (n) => "$" + Number(n).toLocaleString("en-US");

export const LOOKING_FOR = ["room", "roommates", "both"];
export const ROOMMATE_FIELDS = ["sleep_schedule", "cleanliness", "noise", "guests", "pets", "smoking"];
// Fields the renter can mark as a must-have or as flexible. Rooms are always a must-have.
export const STRICTNESS_FIELDS = ["budget_max", "move_in_month", "areas", "max_distance_km"];
const DEFAULT_REQUIRED = { budget_max: true, move_in_month: false, areas: false, max_distance_km: true };

const CHOICE_LABELS = {
  looking_for: { room: "A room", roommates: "Roommates", both: "A room and roommates" },
  sleep_schedule: { early: "Early bird", flexible: "Flexible", late: "Night owl" },
  cleanliness: { relaxed: "Relaxed", average: "Average", tidy: "Very tidy" },
  noise: { quiet: "Quiet", moderate: "Some noise is fine", lively: "Lively" },
  guests: { rarely: "Rarely", sometimes: "Sometimes", often: "Often" },
  pets: { no_pets: "No pets, please", ok_with_pets: "OK with pets", have_pets: "Has a pet" },
  smoking: { no_smoking: "No smoking", outside_ok: "OK outside", smoker: "Smokes" },
  chores: { rotating_schedule: "A chore schedule", split_by_task: "Split by task", as_needed: "As needed" },
};

export const LABELS = {
  looking_for: "Looking for",
  budget_max: "Budget up to",
  budget_min: "Budget from",
  move_in_month: "Move-in month",
  areas: "Areas",
  max_distance_km: "Distance from Brandeis",
  rooms_needed: "Rooms needed",
  lease_months: "Lease length",
  sleep_schedule: "Sleep schedule",
  cleanliness: "Cleanliness",
  noise: "Noise at home",
  guests: "Guests over",
  pets: "Pets",
  smoking: "Smoking",
  chores: "Chores",
  wishes: "Other wishes",
  include_samples: "Show sample listings",
};

class Bad extends Error {}
const int = (v, min, max, what) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[$,\s]/g, "")) : v;
  if (typeof n !== "number" || !Number.isFinite(n)) throw new Bad(`${what} must be a number.`);
  const r = Math.round(n);
  if (r < min || r > max) throw new Bad(`${what} must be between ${min} and ${max}.`);
  return r;
};
const choice = (field) => (v) => {
  const allowed = field === "chores" ? CHORE_CHOICES : field === "looking_for" ? LOOKING_FOR : PREFERENCE_CHOICES[field];
  if (!allowed.includes(v)) throw new Bad(`Use one of: ${allowed.join(", ")}.`);
  return v;
};
const shortTexts = (v, { max, maxLen, pattern, what }) => {
  const list = (Array.isArray(v) ? v : [v]).map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""));
  if (!list.length || list.length > max) throw new Bad(`Give 1 to ${max} ${what}.`);
  const out = [];
  for (const s of list) {
    if (s.length < 2 || s.length > maxLen || !pattern.test(s)) throw new Bad(`"${s.slice(0, 40)}" isn't a valid ${what.replace(/s$/, "")}.`);
    if (hasAddress(s) || PHONE.test(s) || s.includes("@")) throw new Bad("Leave out street addresses, ZIP codes and contact details.");
    if (!out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
  }
  return out;
};
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;

// One checker per field: (value, today "YYYY-MM-DD") -> normalized value, or throws Bad.
const FIELDS = {
  looking_for: choice("looking_for"),
  budget_max: (v) => int(v, 1, 50000, "Budget"),
  budget_min: (v) => int(v, 0, 50000, "Minimum budget"),
  move_in_month: (v, today) => {
    if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new Bad("Use a month like 2027-06.");
    const ahead = monthIndex(v) - monthIndex(today.slice(0, 7));
    if (ahead < 0) throw new Bad("That month has already passed. Which year do you mean?");
    if (ahead > 24) throw new Bad("Pick a month within the next two years.");
    return v;
  },
  areas: (v) => shortTexts(v, { max: 4, maxLen: 40, pattern: /^[A-Za-z][A-Za-z .'-]*$/, what: "areas" }),
  max_distance_km: (v) => {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0.5 || n > 50) throw new Bad("Distance must be between 0.5 and 50 km.");
    return Math.round(n * 2) / 2;
  },
  rooms_needed: (v) => int(v, 1, 10, "Rooms needed"),
  lease_months: (v) => int(v, 1, 24, "Lease length in months"),
  ...Object.fromEntries(ROOMMATE_FIELDS.map((f) => [f, choice(f)])),
  chores: choice("chores"),
  wishes: (v) => shortTexts(v, { max: 5, maxLen: 60, pattern: /^[\w][\w .,'/&+-]*$/, what: "wishes" }),
  include_samples: (v) => {
    if (typeof v !== "boolean") throw new Bad("Must be true or false.");
    return v;
  },
};
export const FIELD_NAMES = Object.keys(FIELDS);

export const emptyMemory = () => ({ v: {}, req: {} });

export function parseMemory(text) {
  try {
    const m = JSON.parse(text || "{}");
    return { v: m && typeof m.v === "object" && m.v ? m.v : {}, req: m && typeof m.req === "object" && m.req ? m.req : {} };
  } catch {
    return emptyMemory();
  }
}

export const isRequired = (memory, field) => (field in memory.req ? !!memory.req[field] : !!DEFAULT_REQUIRED[field]);

// input: { <field>: value | null, must_have: [field], flexible: [field], forget: [field] }
// A null value also forgets the field. Returns a new memory plus what changed and what was refused.
export function applyUpdates(memory, input, today) {
  const next = { v: { ...memory.v }, req: { ...memory.req } };
  const changed = [];
  const errors = [];
  if (!input || typeof input !== "object" || Array.isArray(input)) return { memory: next, changed, errors: [{ field: null, message: "Send an object." }] };
  const listOf = (key) => {
    const v = input[key];
    if (v == null) return [];
    const list = Array.isArray(v) ? v : [v];
    const bad = list.filter((f) => !FIELD_NAMES.includes(f));
    if (bad.length) errors.push({ field: key, message: `Unknown field(s): ${bad.join(", ")}.` });
    return list.filter((f) => FIELD_NAMES.includes(f));
  };
  for (const f of listOf("forget")) {
    if (f in next.v) changed.push(f);
    delete next.v[f];
    delete next.req[f];
  }
  for (const [key, value] of Object.entries(input)) {
    if (["must_have", "flexible", "forget"].includes(key)) continue;
    if (!FIELDS[key]) {
      errors.push({ field: key, message: "Unknown field." });
      continue;
    }
    if (value === null) {
      if (key in next.v) changed.push(key);
      delete next.v[key];
      continue;
    }
    try {
      const clean = FIELDS[key](value, today);
      if (JSON.stringify(next.v[key]) !== JSON.stringify(clean)) changed.push(key);
      next.v[key] = clean;
    } catch (e) {
      if (!(e instanceof Bad)) throw e;
      errors.push({ field: key, message: e.message });
    }
  }
  if (next.v.budget_min != null && next.v.budget_max != null && next.v.budget_min > next.v.budget_max) {
    errors.push({ field: "budget_min", message: "The minimum is above the maximum, so it was not kept." });
    delete next.v.budget_min;
  }
  for (const [key, flag] of [["must_have", true], ["flexible", false]]) {
    for (const f of listOf(key)) {
      if (!STRICTNESS_FIELDS.includes(f)) {
        errors.push({ field: key, message: `${f} can't be marked ${flag ? "must-have" : "flexible"}.` });
        continue;
      }
      if (isRequired(next, f) !== flag) changed.push(`${f}:${flag ? "must_have" : "flexible"}`);
      next.req[f] = flag;
    }
  }
  return { memory: next, changed: [...new Set(changed)], errors };
}

export function displayValue(field, value) {
  if (value == null) return "";
  if (CHOICE_LABELS[field]) return CHOICE_LABELS[field][value] || String(value);
  if (field === "budget_max" || field === "budget_min") return `${money(value)} a month`;
  if (field === "move_in_month") return fmtMonth(value);
  if (field === "max_distance_km") return `Within ${value} km (about ${Math.round(value * 0.621 * 10) / 10} mi), straight line`;
  if (field === "lease_months") return `${value} month${value === 1 ? "" : "s"}`;
  if (field === "include_samples") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

// What the renter has said, in a fixed order, for the side panel and for the AI model.
export function memoryFacts(memory) {
  return FIELD_NAMES.filter((f) => memory.v[f] != null && f !== "include_samples").map((f) => ({
    field: f,
    label: LABELS[f],
    raw: memory.v[f],
    value: displayValue(f, memory.v[f]),
    ...(STRICTNESS_FIELDS.includes(f) ? { mustHave: isRequired(memory, f) } : {}),
  }));
}

// The basics needed before a room search, in the order they are asked.
export function missingBasics(memory) {
  const v = memory.v;
  const out = [];
  if (v.budget_max == null) out.push("budget_max");
  if (v.move_in_month == null) out.push("move_in_month");
  if (!v.areas?.length && v.max_distance_km == null) out.push("areas");
  if (v.rooms_needed == null) out.push("rooms_needed");
  return out;
}

// Merges the chat's answers over the saved profile. Used for roommate matching and for the
// "save to my profile" confirmation. Returns { prefs } when complete, or { missing } otherwise.
export function mergedPreferences(memory, saved) {
  const v = memory.v;
  const s = saved || {};
  const area = v.areas?.length ? v.areas.join(", ").slice(0, 80) : s.area;
  const budgetMax = v.budget_max ?? s.budget_max;
  let budgetMin = v.budget_min ?? s.budget_min ?? 0;
  if (budgetMax != null && budgetMin > budgetMax) budgetMin = 0;
  const body = {
    budget_min: budgetMin,
    budget_max: budgetMax,
    move_in_month: v.move_in_month ?? s.move_in_month,
    area,
    rooms_needed: v.rooms_needed ?? s.rooms_needed,
    ...Object.fromEntries(ROOMMATE_FIELDS.map((f) => [f, v[f] ?? s[f]])),
    chores: v.chores ?? s.chores ?? null,
    roommate_visible: !!s.roommate_visible,
    share_email: !!s.share_email,
    share_profile: !!s.share_profile,
  };
  const missing = [];
  if (body.budget_max == null) missing.push("budget_max");
  if (body.move_in_month == null) missing.push("move_in_month");
  if (!body.area) missing.push("areas");
  if (body.rooms_needed == null) missing.push("rooms_needed");
  for (const f of ROOMMATE_FIELDS) if (body[f] == null) missing.push(f);
  if (missing.length) return { missing };
  return { prefs: parsePreferences(body) };
}

const PROFILE_LABELS = {
  budget_min: ["Budget from", (v) => (v ? money(v) : "No minimum")],
  budget_max: ["Budget up to", (v) => money(v)],
  move_in_month: ["Move-in month", fmtMonth],
  area: ["Area", String],
  rooms_needed: ["Rooms needed", String],
  ...Object.fromEntries([...ROOMMATE_FIELDS, "chores"].map((f) => [f, [LABELS[f], (v) => CHOICE_LABELS[f][v] || "Not set"]])),
  roommate_visible: ["Roommate matching", (v) => (v ? "On" : "Off")],
  share_email: ["Share my email with roommate matches", (v) => (v ? "Yes" : "No")],
  share_profile: ["Share my budget, area, move-in month and lifestyle with matches", (v) => (v ? "Yes" : "No")],
};

// Rows for the confirmation card: what would change in the saved profile.
export function profileChanges(saved, next) {
  const same = (f) => {
    if (!saved) return false;
    if (f === "roommate_visible" || f === "share_email" || f === "share_profile") return !!saved[f] === !!next[f];
    return (saved[f] ?? null) === (next[f] ?? null);
  };
  return Object.entries(PROFILE_LABELS)
    .filter(([f]) => !same(f))
    .map(([f, [label, show]]) => ({ field: f, label, from: saved && saved[f] != null ? show(saved[f]) : null, to: next[f] != null ? show(next[f]) : "Not set" }));
}
