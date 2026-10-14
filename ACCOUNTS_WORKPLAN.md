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
- [x] Local tests: `npm test` 186/186 passing (local D1), plus browser check of each screen (desktop + phone)
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
- [x] Matching tightened (2026-10-01): on the sample data, units shown per renter 14.1 → 4.2, out-of-area matches
      49% → 22%, over-budget matches 84 → 1 (within 10%), 100% top matches unchanged at 23, 3 renters now get none.
      Before/after table in `docs/SAMPLE_MATCHING.md`.
- [x] Roommate matching (2026-10-01): opt-in, first name + score + what two renters have in common, optional email
      sharing. Migration `0002_roommate_matching.sql` (additive) applied to production; restore bookmark from just
      before: `0000001b-00000000-000050f7-feece982737cca1dec57a2acec082e86`. Deployed as
      `6832c654-d97a-401f-b9be-3c835daeabaf`. 24 new tests. Not seen live by a signed-in renter yet.
- [x] Renter contacts landlord (2026-10-01): "I'm interested" request with optional note; landlord sees name, email
      and note on the dashboard. Migration `0003_unit_interests.sql` (additive) applied to production; restore
      bookmark from just before: `0000001c-00000000-000050f7-0238b86f496e2fcb6962edd600450c3b`. Deployed as
      `aea82468-c5b8-4dce-b517-6a99c62e6445`. 28 new tests. Not exercised live by signed-in accounts yet.
- [x] Interface polish for user testing (2026-10-01): one navigation bar, dashboard with summary tiles, new unit page
      (details + interested renters), no more How it works, single blue accent, shared loading/empty/error/success
      states. Frontend only. Deployed as `f72de36f-ce45-453f-a2e7-989b88a96bc7`. Signed-out pages checked live.
- [x] Polish round 2 (2026-10-01): in-app confirm dialog, renter preferences summary with Edit preferences, sorting for
      matches, sort and search for listings, role-specific home page, tables as cards below 900px, skip link.
      Frontend only. Deployed as `697c8f5b-6eff-4230-9e68-5152c6b923cc`; listings search and sort checked live.
- [ ] After the polish: owner re-checks on the live site with real Google accounts (sign in, first-time landlord/renter
      choice, dashboard to unit page to edit and back, renter page, admin page)
- [x] Location search and maps, Massachusetts only (2026-10-02, local): MapTiler Free (no billing), place search,
      Use my location (browser only), map with approximate circles and pin labels that jump to the card, landlord
      address search with draggable pin and approximate/exact choice. Migration `0004_unit_location.sql` (additive)
      applied locally only. 202/202 tests.
- [x] Production (2026-10-02, each approved by the owner): migration 0004 applied (restore bookmark from just before:
      `00000032-00000000-000050f9-cded0b9a637a3ca8de724dfb34fae1b6`), `MAPTILER_KEY` secret set by the owner, sample data
      reloaded (20 sample units with approximate locations), deployed as `90064451-fa90-4867-b73b-7f1776ff32e1`.
      Live: place suggestions, Cambridge search (9 listings, 9 pins), approximate-only listing output, visitor 401s;
      MapTiler key accepted from the site (200) and refused from another origin or none (403).
- [x] Map always shown on Listings (no Show map button), deployed as `2e452e10-a5f3-4a87-b70a-b6970607f827`;
      checked live in headless Edge on desktop and phone: 20 pins, search narrows to 10, Clear restores 20.
- [x] External listing import tool (2026-10-06, local only, not deployed): migration `0005_external_listings.sql`
      (additive, applied locally only), admin preview/import/rollback at `/admin/import`, External cards and map pins,
      sample listings hidden after an import (switchable), admin audit log. 230/230 tests.
- [x] 2026-10-06: all 20 sample units deleted from the live database at the owner's request (restore bookmark from
      just before: `00000052-00000000-000050fc-3869841560ffed16fa9f4732df169900`; rows also saved locally in
      `backups/`, git-ignored). The 36 sample accounts were kept at first, then also deleted at the owner's request (restore bookmark
      `00000056-00000000-000050fc-5835b9375b54a515988fe0a4d11150dd`; rows saved in `backups/`). Production now holds real
      data only. Re-running `scripts/sample-data.sql` would add all sample data back.
- [ ] **Real listings imported: 0.** Blocked on authorized data: Apartments.com refuses automated access and there's
      no republication agreement; a licensed provider's license or landlords' written permission is needed first.
