// Demo mode: 50 fictional room listings and 50 fictional roommate profiles in Waltham, for trying coHabit (plus 3
// profiles that chose not to be found, which are never shown). 100 listings and 200 profiles were written; 52
// profiles were taken out on 2026-11-15 (REMOVED_PEOPLE) and 50 listings and 95 profiles archived on 2026-11-16
// (ARCHIVED_LISTINGS, ARCHIVED_PEOPLE). Taken-out and archived records stay in the data files, so they can be restored.
//
// They live in code, never in the database, so they can't be seeded twice and can't mix with real listings or
// people. They appear only while someone has Demo mode on (Listings, My matches, the assistant and the demo profile
// page), always labeled, and never in real searches, real matches, requests, the admin user list or any count.
// Every id starts with "demo-". Nothing here is real: no real places' availability, no real people, no contact
// details. Locations are made-up points in Waltham neighborhoods, shown only as approximate areas (about 500 m).
// Roommate profiles have a first name and the areas they're looking in, never a location. Scores and "fits" come
// from the normal matching code, which never sees anything about gender (there is no such field).
//
// The first 15 listings and 20 profiles are written by hand in demo-base.js; scripts/demo-build.mjs writes the rest
// to demo-generated.js the same way every time (fixed seed) and checks the coverage targets with the matching code
// (npm run demo:check). Setting DEMO_DATA=off turns Demo mode off everywhere without touching anything else.
//
// Listing photos are illustrative stock photos from Unsplash (free under the Unsplash License, each re-checked on its
// photo page on 2026-11-16), loaded from Unsplash's image servers. They never show the listing they're on, and no photo
// is on two kept listings: a listing whose photo is already on an earlier kept listing has none and shows coHabit's
// drawing instead. Profiles have no photo: no AI-generated images and no stock photos of people, so every screen shows
// their initials. (The AI portraits used until 2026-11-16 are kept, not served, in archive/demo-faces; the old
// illustrated-avatar settings are still in the data but not shown.) Sources are listed in docs/DEMO_DATA.md.
import { HAND_LISTINGS, HAND_PEOPLE, PHOTOS } from "./demo-base.js";
import { GENERATED_LISTINGS, GENERATED_PEOPLE } from "./demo-generated.js";

const UNSPLASH_LICENSE = "Unsplash License";
const LICENSE_URL = "https://unsplash.com/license";
const ref = "utm_source=cohabit&utm_medium=referral";

function photo(key) {
  const p = PHOTOS[key];
  if (!p) throw new Error(`Unknown demo photo ${key}`);
  return {
    src: `https://images.unsplash.com/${p.file}`,
    alt: `Illustrative photo: ${p.alt}`,
    credit: p.by,
    creditUrl: `https://unsplash.com/@${p.username}?${ref}`,
    source: "Unsplash",
    sourceUrl: `https://unsplash.com/photos/${p.id}?${ref}`,
    license: UNSPLASH_LICENSE,
    licenseUrl: LICENSE_URL,
  };
}

// The stored shapes (demo-base.js, demo-generated.js) as the rest of coHabit sees them.
export const asListing = (u) => ({
  ...u,
  location: { precision: "approximate", lat: u.location[0], lng: u.location[1], radiusM: 500 },
  photo: photo(u.photo),
  photoKey: u.photo,
  demo: true,
  sample: false,
});
export const areaText = (p) => (p.looking_in.length ? `Waltham (${p.looking_in.join(", ")})` : `Waltham (within ${p.max_distance_km} km of Brandeis)`);

// No profile photo (initials everywhere).
export const asPerson = (p) => ({ ...p, about: p.program, area: areaText(p), demo: true, photo: null });

// Every record written, before anything is taken out or archived. Nothing on the site reads these (tests check the
// whole written set, and restoring a record starts here).
export const WRITTEN_LISTINGS = [...HAND_LISTINGS, ...GENERATED_LISTINGS].map(asListing);
export const WRITTEN_PEOPLE = [...HAND_PEOPLE, ...GENERATED_PEOPLE].map(asPerson);

