-- coHabit accounts: Better Auth tables (from Better Auth 1.7.6 getMigrations, SQLite dialect)
-- plus coHabit's own tables. Additive only: this database starts empty.

-- ── Better Auth ──────────────────────────────────────────────────────────────
CREATE TABLE "user" (
  "id" text NOT NULL PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL UNIQUE,
  "emailVerified" integer NOT NULL,
  "image" text,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  -- Server-controlled. Only changed by the owner with a wrangler d1 command (see ACCOUNTS_SETUP.md).
  "role" text NOT NULL DEFAULT 'user' CHECK ("role" IN ('user', 'admin')),
  -- Chosen once after first sign-in. NULL until chosen.
  "account_type" text CHECK ("account_type" IN ('landlord', 'renter'))
);

-- account_type can go from NULL to a value once, never change afterwards.
CREATE TRIGGER "user_account_type_set_once"
BEFORE UPDATE OF "account_type" ON "user"
WHEN OLD."account_type" IS NOT NULL AND NEW."account_type" IS NOT OLD."account_type"
BEGIN
  SELECT RAISE(ABORT, 'account_type can only be set once');
END;

CREATE TABLE "session" (
  "id" text NOT NULL PRIMARY KEY,
  "expiresAt" date NOT NULL,
  "token" text NOT NULL UNIQUE,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL,
  "ipAddress" text,
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE
);
CREATE INDEX "session_userId_idx" ON "session" ("userId");
CREATE INDEX "session_expiresAt_idx" ON "session" ("expiresAt");

CREATE TABLE "account" (
  "id" text NOT NULL PRIMARY KEY,
  "accountId" text NOT NULL,          -- Google subject ID (sub)
  "providerId" text NOT NULL,         -- 'google'
  "userId" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "accessToken" text,                 -- always NULL: stripped by a databaseHook in src/auth.js
  "refreshToken" text,                -- always NULL
  "idToken" text,                     -- always NULL
  "accessTokenExpiresAt" date,
  "refreshTokenExpiresAt" date,
  "scope" text,
  "password" text,                    -- unused (Google only)
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);
CREATE INDEX "account_userId_idx" ON "account" ("userId");
CREATE UNIQUE INDEX "account_provider_subject_idx" ON "account" ("providerId", "accountId");

CREATE TABLE "verification" (
  "id" text NOT NULL PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" date NOT NULL,
  "createdAt" date NOT NULL,
  "updatedAt" date NOT NULL
);
CREATE INDEX "verification_identifier_idx" ON "verification" ("identifier");
CREATE INDEX "verification_expiresAt_idx" ON "verification" ("expiresAt");

CREATE TABLE "rateLimit" (
  "id" text NOT NULL PRIMARY KEY,
  "key" text NOT NULL UNIQUE,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL
);

-- ── coHabit ──────────────────────────────────────────────────────────────────
-- Landlords' units. General area only, never a street address.
CREATE TABLE "units" (
  "id" text NOT NULL PRIMARY KEY,
  "landlord_user_id" text NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE,
  "name" text NOT NULL CHECK (length("name") BETWEEN 1 AND 80),
  "area" text NOT NULL CHECK (length("area") BETWEEN 1 AND 80),
  "monthly_rent" integer NOT NULL CHECK ("monthly_rent" BETWEEN 1 AND 50000),
  "rooms_available" integer NOT NULL CHECK ("rooms_available" BETWEEN 1 AND 20),
  "move_in_date" text NOT NULL CHECK ("move_in_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "description" text NOT NULL DEFAULT '' CHECK (length("description") <= 1000),
  "status" text NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'inactive')),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);
CREATE INDEX "units_landlord_idx" ON "units" ("landlord_user_id", "created_at");
CREATE INDEX "units_status_move_in_idx" ON "units" ("status", "move_in_date");

-- Renters' questionnaire answers. One current record per renter.
CREATE TABLE "match_preferences" (
  "user_id" text NOT NULL PRIMARY KEY REFERENCES "user" ("id") ON DELETE CASCADE,
  "budget_min" integer NOT NULL CHECK ("budget_min" BETWEEN 0 AND 50000),
  "budget_max" integer NOT NULL CHECK ("budget_max" BETWEEN 1 AND 50000 AND "budget_max" >= "budget_min"),
  "move_in_month" text NOT NULL CHECK ("move_in_month" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  "area" text NOT NULL CHECK (length("area") BETWEEN 1 AND 80),
  "rooms_needed" integer NOT NULL CHECK ("rooms_needed" BETWEEN 1 AND 10),
  "sleep_schedule" text NOT NULL CHECK ("sleep_schedule" IN ('early', 'flexible', 'late')),
  "cleanliness" text NOT NULL CHECK ("cleanliness" IN ('relaxed', 'average', 'tidy')),
  "noise" text NOT NULL CHECK ("noise" IN ('quiet', 'moderate', 'lively')),
  "guests" text NOT NULL CHECK ("guests" IN ('rarely', 'sometimes', 'often')),
  "pets" text NOT NULL CHECK ("pets" IN ('no_pets', 'ok_with_pets', 'have_pets')),
  "smoking" text NOT NULL CHECK ("smoking" IN ('no_smoking', 'outside_ok', 'smoker')),
  "created_at" integer NOT NULL,
  "updated_at" integer NOT NULL
);

-- Fixed-window request counters for coHabit's own API (/api/*, not /api/auth/*).
CREATE TABLE "app_rate_limits" (
  "key" text NOT NULL PRIMARY KEY,
  "window_start" integer NOT NULL,
  "count" integer NOT NULL
);
