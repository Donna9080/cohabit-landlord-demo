# coHabit project checkpoint: 2026-10-13 (Details and requests)

A snapshot of where the project stands: what's built, how it was tested, what's live, and what's left.
Details live in [ACCOUNTS_SETUP.md](ACCOUNTS_SETUP.md) (how things work, commands) and
[ACCOUNTS_WORKPLAN.md](ACCOUNTS_WORKPLAN.md) (decision log, task list).

## Headline numbers

| | Count | Where checked |
|---|---|---|
| **Real external listings imported** | **0** | Live (table created 2026-10-12, empty). Local: 0. |
| Real accounts | 12 | Live database, 2026-10-13 |
| Sample (fictional) accounts | 0 | Live: all 36 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| Real landlord units | 5 | Live, 2026-10-12 |
| Sample units | 0 | Live: all 20 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| "I'm interested" requests | 3 | Live, 2026-10-13 |
| Roommate requests | 0 | Live, 2026-10-13 (table created that day) |
| Saved questionnaires | 4 | Live, 2026-10-13 |
| Admins | 1 | Live (the owner) |
| Automated tests | 395 passing | `npm test`, local, 2026-10-13 |
| AI cost so far | $0 | No Anthropic key exists; the assistant has only run in basic mode or against the test stand-in |

No real listings were imported because no authorized data source exists yet (see "Pending work").

## Deployment status

- **Live site:** https://cohabit-landlord-demo.dolgorsureng.workers.dev
- **Live version:** `d4ea27c7-4e1f-419f-b52e-21dfb4298ce9`, deployed 2026-10-13 with the owner's approval: Details and requests
  (commit `d3d9734`, tag `checkpoint-2026-10-13-requests`). Order used: restore point, migration 0007, deploy. Checked
  live after deploy:
  - Pages return 200 (home, assistant, listings, My matches, privacy, terms), and the new code and privacy text are served.
  - Signed out, the requests, assistant and roommate APIs return 401, and a cross-site request returns 403.
  - Public listings contain no demo ids and no emails.
  - Not checked: the signed-in flows (that needs two real renter accounts; see Pending work).

  Before it: `e2da146e-2d3b-4c23-9591-63ae1e71a4b8` (assistant redesign and Demo mode, commit `2c7a980`, tag
  `checkpoint-2026-10-12-redesign`). Checked live after that deploy:
  - Pages return 200, and `/assistant` shows the new headline.
  - Signed out, the assistant, Demo and admin APIs return 401, and a cross-site Demo request returns 403.
  - Public listings contain no demo ids.

  Before it: `bdc3fd32-43b6-4d4b-957a-5ae097605f44` (rooms with no map location shown, commit `27df59b`). The version before it, `d7e38548-66c4-4eab-890c-ac0c692a1bcd`,
  brought the chat assistant (basic mode) and the external listing import tool (commit `a5f8e92`).
- **Live database (`cohabit-db`):** migrations 0001 to 0007 applied. 0007 was applied on 2026-10-13 with the owner's
  approval, after a restore point (bookmark `00000075-00000000-00005103-5f5ae051cfc181e65e91b5a1637f9a7c`). It only added a column (off for
  everyone) and two empty tables with four indexes; existing data was checked before and after (12 users, 5 units,
  3 "I'm interested" requests, 4 questionnaires, 2 chats, 1 saved option: unchanged). 0005 and 0006 were applied on 2026-10-12 with
  the owner's approval, after a restore point (bookmark `00000068-00000000-00005103-a85f3ce1468cd45f9f60c37caba86d90`). Both only added tables and one empty column;
  existing data was checked afterwards (11 users, 5 units, 2 requests, 4 questionnaires).
- **Checked live after deploy:**
  - Public pages, including `/assistant`, return 200.
  - Signed out, the assistant and admin APIs return 401, and a chat message from another site returns 403.
  - `/assistant` shows its sign-in invitation, and the home page shows the new text.
  - Not checked: the signed-in chat itself (that needs a real account; see Pending work).
- **Cloudflare secrets (names only):** `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MAPTILER_KEY`.
  No `ANTHROPIC_API_KEY`.
