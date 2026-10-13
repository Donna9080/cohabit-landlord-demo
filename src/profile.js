// A renter's saved profile (questionnaire answers) and "I'm interested" requests. Shared by the
// renter routes and the assistant, so a change confirmed in the chat is saved exactly like the form.
import { HttpError } from "./http.js";

export const MAX_INTERESTS_PER_RENTER = 20;

export const PREF_FIELDS =
  "budget_min, budget_max, move_in_month, area, rooms_needed, sleep_schedule, cleanliness, noise, guests, pets, smoking, chores, roommate_visible, share_email, share_profile, updated_at";
export const asPrefs = (p) => p && { ...p, roommate_visible: !!p.roommate_visible, share_email: !!p.share_email, share_profile: !!p.share_profile };

export const loadPreferences = (db, userId) =>
  db.prepare(`SELECT ${PREF_FIELDS} FROM match_preferences WHERE user_id = ?1`).bind(userId).first();

// p comes from parsePreferences (src/validate.js).
export async function savePreferences(db, userId, p) {
  const now = Date.now();
  const saved = await db
    .prepare(
      `INSERT INTO match_preferences (user_id, budget_min, budget_max, move_in_month, area, rooms_needed,
         sleep_schedule, cleanliness, noise, guests, pets, smoking, created_at, updated_at, roommate_visible, share_email, chores, share_profile)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?13, ?14, ?15, ?16, ?17)
       ON CONFLICT (user_id) DO UPDATE SET
         budget_min = excluded.budget_min, budget_max = excluded.budget_max, move_in_month = excluded.move_in_month,
         area = excluded.area, rooms_needed = excluded.rooms_needed, sleep_schedule = excluded.sleep_schedule,
         cleanliness = excluded.cleanliness, noise = excluded.noise, guests = excluded.guests, pets = excluded.pets,
         smoking = excluded.smoking, updated_at = excluded.updated_at,
         roommate_visible = excluded.roommate_visible, share_email = excluded.share_email, chores = excluded.chores,
         share_profile = excluded.share_profile
       RETURNING ${PREF_FIELDS}`
    )
    .bind(userId, p.budget_min, p.budget_max, p.move_in_month, p.area, p.rooms_needed,
      p.sleep_schedule, p.cleanliness, p.noise, p.guests, p.pets, p.smoking, now, p.roommate_visible ? 1 : 0, p.share_email ? 1 : 0, p.chores ?? null, p.share_profile ? 1 : 0)
    .first();
  return asPrefs(saved);
}

// unit_id and message come from parseInterest (src/validate.js).
export async function createInterest(db, userId, unit_id, message) {
  const unit = await db
    .prepare(`SELECT id, (landlord_user_id LIKE 'sample-%') AS sample FROM units WHERE id = ?1 AND status = 'active'`)
    .bind(unit_id)
    .first();
  if (!unit) throw new HttpError(404, "not_found", "This unit is no longer listed.");
  if (unit.sample) throw new HttpError(409, "sample_listing", "This is a sample listing, so there is no landlord to contact.");
  const { n } = await db.prepare(`SELECT COUNT(*) AS n FROM unit_interests WHERE renter_user_id = ?1`).bind(userId).first();
  if (n >= MAX_INTERESTS_PER_RENTER) {
    throw new HttpError(409, "too_many_interests", `You can have up to ${MAX_INTERESTS_PER_RENTER} open requests. Withdraw one first.`);
  }
  const now = Date.now();
  const res = await db
    .prepare(
      `INSERT INTO unit_interests (id, unit_id, renter_user_id, message, created_at) VALUES (?1, ?2, ?3, ?4, ?5)
       ON CONFLICT (unit_id, renter_user_id) DO NOTHING`
    )
    .bind(crypto.randomUUID(), unit_id, userId, message, now)
    .run();
  if (res.meta.changes !== 1) throw new HttpError(409, "already_sent", "You already told this landlord you're interested.");
  return { unitId: unit_id, message, createdAt: now };
}
