// Rule-based matching of one renter's saved preferences against active units.
// No external AI service: it runs in the Worker, reads only the renter's own
// preferences and the public listing fields of active units.

const words = (s) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

function monthsBetween(ymd, ym) {
  const [y1, m1] = ymd.split("-").map(Number);
  const [y2, m2] = ym.split("-").map(Number);
  return (y1 - y2) * 12 + (m1 - m2);
}

export function scoreUnit(prefs, unit) {
  let score = 0;
  const reasons = [];

  if (unit.monthly_rent <= prefs.budget_max) {
    score += 40;
    reasons.push("Within your budget");
  } else if (unit.monthly_rent <= prefs.budget_max * 1.1) {
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

  if (unit.rooms_available >= prefs.rooms_needed) {
    score += 15;
    reasons.push(`${unit.rooms_available} room${unit.rooms_available === 1 ? "" : "s"} available`);
  }

  return { score, reasons };
}

export function rankUnits(prefs, units, limit = 20) {
  return units
    .map((u) => ({ unit: u, ...scoreUnit(prefs, u) }))
    .filter((m) => m.score >= 40)
    .sort((a, b) => b.score - a.score || a.unit.monthly_rent - b.unit.monthly_rent)
    .slice(0, limit);
}