// Made-up profiles taken out of Demo mode on 2026-11-15: their AI portraits were never made (Workers AI's free daily
// allowance ran out) and the owner chose to remove them rather than show them without a face. Their records stay in
// demo-base.js and demo-generated.js, so the generator stays repeatable; take an id out of this list to bring that
// profile back (it would show initials).
export const REMOVED_PEOPLE = new Set([
  "demo-p44", "demo-p67", "demo-p100", "demo-p152", "demo-p153", "demo-p154", "demo-p155", "demo-p156", "demo-p157", "demo-p158",
  "demo-p159", "demo-p160", "demo-p161", "demo-p162", "demo-p163", "demo-p164", "demo-p165", "demo-p166", "demo-p167", "demo-p168",
  "demo-p169", "demo-p170", "demo-p171", "demo-p172", "demo-p173", "demo-p174", "demo-p175", "demo-p176", "demo-p177", "demo-p178",
  "demo-p179", "demo-p180", "demo-p181", "demo-p182", "demo-p183", "demo-p184", "demo-p185", "demo-p186", "demo-p187", "demo-p188",
  "demo-p189", "demo-p190", "demo-p191", "demo-p192", "demo-p193", "demo-p194", "demo-p195", "demo-p196", "demo-p197", "demo-p198",
  "demo-p199", "demo-p200",
]);
// Archived on 2026-11-16 with the owner's approval, so Demo mode keeps the 50 strongest profiles and 50 strongest
// listings: every kept profile has 3+ mutually compatible kept roommates and 3+ kept rooms that fit everything it
// asked for, and every kept listing suits at least one kept profile (how they were chosen: docs/DEMO_DATA.md).
// Archived records are left out everywhere: Listings, Roommates, My matches, Vibe, the assistant, Details and counts.
// A bookmark pointing at one shows "no longer available" (the database row isn't touched). To restore a record,
// delete its line here; the coverage tests then say whether everyone still has enough matches.
// Later the same day, at the owner's request, two smokers came back so smoking shows up in the demo: Gus (demo-p07)
// and Ahmed (demo-p121) replaced Jules (demo-p10) and Carmen (demo-p131): a senior and a Master's student like them,
// and nobody else loses their only strong match. No single swap worked: each smoker needs 3 kept roommates who don't
// want no smoking, so they need each other.
export const ARCHIVED_LISTINGS = new Map([
  ["demo-02", "not chosen"],
  ["demo-05", "not chosen"],
  ["demo-06", "not chosen"],
  ["demo-07", "not chosen"],
  ["demo-11", "not chosen"],
  ["demo-12", "not chosen"],
  ["demo-14", "not chosen"],
  ["demo-15", "over $1,700 per person"],
  ["demo-16", "not chosen"],
  ["demo-23", "not chosen"],
  ["demo-26", "not chosen"],
  ["demo-28", "duplicate of demo-08"],
  ["demo-29", "not chosen"],
  ["demo-30", "not chosen"],
  ["demo-31", "not chosen"],
  ["demo-32", "not chosen"],
  ["demo-33", "not chosen"],
  ["demo-34", "not chosen"],
  ["demo-37", "not chosen"],
  ["demo-39", "not chosen"],
  ["demo-40", "duplicate of demo-08"],
  ["demo-41", "not chosen"],
  ["demo-45", "not chosen"],
  ["demo-48", "not chosen"],
  ["demo-52", "not chosen"],
  ["demo-55", "not chosen"],
  ["demo-56", "over $1,700 per person"],
  ["demo-57", "not chosen"],
  ["demo-59", "move-in date passed"],
  ["demo-61", "move-in date passed"],
  ["demo-63", "not chosen"],
  ["demo-68", "duplicate of demo-08"],
  ["demo-70", "not chosen"],
  ["demo-71", "not chosen"],
  ["demo-72", "not chosen"],
  ["demo-74", "duplicate of demo-73"],
  ["demo-77", "not chosen"],
  ["demo-78", "not chosen"],
  ["demo-79", "not chosen"],
  ["demo-85", "not chosen"],
  ["demo-86", "not chosen"],
  ["demo-87", "not chosen"],
  ["demo-88", "not chosen"],
  ["demo-89", "not chosen"],
  ["demo-91", "not chosen"],
  ["demo-93", "duplicate of demo-87"],
  ["demo-95", "duplicate of demo-75"],
  ["demo-96", "not chosen"],
  ["demo-98", "not chosen"],
  ["demo-99", "not chosen"],
]);
export const ARCHIVED_PEOPLE = new Map([
  ["demo-p02", "not chosen"],
  ["demo-p05", "not chosen"],
  ["demo-p08", "fewer than 3 compatible roommates"],
  ["demo-p10", "swapped out for the smokers demo-p07 and demo-p121"],
  ["demo-p18", "not chosen"],
  ["demo-p21", "not chosen"],
  ["demo-p22", "not chosen"],
  ["demo-p23", "not chosen"],
  ["demo-p24", "not chosen"],
  ["demo-p25", "not chosen"],
  ["demo-p27", "not chosen"],
  ["demo-p28", "not chosen"],
  ["demo-p31", "fewer than 3 suitable rooms"],
  ["demo-p32", "fewer than 3 compatible roommates"],
  ["demo-p33", "budget over $1,800"],
  ["demo-p34", "not chosen"],
  ["demo-p35", "not chosen"],
  ["demo-p37", "not chosen"],
  ["demo-p38", "fewer than 3 compatible roommates"],
  ["demo-p40", "fewer than 3 suitable rooms"],
  ["demo-p41", "not chosen"],
  ["demo-p42", "not chosen"],
  ["demo-p43", "not chosen"],
  ["demo-p45", "not chosen"],
  ["demo-p46", "not chosen"],
  ["demo-p50", "fewer than 3 suitable rooms"],
  ["demo-p51", "fewer than 3 suitable rooms"],
  ["demo-p56", "not chosen"],
  ["demo-p58", "not chosen"],
  ["demo-p59", "fewer than 3 suitable rooms"],
  ["demo-p64", "not chosen"],
  ["demo-p65", "fewer than 3 suitable rooms"],
  ["demo-p68", "fewer than 3 suitable rooms"],
  ["demo-p69", "not chosen"],
  ["demo-p70", "not chosen"],
  ["demo-p72", "not chosen"],
  ["demo-p73", "not chosen"],
  ["demo-p74", "not chosen"],
  ["demo-p75", "not chosen"],
  ["demo-p76", "fewer than 3 suitable rooms"],
  ["demo-p77", "not chosen"],
  ["demo-p79", "not chosen"],
  ["demo-p80", "fewer than 3 suitable rooms"],
  ["demo-p81", "not chosen"],
  ["demo-p82", "not chosen"],
  ["demo-p83", "not chosen"],
  ["demo-p84", "not chosen"],
  ["demo-p85", "not chosen"],
  ["demo-p86", "fewer than 3 suitable rooms"],
  ["demo-p87", "not chosen"],
  ["demo-p88", "not chosen"],
  ["demo-p89", "budget over $1,800"],
  ["demo-p90", "not chosen"],
  ["demo-p91", "not chosen"],
  ["demo-p92", "not chosen"],
  ["demo-p93", "fewer than 3 suitable rooms"],
  ["demo-p96", "fewer than 3 suitable rooms"],
  ["demo-p97", "not chosen"],
  ["demo-p98", "fewer than 3 suitable rooms"],
  ["demo-p99", "not chosen"],
  ["demo-p101", "not chosen"],
  ["demo-p102", "not chosen"],
  ["demo-p103", "not chosen"],
  ["demo-p104", "budget over $1,800"],
  ["demo-p105", "not chosen"],
  ["demo-p109", "not chosen"],
  ["demo-p110", "not chosen"],
  ["demo-p111", "not chosen"],
  ["demo-p112", "not chosen"],
  ["demo-p115", "not chosen"],
  ["demo-p116", "not chosen"],
  ["demo-p117", "not chosen"],
  ["demo-p122", "not chosen"],
  ["demo-p123", "not chosen"],
  ["demo-p125", "not chosen"],
  ["demo-p126", "not chosen"],
  ["demo-p127", "fewer than 3 suitable rooms"],
  ["demo-p128", "fewer than 3 suitable rooms"],
  ["demo-p129", "not chosen"],
  ["demo-p130", "not chosen"],
  ["demo-p131", "swapped out for the smokers demo-p07 and demo-p121"],
  ["demo-p132", "not chosen"],
  ["demo-p133", "not chosen"],
  ["demo-p134", "not chosen"],
  ["demo-p136", "not chosen"],
  ["demo-p137", "not chosen"],
  ["demo-p138", "not chosen"],
  ["demo-p140", "not chosen"],
  ["demo-p142", "not chosen"],
  ["demo-p143", "budget over $1,800"],
  ["demo-p145", "budget over $1,800"],
  ["demo-p146", "not chosen"],
  ["demo-p147", "not chosen"],
  ["demo-p149", "fewer than 3 compatible roommates"],
  ["demo-p150", "fewer than 3 compatible roommates"],
]);

