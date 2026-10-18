// Coverage checks for the Demo mode data, using coHabit's own matching code (nothing here scores anything itself).
// Used by scripts/demo-build.mjs, scripts/demo-report.mjs and npm test.
//
// A room suits a profile when the assistant's room search (searchRooms) returns it as matching everything ("exact")
// for that profile's answers: within budget, the right rooms, the move-in month or a month earlier, one of their
// areas, within their distance, a lease within a month of what they want, and furnished if they asked for it.
// Must-haves are the profile's own; nothing is loosened.
//
// Two profiles are mutually compatible roommates when the roommate matching code (scoreRoommate) says they're a
// possible match (shared area, move-in within a month, no pet or smoking dealbreaker, score 60+), and also, checked
// both ways: their budgets overlap, their lease lengths are within a month, a must-have move-in month means the same
// month, and a must-have area means one of those areas. Only profiles that chose to be found count as candidates.
import { exclusionCounts, searchRooms } from "../src/assistant/search.js";
import { roommateBlockers, scoreRoommate } from "../src/roommates.js";

export const TARGET = 3;

// A demo profile's answers as the assistant's memory ({ v, req }), as if they'd told the chat.
export function profileMemory(p) {
  const v = { looking_for: "both", budget_min: p.budget_min, budget_max: p.budget_max, move_in_month: p.move_in_month, rooms_needed: p.rooms_needed, lease_months: p.lease_months };
  if (p.looking_in.length) v.areas = p.looking_in;
  if (p.max_distance_km != null) v.max_distance_km = p.max_distance_km;
  if (p.furnished) v.wishes = ["furnished"];
  const req = { budget_max: true, move_in_month: p.must_haves.includes("move_in_month"), areas: p.must_haves.includes("areas") };
  if (p.max_distance_km != null) req.max_distance_km = true;
  return { v, req };
}

export function roomSearch(p, listings) {
  const found = searchRooms(profileMemory(p), listings, { limit: listings.length });
  return { exact: found.results.filter((r) => r.match === "exact").map((r) => r.unitId), partial: found.results.filter((r) => r.match !== "exact").map((r) => r.unitId), excluded: exclusionCounts(profileMemory(p), listings) };
}

const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));

// Reasons two profiles aren't mutually compatible (empty when they are). Engine reasons first.
export function mutualBlockers(a, b) {
  const out = roommateBlockers(a, b);
  if (!(a.budget_min <= b.budget_max && b.budget_min <= a.budget_max)) out.push("budget");
  if (Math.abs(a.lease_months - b.lease_months) > 1) out.push("lease");
  const sameMonth = monthIndex(a.move_in_month) === monthIndex(b.move_in_month);
  if (!sameMonth && [a, b].some((x) => x.must_haves.includes("move_in_month"))) out.push("month_must_have");
  const shareArea = a.looking_in.some((x) => b.looking_in.includes(x));
  if (!shareArea && [a, b].some((x) => x.must_haves.includes("areas"))) out.push("area_must_have");
  return out;
}

export const MUTUAL_TEXT = {
  budget: "Budgets don't overlap",
  lease: "Lease lengths more than a month apart",
  month_must_have: "A must-have move-in month that differs",
  area_must_have: "A must-have area the other isn't looking in",
};

// Everything at once: per profile, the rooms that suit them and their compatible candidates; per room, who it suits.
export function coverage(listings, people) {
  const shown = people.filter((p) => p.discoverable);
  const perPerson = new Map();
  const perRoom = new Map(listings.map((u) => [u.id, { all: [], shown: [] }]));
  for (const p of people) {
    const rooms = roomSearch(p, listings);
    for (const id of rooms.exact) {
      perRoom.get(id).all.push(p.id);
      if (p.discoverable) perRoom.get(id).shown.push(p.id);
    }
    perPerson.set(p.id, { rooms: rooms.exact, partial: rooms.partial, excluded: rooms.excluded, mates: [], engineMates: [] });
  }
  const pairReasons = {};
  for (let i = 0; i < people.length; i++) {
    for (let j = i + 1; j < people.length; j++) {
      const a = people[i];
      const b = people[j];
      const engine = scoreRoommate(a, b).eligible;
      const why = mutualBlockers(a, b);
      if (a.discoverable && b.discoverable) for (const w of why.length ? why : ["compatible"]) pairReasons[w] = (pairReasons[w] || 0) + 1;
      if (engine) {
        if (b.discoverable) perPerson.get(a.id).engineMates.push(b.id);
        if (a.discoverable) perPerson.get(b.id).engineMates.push(a.id);
      }
      if (!why.length) {
        if (b.discoverable) perPerson.get(a.id).mates.push(b.id);
        if (a.discoverable) perPerson.get(b.id).mates.push(a.id);
      }
    }
  }
  const failures = [];
  for (const p of people) {
    const c = perPerson.get(p.id);
    if (c.rooms.length < TARGET) failures.push(`${p.id} ${p.firstName}: ${c.rooms.length} suitable rooms`);
    if (c.mates.length < TARGET) failures.push(`${p.id} ${p.firstName}: ${c.mates.length} compatible roommates`);
  }
  for (const u of listings) if (perRoom.get(u.id).shown.length < TARGET) failures.push(`${u.id}: suits ${perRoom.get(u.id).shown.length} demo renters`);
  return { perPerson, perRoom, pairReasons, failures, shownCount: shown.length };
}

const stats = (nums) => {
  const s = [...nums].sort((a, b) => a - b);
  return { min: s[0], median: s[Math.floor(s.length / 2)], max: s.at(-1) };
};
export function summary(cov, listings, people) {
  const pp = [...cov.perPerson.values()];
  return {
    listings: listings.length,
    people: people.length,
    shown: cov.shownCount,
    roomsPerProfile: stats(pp.map((c) => c.rooms.length)),
    partialRoomsPerProfile: stats(pp.map((c) => c.partial.length)),
    matesPerProfile: stats(pp.map((c) => c.mates.length)),
    engineMatesPerProfile: stats(pp.map((c) => c.engineMates.length)),
    rentersPerRoom: stats([...cov.perRoom.values()].map((r) => r.shown.length)),
    pairReasons: cov.pairReasons,
    failures: cov.failures,
  };
}