- [x] Production for the import tool: migration 0005 and deploy (2026-10-12, with the assistant)
- [x] Chat-first AI housing and roommate assistant (2026-10-12, local only, not deployed): `/assistant` for renters,
      rule-based search and fits/misses in code, Claude (official SDK, server side) only talks and explains, basic mode
      when the AI is off/over a limit/down, confirmation cards for saving the profile or contacting a landlord, saved
      options, Clear chat, usage limits and admin cost totals. Migration `0006_assistant.sql` (additive) applied
      locally only. SDK `@anthropic-ai/sdk` 0.129.0. 314/314 tests (84 new), checked in the browser on desktop and phone.
- [x] **Owner decision (2026-10-12): stay on basic mode for now.** No Anthropic account or key; the assistant runs
      rule-based at $0. Turning AI on later: steps, model choice and expected cost in ACCOUNTS_SETUP.md, "AI assistant".
- [x] Production for the assistant (2026-10-12, each approved by the owner): restore bookmark
      `00000068-00000000-00005103-a85f3ce1468cd45f9f60c37caba86d90`, migrations 0005 and 0006 applied (data checked after: 11 users, 5 units,
      2 requests, 4 questionnaires), deployed as `d7e38548-66c4-4eab-890c-ac0c692a1bcd` in basic mode. Live checks: pages 200,
      signed-out assistant/admin APIs 401, cross-site chat message 403, signed-out `/assistant` page and new home text.
- [x] Rooms with no map location shown (marked distance unknown) instead of hidden by a distance must-have:
      only 1 of 4 active live units had a location. 315/315 tests; deployed as `bdc3fd32-43b6-4d4b-957a-5ae097605f44`.
- [x] Assistant redesign (2026-10-12, local only, not deployed; no database change needed), in three tested stages:
      layout (results 65% / guided chat 35%, List/Map with linked pins, Rooms/Roommates tabs, editable answer chips,
      phone Chat/Results tabs), wording (same questions and answers, shorter copy, "Find your room. Find your people."),
      and Demo mode (15 fictional listings and 20 fictional profiles in code, labeled, never saved, never in real data).
      356/356 tests (41 new).
- [x] Redesign deployed 2026-10-12 with the owner's approval as `e2da146e-2d3b-4c23-9591-63ae1e71a4b8` (no migration). Live checks: pages 200,
      `/assistant` shows the new headline, signed-out assistant/Demo/admin APIs 401, cross-site Demo request 403, no demo
      ids in public listings.