- **Google sign-in:** published (In production), External audience.
- **MapTiler:** Free plan, no billing. The browser key is restricted to the site and localhost (verified: 200 from the
  site, 403 from other origins).

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
| Sample data | 6 landlords, 20 units, 30 renters, all tagged Sample; matching report in `docs/SAMPLE_MATCHING.md` (since deleted from live) | Removed |
| Design | Option A cards, one navigation bar, unit page, in-page dialogs, loading/empty/error/success states | Yes |
| Maps | Massachusetts-only place search, Use my location (browser only), always-on map, landlord address + draggable pin, approximate (500 m) or exact | Yes |
| Import tool | Admin CSV import of external listings from authorized sources: preview, permission record, import (max 50), rollback, audit log, sample hiding | Yes (2026-10-12) |
| **Assistant** | Chat-first housing and roommate assistant for renters at `/assistant` (details below) | Yes, basic mode (2026-10-12) |
| **Assistant redesign + Demo mode** | Results 65% / guided chat 35%, List/Map, editable chips, new wording, Demo mode (details below) | Yes (2026-10-12) |
| **Details and requests** | Shorter cards, exact vs partial groups, room Details with confirmed "I'm interested", roommate Details, Connect, accept/decline/withdraw, messages (details below) | Yes (2026-10-13) |

### Details and requests (2026-10-13, live as `d4ea27c7…`)

- **Layout:**
  - Results and chat start at the same height; the chat stays in view while the results scroll, including the map.
  - The card grid fills the width without stretching a lone card. Cards show the essentials, two reasons and at most
    one important mismatch; everything else is in Details.
  - Room pictures use the listing's photo if it has one, otherwise a drawing labeled "No photo yet" (or "demo
    picture" in Demo mode). People get initials, since profiles have no photos.
  - "Matches everything" / "Strong matches" and "Partial matches" are grouped separately, and the chat and the
    results use the same counts ("3 rooms fit your must-haves: 2 match everything, 1 partly").
  - Changing a chip adds a short note in the chat ("Budget up to: $1,200 a month (must-have). Results updated.").
- **Rooms:** Details reuses the existing "I'm interested" form, now with a "Send this request?" confirmation. The
  status is the same on the card, in Details, on Listings, in Saved and on My matches. Demo, external and sample
  listings explain why nothing can be sent.
- **Roommates:** Details (budget, move-in, area, lifestyle tags, shared answers, differences) when both renters chose
  to share; Connect with an editable introduction; pending, withdraw, accept, decline; messages after acceptance.
- **Privacy:** no account ids or emails on cards or in the assistant's results; email only in Details and only if
  shared; encrypted per-viewer handles; demo profiles can't receive real requests.
- **Database:** migration `0007_roommate_requests.sql` (additive): a `share_profile` column (off by default) and the
  `roommate_requests` and `roommate_messages` tables.
- **Fixed on the way:** the assistant's roommate search didn't read `share_profile`, so Details stayed hidden there
  even with consent on both sides; chat notes said "budget up to to $1,300".

### Assistant redesign (2026-10-12, live as `e2da146e…`)

Built and tested in three stages, each committed separately:

1. **Layout.**
   - Results take the left 65% and the guided chat the right 35%.
   - Rooms have a List / Map toggle with pins and cards kept in step.
   - Roommates show as profiles with what you have in common. "Both" shows Rooms and Roommates tabs.
   - Answers appear as editable chips (value and must-have). All answers and Saved are folded away.
   - On phones, Chat and Results tabs keep their state.
   - Results are worked out from the answers on every change, with early results once two basics are known.
   - Empty results name the blocking must-haves and offer explicit changes.
2. **Wording.**
   - "Find your room. Find your people." and "Hey! What are you looking for?" (A room / A roommate / Both).
   - Shorter questions, with the same order, branching and answer values.
   - No repeated "Got it", and short result messages.
   - A "Guided chat" note explains the free mode and how the chat is stored.
3. **Demo mode.**
   - 15 fictional listings and 20 fictional profiles around Waltham, kept in code, not the database.
   - Per-room and whole-place rent, with whole-place rent split between the people moving in together.
   - Strong, partial and no-match cases.
   - Labeled on every card and pin; never saved, contacted, or mixed into real results or counts.
   - Hidden profiles stay hidden.

### The assistant (2026-10-12)

