# coHabit project checkpoint: 2026-11-10 (AI on OpenRouter's free models: live, switched off)

A snapshot of where the project stands: what's built, how it was tested, what's live, and what's left.
Details live in [ACCOUNTS_SETUP.md](ACCOUNTS_SETUP.md) (how things work, commands) and
[ACCOUNTS_WORKPLAN.md](ACCOUNTS_WORKPLAN.md) (decision log, task list).

## Headline numbers

| | Count | Where checked |
|---|---|---|
| **Real external listings imported** | **0** | Live (table created 2026-10-12, empty). Local: 0. |
| Real accounts | 13 | Live database, 2026-10-17 |
| Sample (fictional) accounts | 0 | Live: all 36 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| Real landlord units | 5 | Live, 2026-10-12 |
| Sample units | 0 | Live: all 20 deleted 2026-10-06 at the owner's request (restorable, see Rollback points) |
| "I'm interested" requests | 4 | Live, 2026-10-13 |
| Quick check-in responses | 2 | Live, 2026-10-17 (1 points award) |
| Roommate requests | 0 | Live, 2026-10-13 (table created that day) |
| Saved questionnaires | 4 | Live, 2026-10-13 |
| Admins | 1 | Live (the owner) |
| Automated tests | 498 of 498 passing | `npm test`, local, 2026-10-18 (two local Workers: passwords on, and Google only with Demo mode off) |
| Demo listings / profiles (fictional, in code) | 100 / 200 | `npm run demo:check`, 2026-10-18 (197 profiles shown, 3 hidden by choice) |
| AI cost so far | $0 | No Anthropic key exists; the assistant has only run in basic mode or against the test stand-in |

No real listings were imported because no authorized data source exists yet (see "Pending work").

## Deployment status

