-- Optional location for a unit: street address, pin, and what renters may see.
-- Additive only: five new nullable/defaulted columns; no existing data is changed.
-- Massachusetts only for now: the pin must fall inside the state's bounding box
-- (the server also checks the address is in Massachusetts).

ALTER TABLE "units" ADD COLUMN "address" text CHECK ("address" IS NULL OR length("address") BETWEEN 5 AND 200);
ALTER TABLE "units" ADD COLUMN "lat" real CHECK ("lat" IS NULL OR "lat" BETWEEN 41.18 AND 42.89);
ALTER TABLE "units" ADD COLUMN "lng" real CHECK ("lng" IS NULL OR "lng" BETWEEN -73.51 AND -69.85);
-- 'approximate' (default): renters see a circle about 500 m wide and no street address.
-- 'exact': renters see the pin and the street address.
ALTER TABLE "units" ADD COLUMN "location_precision" text NOT NULL DEFAULT 'approximate' CHECK ("location_precision" IN ('approximate', 'exact'));
-- Attribution for stored geocoding results, as MapTiler's terms require for databases built from its search service.
ALTER TABLE "units" ADD COLUMN "geo_source" text;
