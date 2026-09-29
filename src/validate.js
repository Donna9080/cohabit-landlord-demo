// Server-side validation for everything the browser sends. Unknown fields are
// dropped, so a request can never set owner, role or account type this way.

export class InvalidInput extends Error {
  constructor(field, message) {
    super(message);
    this.field = field;
  }
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

function text(body, field, { min = 0, max }) {
  const v = body[field];
  if (typeof v !== "string") throw new InvalidInput(field, "Must be text.");
  // Collapse whitespace and remove control characters.
  const s = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").trim();
  if (s.length < min) throw new InvalidInput(field, min === 1 ? "Required." : `At least ${min} characters.`);
  if (s.length > max) throw new InvalidInput(field, `At most ${max} characters.`);
  return s;
}

function int(body, field, { min, max }) {
  const v = body[field];
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isInteger(n)) throw new InvalidInput(field, "Must be a whole number.");
  if (n < min || n > max) throw new InvalidInput(field, `Must be between ${min} and ${max}.`);
  return n;
}

function oneOf(body, field, allowed) {
  const v = body[field];
  if (!allowed.includes(v)) throw new InvalidInput(field, "Choose one of the options.");
  return v;
}

function date(body, field) {
  const v = body[field];
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new InvalidInput(field, "Use a date like 2027-06-01.");
  const d = new Date(v + "T00:00:00Z");
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw new InvalidInput(field, "Not a real date.");
  const year = d.getUTCFullYear();
  if (year < 2020 || year > 2100) throw new InvalidInput(field, "Pick a date between 2020 and 2100.");
  return v;
}

function month(body, field) {
  const v = body[field];
  if (typeof v !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) throw new InvalidInput(field, "Use a month like 2027-06.");
  const year = Number(v.slice(0, 4));
  if (year < 2020 || year > 2100) throw new InvalidInput(field, "Pick a month between 2020 and 2100.");
  return v;
}

// Streets look like "14 Elm Street" or "22 Oak Ave". Areas should be a neighborhood or city.
const STREET = /\b\d+\s+\w+.*\b(st|street|ave|avenue|rd|road|blvd|boulevard|ln|lane|dr|drive|ct|court|way|pl|place|ter|terrace)\b\.?/i;
function area(body, field) {
  const s = text(body, field, { min: 1, max: 80 });
  if (STREET.test(s)) throw new InvalidInput(field, "Enter a neighborhood or city, not a street address.");
  return s;
}

export const UNIT_STATUSES = ["active", "inactive"];

export function parseUnit(body) {
  if (!isObj(body)) throw new InvalidInput(null, "Send a JSON object.");
  return {
    name: text(body, "name", { min: 1, max: 80 }),
    area: area(body, "area"),
    monthly_rent: int(body, "monthly_rent", { min: 1, max: 50000 }),
    rooms_available: int(body, "rooms_available", { min: 1, max: 20 }),
    move_in_date: date(body, "move_in_date"),
    description: body.description == null ? "" : text(body, "description", { max: 1000 }),
    status: oneOf(body, "status", UNIT_STATUSES),
  };
}

export const PREFERENCE_CHOICES = {
  sleep_schedule: ["early", "flexible", "late"],
  cleanliness: ["relaxed", "average", "tidy"],
  noise: ["quiet", "moderate", "lively"],
  guests: ["rarely", "sometimes", "often"],
  pets: ["no_pets", "ok_with_pets", "have_pets"],
  smoking: ["no_smoking", "outside_ok", "smoker"],
};

export function parsePreferences(body) {
  if (!isObj(body)) throw new InvalidInput(null, "Send a JSON object.");
  const p = {
    budget_min: int(body, "budget_min", { min: 0, max: 50000 }),
    budget_max: int(body, "budget_max", { min: 1, max: 50000 }),
    move_in_month: month(body, "move_in_month"),
    area: area(body, "area"),
    rooms_needed: int(body, "rooms_needed", { min: 1, max: 10 }),
  };
  if (p.budget_max < p.budget_min) throw new InvalidInput("budget_max", "Must be at least the minimum.");
  for (const [field, allowed] of Object.entries(PREFERENCE_CHOICES)) p[field] = oneOf(body, field, allowed);
  return p;
}

export function parseAccountType(body) {
  if (!isObj(body)) throw new InvalidInput(null, "Send a JSON object.");
  return oneOf(body, "accountType", ["landlord", "renter"]);
}

export const isUnitId = (s) => typeof s === "string" && /^[0-9a-f-]{36}$/.test(s);
