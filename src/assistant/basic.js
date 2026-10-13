// Basic mode: a rule-based assistant used when the AI model is off, over its limits or unavailable.
// It understands budgets, months, towns, distances, room counts and lifestyle answers, asks one
// question at a time, and describes search results using only what src/assistant/search.js returned.
import { fmtMonth, money, missingBasics, ROOMMATE_FIELDS } from "./memory.js";

const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH_RE = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b\.?(?:\s*(?:of\s+)?(20\d\d))?/i;
const SEASONS = { fall: 9, autumn: 9, spring: 1, summer: 6, winter: 1 };
const NUMBER_WORDS = { a: 1, an: 1, one: 1, single: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };

// Towns and neighborhoods within reach of Brandeis (longest names first so "West Newton" wins over "Newton").
export const AREA_NAMES = [
  "Newton Highlands", "Newton Centre", "Newton Corner", "West Newton", "Newtonville", "Auburndale", "Waban", "Chestnut Hill",
  "Jamaica Plain", "West Roxbury", "Back Bay", "South End", "Roslindale", "Waltham", "Newton", "Watertown", "Belmont",
  "Cambridge", "Somerville", "Boston", "Allston", "Brighton", "Brookline", "Lexington", "Weston", "Wellesley", "Needham",
  "Arlington", "Medford", "Lincoln", "Concord", "Natick", "Framingham", "Fenway", "Dorchester", "Quincy", "Malden",
  "Burlington", "Woburn", "Winchester", "Dedham", "Sudbury", "Wayland",
].sort((a, b) => b.length - a.length);

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function nextOccurrence(month, today) {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  return `${month >= m ? y : y + 1}-${String(month).padStart(2, "0")}`;
}

// Quick-reply answers for each question, matched exactly when that question was just asked.
const OPTION_ANSWERS = {
  looking_for: [["A room", "room"], ["A roommate", "roommates"], ["Both", "both"]],
  sleep_schedule: [["Early bird", "early"], ["Flexible", "flexible"], ["Night owl", "late"]],
  cleanliness: [["Relaxed", "relaxed"], ["Average", "average"], ["Very tidy", "tidy"]],
  noise: [["Quiet", "quiet"], ["Some noise is fine", "moderate"], ["Lively", "lively"]],
  guests: [["Rarely", "rarely"], ["Sometimes", "sometimes"], ["Often", "often"]],
  pets: [["No pets, please", "no_pets"], ["OK with pets", "ok_with_pets"], ["I have a pet", "have_pets"]],
  smoking: [["No smoking", "no_smoking"], ["OK outside", "outside_ok"], ["I smoke", "smoker"]],
  chores: [["A chore schedule", "rotating_schedule"], ["Split by task", "split_by_task"], ["As needed", "as_needed"], ["Skip", null]],
};

