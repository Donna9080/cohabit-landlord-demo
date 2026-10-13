-- Roommate requests ("Connect"), messages after a request is accepted, and a separate opt-in for sharing
-- profile details with roommate matches. Additive only: two new tables, one new column (off for everyone), indexes.

-- 1 = this renter agreed that roommate matches who share theirs too may see their budget range, move-in month,
-- area and lifestyle answers. Off by default; needs roommate matching on.
ALTER TABLE "match_preferences" ADD COLUMN "share_profile" integer NOT NULL DEFAULT 0 CHECK ("share_profile" IN (0, 1));

-- One renter asking another to connect, with an introduction. The recipient accepts or declines; the sender can
-- withdraw while it's pending. Nothing is shared beyond what roommate matching already shows until it's accepted.
CREATE TABLE "roommate_requests" (
  "id" text NOT NULL PRIMARY KEY,
  "from_user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "to_user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "intro" text NOT NULL DEFAULT '' CHECK (length("intro") <= 500),
  "status" text NOT NULL DEFAULT 'pending' CHECK ("status" IN ('pending', 'accepted', 'declined', 'withdrawn')),
  "created_at" integer NOT NULL,
  "decided_at" integer,
  CHECK ("from_user_id" != "to_user_id")
);
-- At most one open (pending or accepted) request between two people, whichever of them sent it.
CREATE UNIQUE INDEX "roommate_requests_open_pair" ON "roommate_requests" (min("from_user_id", "to_user_id"), max("from_user_id", "to_user_id"))
  WHERE "status" IN ('pending', 'accepted');
CREATE INDEX "roommate_requests_to_idx" ON "roommate_requests" ("to_user_id", "status");
CREATE INDEX "roommate_requests_from_idx" ON "roommate_requests" ("from_user_id", "status");

-- Messages between two renters, only after the request was accepted.
CREATE TABLE "roommate_messages" (
  "id" text NOT NULL PRIMARY KEY,
  "request_id" text NOT NULL REFERENCES "roommate_requests" ("id") ON DELETE CASCADE,
  "sender_user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "body" text NOT NULL CHECK (length("body") BETWEEN 1 AND 1000),
  "created_at" integer NOT NULL
);
CREATE INDEX "roommate_messages_request_idx" ON "roommate_messages" ("request_id", "created_at");
