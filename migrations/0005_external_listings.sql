-- External listings imported by an admin from an authorized source (publisher authorization, a licensed
-- provider, or landlords who gave permission). Additive only: four new tables; nothing existing changes.
-- Imported listings never belong to a landlord account and can be rolled back per import.

-- One row per import, with the permission it was made under.
CREATE TABLE "import_batches" (
  "id" text NOT NULL PRIMARY KEY,
  "source_name" text NOT NULL CHECK (length("source_name") BETWEEN 1 AND 80),
  "permission_basis" text NOT NULL CHECK ("permission_basis" IN ('publisher_authorization', 'licensed_provider', 'landlord_permission')),
  "permission_note" text NOT NULL CHECK (length("permission_note") BETWEEN 10 AND 500),
  "created_by" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "created_at" integer NOT NULL,
  "rows_received" integer NOT NULL,
  "rows_imported" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'imported' CHECK ("status" IN ('imported', 'rolled_back')),
  "rolled_back_at" integer
);

-- Imported listings. Blank means "not provided by the source".
CREATE TABLE "external_listings" (
  "id" text NOT NULL PRIMARY KEY,
  "batch_id" text NOT NULL REFERENCES "import_batches" ("id"),
  "source_name" text NOT NULL CHECK (length("source_name") BETWEEN 1 AND 80),
  "source_listing_id" text CHECK ("source_listing_id" IS NULL OR length("source_listing_id") <= 120),
  "source_url" text NOT NULL CHECK ("source_url" LIKE 'https://%' AND length("source_url") <= 500),
  "property_name" text CHECK ("property_name" IS NULL OR length("property_name") <= 120),
  "address" text CHECK ("address" IS NULL OR length("address") <= 200),
  "city" text CHECK ("city" IS NULL OR length("city") <= 80),
  "zip" text CHECK ("zip" IS NULL OR "zip" GLOB '0[1-2][0-9][0-9][0-9]' OR "zip" IN ('05501', '05544')),
  "rent" integer CHECK ("rent" IS NULL OR "rent" BETWEEN 1 AND 100000),
  -- 'unit' = rent for the whole apartment, 'room' = rent for one room.
  "rent_basis" text CHECK ("rent_basis" IS NULL OR "rent_basis" IN ('unit', 'room')),
  "fees" text CHECK ("fees" IS NULL OR length("fees") <= 300),
  "bedrooms" real CHECK ("bedrooms" IS NULL OR "bedrooms" BETWEEN 0 AND 20),
  "bathrooms" real CHECK ("bathrooms" IS NULL OR "bathrooms" BETWEEN 0 AND 20),
  "available_date" text CHECK ("available_date" IS NULL OR "available_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "source_posted_date" text CHECK ("source_posted_date" IS NULL OR "source_posted_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "source_updated_date" text CHECK ("source_updated_date" IS NULL OR "source_updated_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  "retrieved_date" text NOT NULL CHECK ("retrieved_date" GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]-[0-3][0-9]'),
  -- Only stored when the source allows coordinates to be shown.
  "lat" real CHECK ("lat" IS NULL OR "lat" BETWEEN 41.18 AND 42.89),
  "lng" real CHECK ("lng" IS NULL OR "lng" BETWEEN -73.51 AND -69.85),
  -- Only stored together with the license that allows reuse.
  "photo_url" text CHECK ("photo_url" IS NULL OR ("photo_url" LIKE 'https://%' AND length("photo_url") <= 500)),
  "photo_license" text CHECK ("photo_license" IS NULL OR length("photo_license") <= 200),
  "created_at" integer NOT NULL,
  CHECK (("photo_url" IS NULL) = ("photo_license" IS NULL)),
  CHECK (("lat" IS NULL) = ("lng" IS NULL))
);
CREATE UNIQUE INDEX "external_listings_source_url_idx" ON "external_listings" ("source_url");
CREATE UNIQUE INDEX "external_listings_source_id_idx" ON "external_listings" ("source_name", "source_listing_id") WHERE "source_listing_id" IS NOT NULL;
CREATE INDEX "external_listings_batch_idx" ON "external_listings" ("batch_id");

-- Small site switches set by an admin, e.g. hiding sample listings from public search.
CREATE TABLE "app_settings" (
  "key" text NOT NULL PRIMARY KEY,
  "value" text NOT NULL,
  "updated_at" integer NOT NULL
);

-- Every admin write action (imports, rollbacks, setting changes) is recorded here.
CREATE TABLE "admin_audit" (
  "id" text NOT NULL PRIMARY KEY,
  "admin_user_id" text REFERENCES "user" ("id") ON DELETE SET NULL,
  "action" text NOT NULL CHECK (length("action") BETWEEN 1 AND 60),
  "detail" text CHECK ("detail" IS NULL OR length("detail") <= 1000),
  "created_at" integer NOT NULL
);
CREATE INDEX "admin_audit_created_idx" ON "admin_audit" ("created_at");
