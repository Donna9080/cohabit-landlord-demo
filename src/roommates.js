// Roommate matching: how well two renters' saved answers fit together.
// Runs in the Worker; no external service. Only renters who turned on
// "show me to compatible renters" are ever compared or shown (see src/index.js).
//
// Two renters are a possible match only if all of these hold:
//   1. their areas share a word (for example both say "Waltham")
//   2. their move-in months are the same or one month apart
//   3. no dealbreaker: one has a pet and the other wants no pets, or one smokes and the other wants no smoking
//   4. the score is MIN_ROOMMATE_SCORE or more
// The score is 80 points of lifestyle fit plus 10 for overlapping budgets and 10 for the same month.
// What is returned about the other person is only what the two have in common.

export const MIN_ROOMMATE_SCORE = 60;

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== "and");
const monthIndex = (ym) => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7));
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Ordered scales: same = full points, one step apart = half, opposite ends = none.
const SCALES = {
  cleanliness: { order: ["relaxed", "average", "tidy"], points: 20, same: { relaxed: "Both relaxed about tidiness", average: "Similar tidiness", tidy: "Both very tidy" } },
  noise: { order: ["quiet", "moderate", "lively"], points: 15, same: { quiet: "Both like a quiet home", moderate: "Both fine with some noise", lively: "Both like a lively home" } },
  guests: { order: ["rarely", "sometimes", "often"], points: 10, same: { rarely: "Both rarely have guests", sometimes: "Both have guests sometimes", often: "Both often have guests" } },
};
const SLEEP_SAME = { early: "Both early birds", flexible: "Both flexible sleepers", late: "Both night owls" };

export function scoreRoommate(me, other) {
  const shared = [];

  const mine = new Set(words(me.area));
  const commonArea = words(other.area).filter((w) => mine.has(w));
  const gap = Math.abs(monthIndex(me.move_in_month) - monthIndex(other.move_in_month));
  const petClash = [me.pets, other.pets].includes("no_pets") && [me.pets, other.pets].includes("have_pets");
  const smokeClash = [me.smoking, other.smoking].includes("no_smoking") && [me.smoking, other.smoking].includes("smoker");
  if (!commonArea.length || gap > 1 || petClash || smokeClash) return { score: 0, shared, eligible: false };

  let score = 0;
  shared.push(`Both looking in ${commonArea.map((w) => w[0].toUpperCase() + w.slice(1)).join(" / ")}`);
  if (gap === 0) {
    score += 10;
    shared.push(`Both moving in ${MONTHS[Number(me.move_in_month.slice(5, 7)) - 1]} ${me.move_in_month.slice(0, 4)}`);
  } else {
    shared.push("Moving within a month of each other");
  }
  if (me.budget_min <= other.budget_max && other.budget_min <= me.budget_max) {
    score += 10;
    shared.push("Budgets overlap");
  }

  // Sleep: 15 points. "Flexible" gets along with anyone, early vs late does not.
  if (me.sleep_schedule === other.sleep_schedule) {
    score += 15;
    shared.push(SLEEP_SAME[me.sleep_schedule]);
  } else if (me.sleep_schedule === "flexible" || other.sleep_schedule === "flexible") {
    score += 10;
  }

  for (const [field, { order, points, same }] of Object.entries(SCALES)) {
    const distance = Math.abs(order.indexOf(me[field]) - order.indexOf(other[field]));
    if (distance === 0) {
      score += points;
      shared.push(same[me[field]]);
    } else if (distance === 1) {
      score += points / 2;
    }
  }

  // Pets: 10 points (clashes were removed above).
  score += 10;
  if (me.pets === other.pets) shared.push({ no_pets: "Neither wants pets", ok_with_pets: "Both fine with pets", have_pets: "Both have a pet" }[me.pets]);

  // Smoking: 10 points when the same, partial when one step apart.
  if (me.smoking === other.smoking) {
    score += 10;
    shared.push({ no_smoking: "Both want no smoking", outside_ok: "Both fine with smoking outside", smoker: "Both smoke" }[me.smoking]);
  } else {
    score += 6;
  }

  score = Math.round(score);
  return { score, shared, eligible: score >= MIN_ROOMMATE_SCORE };
}

// others: [{ prefs, firstName, email (already null unless they chose to share it), sample }]
export function rankRoommates(me, others, limit = 20) {
  return others
    .map((o) => ({ o, ...scoreRoommate(me, o.prefs) }))
    .filter((m) => m.eligible)
    .sort((a, b) => b.score - a.score || b.shared.length - a.shared.length || a.o.firstName.localeCompare(b.o.firstName))
    .slice(0, limit)
    .map(({ o, score, shared }) => ({ firstName: o.firstName, score, shared, email: o.email ?? null, sample: !!o.sample }));
}

export const firstNameOf = (name) => String(name || "").replace(/\(sample\)/i, "").trim().split(/\s+/)[0] || "Renter";
