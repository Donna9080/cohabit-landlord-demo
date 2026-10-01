-- "I'm interested": a renter contacts the landlord of an active unit.
-- Additive only: one new table and one index; no existing data is changed.
-- The landlord sees the renter's name, email and note. The renter never sees the landlord's email.
CREATE TABLE "unit_interests" (
  "id" text NOT NULL PRIMARY KEY,
  "unit_id" text NOT NULL REFERENCES "units" ("id") ON DELETE CASCADE,
  "renter_user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "message" text NOT NULL DEFAULT '' CHECK (length("message") <= 500),
  "created_at" integer NOT NULL,
  -- One request per renter per unit. Also serves lookups by unit for the landlord's dashboard.
  UNIQUE ("unit_id", "renter_user_id")
);
CREATE INDEX "unit_interests_renter_idx" ON "unit_interests" ("renter_user_id", "created_at");
