// Demo mode: 100 fictional room listings and 200 fictional roommate profiles in Waltham, for trying coHabit.
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
// Photos are illustrative stock photos from Unsplash (free under the Unsplash License), loaded from Unsplash's
// image servers. They never show the listing they're on. Sources are listed in docs/DEMO_DATA.md. Profile pictures
// are illustrated avatars drawn by coHabit's own code from a few settings, not photos of anyone.
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
export const asPerson = (p) => ({ ...p, about: p.program, area: areaText(p), demo: true });

export const DEMO_LISTINGS = [...HAND_LISTINGS, ...GENERATED_LISTINGS].map(asListing);
export const DEMO_PEOPLE = [...HAND_PEOPLE, ...GENERATED_PEOPLE].map(asPerson);
export const DEMO_COUNTS = { listings: DEMO_LISTINGS.length, people: DEMO_PEOPLE.length, shown: DEMO_PEOPLE.filter((p) => p.discoverable).length };

export const isDemoId = (id) => typeof id === "string" && id.startsWith("demo-");
export const demoListing = (id) => DEMO_LISTINGS.find((u) => u.id === id) || null;
export const demoPerson = (id) => DEMO_PEOPLE.find((p) => p.id === id && p.discoverable) || null;

// DEMO_DATA=off (a Worker variable) turns Demo mode off everywhere. It's on unless set to "off".
export const demoDataOn = (env) => String(env?.DEMO_DATA ?? "").trim().toLowerCase() !== "off";
