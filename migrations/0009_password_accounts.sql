-- Email and password accounts (alongside Google sign-in, same "user" table). Two optional answers from the sign-up
-- form. Additive only: two new columns, empty for everyone who already has an account.
-- Passwords are not stored here: Better Auth keeps a salted hash in "account"."password" (provider "credential"),
-- and reset and email-confirmation tokens in "verification", which already exist.

-- Renters, optional: "student", "working", "student,working" or "other".
ALTER TABLE "user" ADD COLUMN "occupation" text CHECK ("occupation" IS NULL OR "occupation" IN ('student', 'working', 'student,working', 'other'));
-- Landlords, optional: the company they rent through.
ALTER TABLE "user" ADD COLUMN "company" text CHECK ("company" IS NULL OR length("company") <= 100);
