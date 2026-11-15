// Demo mode: 100 fictional room listings and 148 fictional roommate profiles in Waltham, for trying coHabit.
// (200 profiles were written; 52 were taken out on 2026-11-15, see REMOVED_PEOPLE below.)
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
// Listing photos are illustrative stock photos from Unsplash (free under the Unsplash License), loaded from
// Unsplash's image servers. They never show the listing they're on. Profile photos are AI-generated portraits of
// people who don't exist (FLUX.1 [schnell], Apache License 2.0, made with Cloudflare Workers AI): one fixed file per
// shown profile in public/demo-faces, so each face is the same on every screen, and every screen labels it
// "AI-generated photo". Sources and prompts are listed in docs/DEMO_DATA.md. (The old illustrated-avatar settings are
// still in the data but no longer shown.)
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

// A made-up profile's AI-generated portrait (public/demo-faces/<id>.webp), or null for the profiles that are
// never shown. The person in it doesn't exist.
function portrait(p) {
  if (!p.discoverable) return null;
  return {
    src: `/demo-faces/${p.id}.webp`,
    alt: `AI-generated photo for ${p.firstName}, a made-up demo profile (not a real person)`,
    ai: true,
    credit: "FLUX.1 [schnell] by Black Forest Labs",
    creditUrl: "https://huggingface.co/black-forest-labs/FLUX.1-schnell",
    source: "Cloudflare Workers AI",
    sourceUrl: "https://developers.cloudflare.com/workers-ai/models/flux-1-schnell/",
    license: "Apache License 2.0",
    licenseUrl: "https://www.apache.org/licenses/LICENSE-2.0",
  };
}
export const asPerson = (p) => ({ ...p, about: p.program, area: areaText(p), demo: true, photo: portrait(p) });

export const DEMO_LISTINGS = [...HAND_LISTINGS, ...GENERATED_LISTINGS].map(asListing);
// Made-up profiles taken out of Demo mode on 2026-11-15: their AI portraits were never made (Workers AI's free daily
// allowance ran out) and the owner chose to remove them rather than show them without a face. Their records stay in
// demo-base.js and demo-generated.js, so the generator stays repeatable; take an id out of this list to bring that
// profile back once it has a photo in public/demo-faces.
export const REMOVED_PEOPLE = new Set([
  "demo-p44", "demo-p67", "demo-p100", "demo-p152", "demo-p153", "demo-p154", "demo-p155", "demo-p156", "demo-p157", "demo-p158",
  "demo-p159", "demo-p160", "demo-p161", "demo-p162", "demo-p163", "demo-p164", "demo-p165", "demo-p166", "demo-p167", "demo-p168",
  "demo-p169", "demo-p170", "demo-p171", "demo-p172", "demo-p173", "demo-p174", "demo-p175", "demo-p176", "demo-p177", "demo-p178",
  "demo-p179", "demo-p180", "demo-p181", "demo-p182", "demo-p183", "demo-p184", "demo-p185", "demo-p186", "demo-p187", "demo-p188",
  "demo-p189", "demo-p190", "demo-p191", "demo-p192", "demo-p193", "demo-p194", "demo-p195", "demo-p196", "demo-p197", "demo-p198",
  "demo-p199", "demo-p200",
]);
export const DEMO_PEOPLE = [...HAND_PEOPLE, ...GENERATED_PEOPLE].filter((p) => !REMOVED_PEOPLE.has(p.id)).map(asPerson);
export const DEMO_COUNTS = { listings: DEMO_LISTINGS.length, people: DEMO_PEOPLE.length, shown: DEMO_PEOPLE.filter((p) => p.discoverable).length };

export const isDemoId = (id) => typeof id === "string" && id.startsWith("demo-");
export const demoListing = (id) => DEMO_LISTINGS.find((u) => u.id === id) || null;
export const demoPerson = (id) => DEMO_PEOPLE.find((p) => p.id === id && p.discoverable) || null;

// DEMO_DATA=off (a Worker variable) turns Demo mode off everywhere. It's on unless set to "off".
export const demoDataOn = (env) => String(env?.DEMO_DATA ?? "").trim().toLowerCase() !== "off";