- [ ] Owner adds addresses to the 3 active live units without one
- [ ] Owner tries the live assistant as a renter (manual test part 9)
- [ ] Owner checks live: dragging the pin (1 km limit), the real Use my location permission prompt, a real unit with an address
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
- **Matching**: rule-based (budget 40, area 25, move-in 20, rooms 15). Tightened 2026-10-01 after the sample run:
  a unit is shown only if rent is at most 10% over budget, it has enough rooms, and it scores 70 or more
  (so it is also in the renter's area or free in their exact month). Was: shown if ≥40, no limits.
  No AI API, so no key and no cost. Lifestyle answers are stored for future roommate
  matching but not used yet, and nobody else sees them.
- **Roommate matching** (owner's choices, 2026-10-01): a renter is shown to others only after opting in, and must opt
  in to see anyone. Others see first name, a score and what the two have in common. Email is a second, separate
  opt-in. Gates: shared area word, move-in within one month, no pet or smoking dealbreaker, score 60+.
- **Renter contacts landlord**: a one-way request, not a message thread. The renter's name and email go to that
  landlord at the moment the renter sends it (stated on the form). The landlord's email is never shown; they reply
  by email. Sample listings can't be contacted. No email notification is sent (no mail service, $0).
- **Maps** (owner's choices, 2026-10-02): MapTiler Free (non-commercial, no card, pauses instead of charging);
  Massachusetts only; street address plus pin stored with approximate as the default and exact as an option; pin
  labels jump to the existing listing card; sample units get hand-placed neighborhood points. Renter location is used
  in the browser only.
- **Public listings**: visitors and renters see active units' listing fields only.
- **Google tokens are not stored**; IP/user agent not stored on sessions; Google photo not stored.
- **No implicit account linking**: one Google subject ID = one user.
- **Rate limits in D1**, not per-isolate memory. Cloudflare's Rate Limiting binding was
  not used (per-location counters; not needed at this scale).
- **Test sign-in without Google**: tests write session rows and HMAC-signed cookies
  directly into the local test database. There is no dev-login endpoint in the code.

## Tests completed (local, 2026-09-29)

`npm test` → **186/186 passed** against Wrangler's local D1 (`.wrangler/test-state`).
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

## Assistant decisions (2026-10-12)

- **Claude through the official Anthropic SDK, called only from the Worker.** The key is a Cloudflare secret; the
  browser never talks to the AI service. Default model `claude-opus-5-5`; the owner can choose Sonnet 5.5 or
  Haiku 5.5 with one variable. Adaptive thinking at low effort (chat), prompt caching on the fixed instructions,
  server-side refusal fallback on Opus/Sonnet.
- **The model never decides what's true.** Search, ranking, fits/misses and scores are code; the model gets labels
  (R1, P1) instead of ids; numbers in its reply are checked against what the code returned.
- **$0 by default.** Without a key the assistant runs a rule-based basic mode with the same search and cards, so the
  site works and costs nothing until the owner decides. Limits (per renter, per site, per minute) and the Console
  spend limit cap any AI cost; reaching one falls back to basic mode instead of failing.
- **No side effects without a click.** Profile saves and landlord contact are confirmation cards handled by the
  same server checks as the forms. Email sharing stays a separate, unticked box.
- **History replayed as plain text** each turn (earlier thinking and tool calls aren't resent), so every turn is a
  fresh, append-only exchange and the cached prefix stays stable.
- **Roommate privacy kept.** The AI sees people only as P1–P3 with a score and shared traits; only what two renters
  have in common is ever shown, never the other person's answers.
- **Test gap fixed on the way:** the cleanup-job test was calling `/__scheduled`, which the site's static pages
  answer (only `/api/*` reaches the Worker first), so the job never ran in tests. Tests now use
  `/cdn-cgi/local/scheduled` and check that the job ran.

## Results, Details and requests (2026-10-13)

- **Reused, not rebuilt.** Room Details and "I'm interested" are the existing listing flow and API; a confirmation
  box was added before sending, and one function keeps "Request sent" in step on every screen.
- **Roommate requests are new** (nothing existed): `roommate_requests` and `roommate_messages` (migration 0007),
  with every rule checked on the server and a unique index for one open request per pair.
- **Consent before details.** Existing users never agreed to show their budget or answers, so a new switch
  (`share_profile`, off by default) is needed, and details show only when both renters have it on. Emails moved off
  cards into Details, and still only when shared.
- **No ids in the browser.** People are addressed by encrypted handles bound to the viewer, so a handle can't be
  reused by someone else or turned back into an account id.
- **Cards stay short.** Two reasons and one important difference (a flexible answer, or "OK with pets" vs "has a
  pet", isn't one), with exact and partial matches grouped separately and the same counts in the chat and the results.
- **No notifications.** Email would need a paid service; requests show when the person opens coHabit.
- **Built and tested locally first**, without deploying or changing the live database. Then, with the owner's
  approval: restore point (bookmark `00000075-00000000-00005103-5f5ae051cfc181e65e91b5a1637f9a7c`), migration 0007 on the live database
  (data unchanged), and deploy as `d4ea27c7-4e1f-419f-b52e-21dfb4298ce9`.

## Quick check-in and coHabit Points (2026-10-13, local only)

- **No existing points system**, so a minimal one: an award ledger (`points_awards`) with one row per award and a
  unique (person, reason) pair; a balance is the sum. No separate balance column that could drift.
- **The award is enforced on the server**, in the same transaction as saving the response, and only for a response
  that belongs to the signed-in person. The browser never says how many points to give.
- **Idempotent sends.** The browser makes one id per draft and reuses it for retries, so a lost response doesn't
  lead to a duplicate row; the reply to a retry is the same as the first.
- **Guests welcome, no tracking.** Guest responses have no account; only the first part of the page path is kept
  (no ids), and the admin never sees names or emails, including in the CSV.
- **Never interrupts.** The drawer only opens from its icon. No pop-ups, badges or reminders.
- **Demo mode is read on the server** from the renter's assistant setting, not trusted from the browser.
- **Not deployed, and the live database not changed**, as asked.

## Next safe step

Run part 10 of the manual test on the live site with two real renter accounts. After that: a "new request" badge
for landlords and renters. If admins ever get write actions, add an audit table in that change.