// Keyword rules for lifestyle answers given in a sentence.
const LIFESTYLE = [
  ["sleep_schedule", "early", /\b(early (bird|riser)|wake up early|up early|morning person|go to bed early)\b/],
  ["sleep_schedule", "late", /\b(night owl|stay up late|late nights?|go to bed late|up late)\b/],
  ["cleanliness", "tidy", /\b(very (tidy|clean|neat)|neat freak|super (tidy|clean)|tidy|neat)\b/],
  ["cleanliness", "relaxed", /\b(messy|relaxed about (mess|cleaning|tidiness)|not (very|too|that) tidy)\b/],
  ["noise", "quiet", /\b(quiet)\b/],
  ["noise", "lively", /\b(lively|loud|parties|party)\b/],
  ["guests", "rarely", /\b(rarely|never|hardly ever) (have )?(guests|people|friends)( over)?\b|\bno guests\b/],
  ["guests", "often", /\b(often|always|a lot of|lots of) (have )?(guests|people over|friends over)\b/],
  ["pets", "have_pets", /\b(i have a|my) (dog|cat|pet|puppy|kitten|rabbit|bird)\b/],
  ["pets", "no_pets", /\bno pets\b/],
  ["pets", "ok_with_pets", /\b(ok|okay|fine) with pets\b|\bpets are (ok|okay|fine)\b|\blove pets\b/],
  ["smoking", "no_smoking", /\b(non-?smoker|don'?t smoke|do not smoke|no smoking|smoke-free)\b/],
  ["smoking", "outside_ok", /\b(smoking|smoke) outside\b|\boutside is (ok|okay|fine)\b/],
  ["smoking", "smoker", /\b(i smoke|i'm a smoker|i am a smoker)\b/],
  ["chores", "rotating_schedule", /\bchore (chart|wheel|schedule|rotation)\b|\brotate chores\b/],
  ["chores", "split_by_task", /\bsplit (the )?(chores|tasks)\b/],
  ["chores", "as_needed", /\bchores as needed\b|\bwhoever notices\b/],
];

function parseMoney(text) {
  const t = text.toLowerCase();
  const hasContext = /\$|budget|rent|afford|pay|spend|per month|a month|\/mo|monthly|dollars|bucks|under|up to|max|below|less than|around|between/.test(t);
  const found = [];
  const re = /(\$\s?)?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(\s?k\b)?/g;
  let m;
  while ((m = re.exec(t))) {
    const [all, dollar, num, k] = m;
    let n = Number(num.replace(/,/g, ""));
    if (k) n *= 1000;
    const after = t.slice(m.index + all.length, m.index + all.length + 12);
    const before = t.slice(Math.max(0, m.index - 12), m.index);
    const isYear = !dollar && !k && n >= 2020 && n <= 2100 && (MONTH_RE.test(before) || /^\s*-\s*\d/.test(after) || /\b(in|of|by)\s*$/.test(before));
    const isUnit = /^\s*(km|kilomet|mi\b|miles?|min|minutes?|months?|rooms?|bed|br\b|people|roommates?|%)/.test(after);
    if (isYear || isUnit) continue;
    if (dollar || k || (hasContext && n >= 200 && n <= 50000)) found.push(n);
  }
  return found;
}

// Returns { updates, intents, asked } from one message. updates uses the memory input shape.
export function understand(text, today, lastAsked) {
  const t = text.toLowerCase();
  const updates = {};
  const intents = new Set();

  // An exact quick-reply answer to the question just asked.
  if (lastAsked && OPTION_ANSWERS[lastAsked]) {
    const hit = OPTION_ANSWERS[lastAsked].find(([label]) => t.trim().replace(/[.!]$/, "") === label.toLowerCase());
    if (hit) {
      if (hit[1] != null) updates[lastAsked] = hit[1];
      else intents.add("skip");
    }
  }

  if (/\broom ?mates?\b|\bhouse ?mates?\b|\bflat ?mates?\b/.test(t)) {
    intents.add("roommates");
    if (!/\b(no|don'?t (want|need)|without) room ?mates?\b/.test(t)) updates.looking_for ??= /\broom\b|\bplace\b|\bapartment\b/.test(t) ? "both" : "roommates";
  } else if (/\b(find|need|want|looking for|search(ing)? for)\b.*\b(room|place|apartment|housing)\b/.test(t)) updates.looking_for ??= "room";
  if (/^\s*(hi|hello|hey|good (morning|afternoon|evening))\b/.test(t)) intents.add("greeting");
  if (/\bsave\b.*\b(profile|answers|preferences)\b/.test(t)) intents.add("save");
  if (/\b(consider|tips?|advice|checklist|what should i (know|ask|check|think about)|scam|deposit)\b/.test(t)) intents.add("considerations");
  if (/\b(show|hide|include)\b.*\b(sample|demo|fictional)\b|\b(sample|demo|fictional) (listings?|rooms?|data|people)\b/.test(t)) {
    updates.include_samples = !/\b(hide|no|without|exclude)\b/.test(t);
    intents.add("search");
  }
  if (/\b(show|find|search|see|any|look(ing)? for)\b.*\b(rooms?|places?|apartments?|listings?|options?|matches|results)\b/.test(t)) intents.add("search");

  // Budget
  const amounts = parseMoney(text);
  if (amounts.length >= 2 && /\b(between|from|-|to)\b|\d\s*-\s*\$?\d/.test(t)) {
    updates.budget_min = Math.min(...amounts.slice(0, 2));
    updates.budget_max = Math.max(...amounts.slice(0, 2));
  } else if (amounts.length && /\bat least\b|\bminimum\b/.test(t)) updates.budget_min = amounts[0];
  else if (amounts.length) updates.budget_max = Math.max(...amounts);
  if (updates.budget_max != null || lastAsked === "budget_max") {
    if (/\b(hard|strict|firm|can'?t go over|cannot go over|no more than|at most|maximum)\b/.test(t)) (updates.must_have ??= []).push("budget_max");
    else if (/\b(flexible|-?ish|roughly|can stretch|could stretch|a bit more)\b/.test(t)) (updates.flexible ??= []).push("budget_max");
  }

  // Move-in month
  const iso = t.match(/\b(20\d\d)-(0[1-9]|1[0-2])\b/);
  const month = t.match(MONTH_RE);
  if (iso) updates.move_in_month = `${iso[1]}-${iso[2]}`;
  else if (month && (month[1].slice(0, 3) !== "may" || month[2] || /\b(in|from|by|early|mid|late|start of|end of)\s+may\b/.test(t) || lastAsked === "move_in_month")) {
    const n = MONTH_WORDS.indexOf(month[1].slice(0, 3)) + 1;
    updates.move_in_month = month[2] ? `${month[2]}-${String(n).padStart(2, "0")}` : nextOccurrence(n, today);
  } else {
    const season = t.match(/\b(fall|autumn|spring|summer|winter)\b(?:\s*(20\d\d))?/);
    if (season && (lastAsked === "move_in_month" || /\b(move|start|semester|lease)\b/.test(t))) {
      const n = SEASONS[season[1]];
      updates.move_in_month = season[2] ? `${season[2]}-${String(n).padStart(2, "0")}` : nextOccurrence(n, today);
    }
  }

  // Areas and distance
  const areas = [];
  let rest = text;
  for (const name of AREA_NAMES) {
    const re = new RegExp(`\\b${escapeRe(name)}\\b`, "i");
    if (re.test(rest)) {
      areas.push(name);
      rest = rest.replace(re, " ");
    }
  }
  if (areas.length) {
    updates.areas = areas.slice(0, 4);
    if (/\bonly\b/.test(t)) (updates.must_have ??= []).push("areas");
    else if (/\b(or nearby|flexible|anywhere|open to)\b/.test(t)) (updates.flexible ??= []).push("areas");
  }
  const dist = t.match(/(\d+(?:\.\d+)?)\s*(km|kilomet(?:er|re)s?|mi\b|miles?)/);
  if (dist) updates.max_distance_km = Math.min(50, Math.max(0.5, Number(dist[1]) * (dist[2].startsWith("k") ? 1 : 1.609)));
  else if (/\bwalk(ing|able)?\b.*\b(distance|campus|brandeis)\b|\bwalking distance\b/.test(t)) updates.max_distance_km = 2;
  else if (/\b(bike|biking|cycle)\b/.test(t)) updates.max_distance_km = 5;
  else if (/\b(near|close to|next to|by) (campus|brandeis)\b/.test(t)) updates.max_distance_km = 3;

  // Rooms
  // "a room" is what they want, not how many, so only numbers count here.
  const rooms = t.match(/\b(\d+|one|single|two|three|four|five|six)\s+(?:bed)?rooms?\b/) || t.match(/\b(\d+)\s*(?:br|beds?|bedrooms?)\b/);
  if (rooms) {
    const n = NUMBER_WORDS[rooms[1]] ?? Number(rooms[1]);
    if (n >= 1 && n <= 10) updates.rooms_needed = n;
  } else if (/\b(just me|only me|myself|alone|by myself)\b/.test(t)) updates.rooms_needed = 1;
  else if (/\b(with|and) (a|one) friend\b/.test(t)) updates.rooms_needed = 2;
  else if (/\b(with|and) (two|2) friends\b/.test(t)) updates.rooms_needed = 3;

  // Lease length
  const lease = t.match(/\b(\d{1,2})\s*-?\s*months?\s*lease\b|\blease\s*(?:of|for)?\s*(\d{1,2})\s*months?\b/);
  if (lease) updates.lease_months = Number(lease[1] || lease[2]);
  else if (/\b(one|1|a)[- ]year lease\b|\b12-month\b/.test(t)) updates.lease_months = 12;

  // Lifestyle
  for (const [field, value, re] of LIFESTYLE) if (updates[field] == null && re.test(t)) updates[field] = value;

  return { updates, intents };
}

// Same questions, order and answers as before; only the wording is shorter. Each answer button keeps its meaning
// (OPTION_ANSWERS maps the labels to the stored values; the rest are read by understand()).
const QUESTIONS = {
  looking_for: () => ({ text: "What are you looking for?", options: OPTION_ANSWERS.looking_for.map(([l]) => l) }),
  budget_max: () => ({ text: "What's your max rent per month?", options: ["Up to $900", "Up to $1,200", "Up to $1,500", "Up to $2,000"] }),
  move_in_month: (today) => ({
    text: "When do you want to move in?",
    options: [1, 5, 6, 9].map((n) => nextOccurrence(n, today)).sort().map((ym) => fmtMonth(ym).replace(/^(\w+)/, (m) => ({ Jan: "January", May: "May", Jun: "June", Sep: "September" })[m] || m)),
  }),
  areas: (today, memory) =>
    memory?.v.max_distance_km != null
      ? { text: "Which town should go on your profile? Roommate matching goes by town.", options: ["Waltham", "Newton", "Watertown"] }
      : { text: "Where do you want to live? Pick a town, or how far from campus works.", options: ["Waltham", "Newton", "Watertown", "Within 3 km of campus"] },
  rooms_needed: () => ({ text: "How many rooms do you need?", options: ["Just me", "2 rooms", "3 rooms"] }),
  sleep_schedule: () => ({ text: "Now a few roommate questions. Early bird, night owl, or flexible?", options: OPTION_ANSWERS.sleep_schedule.map(([l]) => l) }),
  cleanliness: () => ({ text: "How tidy do you keep your place?", options: OPTION_ANSWERS.cleanliness.map(([l]) => l) }),
  noise: () => ({ text: "How much noise is OK at home?", options: OPTION_ANSWERS.noise.map(([l]) => l) }),
  guests: () => ({ text: "How often do you have people over?", options: OPTION_ANSWERS.guests.map(([l]) => l) }),
  pets: () => ({ text: "How do you feel about pets?", options: OPTION_ANSWERS.pets.map(([l]) => l) }),
  smoking: () => ({ text: "And smoking?", options: OPTION_ANSWERS.smoking.map(([l]) => l) }),
  chores: () => ({ text: "Last one, and optional: how do you like to split chores?", options: OPTION_ANSWERS.chores.map(([l]) => l) }),
};

export function question(field, today, memory) {
  return { field, ...QUESTIONS[field](today, memory) };
}

// The next thing to ask, or null when nothing is missing for what the renter wants.
export function nextQuestion(memory, { wantsRoommates, skipped = [] } = {}) {
  const basics = missingBasics(memory).filter((f) => !skipped.includes(f));
  if (basics.length) return basics[0];
  if (wantsRoommates) {
    const life = ROOMMATE_FIELDS.find((f) => memory.v[f] == null);
    if (life) return life;
    if (memory.v.chores == null && !skipped.includes("chores")) return "chores";
  }
  return null;
}

const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

// "2 match everything, 1 partly": the same words as the results panel.
export function exactSplit(total, exact) {
  if (exact >= total) return total === 1 ? "it matches everything" : "all match everything";
  if (!exact) return total === 1 ? "a partial match" : "all partial matches";
  return `${exact} ${exact === 1 ? "matches" : "match"} everything, ${total - exact} partly`;
}

// The Results panel shows every card with what fits and what doesn't; the chat says what was found, in short.
export function describeRooms(found) {
  const lines = [];
  const n = found.totalMatching;
  if (found.results.length) {
    const exact = found.exactMatching;
    lines.push(
      `${n === 1 ? "1 room fits" : `${n} rooms fit`} your must-haves: ${exactSplit(n, exact)}.`
    );
    lines.push(`Top pick: ${found.results[0].ref} · ${found.results[0].name}${found.results[0].sample ? " (sample, fictional)" : ""}, ${money(found.results[0].monthly_rent)} a month.`);
  } else {
    lines.push("No rooms match all your must-haves right now.");
    if (found.ifRelaxed.length) {
      lines.push("Changing one would help:");
      for (const o of found.ifRelaxed) lines.push(`- ${o.change}: ${plural(o.extraRooms, "more room")}`);
      lines.push("Want to change one? Tap it in Results, or tell me.");
    } else lines.push("Nothing comes close yet. New rooms get listed all the time, so check back.");
  }
  if (found.samplesHidden) lines.push(`${plural(found.samplesHidden, "sample (fictional) listing")} also ${found.samplesHidden === 1 ? "fits" : "fit"}. Say “show sample listings” to see ${found.samplesHidden === 1 ? "it" : "them"}.`);
  return lines.join("\n");
}

export function describeRoommates(found) {
  if (!found.results.length) {
    const tail = found.samplesHidden ? ` (${plural(found.samplesHidden, "sample person", "sample people")} would fit. Say “show sample listings” to include them.)` : "";
    return `Nobody who's open to roommates fits your area, timing and lifestyle yet.${tail} Check back as more students join.`;
  }
  const n = found.totalMatching;
  const top = found.results[0];
  return [
    `${n === 1 ? "1 student fits" : `${n} students fit`}. You only see people who chose to be found.`,
    `Top pick: ${top.ref}${top.sample ? " (sample, fictional)" : ""}, ${top.score}% compatible. The cards show what you have in common.`,
  ].join("\n");
}

export const CONSIDERATIONS = [
  "Worth checking before you sign:",
  "- Move-in cost: first month, plus any last month's rent and security deposit. Get the list in writing.",
  "- What's included: heat, hot water, electricity, internet. Listings often don't say, so ask.",
  "- Lease dates: do they fit your school year? Can you sublet for the summer?",
  "- Getting to campus in winter: walk, bike or shuttle.",
  "- See the place (in person or on a live video call) before paying anything. Never wire money to someone you haven't verified.",
  "- Keep the lease and every payment in writing.",
  "Questions about tenant rights? The Massachusetts Attorney General's guide for tenants and your university's housing office can help.",
].join("\n");

export const BASIC_INTRO = "Tap an answer, or type something short like “$1,200”, “June” or “Waltham”.";

export const describeAnswer = (field, value) => {
  if (field === "budget_max") return `budget up to ${money(value)}`;
  if (field === "move_in_month") return `moving in ${fmtMonth(value)}`;
  if (field === "areas") return value.join(", ");
  if (field === "max_distance_km") return `within ${value} km of Brandeis`;
  if (field === "rooms_needed") return plural(value, "room");
  return null;
};
