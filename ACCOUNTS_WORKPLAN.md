# Accounts work plan (BUS131)

Adds Google sign-in, landlord units, renter match preferences and a read-only
admin user list to this site. Setup and commands: [ACCOUNTS_SETUP.md](ACCOUNTS_SETUP.md).

## Checklist

- [x] Confirm target: this repo (`Donna9080/cohabit-landlord-demo`), Worker `cohabit-landlord-demo`
      on account "Dolgorsureng@brandeis.edu's Account" (only account on the login). Not `Documents\cohabit`.
- [x] Recovery point: git tag `pre-accounts-2026-09-29`; deployed version `a3c0f17b-d52a-47e3-9d71-5049e87a7a34`
- [x] Create D1 `cohabit-db` (`0e413d91-d5f8-42ce-868c-fc382b0ca38c`), bind as `DB`
- [x] Migration `0001_accounts.sql` (Better Auth tables + units + match_preferences + counters)
- [x] Worker API with server-side permissions, validation, CSRF/origin checks, D1 rate limits, daily cleanup
- [x] UI: sign in/out, one-time landlord/renter choice, units dashboard + form, renter questionnaire + matches,
      public listings, How it works, admin user list; sample dashboard moved to `/sample`
- [x] Local tests: `npm test` 102/102 passing (local D1), plus browser check of each screen (desktop + phone)
- [x] Handoff docs (this file, ACCOUNTS_SETUP.md)
- [ ] Owner: create Google OAuth client, set 3 secrets (ACCOUNTS_SETUP.md → Google sign-in setup)
- [ ] Apply migration `--remote`, deploy, verify live
- [ ] Owner signs in on live site → promote to admin with the D1 command → verify
- [ ] Live test with a second Google account as renter

## Decisions

- **Better Auth 1.7.6** (not Auth.js): it has a plain `fetch` handler that fits a
  framework-less Worker, and 1.7.6 detects a D1 binding directly (`database: env.DB`)
  and turns transactions off for it. Its only transaction calls are in MySQL-only code
  paths (checked in `@better-auth/kysely-adapter`). Schema SQL came from Better Auth's
  own `getMigrations`, not guessed.
- **No `nodejs_compat` flag** needed; compatibility date unchanged (2026-09-20).
- **Stayed a Worker with static assets** (it already was). Added `main`,
  `run_worker_first: ["/api/*"]`, a D1 binding, one var and a daily cron.
- **Account type** is chosen on `/welcome` after first sign-in and can't change.
- **Existing UI adjustments**: the front page "Tenant (coming soon)" card is now
  **Renter**. The old fictional dashboard moved from `/landlord` to `/sample` and
  `/landlord` is the real signed-in dashboard. The sample kept street addresses and
  tenant phones because it's fictional; real units use general area only and have
  no tenant list.
- **Unit fields**: name, general area, monthly rent (whole dollars, per room), rooms
  available (1–20), move-in date, description (≤1000 chars), status active/inactive.
  Up to 50 units per landlord.
- **Matching**: rule-based (budget 40, area 25, move-in 20, rooms 15; shown if ≥40).
  No AI API, so no key and no cost. Lifestyle answers are stored for future roommate
  matching but not used yet, and nobody else sees them.
- **Public listings**: visitors and renters see active units' listing fields only.
- **Google tokens are not stored**; IP/user agent not stored on sessions; Google photo not stored.
- **No implicit account linking**: one Google subject ID = one user.
- **Rate limits in D1**, not per-isolate memory. Cloudflare's Rate Limiting binding was
  not used (per-location counters; not needed at this scale).
- **Test sign-in without Google**: tests write session rows and HMAC-signed cookies
  directly into the local test database. There is no dev-login endpoint in the code.

## Tests completed (local, 2026-09-29)

`npm test` → **102/102 passed** against Wrangler's local D1 (`.wrangler/test-state`).
Covers: public pages; Google authorization URL (scopes exactly openid/email/profile,
PKCE S256, state, no offline access, correct redirect URI, injected scope dropped);
forged OAuth state rejected; non-allowlisted Better Auth endpoints 404; one-time account
type (forged role ignored, change refused, DB trigger); landlord CRUD with forged owner
ignored; Landlord B blocked from A's units (view/edit/delete); renters blocked from all
unit endpoints; inactive units hidden from listings and matches; listing fields only;
renter preferences save/reload/edit, isolation between renters, landlords/admin blocked;
admin access by visitor/renter/landlord/forged role/tampered cookie/expired session denied;
admin list has no answers/ids/tokens/sessions; demotion immediate; CSRF (no/foreign
Origin, cross-site fetch metadata, non-JSON) blocked; no CORS; invalid and injection
input rejected or stored as plain text; oversized body 413; sign-out deletes the
server session; cross-origin sign-out blocked; app and sign-in rate limits return 429;
cron cleanup removes expired sessions.

Browser check (local preview): newcomer choice → renter form; landlord add unit
(street address refused, then saved) → dashboard after reload; renter saves
preferences → 100% match, still there after reload; renter on `/landlord` and `/admin`
blocked; admin list desktop + phone; sign-out → admin API 401.

NOT RUN locally: the real Google callback (needs the Google client). It is covered
by the live test.

## Blockers

- Waiting on the owner for the Google OAuth client and the three secrets.
- Plan check: Wrangler's token can't read the account's subscriptions. Confirm
  **Workers Free** in the dashboard.

## Next safe step

After the live check passes: add a "delete my account" flow (with an audit table if
admins ever get write actions), then roommate matching using the saved lifestyle answers.