- **What renters get:**
  - One chat that asks one question at a time, remembers the answers and accepts corrections.
  - Must-have or flexible for budget, timing, area and distance.
  - Up to 3 rooms or roommates beside the chat (inside it on phones), each with why it fits and what doesn't.
  - Details, Save, and Refine-by-chatting without losing the conversation.
  - Starter buttons, Clear chat, and a storage note.
  - Confirmation cards before saving the profile or contacting a landlord.
- **How it stays truthful:**
  - Code searches the database, filters and ranks, and writes every fit and mismatch.
  - Claude (official Anthropic SDK, server side) only talks and explains, through four checked tools.
  - Invented prices, distances and percentages are removed from replies.
  - Sample data is excluded unless asked for, and labeled.
  - Only discoverable roommates are shown.
  - No protected characteristics can be stored.
- **When the AI is off, over a limit or failing:** a rule-based basic mode gives the same search and cards, at $0.
- **Usage limits:** 40 AI replies per renter a day, 300 for the site, 10 a minute.
- **Admin:** sees daily totals and an estimated cost.
- **Changes to existing pages:** an optional chores answer on the questionnaire; updated privacy and terms pages;
  renters land on the assistant after sign-in.
- **Live in basic mode** since 2026-10-12. AI mode (Anthropic account and key) was declined for now; see
  ACCOUNTS_SETUP.md, "AI assistant", for the steps and expected cost.

## Tests

- `npm test`: **395/395** on 2026-10-13. New checks for this change:
  - Handles: no ids in responses; a handle made for one renter fails for another; a changed handle fails.
  - Consent: details only when both share; email only when shared; sharing needs roommate matching on.
  - Connect: created only on Send; duplicates, self-requests, hidden targets, renters without matching, landlords and
    other sites refused; a phone number in the introduction refused.
  - Lifecycle: only the sender withdraws, only the recipient accepts or declines, outsiders get 404, no new request
    after a decline, a new one after withdrawing; messages only after acceptance, only between the two, no phone
    numbers.
  - Demo profiles have no handle; deleting an account deletes its requests and messages.
  - Room cards: two reasons, one mismatch, exact vs partial, counts that add up; chat notes for changed answers.
- **Browser walkthrough (local preview, two local test renters):** Connect → incoming request → Accept → Messages;
  room Details → "I'm interested" → confirmation → "Request sent" on the card, in Details and on Listings; Demo
  previews; Map with the chat in view while scrolling; phone width 390 px with no sideways scrolling.

Earlier runs:

- `npm test`: **314/314** on 2026-10-12.
  - It runs the real Worker against a throwaway local D1 database.
  - It never touches the live database, Google or Anthropic. The AI service is a local stand-in that records every
    request.
- **Earlier tests cover:**
  - Sign-in setup, permissions for every role, and landlord/renter/admin separation.
  - Validation and injection, CSRF and rate limits.
  - Matching and roommate rules, requests, and account deletion.
  - Location privacy and Massachusetts limits.
  - The import tool (28 checks).
- **New assistant tests (84 checks):**
  - **Accuracy:** only real, active, in-budget rooms; invented numbers removed; replies rewritten from data when
    needed; invalid tool values refused.
  - **Continuity:** the chat survives signing in again; corrections replace answers; Clear chat.
  - **Privacy:** no names, emails, ids or street addresses sent to the AI; messages with contact details refused.
  - **Consent:** only opted-in roommates; email only if shared; confirmation cards required, once only, by their owner.
  - **Fallbacks:** AI down, model declining, daily limit reached.
  - **Basic-mode conversation.**
  - **Cleanup:** account deletion and the 90-day job.
- **Browser check (local preview, basic mode):**
  - The full conversation, the confirmation card, Save, Details and Clear chat.
  - Desktop 1280 px and phone 390 px, with no sideways scrolling.
- **Fixed on the way:** the cleanup-job test never actually ran the job (its trigger URL was served the website
  page). It now does.
- **Not verified anywhere yet:**
  - A real Claude reply (no key).
  - The 1 km drag limit on the landlord pin.
  - The real "Use my location" permission prompt.

## Pending work

**Owner decisions (each separately):**

