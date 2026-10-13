// Room and roommate search for the assistant. This code, not the AI model, decides what is shown:
// it filters by the renter's must-haves, ranks by the flexible preferences, and writes the
// "fits" and "doesn't fit" lines for each result. The model only explains these results.
import { scoreRoommate } from "../roommates.js";
import { fmtDate, isRequired, money } from "./memory.js";

export const MAX_RESULTS = 3;

// Brandeis University's main campus in Waltham. Distances are straight-line ("as the crow flies"):
// coHabit has no travel-time data.
export const BRANDEIS = { lat: 42.3656, lng: -71.2589 };

export function kmBetween(a, b) {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
const round1 = (n) => Math.round(n * 10) / 10;

const STOP = new Set(["the", "and", "near", "area", "massachusetts"]);
const words = (s) => String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w));
const monthsBetween = (ymd, ym) => (Number(ymd.slice(0, 4)) - Number(ym.slice(0, 4))) * 12 + (Number(ymd.slice(5, 7)) - Number(ym.slice(5, 7)));
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// One unit against the renter's answers. ok.<condition> says whether it passes that condition
// as currently set (must-have or flexible).
function evaluate(memory, u) {
  const v = memory.v;
  const fits = [];
  const misses = [];
  const ok = {};
  let score = 0;

  const rooms = v.rooms_needed ?? 1;
  ok.rooms = u.rooms_available >= rooms;
  if (ok.rooms) {
    score += 15;
    fits.push(v.rooms_needed > 1 ? `${u.rooms_available} rooms available (you need ${rooms})` : `${plural(u.rooms_available, "room")} available`);
  }

  if (v.budget_max != null) {
    const within = u.monthly_rent <= v.budget_max;
    const slightly = u.monthly_rent <= v.budget_max * 1.1;
    ok.budget = isRequired(memory, "budget_max") ? within : slightly;
    if (within) {
      score += 40;
      fits.push(`${money(u.monthly_rent)} a month, within your ${money(v.budget_max)} budget`);
    } else {
      if (slightly) score += 15;
      misses.push(`${money(u.monthly_rent)} a month, ${money(u.monthly_rent - v.budget_max)} over your ${money(v.budget_max)} budget`);
    }
  } else ok.budget = true;

  let monthGap = 0;
  if (v.move_in_month) {
    const d = (monthGap = monthsBetween(u.move_in_date, v.move_in_month));
    const inWindow = d === 0 || d === -1;
    ok.month = isRequired(memory, "move_in_month") ? inWindow : Math.abs(d) <= 3;
    const date = fmtDate(u.move_in_date);
    if (d === 0) {
      score += 20;
      fits.push(`Available ${date}, in your move-in month`);
    } else if (d === -1) {
      score += 15;
      fits.push(`Available from ${date}, a month before you want to move in`);
    } else {
      if (Math.abs(d) === 1) score += 10;
      misses.push(
        d > 0
          ? `Available ${date}, ${plural(d, "month")} after you want to move in`
          : `Available from ${date}, ${plural(-d, "month")} before you want to move in (ask whether the start can be later)`
      );
    }
  } else ok.month = true;

  if (v.areas?.length) {
    const have = new Set(words(u.area));
    const match = v.areas.some((a) => words(a).some((w) => have.has(w)));
    ok.area = isRequired(memory, "areas") ? match : true;
    if (match) {
      score += 25;
      fits.push(`In ${u.area}`);
    } else misses.push(`In ${u.area}, not one of your areas (${v.areas.join(", ")})`);
  } else ok.area = true;

  // Distance uses the same approximate point renters see, so it is "about" and never reveals more.
  const km = u.location ? round1(kmBetween(u.location, BRANDEIS)) : null;
  // A must-have distance hides rooms known to be farther. A room with no map location isn't hidden (many landlords
  // haven't added an address); it ranks lower and says the distance is unknown.
  if (v.max_distance_km != null) {
    const slack = u.location?.precision === "approximate" ? 0.5 : 0;
    const within = km != null && km <= v.max_distance_km + slack;
    ok.distance = isRequired(memory, "max_distance_km") ? within || km == null : true;
    if (within) {
      score += 20;
      fits.push(`About ${km} km from Brandeis in a straight line, within your ${v.max_distance_km} km`);
    } else if (km == null) misses.push("No map location, so the distance to Brandeis is unknown. Ask the landlord where it is");
    else misses.push(`About ${km} km from Brandeis in a straight line, more than your ${v.max_distance_km} km`);
  } else ok.distance = true;

  return { fits, misses, ok, score, km, monthGap };
}

const CONDITIONS = ["rooms", "budget", "month", "area", "distance"];

