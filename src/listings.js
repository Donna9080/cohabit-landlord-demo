// What renters may see of coHabit units, shared by /api/listings, room matches and the assistant.

// "sample" marks fictional demo listings (owned by users whose id starts with "sample-"; see scripts/sample-data.mjs).
export const LISTING_FIELDS =
  "id, name, area, monthly_rent, rooms_available, move_in_date, description, (landlord_user_id LIKE 'sample-%') AS sample, address, lat, lng, location_precision";

// What renters may see of a unit's location. For "approximate" the exact point and the street
// address never leave the server: the point is snapped to a ~400 m grid and moved by a secret,
// per-unit offset, so the true spot is always inside the 500 m circle but can't be worked out.
export const APPROX_RADIUS_M = 500;
function approximatePoint(id, lat, lng, salt) {
  const cell = 0.004;
  let h = 2166136261;
  for (const ch of salt + id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  const dx = ((h & 0xffff) / 0xffff - 0.5) * 0.0024;
  const dy = ((h >>> 16) / 0xffff - 0.5) * 0.0024;
  return { lat: +(Math.round(lat / cell) * cell + dy).toFixed(4), lng: +(Math.round(lng / cell) * cell + dx).toFixed(4) };
}
function publicLocation(u, salt) {
  if (u.lat == null || u.lng == null) return null;
  if (u.location_precision === "exact") return { precision: "exact", lat: u.lat, lng: u.lng, address: u.address };
  return { precision: "approximate", radiusM: APPROX_RADIUS_M, ...approximatePoint(u.id, u.lat, u.lng, salt) };
}

export const listingMapper = (env) => (u) => {
  const { lat, lng, location_precision, address, ...rest } = u;
  return { ...rest, sample: !!u.sample, location: publicLocation(u, env.BETTER_AUTH_SECRET || "") };
};

export async function sampleListingsHidden(db) {
  const row = await db.prepare(`SELECT value FROM app_settings WHERE key = 'hide_sample_listings'`).first();
  return row?.value === "1";
}
export const noSamples = (hidden) => (hidden ? " AND landlord_user_id NOT LIKE 'sample-%'" : "");

// Active coHabit units as renters see them.
export async function activeListings(db, env, { includeSamples = true } = {}) {
  const hidden = !includeSamples || (await sampleListingsHidden(db));
  const { results } = await db
    .prepare(`SELECT ${LISTING_FIELDS} FROM units WHERE status = 'active'${noSamples(hidden)} ORDER BY move_in_date, id LIMIT 200`)
    .all();
  return results.map(listingMapper(env));
}