- [x] AI mode: **decided 2026-10-12 to stay on basic mode for now** ($0, no Anthropic account or key). To turn it on
      later: create an Anthropic Console account, set a spend limit (for example $5 a month), create a key and enter it
      yourself, and choose the model. Default Opus 5.5 is about 2–6¢ per reply, Sonnet 5.5 about 1–3¢, Haiku 5.5
      about 0.1¢.
- [x] Apply migrations 0005 and 0006 to the live database (2026-10-12, restore point taken first).
- [x] Push and deploy the import tool and the assistant (2026-10-12, version `d7e38548…`).
- [x] Deploy the assistant redesign and Demo mode (2026-10-12, version `e2da146e…`, no migration).
- [ ] Owner tries the redesigned assistant on the live site as a renter (manual test part 9, including Demo mode).
- [x] Apply migration 0007 to the live database and deploy the 2026-10-13 work (restore point first; version `d4ea27c7…`).
- [ ] Run part 10 of the manual test with two real renter accounts (Details, Connect, Accept, Messages, room request).
- [x] Push commits `d3d9734` and the deploy record to GitHub (2026-10-13, with tag `checkpoint-2026-10-13-requests`).
- [ ] Owner tries the live assistant as a renter: a few answers, results, Save, Clear chat (part 9 of the manual test).

**Blocked: real listings (0 imported).** Apartments.com refuses automated access, and there is no republication
agreement with it or its owner CoStar. RentCast's API terms weren't confirmed to allow public display. To import,
one of these is needed:

1. Written permission from a listing site, plus an export in the template's columns.
2. A licensed provider whose license allows public display. Ask before any signup that needs billing.
3. Landlords' own listings with written permission to publish.

**Owner checks on the live site:**

- [ ] Add addresses to the 5 real units so they appear on the map; drag a pin far to see the 1 km snap-back.
- [ ] Try "Use my location" (allow once, block once).
- [ ] Run the manual test at the end of ACCOUNTS_SETUP.md (part 9 covers the assistant, after it's deployed).
- [ ] Confirm the Cloudflare plan is Workers Free.

**Possible next features:**
- Imported listings in the assistant.
- Replies that stream word by word.
- A "new request" badge for landlords.
- Email notifications (would need a paid email service and domain; ask first).

## Rollback points

| What | How |
|---|---|
| Code (current live) | `npx wrangler rollback <version>`. Previous versions: `e2da146e-2d3b-4c23-9591-63ae1e71a4b8` (before Details and requests; it doesn't use the new tables, so it runs fine on the migrated database), `bdc3fd32-43b6-4d4b-957a-5ae097605f44` (assistant before the redesign), `2e452e10-a5f3-4a87-b70a-b6970607f827` (before the assistant), `90064451…` (map with a toggle), `8adbaa8a…` (before maps) |
| Database before migration 0007 | Time Travel bookmark `00000075-00000000-00005103-5f5ae051cfc181e65e91b5a1637f9a7c` (only added a column and tables, so rolling back the code alone is usually enough) |
| Database before migrations 0005 and 0006 | Time Travel bookmark `00000068-00000000-00005103-a85f3ce1468cd45f9f60c37caba86d90` (only added tables, so rolling back the code alone is usually enough) |
| Database before migration 0004 | Time Travel bookmark `00000032-00000000-000050f9-cded0b9a637a3ca8de724dfb34fae1b6` |
| Original static site | Version `a3c0f17b-d52a-47e3-9d71-5049e87a7a34`, git tag `pre-accounts-2026-09-29` |
| Previous checkpoint | Git tag `checkpoint-2026-10-06` |
| Earlier checkpoint today | Git tag `checkpoint-2026-10-12` (assistant first built) |
| Previous checkpoint (live code) | Git tag `checkpoint-2026-10-12-redesign` |
| This checkpoint (live) | Git tag `checkpoint-2026-10-13-requests` |
| Database before the sample accounts were deleted | Bookmark `00000056-00000000-000050fc-5835b9375b54a515988fe0a4d11150dd` |
| Database before the sample units were deleted | Bookmark `00000052-00000000-000050fc-3869841560ffed16fa9f4732df169900`, or re-run `scripts/sample-data.sql` (adds them back exactly) |

A restore overwrites the database in place, including anything saved since. Export first if unsure.
