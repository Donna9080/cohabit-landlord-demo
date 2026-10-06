# coHabit project checkpoint: 2026-10-06

A snapshot of where the project stands: what's built, how it was tested, what's live, and what's left.
Details live in [ACCOUNTS_SETUP.md](ACCOUNTS_SETUP.md) (how things work, commands) and
[ACCOUNTS_WORKPLAN.md](ACCOUNTS_WORKPLAN.md) (decision log, task list).

## Headline numbers

| | Count | Where checked |
|---|---|---|
| **Real external listings imported** | **0** | Live: the `external_listings` table doesn't exist yet (migration 0005 not applied). Local: 0. |
| Real accounts | 10 | Live database, read-only query |
| Sample (fictional) accounts | 0 | Live: all 36 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| Real landlord units | 5 | Live |
| Sample units | 0 | Live: all 20 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| "I'm interested" requests | 2 | Live |
| Admins | 1 | Live (the owner) |
| Automated tests | 230 passing | `npm test`, local, 2026-10-06 |

No real listings were imported because no authorized data source exists yet (see "Pending work").

## Deployment status

- **Live site:** https://cohabit-landlord-demo.dolgorsureng.workers.dev
- **Live version:** `2e452e10-a5f3-4a87-b70a-b6970607f827`, deployed 2026-10-03 (always-on map). Matches git commit
  `85c8524` on GitHub `main`.
- **Not deployed:** commit `8443019`, the external listing import tool, plus this checkpoint commit. Both are local
  only, ahead of `origin/main`.
- **Live database (`cohabit-db`):** migrations 0001 to 0004 applied. **0005 (external listings) not applied.**
- **Cloudflare secrets (names only):** `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAPTILER_KEY`.
- **Google sign-in:** published (In production), External audience.
- **MapTiler:** Free plan, no billing; browser key restricted to the site and localhost (verified: 200 from the site,
  403 from other origins).

## Completed changes (in order)

| Area | What | Live? |
|---|---|---|
| Accounts | Google sign-in (Better Auth), one-time landlord/renter choice, sessions in D1, sign-out | Yes |
| Landlords | Units: add, edit, delete; dashboard with summary tiles; unit page with interested renters | Yes |
| Renters | Questionnaire, preferences summary, room matches (budget, rooms, area, month), sorting | Yes |
| Admin | Read-only user list; owner promoted by D1 command | Yes |
| Security | Server-side permissions, Origin checks, D1 rate limits, no tokens stored, 16 KB body cap | Yes |
| Privacy | Delete my account; privacy and terms pages | Yes |
| Roommates | Opt-in roommate matching on lifestyle answers; optional email sharing | Yes |
| Contact | "I'm interested" requests from renters to landlords | Yes |
| Sample data | 6 landlords, 20 units, 30 renters, all tagged Sample; matching report in `docs/SAMPLE_MATCHING.md` | Yes |
| Design | Option A cards, one navigation bar, unit page, in-page dialogs, loading/empty/error/success states | Yes |
| Maps | Massachusetts-only place search, Use my location (browser only), always-on map, landlord address + draggable pin, approximate (500 m) or exact | Yes |
| **Import tool** | Admin CSV import of external listings from authorized sources: preview, permission record, import (max 50), rollback, audit log, sample hiding | **No (local only)** |

## Tests

- `npm test`: **230/230** on 2026-10-06. Runs the real Worker against a throwaway local D1 database; never touches
  the live database or Google.
- Covers: sign-in setup, permissions for every role, landlord/renter/admin separation, validation and injection,
  CSRF, rate limits, matching and roommate rules, requests, account deletion, location privacy (approximate points
  stay within 500 m and never expose the address), Massachusetts limits, and the import tool (28 checks).
- Browser checks were done locally for every feature, and live for each deploy (signed-out pages, APIs, maps in
  headless Edge).
- **Not verified anywhere yet:** the 1 km drag limit on the landlord pin, and the real "Use my location" permission
  prompt (simulated only).

## Pending work

**Blocked: real listings (0 imported).** Apartments.com refuses automated access and there is no republication
agreement with it or its owner CoStar. RentCast's API terms weren't confirmed to allow public display. To import, one of:

1. Written permission from a listing site, plus an export in the template's columns.
2. A licensed provider whose license allows public display. Ask before any signup that needs billing.
3. Landlords' own listings with written permission to publish.

**Needs the owner's approval (separately):**

- [ ] Apply migration 0005 to the live database (adds 4 empty tables; take a restore point first).
- [ ] Push and deploy the import tool (commit `8443019`).

**Owner checks on the live site:**

- [ ] Add addresses to the 5 real units so they appear on the map; drag a pin far to see the 1 km snap-back.
- [ ] Try "Use my location" (allow once, block once).
- [ ] Run the manual test at the end of ACCOUNTS_SETUP.md.
- [ ] Confirm the Cloudflare plan is Workers Free.
- [x] Sample data removed from production (units and accounts, 2026-10-06); live counts are now real data only.

**Possible next features:** distance-based matching, a "new request" badge for landlords, a map on the renter's
matches page, a shorter renter page, email notifications (would need a paid email service and domain; ask first).

## Rollback points

| What | How |
|---|---|
| Code (current live) | `npx wrangler rollback <version>`; previous versions: `90064451…` (map with a toggle), `8adbaa8a…` (before maps) |
| Database before migration 0004 | Time Travel bookmark `00000032-00000000-000050f9-cded0b9a637a3ca8de724dfb34fae1b6` |
| Original static site | Version `a3c0f17b-d52a-47e3-9d71-5049e87a7a34`, git tag `pre-accounts-2026-09-29` |
| This checkpoint | Git tag `checkpoint-2026-10-06` |
| Database before the sample accounts were deleted | Bookmark `00000056-00000000-000050fc-5835b9375b54a515988fe0a4d11150dd` |
| Database before the sample units were deleted | Bookmark `00000052-00000000-000050fc-3869841560ffed16fa9f4732df169900`, or re-run `scripts/sample-data.sql` (adds them back exactly) |

A restore overwrites the database in place, including anything saved since. Export first if unsure.