// The kept listings, in order; the first kept listing with a photo keeps it, later ones show the drawing.
const photoSeen = new Set();
export const DEMO_LISTINGS = WRITTEN_LISTINGS.filter((u) => !ARCHIVED_LISTINGS.has(u.id)).map((u) => {
  if (!photoSeen.has(u.photoKey)) {
    photoSeen.add(u.photoKey);
    return u;
  }
  return { ...u, photo: null };
});
export const DEMO_PEOPLE = WRITTEN_PEOPLE.filter((p) => !REMOVED_PEOPLE.has(p.id) && !ARCHIVED_PEOPLE.has(p.id));
export const DEMO_COUNTS = { listings: DEMO_LISTINGS.length, people: DEMO_PEOPLE.length, shown: DEMO_PEOPLE.filter((p) => p.discoverable).length };

export const isDemoId = (id) => typeof id === "string" && id.startsWith("demo-");
export const demoListing = (id) => DEMO_LISTINGS.find((u) => u.id === id) || null;
export const demoPerson = (id) => DEMO_PEOPLE.find((p) => p.id === id && p.discoverable) || null;

// DEMO_DATA=off (a Worker variable) turns Demo mode off everywhere. It's on unless set to "off".
export const demoDataOn = (env) => String(env?.DEMO_DATA ?? "").trim().toLowerCase() !== "off";
