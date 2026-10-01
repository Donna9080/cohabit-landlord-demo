// Rule-based matching of one renter's saved preferences against active units.
// No external AI service: it runs in the Worker, reads only the renter's own
// preferences and the public listing fields of active units.
//
// A unit is shown only if all three hold:
//   1. rent is at most 10% over the renter's "budget up to"
//   2. it has at least as many rooms as the renter needs
//   3. it scores MIN_SCORE or more, which in practice means it is also in the
//      renter's area or available in the exact month they want
// docs/SAMPLE_MATCHING.md shows the effect on the sample data.

export const OVER_BUDGET_LIMIT = 1.1;
export const MIN_SCORE = 70;

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

function monthsBetween(ymd, ym) {
  const [y1, m1] = ymd.split("-").map(Number);
  const [y2, m2] = ym.split("-").map(Number);
  return (y1 - y2) * 12 + (m1 - m2);
}

export function scoreUnit(prefs, unit) {
  let score = 0;
  const reasons = [];

  const affordable = unit.monthly_rent <= prefs.budget_max * OVER_BUDGET_LIMIT;
  if (unit.monthly_rent <= prefs.budget_max) {
    score += 40;
    reasons.push("Within your budget");
  } else if (affordable) {
    score += 15;
    reasons.push("Slightly over budget");
  }

  const want = words(prefs.area);
  const have = new Set(words(unit.area));
  if (want.some((w) => have.has(w))) {
    score += 25;
    reasons.push("In your area");
  }

  const gap = Math.abs(monthsBetween(unit.move_in_date, prefs.move_in_month));
  if (gap === 0) {
    score += 20;
    reasons.push("Move-in month matches");
  } else if (gap === 1) {
    score += 10;
    reasons.push("Move-in within a month");
  }

  const enoughRooms = unit.rooms_available >= prefs.rooms_needed;
  if (enoughRooms) {
    score += 15;
    reasons.push(`${unit.rooms_available} room${unit.rooms_available === 1 ? "" : "s"} available`);
  }

  return { score, reasons, eligible: affordable && enoughRooms && score >= MIN_SCORE };
}

export function rankUnits(prefs, units, limit = 20) {
  return units
    .map((u) => ({ unit: u, ...scoreUnit(prefs, u) }))
    .filter((m) => m.eligible)
    .sort((a, b) => b.score - a.score || a.unit.monthly_rent - b.unit.monthly_rent)
    .slice(0, limit)
    .map(({ unit, score, reasons }) => ({ unit, score, reasons }));
}