- **Live site:** https://cohabit-landlord-demo.dolgorsureng.workers.dev
- **Live version:** `8099c427-bc81-4cba-8dfd-a1af6fe809a3`, deployed 2026-11-14 with the owner's approval of the
  preview: home hero refinement (commit `3a657ac`, 538/538 on the second run; the first run's one failure was the
  password rate-limit check getting a 500 right after the test reset the local counters, unrelated and passing on the
  rerun; no database change). No forced full-screen height: the hero sits under the header and the photo's height
  follows the screen (300–640 px, at most 80% of its width), so the purple strip lands near the bottom of the first
  laptop screen; photo column wider (about 635 px wide on laptops); description 18/20 px; new photo of friends sharing
  pizza in a living room (Vitaly Gariev, Unsplash License, credited). Restore point before it: commit `71f5830`, tag
  `pre-home-hero-2026-11-14` (local). Checked live: signed-out checks as before; at 1366×657 the strip ends 26 px
  above the bottom and the button at 499 px; photo loads; no sideways scrolling at 1366 or 390 px; Listings unchanged.

  Before it: `ccc684a8-150f-4a5f-8aa9-fc25bcb6a29b`, deployed 2026-11-14 with the owner's approval of the
  laptop and phone previews: home page polish (commit `d15719a`, 538/538, no database change). Two sections on one
  page (header, hero, photo and purple strip: one laptop screen, up to 800 px tall, never clipped; then How it works,
  the cards and the footer); one content width and side margin for header, hero, cards and footer; balanced type
  sizes; lighter borders, shadows and stickers; the photo cropped 4:3 and shrinking on short laptop screens. Restore
  point before it: commit `e14050d`, tag `pre-home-polish-2026-11-14` (local). Checked live: signed-out checks as
  before; at 1366×657 section 1 is exactly the screen and the button ends at 502 px; no sideways scrolling at 1366 or
  390 px; Listings unchanged.

  Before it: `13f1eb6e-2872-41b1-86a4-23f512cf87fa`, deployed 2026-11-14 with the owner's approval of the local
  preview: home page refinement (commit `c84c949`, 538/538, no database change). Tighter spacing; a two-line laptop
  headline; header, headline, description and Find my match fit the first screen at 1366×768 and 1440×900; a lime
  "List your place" header button into the landlord flow (visitors: landlord sign-up; landlords: Add a unit; renters:
  hidden); no Listings or Sample dashboard in the home header, no link beside Find my match, no "Looking or listing?"
  section or duplicate links, home footer shows only Privacy and Terms; wording "Find your kind of home.", shorter
  How it works; brighter photo (Vitaly Gariev, Unsplash License, credited); footer tagline "Rooms. Roommates. Your
  vibe." on all pages. Restore point before it: commit `9d46fa0`, tag `pre-home-refine-2026-11-14` (local). Checked
  live: signed-out checks as before; at 1366×657 the button ends at 487 px, photo loads, no console errors; "List your
  place" opens the landlord sign-up (Google).

  Before it: `2c79daad-f654-4045-838e-d1d1693fe8ed`, deployed 2026-11-13 with the owner's approval of the local
  preview: the home page redesigned to the Figma home screen (cream background, "Your people. Your place." with a pink
  underlined "place.", purple and lime accents, a rounded tilted photo with stickers, a black pill "Find my match"
  button with a lime arrow, a purple marquee, How it works, the renter and landlord cards), with its own role-aware
  header (renters: Assistant, Matches, Listings, Messages, Profile, Sign out); styles scoped to the home page only;
  the privacy page now says the home photo loads from Unsplash too (commits `f955315`, `c7234de`, 538/538, no
  database change). Restore point before it: commit `39be0c6`, tag `pre-home-redesign-2026-11-13` (local). Checked
  live: signed-out checks as before; the home page renders (photo loads, no sideways scrolling at 1440 and 390 px, no
  console errors); Listings unchanged.

  Before it: `39ae3ea3-b3d1-453a-92ab-80c54f9e626f`, deployed 2026-11-11 ~20:05 UTC with the owner's approval:
  helpers wait up to 45 s a try (60 s in all; a retry needs 10 s left), send OpenRouter's reasoning setting (effort
  low), and a reply that stops arriving is logged as a timeout with the seconds waited (commit `550764b`, 538/538, no
  database change). Signed-out checks as before. **Helper test (20:08 UTC, polish on the owner's unit, not saved):**
  failed again. Log: Nemotron 3.5 Lightning answered after 27.1 s but spent all 1,500 tokens thinking (reasoning=1500,
  cut off), so "think less" wasn't honored; the retry (Nemotron 3.5 Super, Gemma 4 26B, 33 s left) got OpenRouter's
  own "504 The operation was aborted" (its wait for the provider ran out). Helpers switched back off; today's 10
  helper requests are used up.

  Before it: `13d42e2b-3bb1-4e93-a229-561d3d18f868`, deployed 2026-11-11 with the owner's approval: My matches
  shows a room only if it's free from the renter's move-in month or the month before (the assistant's window; 15 points
  for the month before), as well as affordable, big enough and scoring 70+; rooms free months earlier or later stay on
  Listings only (commit `34cac3b`, 537/537, no database change). Checked live: signed out as before; the owner's
  renter account (Nov 2026 move-in) in Demo mode now gets 2 of 100 demo rooms (both free from Nov 15, 2026, 100%),
  was 83, and 13 demo roommates; Demo mode turned back off.

  Before it: `917e67f3-0705-4ff9-a42e-1c6f64fbf3ea`, deployed 2026-11-11 with the owner's approval: demo data
  with two December 2026 groups (15 roommate profiles and 6 rooms free from mid-November or December), taken from the
  largest 2027 groups so the totals stay 100 listings and 200 profiles (197 shown); every coverage target still met
  (commit `3929a5b`, 534/534, no database change). Checked live: signed out as before; the demo endpoints give 100
  listings, 200 profiles (197 shown), move-in months now from Dec 2026, 15 December profiles and 7 rooms free in Nov or
  Dec 2026; signed in as the owner's renter account (Demo mode left off), 13 demo profiles are now compatible with the
  saved preferences (Nov 2026 move-in), up from 0.

  Before it: `75a84c62-9f0c-4f81-889e-51357229e84f`, deployed 2026-11-11 ~14:55 UTC with the owner's approval:
  a helper request with no answer (no message, an error inside the reply, a busy provider, empty, cut off) is tried
  once more with the next listed models (if today's helper share allows; the retry counts as a request), and a reply
  without a message is described in the logs (status, size, parts, finish reason, provider, model; never text)
  (commit `3ef4cb5`, 534/534, no database change). Signed-out checks repeated (all as before). The owner switched
  the helpers off at 14:50 UTC until they work reliably; the chat stays on.

  Before it: `34522db7-43c6-4d77-a944-e51ee6383c78`, deployed 2026-11-11 ~14:45 UTC with the owner's approval,
  chat and helpers left on: the helpers list checked models only (Nemotron 3.5 Lightning → Nemotron 3.5 Super → Gemma
  4 26B, no free router; only admin summaries keep it), and an unusable helper answer logs its own short line
  (`AI helper unusable: task=… reason=…`) (commit `8421f72`, 532/532, no database change). Signed-out checks
  repeated (all as before).

  Before it: `ba0046b4-6088-470f-87c7-c758ce410183`, deployed 2026-11-11 ~05:05 UTC with the owner's approval,
  chat and helpers left on: helpers ask for up to 1,500 tokens (was 300-500; Nemotron 3.5 Lightning spent all 400 of
  the polish helper's tokens thinking, so the owner's 3 live tries came back empty), a cut-off answer is a failed try,
  a person's helper use counts only for a usable result, and each helper request logs task, model, finish and tokens
  (never the text) (commit `fa6f908`, 531/531, no database change). Signed-out checks repeated (all as before; the
  public config says helpers on). With the owner's approval, today's helper count for the owner's admin account was
  reset (one `assistant_usage` row removed); the site's helper share still counts the 3 real requests.

  Before it: `6d87bbf3-a743-4f94-9db1-388b30de6850`, deployed 2026-11-11 with the owner's approval, chat left
  on: the chat lists checked models only (Nemotron 3.5 Super → Nemotron 3.5 Lightning → Gemma 4 31B, no free router),
  each step may use up to 1,500 tokens (was 900), and each AI chat reply logs its model, finish reason, requests and
  tokens, never the text (commit `efadcd1`, 529/529, no database change). Signed-out checks repeated (all as before).

  Before it: `428bb983-71c4-4a0d-a3aa-30d49952876a`, deployed 2026-11-11 with the owner's approval: Nemotron
  leads the chat and helper model lists (commit `215c064`), AI still switched off, no database change. Signed-out
  checks repeated (pages 200, helpers off, AI endpoints 401, cross-site 403, no key anywhere); signed in as admin, the
  AI panel lists chat Nemotron 3.5 Super → Gemma 4 31B → free router and helpers Nemotron 3.5 Lightning → Gemma 4 26B
  → free router; not paused.

  Before it: `ce127f77-8c0e-4613-82cf-6791b424e69f`, deployed 2026-11-10 22:43 UTC with the owner's approval: the
  busy-provider fix (commit `3e5d33f`), AI still switched off; signed-out checks repeated (all as before).
  **Third model check (2026-11-11 00:01 UTC, owner signed in as admin), all 4 models:** Nemotron 3.5 Super worked
  (correct tool call, 0.7 s); Nemotron 3.5 Lightning worked (correct tool call, 1.3 s); Gemma 4 31B (3.3 s) and Gemma 4
  26B (0.2 s) both got "Provider returned error" (Google AI Studio's free capacity busy, the same as at 22:34 UTC).
  The fix held: no pause was set, the switches stayed off, coHabit counted 4 admin requests, OpenRouter's free counter
  showed 0 of 50 right after. Both Gemma models lead a list (chat, helpers), so while Google stays busy each AI reply
  waits for the fallback to Nemotron; making Nemotron first is an owner decision (needs a deploy or a Worker variable).

  Before it: `ec3aef29-2490-481e-a5f8-99c5482359dd`, deployed 2026-11-10 22:33 UTC with the owner's approval: the
  model-check fix (commit `7972d8a`), AI still switched off. Signed-out checks repeated (pages 200, helpers off, AI
  endpoints 401, cross-site 403, no key anywhere). **Second model check (22:34 UTC):** Nemotron 3.5 Super worked (correct
  tool call, 1 s); Gemma 4 31B got "Provider returned error" (429 from Google AI Studio's free capacity, not the
  account: OpenRouter's free counter stayed at 0 of 50); the other 2 models were skipped (today's admin share, after
  the 4 refused requests of the first run). Found: coHabit treated that provider 429 as the account's daily limit and
  paused AI until 00:00 UTC (no effect while AI is off). Fixed locally: only the account's per-day limit pauses AI; a
  busy provider only affects that reply (the chat's fallback list then tries the next model). Needs a redeploy.

  Before it: `ff28f64e-a2b8-4b97-99a3-d4a4cd209778`, deployed 2026-11-10 with the owner's approval: AI on OpenRouter's
  free models with **every AI feature switched off** (commit `6e68a2e`, tag `checkpoint-2026-11-10-openrouter`). No
  database change. Bundle 527 KiB compressed, startup 60 ms. Checked live, signed out:
  - Pages return 200 (home, listings, My matches, assistant, admin, admin survey, privacy) and serve the new code,
    including the new privacy wording for AI.
  - `/api/config` reports the AI helpers off; the key appears nowhere in it.
  - Signed out, `/api/ai/help`, `/api/admin/ai`, the model check and the assistant return 401; from another site,
    the helpers and the admin switch return 403.
  - **Admin model check, run 2026-11-10 22:03 UTC (owner signed in as admin):** the key works (OpenRouter answered:
    free tier, 0 of 50 free requests used, key credit limit $5, $0 spent). All 4 models were refused in 0.1 s with
    "no provider", before reaching any model (OpenRouter's free counter stayed at 0). Cause, a bug in coHabit's
    requests: they sent `parallel_tool_calls`, which none of these free models support, together with "only
    providers that support every option". Fixed locally (not sent any more; a stand-in check now refuses unsupported
    options like OpenRouter does; refused requests no longer count toward coHabit's daily share; the check shows
    OpenRouter's own message). Needs a redeploy (owner's approval), then the check again.

  Before it: `df357d7e-73f7-4255-8104-1a7b6de9da29`, deployed 2026-10-18 with the owner's approval: the connected demo data (100 demo
  rooms, 200 demo profiles, Demo mode across Listings, My matches, the assistant and `/demo/people`; commit `f5d39e4`,
  tag `checkpoint-2026-10-18-demo-100`). No database change (none needed), so no restore point or migration. Bundle
  517 KiB compressed, startup 53 ms. Checked live, signed out:
  - Pages return 200 (home, listings, `/demo/people`, My matches, assistant, admin, privacy) and serve the new code.
  - `/api/config` reports Demo mode on with 100 listings and 200 profiles (197 shown); password sign-in still off.
  - `/api/demo/listings` returns 100 demo listings (94 ms), `/api/demo/people` 197 profiles with no contact details
    (112 ms); real `/api/listings` (4 listings) contains no demo ids.
  - All 41 photo addresses answer 200 with an image (checked without downloading).
  - Signed out, My matches, roommates, saved and admin demo APIs return 401; a cross-site Demo mode request returns 403;
    the admin cleanup returns 401.
  - Google sign-in still answers with a Google link (0.5 s).
  - In a browser as a guest: Listings in Demo mode showed 100 cards, 100 dashed pins, photos, the banner and no Save
    (renters only); switched back off afterwards (it's stored in that browser only).
  - Not checked: Demo mode signed in as a renter (My matches, Save, the assistant); that needs a real account.

  Before it: `05be52b1-a9aa-4485-8d33-3b94b38e6e02`, deployed 2026-10-17 with the owner's approval: the homepage paths, the account
  pages (Google only on the live site), and the sign-in freeze fix (commits `3fc6c9d`…`89e8e4d`, tag
  `checkpoint-2026-10-17-accounts`). Order used: restore point, migration 0009, deploy. Password accounts stay off:
  the Worker has no email sender and no `PASSWORD_ACCOUNTS` setting (secrets: names checked only). Checked live:
  - Pages return 200 (home, sign-up, sign-in, forgot and reset, listings, assistant, privacy) and serve the new code.
  - `/api/config` reports no password sign-in and no test inbox; all five password endpoints, the confirmation and
    reset links and `/api/dev/outbox` answer 404.
  - Google sign-in answers in 0.4 s with a Google link, right after a blocked cross-site sign-out (the freeze sequence).
  - In a browser, signed out: the homepage paths, "Sign up with Google", the Google sign-in panel, and
    `/forgot-password` going to `/signin`; no password fields anywhere (desktop and phone).
  - Signed out, the assistant, admin survey and roommate-request APIs return 401.
  - Not checked: a full Google sign-in with a real account (that needs the owner).

  Before it: `c35940b7-6b05-4156-9cf5-c274a3386f0e`, deployed 2026-10-14 with the owner's approval: the demo data refresh
  (commit `419c826`, tag `checkpoint-2026-10-14-demo-data`). No database change (none pending). Checked live after deploy:
  - Pages return 200 (home, assistant, listings, privacy), and the new photo, avatar and fact-list code, styles and
    privacy wording (Demo mode photos load from Unsplash) are served.
  - Signed out, the assistant and Demo APIs return 401 and a cross-site Demo request returns 403; public listings
    contain no demo ids or photos.
  - All 15 photo addresses answer 200 with an image (checked without downloading).
  - Not checked: Demo mode itself while signed in (it needs a real account).

  Before it: `e2e17667-50ba-4f0d-94ef-b2ed994b1d96`, deployed 2026-10-13 with the owner's approval: the Quick check-in and
  coHabit Points (commit `3afb592`, tag `checkpoint-2026-10-13-checkin`). Order used: restore point, migration 0008,
  deploy. Checked live after deploy:
  - Pages return 200 (home, assistant, listings, account, admin survey, privacy, terms), and the drawer, survey
    code and points wording are served.
  - Signed out: `/api/me` and `/api/survey` work (4 questions, no points state); a blank send and an "exclusive plus
    another answer" send are refused (400); a send from another site is refused (403); the admin results and CSV
    return 401. Only refused sends were tried, so the live tables stayed empty (0 responses, 0 awards).
  - Not checked: a real signed-in or guest send (part 11 of the manual test; it will add real rows).

  Before it: `d4ea27c7-4e1f-419f-b52e-21dfb4298ce9` (Details and requests, commit `d3d9734`, tag
  `checkpoint-2026-10-13-requests`). Order used: restore point, migration 0007, deploy. Checked live after that deploy:
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
- **Live database (`cohabit-db`):** migrations 0001 to 0009 applied. 0009 was applied on 2026-10-17 with the owner's
  approval, after a restore point (bookmark `000000a0-00000000-00005107-945d11084f9aa143232ee332dac64224`). It only added two empty, optional columns
  to `user` (`occupation`, `company`); data was checked before and after (13 users, 13 linked accounts, 6 sessions,
  5 units, 4 requests, 4 questionnaires, 3 chats, 2 check-in responses, 1 points award: unchanged).
  Earlier: migrations 0001 to 0008. 0008 was applied on 2026-10-13 with the owner's
  approval, after a restore point (bookmark `0000007f-00000000-00005104-ae72185c6770bf744251aa407c3afd16`). It only added two empty tables
  (`survey_responses`, `points_awards`) and their indexes; existing data was checked before and after (12 users,
  5 units, 4 "I'm interested" requests, 4 questionnaires, 3 chats, 1 saved option: unchanged). 0007 was applied on 2026-10-13 with the owner's
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
| **AI on OpenRouter (free models)** | Assistant replies, form filling, intro and description drafts, check-in themes, admin switches, budget and model check; all off until switched on (details below) | Deployed; assistant chat and helpers switched on 2026-11-11 |
| **Connected demo data** | 100 demo rooms and 200 demo profiles in Waltham, one Demo mode switch across Listings, My matches, the assistant and a demo profile page; coverage checked with the matching code (details below) | Yes (2026-10-18) |
| **Details and requests** | Shorter cards, exact vs partial groups, room Details with confirmed "I'm interested", roommate Details, Connect, accept/decline/withdraw, messages (details below) | Yes (2026-10-13) |

### AI on OpenRouter's free models (2026-11-10, live as `ff28f64e…`, switched off)

- **Plan and model audit:** [docs/OPENROUTER_PLAN.md](docs/OPENROUTER_PLAN.md), approved by the owner on 2026-11-10.
  16 of OpenRouter's 469 models are free; chat uses Gemma 4 31B, then Nemotron 3.5 Super, then the free router.
- **Key:** the owner's Worker secret `openrouter-api-key` (name checked only). It never leaves the server except to
  OpenRouter. No request has been sent to OpenRouter yet.
- **Free models only:** model ids that aren't `:free` (or the free router) are dropped before any request, so nothing
  can be billed; the owner should also set a credit limit on the key in OpenRouter.
- **Built:** the assistant on OpenRouter (same tools, the same check against invented numbers, the guided chat as the
  fallback); helpers (questionnaire and demo listing filters from a sentence, a Connect intro draft, a landlord
  description polish); admin AI panel (switches, OpenRouter's free counter, coHabit's requests per use, models, a
  model check, check-in themes); privacy page wording for AI (to approve before switching on).
- **Free budget:** 50 requests a day for the account: chat 34, helpers 10, admin 6; per renter 6 AI replies and 3
  helper uses a day; a pause until 00:00 UTC after OpenRouter's 429. No database change.
- **Deployed with AI off; model check done** (2026-11-11 00:01 UTC: both Nemotron models work with tools, both Gemma
  models' provider busy). **Approved 2026-11-11:** Nemotron leads the chat and helper lists (code default changed
  locally, 527/527) and the privacy page wording (already live, unchanged); the new order deployed 2026-11-11 as
  `428bb983…` with AI off. **Assistant chat switched on 2026-11-11 04:2x UTC** (owner's request; Admin → AI; the
  switch is recorded in the audit log): provider OpenRouter, first model Nemotron 3.5 Super, not paused, OpenRouter's
  free counter 2 of 50. Helpers still off. Not yet tried end to end: the assistant is for renter accounts only, and the
  owner's admin account is a landlord. **Next:** a renter tries the chat; later, the helpers (owner's decision).

### Connected demo data (2026-10-18, live as `df357d7e…`)

- **Data:** 100 fictional rooms and 200 fictional roommate profiles, all in Waltham. The 15 listings and 20 profiles
  that existed are kept with their ids (`src/assistant/demo-base.js`); the other 85 and 180 are written by
  `scripts/demo-build.mjs` to `src/assistant/demo-generated.js`, the same every time. Still in code, never the database.
  26 more free Unsplash photos (41 in all, each checked on its page, none on more than 3 listings); illustrated avatars.
- **Coverage, checked with the matching code (nothing loosened):** every profile has 3+ rooms that match everything
  (median 6) and 3+ roommates compatible both ways (median 23); every room suits 3+ visible profiles (median 10). Pairs
  fail on month, lease, must-haves, budget, lifestyle, pets and smoking, so not everyone matches everyone.
- **Demo mode across the site:** one switch (a renter's saved on the server, others' in the browser).
  Listings shows all 100 demo listings with filters (neighborhood, type, rent per person, move-in month, lease,
  furnishing, rooms), "Showing X of 100", dashed map pins, Details and Save. My matches shows demo rooms and demo
  roommates that fit the renter's saved preferences ("N of 100", "N of 197") and links to "Browse all demo profiles"
  (`/demo/people`, with filters and counts). The assistant uses the same data. Chats, answers, preferences, requests
  and real saved options never change when switching.
- **Safety:** no sign-in accounts or contact details for anyone fictional; demo requests are previews ("Demo only,
  nothing sent"), with no notifications. Demo cards can be saved and show only in Demo mode.
- **Data management:** `npm run demo:build`, `demo:check` (repeatable, targets met), `demo:report`. `DEMO_DATA=off`
  turns Demo mode off everywhere. An admin action removes only saved demo cards (the only demo records in the database).
- **Bugs fixed:** My matches compared a whole place's rent with one person's budget (whole two- and three-bedrooms never
  showed for people moving in together); a wish for "unfurnished" counted as wanting furnished; Save didn't work in
  Demo mode.
- **Found, not changed (owner's decision):** My matches shows a room in your area and budget even when the move-in
  month is months off (80% match), because area + budget + rooms reach its threshold. Details in docs/DEMO_DATA.md.
- **Report:** coverage, 20 representative searches with results and exclusion reasons, and every listing, photo and
  profile: [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

### Email and password accounts (2026-10-17, local only)

- **Homepage:** "Find a room or roommate" and "List your space" (remembered in the browser), with Browse listings and
  Sign in kept.
- **Sign-up:** renters (first name, email, password, optional Student / Working / Other) and landlords (name, email,
  password, optional company); email confirmation required, then the assistant or the landlord dashboard.
- **Sign-in and recovery:** Show/Hide password, "Forgot password?" under the field, neutral "check your email"
  answers, one-time 1-hour reset links, a new-password form and a confirmation.
- **Same account system** as Google (Better Auth), permissions still checked on the server for every request.
- **Database:** migration `0009_password_accounts.sql` (two optional `user` columns).
- **Off on the live site, by design:** password accounts need an email sender and `PASSWORD_ACCOUNTS=on`; until
  then every password endpoint answers 404 and the pages show only Google (tested in a browser and in `npm test`).
- **Sign-in freeze found and fixed:** a request rejected by our checks as the first sign-in request on a fresh Worker
  left Better Auth's setup unfinished, and every later sign-in request (Google too) hung. The live code has the same
  pattern for cross-site sign-out requests. Better Auth is now created only after the checks and kept only when ready.
- **Email check (2026-10-17):** no sending domain on the account; Cloudflare Email Sending needs Workers Paid and a
  domain; Resend and similar need a domain. The only $0 route is a dedicated Gmail account through Gmail's SMTP
  server with an app password (code not written; owner's decision). Password hashing (about 20 ms of CPU against the
  Free plan's 10 ms) still needs a live check; iterations stay at 100,000.

### Demo data refresh (2026-10-14, live as `c35940b7…`)

- **Audit:** 15 listings and 20 profiles already existed, in code (`src/assistant/demo-data.js`), not the database;
  no images; 8 listings outside Waltham. The assistant retrieved them in Demo mode. Improved in place, same ids.
- **Listings:** all 15 in Waltham neighborhoods; private rooms, a shared room, studios, spring and summer sublets, a
  lease takeover, whole apartments; per-room vs whole-place rent, utilities, lease, furnishing, laundry, transport.
  Each has an illustrative Unsplash photo (labeled, credited, Unsplash License).
- **Profiles:** 20 fictional seniors and grad students (17 shown, 3 hidden) with program/year, introduction,
  interests, budget, move-in, Waltham area and lifestyle; illustrated avatars drawn in the page.
- **Also fixed:** card photos could cover the first line of the card; group headings counted only the cards shown
  before "Show more"; demo Details said "the landlord shares" an area.
- **Records, sources, licenses and example searches:** [docs/DEMO_DATA.md](docs/DEMO_DATA.md).

### Quick check-in and coHabit Points (2026-10-13, live as `e2e17667…`)

- **What people see:** a feedback icon beside the profile menu (or beside Sign in) opens a drawer from the right
  (full width on phones) with "Quick check-in", four tap-to-answer questions and an optional comment. Every question
  is optional; Send feedback needs at least one answer or a comment, otherwise Not now. Nothing opens by itself, and
  the chat, results and search behind it stay as they were.
- **Points:** a signed-in person's first saved check-in earns 100 coHabit Points, once, enforced on the server and
  by the database. The drawer says "You earned 100 coHabit Points 🎉" only when they were awarded; repeat
  submissions and guests get a plain thank-you. Pilot participation points with no cash value; the balance shows
  on Account.
- **Admin:** `/admin/survey`: totals, answers per question, newest responses, CSV export, with Demo mode
  responses labeled and filterable. No names or emails.
- **Database:** migration `0008_survey_points.sql` (additive): `survey_responses` and `points_awards`.
- **Also updated:** privacy page (what's collected, who sees it, points) and terms (points have no cash value).

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

- `npm test`: **526/526** on 2026-11-10. New OpenRouter checks (a stand-in, never the real service): free
  model ids only (paid ids dropped from variables); tools in OpenAI's format; provider choice; AI off until an admin
  switches it on (guided chat, helpers 409, nothing sent); a chat turn through the tools with invented numbers
  removed; free models only, key only in the Authorization header, no names or emails sent; a tool call written as
  text falls back to the guided chat; requests counted per use with the model that answered; each helper's checks
  (unknown values and wrong types dropped, the intro name filled in by coHabit, phone numbers, addresses, emails and
  invented prices removed, typed input checked, roles, 3 uses a day); the model check (one request per model,
  tool use reported); check-in themes (counts capped, contact details removed); OpenRouter's 429 pauses AI until
  00:00 UTC with nothing more sent, and Resume; the key never in any response.

Earlier:

- `npm test`: **498/498** on 2026-10-18. New demo checks: 100 listings and 200 profiles with unique `demo-`
  ids and the 35 originals kept; 41 photos, none on more than 3 listings; every coverage target met using the matching
  code; realistic variation; compatibility symmetric; the generator writes exactly the committed file; exclusion counts;
  the two bug fixes; the demo endpoints (public, no contact details, never in real listings); one Demo mode switch
  across `/api/me`, My matches rooms and roommates; My matches in Demo mode equals the same rules over the demo data;
  demo saves (hidden or unknown ids refused) shown only in Demo mode; real matches unchanged after switching back;
  the admin cleanup removes only saved demo cards and is recorded; guest check-ins in Demo mode are labeled; with
  `DEMO_DATA=off` nothing demo is served.
- **Browser walkthrough (local preview):** guest Listings in Demo mode (100 cards, filters and counts, 100 dashed pins,
  photos, Details with photo credit, preview request); the demo profile page (filters, counts, Details, Connect preview
  with no network write); as a local test renter: My matches (81 of 100 demo listings, 73 of 197 profiles), the
  assistant in Demo mode (71 rooms fit, 31 match everything; 73 roommates, the same as My matches), Save from each
  page, switching back to real data; phone 390 px.

Earlier:

- `npm test`: **471/471** on 2026-10-17. New account checks (34): renter and landlord sign-up with their optional
  answers; role, confirmed email and photo can't be set; neutral replies; salted hashes only; confirmation email,
  sign-in refused until confirmed, confirmation signs in and routes by role; used links don't sign in again; same
  answer for wrong password and unknown email; field validation; other sites blocked; existing email (password or
  Google) gets the same answer and an email to the owner; reset: neutral request, 1-hour single-use token, no
  redirect to other sites, sessions signed out, old password fails, expired link refused; Google users can add a
  password; rate limit; account deletion; unconfirmed sign-ups cleaned up after 7 days; email sign-up off without a
  way to send mail.
- **Browser walkthrough (local preview, local test inbox):** homepage paths and remembered choice, renter sign-up
  with Student + Working and Show password, field errors, Check your email, landlord sign-up with company, local
  inbox, confirming (renter → assistant, landlord → dashboard), sign-in (wrong password, success), forgot password
  (known and unknown email: same message), reset form, password changed, reused link, phone 390 px.

Earlier:

- `npm test`: **437/437** on 2026-10-14. New demo-data checks: Waltham neighborhoods within 4 km; every listing has
  rent basis, utilities, lease, furnishing, laundry and transport; a unique labeled Unsplash photo with credit and
  license; every profile is a senior or grad student with program, intro, 3 interests and an avatar; no gender field,
  and names or avatars never change a score. Earlier demo checks (strong/partial/no-match, split rent, spring
  sublet, hidden profiles, never in Listings) still pass.
- **Local walkthrough (Demo mode):** five searches through the real API (see docs/DEMO_DATA.md), all 15 photos
  loading on cards and in Details, map pins, avatars on cards and in Details, phone 390 px with no sideways scroll.

Earlier:

- `npm test`: **433/433** on 2026-10-13. New Quick check-in checks (38):
  - Optional answers: one answer alone, a comment alone; a blank send is refused and stores nothing.
  - Exclusive answers, choose-one questions, unknown questions or answers, 500-character comments, emails and phone
    numbers in comments, other sites, a missing submission id: all refused.
  - Points: 100 on the first signed-in send; a retry with the same id saves nothing new; a repeat earns nothing;
    two sends at once award once; someone else's id is refused; balance on `/api/me`; landlords too.
  - Demo mode label; only the first part of the page path kept; matching preferences unchanged.
  - Admin only (guest 401, renter and landlord 403); totals, per-answer counts, Demo filters; CSV rows, readable
    answers, neutralized formulas, no names, emails or ids; 5 a minute; account deletion removes answers and points.
- **Browser walkthrough (local preview):** renter (first send with points, repeat without), a send that fails and
  keeps the answers then succeeds on retry, guest, phone (390 px, full-width drawer, no sideways scrolling), admin
  results on desktop and phone, the CSV file, and the chat, results tab and a Listings search unchanged after
  opening and closing the drawer.

Earlier:

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
- [x] Owner tries the redesigned assistant on the live site as a renter (2026-11-11: AI and guided chat, Clear chat, Demo mode).
- [x] Apply migration 0007 to the live database and deploy the 2026-10-13 work (restore point first; version `d4ea27c7…`).
- [ ] Run part 10 of the manual test with two real renter accounts (Details, Connect, Accept, Messages, room request).
- [x] Quick check-in live: restore point, migration 0008 on the live database, deploy (version `e2e17667…`).
- [ ] Run part 11 of the manual test (Quick check-in) on the live site. It adds real responses; that's expected.
- [x] Deploy and push the demo data refresh (2026-10-14, version `c35940b7…`, no database change).
- [x] Try Demo mode on the live site as a renter: a room search, a roommate search, Details on each (2026-11-11).
- [x] Deploy the connected demo data (2026-10-18, version `df357d7e…`, no database change).
- [x] Demo mode on the live site as a renter (owner's renter account in Chrome, 2026-11-11 ~15:30 UTC; Demo mode was
      off, turned on for the check and back off after): My matches showed the banner and 83 of 100 demo rooms, all
      labelled Demo; Save on a demo card worked ("Saved ✓", kept apart from real saved items) and was removed again;
      Listings showed 100 demo cards and 100 map pins; Details showed the photo credit, "made-up spot" and Demo label;
      the request form said "Demo listing: this is a preview. Nothing will be sent." (cancelled, nothing sent);
      `/demo/people` showed 197 profiles; the assistant showed demo results (19 demo roommates for its answers) and the
      guided chat answered one tap ("Sometimes", the same as the saved preferences). Found: (1) 0 of 197 demo roommates
      fit the saved preferences in My matches, because every demo profile moves in Jan–Sep 2027 and the saved move-in
      is Nov 2026, so a real renter moving in this year sees no demo roommates; (2) demo rooms starting Aug–Sep 2027
      show at 80% for a Nov 2026 move-in (the open My matches decision below).
- [x] Demo roommates for this year's renters (approved and deployed 2026-11-11, version `917e67f3…`): for sample
      answers like a typical renter's, compatible demo roommates went from 0 to 13 (Nov 2026), 12 to 26 (Dec 2026) and
      18 to 31 (Jan 2027). They're December 2026 profiles, so they'll need refreshing in the spring (a later
      `npm run demo:build` with new months).
- [x] In OpenRouter (owner): a credit limit on the `openrouter-api-key` key (OpenRouter reports $5, $0 spent).
- [ ] In OpenRouter (owner): decide on the free-models privacy setting (providers may use prompts for training).
- [x] Deploy the OpenRouter build with AI off (2026-11-10, version `ff28f64e…`, no database change).
- [x] Redeploy the model-check fix (2026-11-10, version `ec3aef29…`); second check: Nemotron 3.5 Super works, Gemma 4 31B's
      provider was busy, 2 models not checked yet.
- [x] Redeploy the busy-provider fix (2026-11-10 22:43 UTC, version `ce127f77…`).
- [x] Run Check models for all 4 models (2026-11-11 00:01 UTC): Nemotron 3.5 Super and Lightning work (correct tool
      calls, 0.7 s and 1.3 s); Gemma 4 31B and 26B: provider busy (Google AI Studio), no pause set.
- [x] Nemotron leads the chat and helper lists (owner's approval 2026-11-11): chat Nemotron 3.5 Super → Gemma 4 31B →
      free router; helpers Nemotron 3.5 Lightning → Gemma 4 26B → free router. Code default changed locally (527/527).
- [x] Deploy the new model order (2026-11-11, version `428bb983…`, AI still off, no database change).
- [x] Privacy page wording for AI approved by the owner (2026-11-11), as it already is on the live privacy page.
- [x] Switch on the assistant chat (2026-11-11, owner's request; Admin page → AI).
- [x] Try the AI chat from a renter account (owner, 2026-11-11 04:30–04:32 UTC; checked with live logs and the
      database, no message text read): 6 messages, 5 AI replies (2 with room cards), 1 guided chat because the
      model's answer hit the 900-token limit ("too_long"). 12 of the chat's 34 daily requests used (about 2 per reply).
      The last reply came from `dots-studio/dots-3-note-preview:free` through the free router, so both chosen models
      failed on that request; which model answered the others isn't recorded.
- [x] Chat: checked models only, a log line per AI reply, 1,500-token steps (approved and deployed 2026-11-11,
      version `6d87bbf3…`).
- [x] Second renter try after that deploy (owner, 2026-11-11 04:49 UTC): the AI reply came from Nemotron 3.5 Super
      (first choice), stopped normally, 1 request, 342 output tokens of which 298 were thinking (so 900 was tight;
      1,500 leaves room). The next 5 messages got the guided chat with "You've used today's 6 AI replies", as
      designed. Today: 13 of the chat's 34 requests used.
- [x] Helpers switched on by the owner (2026-11-11 04:52 UTC, Admin → AI; recorded in the audit log). Checked: the
      public config now says helpers are on; chat still on; not paused. No helper used yet.
- [x] First helper tries (owner, 2026-11-11 04:57 UTC, polish as landlord): 3 × "AI help didn't work this time" —
      each answer used exactly its 400-token limit thinking. Fixed and deployed as `ba0046b4…` (see above).
- [x] Helper tried again after that deploy (owner, 2026-11-11 14:35 UTC, polish): 2 × "didn't work". The new log lines
      show neither listed model answered (Nemotron 3.5 Lightning and Gemma 4 26B both failed), so the free router
      picked unchecked models: `nvidia/nemotron-3-ultra-550b-a55b:free` (an empty answer) and `liquid/lfm-3-1.7b:free`
      (1,500 tokens of thinking, cut off). The failed tries didn't use up the owner's helper uses; 5 of the helpers' 10
      free requests used today.
- [x] Helpers on checked models only (approved and deployed 2026-11-11, version `34522db7…`).
- [x] Model check at 14:45 UTC (owner): Nemotron 3.5 Super worked (correct tool call, 1.6 s) and Nemotron 3.5
      Lightning worked (correct tool call, 1.9 s); the 2 Gemma models skipped (today's admin share used up). So the
      14:35 helper failures were a short-lived busy spell, not a broken model.
- [x] Polish tried again (owner, 14:47:58 UTC): "didn't work"; log: `AI helper unavailable: task=unit_description
      bad_output No message in the reply.` OpenRouter answered with HTTP 200 but no message and no token counts (the
      body may have been empty or cut short). The same models answer the admin check (with tools) fine.
- [x] Log the reply's shape and retry once with the next listed models (approved and deployed 2026-11-11, version
      `75a84c62…`). Helpers switched off by the owner at 14:50 UTC meanwhile.
- [x] Polish tried with the retry (owner, 2026-11-11 15:00 UTC): failed again. Log: first try "HTTP 200, 0 bytes, empty
      body"; retry (Nemotron 3.5 Super, Gemma 4 26B) "504 The operation was aborted". Likely cause: the free providers
      took longer than the helpers' 20-second limit (OpenRouter answers "OK" straight away and sends the reply when the
      model is done; coHabit gave up mid-reply and read an empty body). The owner switched the helpers off again at
      15:01 UTC and chose to leave them off for now. The chat stays on.
- [x] Helpers: 45 s wait, "think less", timeouts logged (deployed 2026-11-11, version `39ae3ea3…`); tried: still
      failing (Nemotron Lightning thinks through all 1,500 tokens on the polish task; the retry timed out at
      OpenRouter). Helpers off.
- [ ] Later (owner's call): helpers with reasoning switched off for the Nemotron models (if OpenRouter supports it for
      them) or a model that doesn't think first; needs a model check of that request first (free requests).
- [ ] To turn the chat off at any time: Admin page → AI → "Assistant chat: On" (renters then get the guided chat).
- [x] My matches requires the room to be free in the move-in month or the month before (approved and deployed
      2026-11-11, version `13d42e2b…`; for sample answers, demo matches for Nov 2026 went from 83 to 2, Jun 2027 from
      83 to 29; sample data: 25 of 30 renters get a match, was 27). Was: "Decide whether My matches should require the
      move-in month within a month (today a room in your area and
      budget shows at 80% even months off; it affects real matches too)."
- [ ] Decide whether to use a dedicated Gmail account for coHabit's emails (the only $0 option found). If yes: create
      it with 2-Step Verification and an app password, enter it with `wrangler secret put`, and I'll add the SMTP sender.
- [x] Migration 0009 on the live database (restore point first) and deploy, passwords off (2026-10-17, version `05be52b1…`).
- [x] Sign in with Google on the live site to confirm the real flow end to end (the owner, both accounts, many times on
      2026-11-11: sign-in, Google callback, session, sign-out all seen in the live logs).
- [ ] Only after a sender exists and live email and speed checks pass: `PASSWORD_ACCOUNTS=on`.
- [x] Push the Quick check-in commits to GitHub (2026-10-13, with tag `checkpoint-2026-10-13-checkin`).
- [x] Push commits `d3d9734` and the deploy record to GitHub (2026-10-13, with tag `checkpoint-2026-10-13-requests`).
- [x] Owner tries the live assistant as a renter: a few answers, results, Save, Clear chat (2026-11-11).

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
| Code (current live) | `npx wrangler rollback <version>`. Previous versions: `ccc684a8-150f-4a5f-8aa9-fc25bcb6a29b` (home page before the hero refinement), `13f1eb6e-2872-41b1-86a4-23f512cf87fa` (home page before the polish), `2c79daad-f654-4045-838e-d1d1693fe8ed` (first home page redesign), `39ae3ea3-b3d1-453a-92ab-80c54f9e626f` (before the home page redesign), `13d42e2b-3bb1-4e93-a229-561d3d18f868` (helpers with a 20 s wait), `917e67f3-0705-4ff9-a42e-1c6f64fbf3ea` (My matches ignoring the move-in month), `75a84c62-9f0c-4f81-889e-51357229e84f` (demo data without December 2026), `34522db7-43c6-4d77-a944-e51ee6383c78` (helpers without the retry), `ba0046b4-6088-470f-87c7-c758ce410183` (helpers with the free router), `6d87bbf3-a743-4f94-9db1-388b30de6850` (helpers with 300-500 tokens), `428bb983-71c4-4a0d-a3aa-30d49952876a` (chat with the free router, 900-token steps), `ce127f77-8c0e-4613-82cf-6791b424e69f` (Gemma first; busy-provider fix), `ec3aef29-2490-481e-a5f8-99c5482359dd` (model-check fix), `ff28f64e-a2b8-4b97-99a3-d4a4cd209778` (first OpenRouter deploy), `df357d7e-73f7-4255-8104-1a7b6de9da29` (before AI on OpenRouter; no database change between them), `05be52b1-a9aa-4485-8d33-3b94b38e6e02` (before the connected demo data; no database change between them), `c35940b7-6b05-4156-9cf5-c274a3386f0e` (before the account pages and freeze fix; it doesn't read the two new columns, so it runs fine on the migrated database), `e2e17667-50ba-4f0d-94ef-b2ed994b1d96` (before the demo data refresh), `d4ea27c7-4e1f-419f-b52e-21dfb4298ce9` (before the Quick check-in; it doesn't use the new tables, so it runs fine on the migrated database), `e2da146e-2d3b-4c23-9591-63ae1e71a4b8` (before Details and requests; it doesn't use the new tables, so it runs fine on the migrated database), `bdc3fd32-43b6-4d4b-957a-5ae097605f44` (assistant before the redesign), `2e452e10-a5f3-4a87-b70a-b6970607f827` (before the assistant), `90064451…` (map with a toggle), `8adbaa8a…` (before maps) |
| Database before migration 0009 | Time Travel bookmark `000000a0-00000000-00005107-945d11084f9aa143232ee332dac64224` (only added two empty columns, so rolling back the code alone is usually enough) |
| Database before migration 0008 | Time Travel bookmark `0000007f-00000000-00005104-ae72185c6770bf744251aa407c3afd16` (only added tables, so rolling back the code alone is usually enough) |
| Database before migration 0007 | Time Travel bookmark `00000075-00000000-00005103-5f5ae051cfc181e65e91b5a1637f9a7c` (only added a column and tables, so rolling back the code alone is usually enough) |
| Database before migrations 0005 and 0006 | Time Travel bookmark `00000068-00000000-00005103-a85f3ce1468cd45f9f60c37caba86d90` (only added tables, so rolling back the code alone is usually enough) |
| Database before migration 0004 | Time Travel bookmark `00000032-00000000-000050f9-cded0b9a637a3ca8de724dfb34fae1b6` |
| Original static site | Version `a3c0f17b-d52a-47e3-9d71-5049e87a7a34`, git tag `pre-accounts-2026-09-29` |
| Previous checkpoint | Git tag `checkpoint-2026-10-06` |
| Earlier checkpoint today | Git tag `checkpoint-2026-10-12` (assistant first built) |
| Earlier checkpoint | Git tag `checkpoint-2026-10-12-redesign` |
| Previous checkpoint | Git tag `checkpoint-2026-10-13-requests` |
| Previous checkpoint (live code) | Git tag `checkpoint-2026-10-13-checkin` |
| Previous checkpoint (live code) | Git tag `checkpoint-2026-10-14-demo-data` |
| Previous checkpoint (live code) | Git tag `checkpoint-2026-10-17-accounts` |
| Previous checkpoint (live code) | Git tag `checkpoint-2026-10-18-demo-100` |
| This checkpoint (live, AI off) | Git tag `checkpoint-2026-11-10-openrouter` |
| Database before the sample accounts were deleted | Bookmark `00000056-00000000-000050fc-5835b9375b54a515988fe0a4d11150dd` |
| Database before the sample units were deleted | Bookmark `00000052-00000000-000050fc-3869841560ffed16fa9f4732df169900`, or re-run `scripts/sample-data.sql` (adds them back exactly) |

A restore overwrites the database in place, including anything saved since. Export first if unsure.
