-- Quick check-in: a short optional survey anyone can send (signed in or not), kept apart from matching
-- preferences, and coHabit Points: pilot participation points with no cash value. Additive only: two new tables.

-- One row per submission. The id is made by the browser once per draft, so a retry after a network error
-- can't save the same answers twice.
CREATE TABLE "survey_responses" (
  "id" text NOT NULL PRIMARY KEY,
  "survey" text NOT NULL,                                          -- version of the questions, e.g. 'checkin-2026-10'
  "user_id" text REFERENCES "user"("id") ON DELETE CASCADE,        -- NULL for guests
  "respondent" text NOT NULL CHECK ("respondent" IN ('guest', 'renter', 'landlord', 'member')),
  "demo" integer NOT NULL DEFAULT 0 CHECK ("demo" IN (0, 1)),       -- sent while the assistant's Demo mode was on
  "page" text,                                                     -- where it was opened, e.g. '/assistant' (no ids)
  "answers" text NOT NULL,                                         -- JSON, only known questions and answers
  "comment" text NOT NULL DEFAULT '' CHECK (length("comment") <= 500),
  "points_awarded" integer NOT NULL DEFAULT 0,
  "created_at" integer NOT NULL
);
CREATE INDEX "survey_responses_survey_idx" ON "survey_responses" ("survey", "created_at");
CREATE INDEX "survey_responses_user_idx" ON "survey_responses" ("user_id");

-- coHabit Points, one row per award. At most one award per person per reason (the unique pair), so retries,
-- repeat submissions and two submissions at once can't award twice. A balance is the sum of a person's rows.
CREATE TABLE "points_awards" (
  "id" text NOT NULL PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "reason" text NOT NULL,                                          -- e.g. 'survey:checkin-2026-10'
  "points" integer NOT NULL CHECK ("points" > 0),
  "source_id" text,                                                -- the survey response that earned it
  "created_at" integer NOT NULL,
  UNIQUE ("user_id", "reason")
);