// For each condition that is hiding rooms: what relaxing it would mean, and which hidden rooms it would bring back.
function relaxOptions(memory) {
  const v = memory.v;
  const options = [];
  if ((v.rooms_needed ?? 1) > 1) options.push({ condition: "rooms", change: `Look for fewer than ${v.rooms_needed} rooms in one place`, brings: () => true });
  if (v.budget_max != null) {
    const cap = Math.floor(v.budget_max * 1.1);
    options.push(
      isRequired(memory, "budget_max")
        ? { condition: "budget", change: `Allow up to 10% over budget (up to ${money(cap)})`, brings: (e) => e.u.monthly_rent <= cap }
        : { condition: "budget", change: `Raise your budget above ${money(cap)}`, brings: () => true }
    );
  }
  if (v.move_in_month) {
    options.push(
      isRequired(memory, "move_in_month")
        ? { condition: "month", change: "Be flexible on the move-in month (up to 3 months either way)", brings: (e) => Math.abs(e.monthGap) <= 3 }
        : { condition: "month", change: "Consider a move-in month more than 3 months away", brings: () => true }
    );
  }
  // A flexible area or distance never hides a room, so only must-haves are offered.
  if (v.areas?.length && isRequired(memory, "areas")) options.push({ condition: "area", change: `Look outside ${v.areas.join(", ")}`, brings: () => true });
  if (v.max_distance_km != null && isRequired(memory, "max_distance_km"))
    options.push({ condition: "distance", change: `Look farther than ${v.max_distance_km} km from Brandeis`, brings: () => true });
  return options;
}

// listings: active units as renters see them (src/listings.js). Samples are left out unless asked for.
export function searchRooms(memory, listings, { limit = MAX_RESULTS } = {}) {
  const includeSamples = !!memory.v.include_samples;
  const evaluated = listings.map((u) => ({ u, ...evaluate(memory, u) }));
  const passes = (e) => CONDITIONS.every((c) => e.ok[c]);
  const matching = evaluated.filter((e) => passes(e) && (includeSamples || !e.u.sample));
  matching.sort((a, b) => a.misses.length - b.misses.length || b.score - a.score || a.u.monthly_rent - b.u.monthly_rent || a.u.id.localeCompare(b.u.id));

  // How many more rooms would appear if one condition were relaxed (the others staying as they are).
  const ifRelaxed = [];
  for (const { condition, change, brings } of relaxOptions(memory)) {
    const extraRooms = evaluated.filter(
      (e) => (includeSamples || !e.u.sample) && !e.ok[condition] && brings(e) && CONDITIONS.every((o) => o === condition || e.ok[o])
    ).length;
    if (extraRooms) ifRelaxed.push({ condition, change, extraRooms });
  }

  const samplesHidden = includeSamples ? 0 : evaluated.filter((e) => passes(e) && e.u.sample).length;
  const results = matching.slice(0, limit).map((e, i) => ({
    ref: `R${i + 1}`,
    unitId: e.u.id,
    name: e.u.name,
    area: e.u.area,
    monthly_rent: e.u.monthly_rent,
    rooms_available: e.u.rooms_available,
    move_in_date: e.u.move_in_date,
    km_from_brandeis: e.km,
    description: (e.u.description || "").slice(0, 300),
    sample: !!e.u.sample,
    fits: e.fits,
    misses: e.misses,
  }));
  return { results, totalMatching: matching.length, ifRelaxed, samplesHidden };
}

// me: the renter's merged answers (memory over saved profile). others: renters who turned on roommate
// matching, as { userId, prefs, firstName, email (null unless they share it), sample }.
export function searchRoommates(memory, me, others, { limit = MAX_RESULTS } = {}) {
  const includeSamples = !!memory.v.include_samples;
  const scored = others
    .map((o) => ({ o, ...scoreRoommate(me, o.prefs) }))
    .filter((m) => m.eligible);
  const shown = scored
    .filter((m) => includeSamples || !m.o.sample)
    .sort((a, b) => b.score - a.score || b.shared.length - a.shared.length || a.o.userId.localeCompare(b.o.userId));
  const results = shown.slice(0, limit).map((m, i) => ({
    ref: `P${i + 1}`,
    userId: m.o.userId,
    firstName: m.o.firstName,
    email: m.o.email,
    score: m.score,
    sample: !!m.o.sample,
    fits: m.shared,
    // Only what the two have in common is ever shown about the other person, never their answers.
    misses: m.score < 90 ? ["Not every lifestyle answer matches. Talk through sleep, guests and chores before deciding."] : [],
  }));
  return { results, totalMatching: shown.length, samplesHidden: includeSamples ? 0 : scored.length - shown.length };
}
