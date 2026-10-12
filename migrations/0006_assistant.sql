-- The coHabit assistant: one chat per renter, what it has learned, confirmations, saved options and usage.
-- Additive only: five new tables, one new nullable column, two indexes. No existing data is changed.

-- One row per renter: what the assistant has learned so far (JSON) and the results it last showed.
-- "last_results" maps the short labels the AI sees (R1, P1...) to unit or user ids; it never leaves the server.
CREATE TABLE "assistant_threads" (
  "user_id" text NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "memory" text NOT NULL DEFAULT '{}' CHECK (length("memory") <= 8000),
  "last_results" text NOT NULL DEFAULT '{}' CHECK (length("last_results") <= 8000),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

-- The chat itself. "cards" holds the rooms or people shown with a reply (ids stay on the server).
CREATE TABLE "assistant_messages" (
  "id" text NOT NULL PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('user', 'assistant')),
  "content" text NOT NULL CHECK (length("content") <= 4000),
  "cards" text CHECK ("cards" IS NULL OR length("cards") <= 8000),
  "mode" text CHECK ("mode" IS NULL OR "mode" IN ('ai', 'basic')),
  "created_at" integer NOT NULL
);
CREATE INDEX "assistant_messages_user_idx" ON "assistant_messages" ("user_id", "created_at");

-- Things only the renter can approve: saving answers to their profile, or contacting a landlord.
-- The assistant can only propose them; nothing happens until the renter clicks Confirm.
CREATE TABLE "assistant_actions" (
  "id" text NOT NULL PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "message_id" text,
  "kind" text NOT NULL CHECK ("kind" IN ('save_profile', 'contact_landlord')),
  "payload" text NOT NULL CHECK (length("payload") <= 4000),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'done', 'dismissed')),
  "created_at" integer NOT NULL,
  "decided_at" integer
);
CREATE INDEX "assistant_actions_user_idx" ON "assistant_actions" ("user_id", "status");

-- Rooms and people a renter saved from the chat. A saved person is shown again only while they
-- still have roommate matching turned on.
CREATE TABLE "saved_options" (
  "id" text NOT NULL PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('room', 'person')),
  "target_id" text NOT NULL,
  "note" text NOT NULL DEFAULT '' CHECK (length("note") <= 2000),
  "created_at" integer NOT NULL,
  UNIQUE ("user_id", "kind", "target_id")
);

-- AI replies per day, per renter and for the whole site (user_id '*'), to enforce limits and watch cost.
CREATE TABLE "assistant_usage" (
  "day" text NOT NULL CHECK ("day" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "user_id" text NOT NULL,
  "replies" integer NOT NULL DEFAULT 0,
  "input_tokens" integer NOT NULL DEFAULT 0,
  "output_tokens" integer NOT NULL DEFAULT 0,
  PRIMARY KEY ("day", "user_id")
);

-- How a renter likes to share chores (optional; asked by the questionnaire and the assistant).
ALTER TABLE "match_preferences" ADD COLUMN "chores" text CHECK ("chores" IS NULL OR "chores" IN ('rotating_schedule', 'split_by_task', 'as_needed'));
