-- Roommate matching is opt-in. Both switches are off for every existing renter.
-- Additive only: two new columns and one index; no existing data is changed.

-- 1 = this renter agreed to be shown to other opted-in renters (first name and what they have in common).
ALTER TABLE "match_preferences" ADD COLUMN "roommate_visible" integer NOT NULL DEFAULT 0 CHECK ("roommate_visible" IN (0, 1));

-- 1 = this renter also agreed that their roommate matches may see their email address.
ALTER TABLE "match_preferences" ADD COLUMN "share_email" integer NOT NULL DEFAULT 0 CHECK ("share_email" IN (0, 1));

-- Roommate lookups read only opted-in rows.
CREATE INDEX "match_preferences_roommate_idx" ON "match_preferences" ("roommate_visible");
