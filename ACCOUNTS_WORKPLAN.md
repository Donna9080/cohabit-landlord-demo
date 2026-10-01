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
- [x] Local tests: `npm test` 124/124 passing (local D1), plus browser check of each screen (desktop + phone)
- [x] Handoff docs (this file, ACCOUNTS_SETUP.md)
- [x] Owner: created Google OAuth client, set 3 secrets (2026-09-30)
- [x] Applied migration `--remote`, first deployed version `dcb965ea-d350-4e36-b56e-3458f7f7c423` (current: `1eb287af-f083-4312-a309-46cf923ab3b1`), signed-out live checks pass
- [x] Owner signed in on the live site with Google (landlord); promoted to admin with the D1 command; read-back shows `role = admin`
- [x] Live: owner (landlord, admin) added 2 units; second Google account signed in as renter and saved preferences (seen in D1)
- [x] Google app published (**In production**, External) after adding home page, `/privacy`, `/terms` and authorized domain on Branding
- [x] Owner confirmed in the browser (2026-10-01): admin page, landlord dashboard and renter page work as intended
- [x] Delete my account: `/account` page + `POST /api/me/delete` (2026-10-01), 13 new tests, deployed as
      `514b3a18-af63-4c17-bb68-78d4140ed0db`. Live: visitor 401, cross-origin 403. Not exercised live with a real
      account (that would delete it); covered by local tests and a local browser run.
- [x] Fictional sample data loaded in production (2026-10-01): 6 landlords, 20 units, 30 renters, all tagged Sample;
      matching write-up in `docs/SAMPLE_MATCHING.md`. Restore bookmark from just before the load:
      `00000019-00000000-000050f7-8f1857dca024c6a8f827bb00861ff290`. Removal command in ACCOUNTS_SETUP.md.
- [ ] Decide whether to tighten matching (sample run: 49% of shown matches are outside the renter's area, 84 are over budget)
- [ ] A person who was never on the Google test-user list signs in (database still shows only the owner's 2 accounts)
- [x] Owner renamed the two test units that had street addresses in their names (checked in D1 and on `/api/listings`); live edit of a unit works
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

`npm test` → **124/124 passed** against Wrangler's local D1 (`.wrangler/test-state`).
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

## Live results (2026-09-30)

- Signed out: public pages 200; `/api/me` signed out and `no-store`; admin, landlord and renter APIs 401;
  cross-origin sign-in 403; hidden Better Auth endpoint 404; forged OAuth state rejected; Google URL has scopes
  `email profile openid`, PKCE S256, no offline access; cookies `HttpOnly; Secure; SameSite=Lax`.
- Real Google sign-in: one user row created, Google subject linked, no tokens/photo/IP/user agent stored.
- Trouble along the way: one secret was first saved as `Google_CLIENT_ID` (names are case-sensitive), then the
  client secret did not match the client ID (Google: `invalid_client`). Fixed by loading both from Google's
  downloaded JSON with `node scripts/set-google-secrets.mjs`. How to diagnose next time: `npx wrangler tail`,
  try to sign in, read the `[Better Auth]` error line.
- CPU time per sign-in request measured 6 to 57 ms (higher right after a deploy). Workers Free lists 10 ms per
  request; no request was cut off, but if sign-in ever fails with error 1102 this is why.

- 2026-10-01: found on live data that street addresses were refused in the area field but accepted in the unit name
  and description. Fixed in `src/validate.js` (house-number + street-word pattern, and ZIP codes), 7 new tests,
  `npm test` 109/109, redeployed.
- One request (a forged callback right after the first deploy) hung and returned 502; not reproduced in later tries.

## Blockers

- Sign-in by an account that was never a test user has not been observed yet (app is published; ask a classmate to try).
- Plan check: Wrangler's token can't read the account's subscriptions. Confirm **Workers Free** in the dashboard.

## Next safe step

Roommate matching using the saved lifestyle answers (decide first what one renter may see about another),
then a way for a renter to tell a landlord they're interested. If admins ever get write actions, add an audit
table in that change.
