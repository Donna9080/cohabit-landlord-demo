# coHabit accounts: setup and operations

How sign-in, saved data and the admin role work in this site, and the exact
commands to run, test, migrate and deploy it. Progress and decisions are in
[ACCOUNTS_WORKPLAN.md](ACCOUNTS_WORKPLAN.md).

## How it fits together

```
 Browser (public/*.html, app.js)
   │  same-origin fetch, HttpOnly session cookie, no tokens in JavaScript
   ▼
 Cloudflare Worker  "cohabit-landlord-demo"  (src/index.js)
   │  /api/auth/*  Better Auth 1.7.6: Google sign-in, sessions, sign-out
   │  /api/*       coHabit API: checks who you are, then what you may do
   │  (every other path is a static file from ./public; no Worker code runs)
   ▼
 Cloudflare D1  "cohabit-db"  (binding DB)
     user, account, session, verification, rateLimit   ← Better Auth
     units, match_preferences, app_rate_limits         ← coHabit

 Google (accounts.google.com) is only contacted during sign-in, by the browser
 redirect and by the Worker exchanging the one-time code. Scopes: openid email profile.

 Anthropic (Claude API) is only contacted by the Worker, for a renter's chat message,
 and only when the ANTHROPIC_API_KEY secret is set (see "AI assistant"). Not set: live runs basic mode.
```

There is no R2 bucket and no file upload. Matching and search are rule-based code in `src/match.js`,
`src/roommates.js` and `src/assistant/search.js`. The optional AI model only talks and explains (see "AI assistant").

## What is stored where

| Table (D1 `cohabit-db`) | What | Who can read it through the app |
| --- | --- | --- |
| `user` | id, display name, email, `role` (`user`/`admin`), `account_type` (`landlord`/`renter`), join date. Photo URL is dropped. | The person themself (`/api/me`); admin sees name, email, type, join date |
| `account` | Link from a Google subject ID (`accountId`) to a user. Google access/refresh/ID tokens are **not** kept (set to NULL by a hook in `src/auth.js`). | Nobody (server only) |
| `session` | Session token, expiry, user id. IP and user agent are **not** stored. | Nobody (server only; cookie holds a signed copy of the token) |
| `verification` | Short-lived OAuth state for sign-in in progress | Nobody |
| `rateLimit`, `app_rate_limits` | Request counters | Nobody |
| `units` | A landlord's units: name, general area, monthly rent, rooms available, move-in date, description, status; optionally a Massachusetts street address, pin (lat/lng), approximate/exact choice and the MapTiler attribution | Owner: everything. Everyone: active units' listing fields only (no owner, no status); the location as an approximate 500 m circle with no address, unless the landlord chose exact. Admin: a count per landlord |
| `match_preferences` | A renter's questionnaire: budget range, move-in month, area, rooms needed, sleep schedule, cleanliness, noise, guests, pets, smoking, chores (optional), and three switches: `roommate_visible`, `share_email`, `share_profile` (migration `0007`) | Only that renter. Not landlords, not admin (admin sees "saved yes/no"). Other renters see nothing unless the renter turns on roommate matching (see below) |

| `assistant_threads`, `assistant_messages`, `assistant_actions` | A renter's chat with the assistant, what it learned, and its confirmation cards (migration `0006`) | Only that renter. Not landlords, not admin |
| `saved_options` | Rooms and people a renter saved from the chat | Only that renter |
| `assistant_usage` | AI replies and tokens per day, per renter and for the site | Nobody per renter; admin sees site totals |
| `roommate_requests` | A renter's request to connect with another renter: who to whom, the introduction (max 500 characters), status (pending, accepted, declined, withdrawn) and dates (migration `0007`) | The two renters involved. Not landlords, not admin |
| `roommate_messages` | Messages between two renters after a request is accepted (max 1,000 characters each) (migration `0007`) | Only those two renters |
| `survey_responses` | Quick check-in answers: the answers, an optional comment (max 500), renter / landlord / guest, whether Demo mode was on, the first part of the page it was sent from, the time, and the points it earned (migration `0008`) | Admin sees answers and who answered (renter, landlord, guest), never names, emails or account ids. Not used for matching |
| `points_awards` | coHabit Points: one row per award (who, why, how many, which response earned it); a balance is the sum (migration `0008`) | The person themself (balance on Account and in the check-in). Admin sees how many awards were made |

Not collected: street addresses (rejected by validation), phone numbers, IDs,
dates of birth, financial or health details, profile photos.

The fictional sample dashboard (`/sample`, `/properties/<id>`) is still in
`public/data.js`. It is not in the database and is labeled "Fictional sample data".

## Renter contacts landlord ("I'm interested")

- A renter clicks **I'm interested** on an active, non-sample unit and can add a note of up to 500 characters
  (phone numbers are refused). Stored in `unit_interests` (migration `0003`), one request per renter per unit,
  at most 20 open requests per renter.
- The unit's landlord sees it under **Interested renters** on their dashboard: the renter's name, email and note.
  This is the only place a landlord sees a renter's identity, and only for renters who sent a request. Landlords
  never see questionnaire answers.
- Renters never receive the landlord's name or email. The landlord replies by email if they choose to.
- The renter can withdraw a request; the landlord can remove one from their list. Deleting the unit or either
  account removes the requests that belong to it.
- Routes: `GET/POST /api/renter/interests`, `DELETE /api/renter/interests/<unit id>`,
  `GET /api/landlord/interests`, `DELETE /api/landlord/interests/<request id>`. Admin sees none of it.

## Importing external listings (admin)

Admins can add real rental listings from **another source that allows coHabit to republish them**:
the listing website itself, a licensed data provider whose license allows public display, or landlords who
gave permission. Nothing is scraped, and fictional rows must never be imported as real listings.

**Status (2026-10-06): 0 real listings imported.** Apartments.com refuses automated access (its terms page and
robots.txt return 403 to automated tools) and coHabit has no republication agreement with it or its owner CoStar.
RentCast (a licensed provider with a free tier) only grants a "limited right to access and use", and its API terms
weren't confirmed to allow public display. See "What's needed to finish" below.

**How it works** (Admin → **Import listings**, `/admin/import`):
1. Fill in the source name, what gives permission (publisher authorization, licensed provider, or landlord
   permission) and the permission details (who granted it, when, where the written permission is kept).
2. Choose a CSV file made from the [template](public/import-template.csv) (header row only; one listing per row).
3. **Preview import** checks every row and saves nothing. Rows are marked Ready, Not available (rented, leased,
   expired, unavailable...), Duplicate (same source URL or source + listing id, in the file or already imported),
   Needs fixing (with the reason), or Over limit. At most **50** are imported at a time, chosen by city (Boston,
   Cambridge, Somerville, Waltham, Newton, Belmont, then others) and then most recently updated or posted.
4. Tick the confirmation and **Import**. The listings go live on Listings and the map, tagged **External**, with the
   source's posted/updated date, the retrieval date and a "View on <source>" link. They have no "I'm interested"
   button and belong to no landlord account. Renters' room matches still use coHabit listings only.
5. After a successful import, sample listings are hidden from Listings, the map and matches (kept for testing; the
   admin page has a Show/Hide switch). **Roll back** removes an import's listings; when none are left, the sample
   listings come back automatically. Every import, rollback and switch is recorded in `admin_audit`.

**Data rules:** blank stays blank (nothing is estimated). Rent is one amount, marked whole unit or per room (ranges
are refused). Massachusetts ZIPs/coordinates only. Coordinates are used only when `coordinates_permitted` is yes, and
a photo only with a `photo_license` (photos are stored but not shown yet). Listings are never called "latest"; the
card shows the source's own dates, or "No posting date given".

**Tables (migration `0005`, additive):** `import_batches` (source, permission, who, when, counts, status),
`external_listings` (the listings, linked to their batch), `app_settings` (the sample-listing switch),
`admin_audit`.

**Before a production import:** take a restore point (`npx wrangler d1 time-travel info DB`). Imports only add rows to
the new tables and change the sample switch; landlord units, users and requests are never touched. To undo,
use **Roll back** on the import page.

**What's needed to finish importing 50 real listings** (any one of these):
- Written permission from Apartments.com/CoStar (or another listing site) to republish listings, plus an export
  or feed from them in the template's columns; or
- A licensed provider account whose license explicitly allows displaying listings publicly on coHabit (check the
  API terms and whether it needs billing before signing up); or
- Landlords who send their own current listings (address, rent, beds/baths, availability, source link) and agree
  in writing that coHabit may publish them.

Then: fill the template, run Preview, import, check Listings and the map, and record the batch id in the workplan.

## Maps and location (MapTiler, Massachusetts only)

**Provider:** MapTiler Cloud, Free plan (every Listings page visit loads the map, so counts as one map session) (checked 2026-10-02): no card, 5,000 map sessions, 1,000 search sessions and
100,000 API requests a month. Over the limit the service **pauses until next month; nothing is charged**. The Free plan is
for "testing, PoC, prototyping, personal, or non-commercial use", which covers this class project; a commercial coHabit
would need a paid plan. Billing is not enabled. Maps are drawn with MapLibre GL JS 4.7.1 (open source), loaded from
jsDelivr only when a map is opened.

**Key:** one browser key, `MAPTILER_KEY`, restricted in MapTiler (Account → API keys → the key → Allowed HTTP origins) to:

```
cohabit-landlord-demo.dolgorsureng.workers.dev
localhost
```

It is meant to be visible in the browser (`GET /api/config` hands it to the page); the origin list is what protects it.
Locally it lives in `.dev.vars`; in production it is a Cloudflare secret (`npx wrangler secret put MAPTILER_KEY`).
To replace it: create a new key with the same origins, put it in both places, then delete the old key in MapTiler.
There are no server-side map credentials.

**Renters (Listings page):**
- One field, **City, neighborhood or ZIP**, with suggestions limited to Massachusetts (country US, a Massachusetts
  bounding box, and only results whose address is in Massachusetts). Picking one shows listings within 3 to 15 km
  depending on the size of the place, nearest first. Typing without picking still filters by listing name and area,
  which is also what happens if MapTiler is unavailable.
- **Use my location** asks for browser permission only when clicked. The position is used in the browser to filter and
  sort, then forgotten; it is never sent to coHabit's server or saved. Declined, unavailable or outside Massachusetts
  each show a short message, and the search field keeps working.
- A map of Greater Boston is always shown above the list (loaded after the list, so the list never waits). It shows the listings that match the search: approximate ones as a circle with a pin, sample
  ones in grey and labeled Sample. A pin opens a label; **View listing** scrolls to and highlights that listing's card.
  When the map is open, MapTiler sees which area is being viewed, as with any web map.

**Landlords (Add or edit a unit):** an optional **Street address** field with Massachusetts address suggestions. Picking
one fills the general area if it's empty and shows a small map with a draggable pin (moves of up to 1 km). **What renters
see**: *Approximate area* (default) or *Exact location*. The server refuses pins outside Massachusetts and addresses whose
suggestion wasn't in Massachusetts. Street addresses are still refused in the unit name, area and description.

**Approximate locations:** the server snaps the pin to a roughly 400 m grid and moves it by a per-unit offset derived
from a secret, so the true spot is always inside the 500 m circle renters see but can't be worked out from it. The exact
pin and the street address never leave the server for approximate units.

**Storing coordinates:** MapTiler's terms say databases built from its search results must carry attribution. Every
saved location stores `geo_source = "© MapTiler © OpenStreetMap contributors"`. Sample units carry
`"Sample: neighborhood center, set by hand"` instead (they were placed by hand, not geocoded).

## Roommate matching (opt-in)

Renters can be matched with each other on their lifestyle answers. The code is in `src/roommates.js`; the rules and a
worked example on the sample data are in [docs/SAMPLE_MATCHING.md](docs/SAMPLE_MATCHING.md).

- Two switches on the renter's questionnaire, stored in `match_preferences` (migration `0002`), both **off by default**:
  `roommate_visible` ("Show me to compatible renters") and `share_email` ("Let my roommate matches see my email").
  `share_email` cannot be on without `roommate_visible`.
- `GET /api/renter/roommates` only works for a signed-in renter who has `roommate_visible` on, and only compares them
  with other renters who have it on. A renter who has it off sees nobody and is seen by nobody.
- What it returns about another renter: first name, score, the list of things the two have in common, a sample flag,
  and the email only if that renter turned on `share_email`. Never an id, last name, budget figures or raw answers.
- Admin still sees none of this. Turning the switch off, or deleting the account, removes the renter from other
  people's results on the next request.

### Details and Connect (roommate requests, migration `0007`, live since 2026-10-13)

- **A third switch, `share_profile`** ("Share my details with my matches"), off by default and only possible with
  `roommate_visible` on. Details then shows that person's budget range, move-in month, area, lifestyle tags and where
  your answers differ, **only when both renters have it on**. Without it, Details shows what you have in common and
  how many answers differ, never which ones. Email still needs `share_email` and appears only in Details.
- **No ids in the browser.** Each person comes with a `handle`: their id encrypted (AES-GCM) with a key derived from
  `BETTER_AUTH_SECRET` and bound to the viewer. A handle only works for the renter it was made for; a changed or
  borrowed handle gets 404. Demo profiles have no handle, so they can never be sent a real request.
- **Connect** opens an editable introduction. Nothing is sent until **Send request**. The recipient sees the first
  name, the introduction and what the two have in common, then **Accept** or **Decline**. The sender can **Withdraw**
  while it's pending. After acceptance both can **Message** each other on coHabit (no phone numbers or addresses;
  those are refused). Status shows on the card, in Details, and under "Roommate requests" in the assistant and on
  My matches.
- **Server checks** (`src/connections.js`): renters only; the sender must have roommate matching on; the target must
  be a discoverable renter; no requests to yourself; one open request per pair (also a unique database index); no
  new request after a decline; at most 10 open outgoing requests; only the sender can withdraw, only the recipient
  can accept or decline; only the two renters can read or send messages, and only after acceptance; 500 messages per
  conversation; the usual Origin check and write rate limit.
- **API:** `GET /api/roommates/requests` (incoming, outgoing, connected, earlier); `POST /api/roommates/requests`
  `{handle, intro}`; `POST /api/roommates/requests/<id>` `{action: withdraw | accept | decline}`;
  `GET`/`POST /api/roommates/requests/<id>/messages`.
- **Deleting an account** deletes its requests and messages. There are no email notifications (that would need a
  paid email service); people see new requests when they open the assistant or My matches.
- **Rooms ("I'm interested")** use the existing request flow, now also opened from a room's Details in the
  assistant, with a "Send this request?" confirmation first. "Request sent" and Withdraw stay in step on the card,
  in Details, on Listings, in Saved and on My matches. A request doesn't reserve the room. Demo listings show a
  preview only; external listings say to contact the original site; sample listings have no landlord to contact.

## Quick check-in survey and coHabit Points (migration `0008`, live since 2026-10-13)

An optional survey that helps shape coHabit. It never opens by itself: a small feedback icon sits beside the profile
menu (or beside **Sign in**) and opens a drawer from the right, full width on phones. It's a dialog on top of the
page, so the chat, results, tabs and any search stay exactly as they were. The code is in `src/survey.js`.

- **Questions** (all optional, tap to answer): where people look for rooms or roommates (several; "I haven't looked
  yet" can't be combined), how well their options work (one), whether they'd create a roommate profile (one), and
  what they'd use coHabit for (several; "None of these" can't be combined), plus a comment of up to 500 characters.
  A choose-one answer clears when tapped again. **Send feedback** stays off until there is at least one answer or a
  comment; **Not now** closes the drawer and keeps the draft until the page is reloaded.
- **Anyone can send it**, signed in or not. Guests get a plain thank-you. Comments with emails, phone, ID or card
  numbers, or street addresses are refused, as everywhere on coHabit. At most 5 submissions a minute per person (or
  per network address for guests). Writes need the usual same-site Origin.
- **Saving:** success is shown only after the server saved it. If sending fails, the answers stay and **Send
  feedback** tries again with the same submission id, so a retry never saves twice.
- **coHabit Points:** a signed-in person's first saved check-in earns 100 points, once. The award is made on the
  server in the same transaction as the response, and the database allows only one award per person for this
  check-in (`UNIQUE (user_id, reason)`), so retries, repeat submissions and two sends at once can't award twice.
  Only then does the drawer say "You earned 100 coHabit Points 🎉". Points are pilot participation points with no
  cash value and nothing to redeem yet; the balance shows on **Account**.
- **Demo mode:** submissions sent while a renter's assistant Demo mode is on are labeled, and the admin can show
  them alone or leave them out.
- **Separate from matching:** the answers are in their own table and never read by matching or the assistant.
- **Admin:** **Admin → Check-in survey** (`/admin/survey`) shows totals, answers per question (count and share of
  those who answered), the newest 200 responses, and **Download CSV** (all responses, formulas neutralized), each
  for all responses, without Demo mode, or Demo mode only. No names, emails or account ids.
- **API:** `GET /api/survey` (questions, and whether the points were earned); `POST /api/survey`
  `{id, answers, comment, page}`; `GET /api/admin/survey?demo=all|real|demo`; `GET /api/admin/survey.csv`.
- **Deleting an account** deletes its check-in answers and points.

## AI assistant (chat)

**Status (2026-10-12): live in basic mode** (deployed as `d7e38548-66c4-4eab-890c-ac0c692a1bcd`, migrations 0005 and 0006 applied). The owner
chose to stay on basic mode for now, so there is no AI key and it costs $0.
Renters get one chat at `/assistant`, now their first stop after sign-in. The questionnaire and matches
(`/renter`) and Listings are unchanged and linked from the chat.

**Redesign (2026-10-12, live as `e2da146e-2d3b-4c23-9591-63ae1e71a4b8`; no database change was needed).**
- **Layout.** Results take the left two thirds and the guided chat the right third. On phones, Chat and Results tabs
  switch between them and keep their state.
- **Results follow the goal:**
  - A room: listing cards with a List / Map toggle. Pins and cards stay in step: tap one and the other is selected.
  - A roommate: profiles of students who chose to be found, with what you have in common.
  - Both: Rooms and Roommates tabs that share the same answers.
- **Answers as chips.** The student's answers sit above the results. Tap one to change it or make it a must-have.
  "All your answers" and "Saved" are folded away below.
- **Live results.** Results are worked out from the answers every time they change, separately from the chat, so the
  question flow is unchanged. They show as "early results" once two of the four basics are known.
- **Empty results.** They name the must-haves that block results and offer explicit changes. Nothing is loosened
  silently.
- **Wording.**
  - The headline is "Find your room. Find your people." and the welcome is "Hey! What are you looking for?" (A room /
    A roommate / Both). That welcome counts as the first question.
  - The questions are shorter, with the same order, branching and answer values.
  - Tapped answers aren't echoed; typed ones get a short "Noted: …".
  - A "Guided chat" note explains the free mode's limits and how the chat is stored.
- **Demo mode.** A switch on the assistant page (see "Demo mode" below).

**What it does.**
- It asks one question at a time and learns:
  - Budget, move-in month, and towns or distance from Brandeis.
  - Rooms needed and lease length.
  - For roommates: sleep, tidiness, noise, guests, pets, smoking and chores.
- Must-have or flexible: each answer can be a must-have (it filters results) or flexible (it only changes the order).
  The side panel "What I know so far" lists every answer, with Must-have/Flexible and Forget buttons.
- Results: up to 3 rooms or people appear beside the chat, or inside it on phones. Each card shows why it fits and
  what doesn't. Rooms open in a Details box (with the usual "I'm interested") and can be saved; people can be saved.
- Controls:
  - Starter buttons and quick-answer chips.
  - Clear chat, which asks for confirmation first.
  - A note under the chat explaining what is stored and sent.

**Who does what.**
- **The database code decides the results** (`src/assistant/search.js`):
  - Must-haves filter; flexible answers rank.
  - Every "fits" and "doesn't fit" line is written here.
  - When nothing fits, it counts how many listings relaxing each condition would bring back.
  - Sample listings and people are left out unless the renter asks for them, and are always labeled.
  - Only renters who turned roommate matching on are compared.
  - Distance is straight-line from Brandeis, using the same approximate point renters see. There is no travel-time data.
  - A must-have distance hides rooms known to be farther. A room with no map location is still shown, after the rooms
    that fit, marked "distance to Brandeis unknown". Most live units had no address yet on 2026-10-12.
- **The AI model explains** (Claude, called from the Worker with the official Anthropic SDK, `src/assistant/ai.js`).
  - It can only call four tools: `update_memory`, `search_rooms`, `search_roommates` and `propose_action`.
  - Every value it sends is checked like form input (`src/assistant/memory.js`). It cannot store anything outside
    the fields above (for example, gender or religion).
  - Its instructions forbid inventing anything and forbid using protected characteristics. They also say that a
    suggestion is not approval.
- **Grounding check.**
  - Every dollar amount, percentage and km/mile figure in the model's reply must also appear in this turn's search
    results, the renter's own words or the saved answers.
  - Sentences that fail are removed. Travel times are always removed.
  - If too little is left, the reply is rewritten from the search results.
- **Confirmation before anything happens.** Nothing is saved to the profile and no landlord is contacted until the
  renter clicks Confirm on a card (`POST /api/assistant/actions/<id>`). That step reuses the questionnaire's and
  "I'm interested" checks. The landlord note can be edited first, and email sharing is a separate tick box.

**Two modes.**
- **AI mode** needs the `ANTHROPIC_API_KEY` secret.
- **Basic mode** takes over when there is no key, a limit is reached, or the AI service fails or declines.
  - It is rule-based (`src/assistant/basic.js`) and uses no outside service.
  - It uses the same search, cards and confirmations, and shows a notice saying why it's in basic mode.
  - It is free.

**Limits** (Worker variables; defaults in code):

| Variable | Default | What |
| --- | --- | --- |
| `ASSISTANT_MODEL` | `claude-opus-5-5` | `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` |
| `ASSISTANT_DAILY_PER_USER` | 40 | AI replies per renter per day (UTC), then basic mode |
| `ASSISTANT_DAILY_SITE` | 300 | AI replies per day for the whole site, then basic mode |
| `ASSISTANT_PER_MINUTE` | 10 | AI messages per renter per minute (basic mode keeps the usual 30 writes a minute) |

Each reply is also capped:
- At most 5 model calls, each with up to 4,000 output tokens, a 25-second timeout and 1 retry.
- Messages are limited to 800 characters.
- Messages containing phone numbers, email addresses, ID or card numbers, or street addresses are refused before
  they are saved or sent.

**Storage** (migration `0006_assistant.sql`, additive):

| Table or column | What it holds |
| --- | --- |
| `assistant_threads` | The answers it learned, plus a server-only map from R1/P1 labels to ids |
| `assistant_messages` | The last 100 messages per renter |
| `assistant_actions` | Confirmation cards |
| `saved_options` | Rooms and people the renter saved |
| `assistant_usage` | Daily replies and tokens |
| `match_preferences.chores` | Optional chores answer, also added to the questionnaire |

When it is deleted:
- **Clear chat** deletes the messages, the learned answers and the cards. Saved options stay.
- **Deleting the account** deletes all of it.
- **The daily cleanup job** deletes chats unused for 90 days, closes unanswered cards after 7 days, and deletes
  per-renter usage counts after 7 days.

**What the AI service receives:**
- The fixed instructions and tool list.
- The renter's last 12 messages and the assistant's replies.
- A note with today's date, the learned answers and what's on screen.
- Search results:
  - For rooms: name, area, rent, rooms, move-in date, the first 300 characters of the description, and the
    approximate distance.
  - For people: only a label (P1–P3), a score and what the two have in common.

It never receives names, email addresses, user or unit ids, or street addresses (checked by `npm test`). The admin
sees daily totals and an estimated cost, never chats (Admin page, "AI assistant").

### Demo mode (fictional listings and people)

A switch at the top of `/assistant` swaps the results for 15 made-up listings and 20 made-up roommate profiles around
Waltham. They let anyone try coHabit, given how few real listings there are.

- **The data lives in code** (`src/assistant/demo-data.js`), never in the database:
  - There is nothing to seed, so nothing can be seeded twice.
  - Real data is never touched.
  - Demo records never appear in Listings, real matches, the admin user list or any count.
  - Every id starts with `demo-`.
- **Scenarios covered:**
  - Rooms in shared houses, a shared bedroom, studios, a spring sublet and a lease takeover.
  - Whole places for two or three friends, a group replacing a graduating roommate, and a room for an incoming grad
    student.
  - Furnished and unfurnished places, a range of utilities, lease lengths and ways to get to campus, and
    budgets from $700 to $3,450.
  - Searches that match strongly, partly, or not at all.
- **Rent.**
  - Each listing says whether its rent is per room or for the whole place.
  - Whole-place rent is split between the people moving in together (the rooms they need, up to the number of
    bedrooms). One person pays all of a studio's rent.
  - Lease length and "furnished" are compared only for listings that record them. Real listings are matched exactly
    as before.
- **Roommate profiles.**
  - Each has a first name, a town and a short line, never a location or contact details.
  - Three chose not to be found and are never shown.
  - Scores and shared traits come from the normal matching code. Seeing demo profiles doesn't need the student's own
    opt-in, because nobody real is involved; their lifestyle answers are still needed.
- **Labels and limits.**
  - Every demo card says "Demo", demo pins are dashed, and a banner stays on while Demo mode is on.
  - Demo cards can't be saved (409), and demo listings have no landlord to contact.
  - The pictures are simple drawings made in the page; no images are loaded.

### Turning the AI on (the owner's decision: it can cost money)

Until a key is added, the assistant runs in basic mode and costs nothing.

1. Sign in to the Anthropic Console at https://platform.claude.com with your own account.
   - New accounts get a small amount of free credit.
   - After that, usage is billed to a card you add yourself.
2. Set a spend limit before creating a key.
   - Go to **Settings → Billing → Spend limits → Set limit** and choose, for example, $5 a month.
   - When the limit is reached, Anthropic refuses requests and coHabit switches to basic mode. Nothing more is charged.
3. Create the key: **API keys → Create key**, named `cohabit`. It is shown only once.
4. Enter the key yourself. Never paste it into a chat, an issue or a file that's in git.
   - **Local testing:** add a line `ANTHROPIC_API_KEY=<the key>` to `.dev.vars` (git-ignored) and restart `npm run dev`.
   - **Production, only when deploying:** run `npx wrangler secret put ANTHROPIC_API_KEY` and paste the key at the
     hidden prompt.
5. Optional: choose a cheaper model.
   - Add `"ASSISTANT_MODEL": "claude-haiku-5-5"` (or `claude-sonnet-5-5`) under `vars` in `wrangler.jsonc`, or as a
     line in `.dev.vars`.

### Expected cost

Anthropic list prices, checked 2026-10-12, in US dollars per million tokens:

| Model | Input | Output | Cached input |
| --- | --- | --- | --- |
| Opus 5.5 | $4 | $20 | $0.20 |
| Sonnet 5.5 | $2 | $10 | $0.10 |
| Haiku 5.5 | $0.10 | $0.50 | $0.01 |

How much each reply uses:
- The fixed instructions and tool list are about 2,700 tokens, plus 286 that the API adds whenever tools are used.
  This part is marked for caching.
- A typical reply takes 2 or 3 model calls.

| Model | Per AI reply (estimate) | 600 replies (30 students × 20) | Most in one day (300-reply cap) |
| --- | --- | --- | --- |
| Opus 5.5 (default) | about 2–6¢ | about $15–35 | about $17 |
| Sonnet 5.5 | about 1–3¢ | about $7–18 | about $9 |
| Haiku 5.5 | about 0.1¢ | under $1 | under $0.50 |

Where to see the real numbers:
- The Admin page shows each day's AI replies and an estimate at list prices, before caching discounts.
- The Console's Usage page shows the actual bill.

Refusal fallback:
- On Opus and Sonnet, requests turn on Anthropic's server-side fallback (`fallbacks: "default"`). If the model
  declines for a safety reason, Anthropic answers with another model, billed at that model's rates.
- If every model declines, coHabit answers in basic mode.

### Deploying it (done 2026-10-12, each step approved by the owner)

This also shipped the earlier import tool (commit `8443019`), which needs migration 0005. Restore point taken before
the migrations: bookmark `00000068-00000000-00005103-a85f3ce1468cd45f9f60c37caba86d90`. Steps used:

1. Note a restore point: `npx wrangler d1 time-travel info DB`.
2. Apply migrations 0005 and 0006 (both additive): `npx wrangler d1 migrations apply DB --remote`.
3. Optional: set the `ANTHROPIC_API_KEY` secret (see above). Without it, the live site runs basic mode at $0.
4. Deploy with `npx wrangler deploy`, then sign in as a renter and open `/assistant`.

To turn AI mode on later, only step 3 is needed (no redeploy). Setting or changing a secret takes effect immediately.

## Sample data (fictional)

Loaded on 2026-10-01 so matching can be seen with realistic volume: 6 sample landlords, 20 sample units and
30 sample renters around Waltham, Belmont and Cambridge. They are generated by `scripts/sample-data.mjs`.

- Every sample user id starts with `sample-`, the name ends in "(sample)", the email is at `sample.example`.
- They have no Google link and no session, so nobody can sign in as them.
- The site shows a **Sample** tag on their listings and in the admin list; the admin headline counts real people only.
- What matching does with them is written up in [docs/SAMPLE_MATCHING.md](docs/SAMPLE_MATCHING.md).

```powershell
node scripts/sample-data.mjs                                           # regenerate the SQL and the report
npx wrangler d1 execute DB --local  --file scripts/sample-data.sql     # load locally
npx wrangler d1 execute DB --remote --file scripts/sample-data.sql     # load in production (replaces earlier sample rows)

# Remove all sample data from production (real users and units are not touched)
npx wrangler d1 execute DB --remote --command "DELETE FROM units WHERE landlord_user_id LIKE 'sample-%'; DELETE FROM match_preferences WHERE user_id LIKE 'sample-%'; DELETE FROM user WHERE id LIKE 'sample-%'"
```

Remove it before counting users or listings for anything you report as real traction.

**2026-10-06:** all sample data (20 units, 36 accounts) was deleted from production at the owner's request, so live
counts are real data only. Re-running `scripts/sample-data.sql` would add all of it back. The fictional dashboard at
`/sample` is built into the code and is unaffected.

## Who can do what

| | Visitor | Landlord | Renter | Admin |
| --- | --- | --- | --- | --- |
| Home, Listings (search and sort), Sample dashboard, Privacy, Terms | ✓ | ✓ | ✓ | ✓ |
| Sign in with Google, choose landlord/renter once | ✓ | | | |
| Create/view/edit/delete **own** units | | ✓ | | |
| Save/edit **own** preferences, see matches | | | ✓ | |
| See possible roommates (only after opting in; only others who opted in) | | | ✓ | |
| Tell a unit's landlord "I'm interested"; withdraw it | | | ✓ | |
| Chat with the assistant; confirm its cards; save options (`/assistant`) | | | ✓ | |
| See and remove requests from renters on **own** units | | ✓ | | |
| Delete **own** account and everything saved with it (`/account`) | | ✓ | ✓ | ✓ (not the last admin) |
| Read-only user list (`/admin`), AI assistant totals and estimated cost | | | | ✓ |

Rules enforced on the server (`src/index.js`), not in the page:

- The owner of a unit / preference record is always the signed-in user from the
  session. `landlord_user_id`, `user_id`, `role`, `account_type` in a request body are ignored.
- Landlord routes return 404 for another landlord's unit (no way to tell it exists).
- `account_type` is set once (`UPDATE … WHERE account_type IS NULL`), and a
  database trigger rejects any later change. Choosing a type never touches `role`.
- `role` defaults to `user`. No web endpoint changes it. Admin checks read the
  role from D1 on every request, so demotion is immediate.
- Delete my account (`POST /api/me/delete`, body `{"confirm":"DELETE"}`) removes only the signed-in user: their units,
  preferences, sessions, Google link and user row, in one D1 batch (one transaction). No user id is read from the
  request. The last remaining admin is refused (409), so the owner can't lock themself out. Signing in again with
  the same Google account afterwards creates a brand-new, empty account.
- Only four Better Auth endpoints are reachable: `GET /api/auth/get-session`,
  `POST /api/auth/sign-in/social`, `GET /api/auth/callback/google`,
  `POST /api/auth/sign-out`. Everything else under `/api/auth/` returns 404
  (no update-user, delete-user, email sign-up, account linking, admin plugin).
- Sign-in requests are rebuilt on the server: provider is forced to Google,
  extra scopes and client-supplied ID tokens are dropped.
- Writes must come from the site's own origin (`Origin` and `Sec-Fetch-Site`
  checks) and be JSON. Bodies over 16 KB are refused. No CORS headers.
- Every API response is `Cache-Control: private, no-store`.
- Rate limits (stored in D1, so shared by every Worker instance): coHabit API
  120 reads and 30 writes per minute per user (or per IP when signed out); Better
  Auth 60/min per IP overall, 10/min for starting sign-in, 20/min for callbacks.
- Sessions last 7 days (renewed daily when used). A daily cron (04:17 UTC)
  deletes expired sessions, OAuth state and old counters.

## How the first admin was assigned

The owner (user id `E17hW2AFcxjOkt3oA3Cmvq3VTroxN5X5`) signed in with Google on 2026-09-30 and was promoted with the
commands below. There is no web page or endpoint that makes someone an admin, and the first
person to sign up is not special. The owner runs a D1 command with Wrangler,
which requires being logged in to the Cloudflare account:

```powershell
# 1. Find your user row (after signing in once on the live site)
npx wrangler d1 execute DB --remote --command "SELECT user.id, user.name, user.email, user.role, account.accountId AS google_subject FROM user JOIN account ON account.userId = user.id ORDER BY user.createdAt"

# 2. Promote exactly that row (match both id and email)
npx wrangler d1 execute DB --remote --command "UPDATE user SET role = 'admin' WHERE id = '<USER_ID>' AND email = '<YOUR_EMAIL>'"

# 3. Check
npx wrangler d1 execute DB --remote --command "SELECT id, email, role FROM user WHERE role = 'admin'"

# Demote (takes effect on the next request)
npx wrangler d1 execute DB --remote --command "UPDATE user SET role = 'user' WHERE id = '<USER_ID>'"

# Sign someone out everywhere
npx wrangler d1 execute DB --remote --command "DELETE FROM session WHERE userId = '<USER_ID>'"
```

## Secrets and settings (names only)

| Name | Where | What |
| --- | --- | --- |
| `BETTER_AUTH_URL` | `wrangler.jsonc` `vars` (not secret) | `https://cohabit-landlord-demo.dolgorsureng.workers.dev` |
| `BETTER_AUTH_SECRET` | Cloudflare secret | Signs session cookies. Long random string. |
| `GOOGLE_CLIENT_ID` | Cloudflare secret | From Google Cloud OAuth client |
| `GOOGLE_CLIENT_SECRET` | Cloudflare secret | From Google Cloud OAuth client |
| `MAPTILER_KEY` | Cloudflare secret (and `.dev.vars` locally) | MapTiler browser key, restricted to this site and localhost (see "Maps and location") |
| `ANTHROPIC_API_KEY` | Cloudflare secret (and `.dev.vars` locally). **Not set anywhere yet.** | Turns on AI mode for the assistant. The owner creates it in the Anthropic Console and enters it; see "AI assistant" |
| `ASSISTANT_MODEL`, `ASSISTANT_DAILY_PER_USER`, `ASSISTANT_DAILY_SITE`, `ASSISTANT_PER_MINUTE` | Optional `vars` | Model and usage limits; defaults in "AI assistant" |

Locally the same names go in `.dev.vars` (git-ignored; copy `.dev.vars.example`).
Binding: `DB` → D1 `cohabit-db` (`0e413d91-d5f8-42ce-868c-fc382b0ca38c`).

Set production secrets. Names are case-sensitive. Easiest for the two Google values: in Google Cloud > Clients, add a secret,
download the JSON, then run `node scripts/set-google-secrets.mjs` (reads the newest `client_secret_*.json` in Downloads,
prints names only), and delete the JSON file. Or type/paste each value at the prompt (it is never shown):

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Generates a random value and sends it straight to Cloudflare without printing it:
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret list
```

Changing `BETTER_AUTH_SECRET` signs everyone out.

If sign-in fails, run `npx wrangler tail`, try to sign in, and read the `[Better Auth]` line: `invalid_client` means the
client ID and secret don't match; `CLIENT_ID_AND_SECRET_REQUIRED` means one is missing or misnamed;
`redirect_uri_mismatch` (shown by Google) means the redirect URI in Google Cloud is not exactly the one below.

## Google sign-in setup (one time)

Do this with a personal Google account. School-managed accounts are often not
allowed to create Cloud projects or "External" apps.

1. Open https://console.cloud.google.com, click the project picker, **New project**,
   name it e.g. `coHabit`, **Create**. (Reusing an existing coHabit project is fine.)
2. Go to **Google Auth Platform** (menu → APIs & Services → OAuth consent screen).
   If asked, click **Get started**: App name `coHabit`, your support email,
   Audience **External**, your contact email, agree, **Create**.
3. **Data access**: leave the default. Don't add scopes; Better Auth only asks for `openid`, `email`, `profile`.
4. **Clients → Create client** → Application type **Web application**, name `coHabit site`.
   - Authorized JavaScript origins:
     - `https://cohabit-landlord-demo.dolgorsureng.workers.dev`
     - `http://localhost:8787`
   - Authorized redirect URIs:
     - `https://cohabit-landlord-demo.dolgorsureng.workers.dev/api/auth/callback/google`
     - `http://localhost:8787/api/auth/callback/google`
   - **Create**. Copy the Client ID and Client secret into `wrangler secret put`
     (above) and your local `.dev.vars`. Don't paste them anywhere else.
5. **Audience**: while the app is in **Testing**, only Google accounts listed under
   **Test users** can sign in (max 100). To let anyone sign in, click **Publish app**
   → **In production**. With only name/email/profile, Google doesn't require a
   review. Don't upload a logo: that triggers brand verification.
   If **Publish app** is greyed out with "complete your configuration on the Branding page", fill in on **Branding**:
   home page `https://cohabit-landlord-demo.dolgorsureng.workers.dev`, privacy policy `…/privacy`, terms `…/terms`,
   authorized domain `dolgorsureng.workers.dev`, then **Save**.
6. Google changes can take a few minutes to apply. `redirect_uri_mismatch` means the
   callback URL in step 4 doesn't exactly match the site address.

Organization blockers: a Google Workspace school account may be blocked by its admin
from signing in to unverified third-party apps. Personal Gmail accounts are not affected.

## Run and test locally

```powershell
npm install
copy .dev.vars.example .dev.vars        # then fill in the values (BETTER_AUTH_SECRET: any long random string)
npm run db:migrate:local                # = wrangler d1 migrations apply DB --local
npm run dev                             # http://localhost:8787
npm test                                # 356 automated checks (see below)
```

`npm test` (`tests/run-local.mjs`) wipes and recreates a separate local database in
`.wrangler/test-state`, starts `wrangler dev` on port 8788 with a random test secret
and fake Google client values, and signs fixture users in by writing session rows
and signed cookies. It never contacts Cloudflare's remote D1, Google or Anthropic: a stand-in for the AI
service (`tests/fake-anthropic.mjs`, port 8799) follows scripted steps and records every request, so the tests
can check what would have been sent. Local D1
is Wrangler's local simulator (SQLite inside workerd), not the real D1 service.

Real Google sign-in locally needs your Google client values in `.dev.vars` and
`http://localhost:8787/api/auth/callback/google` registered in Google Cloud.

## Migrations and deploy (exact commands used)

**Migration `0008_survey_points.sql`** (adds `survey_responses` and `points_awards`; additive only) was applied to the
live database on 2026-10-13 with the owner's approval, after a restore point (bookmark
`0000007f-00000000-00005104-ae72185c6770bf744251aa407c3afd16`), and before deploying version `e2e17667-50ba-4f0d-94ef-b2ed994b1d96`, which needs it
(`/api/me` reads the points balance). Existing data was unchanged.

**Migration `0007_roommate_requests.sql`** (adds the `share_profile` column, `roommate_requests` and
`roommate_messages`; additive only) was applied to the live database on 2026-10-13 with the owner's approval, after
a restore point (bookmark `00000075-00000000-00005103-5f5ae051cfc181e65e91b5a1637f9a7c`), and before deploying version `d4ea27c7-4e1f-419f-b52e-21dfb4298ce9`,
which needs it. Existing data was unchanged.

```powershell
npx wrangler d1 migrations apply DB --local     # always first; then npm test
npx wrangler d1 migrations list DB --remote     # what's pending on production
npx wrangler d1 migrations apply DB --remote    # production database cohabit-db
npx wrangler deploy                             # uploads Worker + ./public
npx wrangler deployments list
```

Deploys are manual from this computer (no Git-triggered deploy). Commit and push
to `main` on GitHub for history.

Migrations must stay additive (new tables/columns/indexes). Before a migration on a
database with real data, note a recovery point:

```powershell
npx wrangler d1 time-travel info DB             # prints the current bookmark
npx wrangler d1 export DB --remote --output backup-YYYY-MM-DD.sql   # optional full export (keep out of git)
```

## Rollback and recovery

- **Code**: `npx wrangler deployments list`, then `npx wrangler rollback <VERSION_ID>`.
  The pre-accounts static site is version `a3c0f17b-d52a-47e3-9d71-5049e87a7a34`
  and git tag `pre-accounts-2026-09-29`.
- **Data**: D1 Time Travel keeps 7 days on the Free plan (30 on Paid):
  `npx wrangler d1 time-travel restore DB --timestamp=<UNIX_OR_RFC3339>` or `--bookmark=<BOOKMARK>`.
  A restore overwrites the database in place; export first if unsure.

## Free-plan assumptions

Checked against Cloudflare docs on 2026-09-29. Workers Free: 100,000 Worker requests/day,
10 ms CPU per request. D1 Free: 5 M rows read/day, 100 k rows written/day, 5 GB total,
500 MB per database, 10 databases (this account uses 3). Static files don't count as
Worker requests. Each API call writes about 1 row (its rate-limit counter), so
writes cap out around tens of thousands of API calls per day. Well above class-project
traffic. On the Free plan going over a limit returns errors; it does not bill. The account's
plan could not be read with Wrangler's token: confirm it is **Workers Free** in the
Cloudflare dashboard (Workers & Pages → Plans). Alerts are not a spending cap.

## Not built (on purpose)

Map search on the renter's matches page, travel-time commute data, imported (external) listings in the assistant, replies that stream word by word, landlord tenant preferences, applicant tracking beyond the request list, private notes,
in-app messaging threads, email notifications, listing photos / R2 uploads, landlord approval or verification, admin moderation/editing/deleting, admin stats,
role-management UI, admin deleting other people's accounts, changing account type, payments.

## Manual test for a group member (about 25 minutes)

Use two Google accounts and two browsers (or one normal window and one private window):
**A** will be the landlord, **B** the renter. Button and page names below are exactly as they appear on the site.

This runs on the live site, so everything you create is real data. Start every name with **TEST** and do the
clean-up in part 6. The site has only a few real listings, so the search and map steps use the TEST unit
you create in part 2.

### 1. Signed out (3 minutes)

1. Open the site. The home page shows two cards, **I have rooms to rent** and **I'm looking for a room**,
   and two buttons, **Browse listings** and **View a sample dashboard**.
2. Click **Browse listings**. You see the real listings, if any, with a map of Greater Boston above them.
   No listing is tagged Sample. A listing card says "Sign in as a renter to tell the landlord you're interested."
3. Type "Nashua" in **City, neighborhood or ZIP**: no suggestions (coHabit is Massachusetts only).
   Type "Waltham" and pick **Waltham, Massachusetts**: the list shows only listings within a few km (possibly none),
   with a **Clear** link that brings everything back.
4. Click **View a sample dashboard**, open a property, then use **Sample dashboard** to go back. Both pages
   start with a "Sample data" notice: this dashboard is fictional and separate from the listings.
5. Open `/landlord` and `/admin` directly: both ask you to sign in.

### 2. Landlord, account A in browser 1 (5 minutes)

1. Click **Sign in**, choose account A, then **I'm a landlord** (if A is new). You land on **Your units** and the
   top bar shows **Dashboard** and **Listings**.
2. Click **Add a unit**. Enter "12 Main Street" as the unit name: it is refused with a message under the field.
   Name it **TEST room near campus**, with a rent, rooms and a move-in date. In **Street address** type
   "415 South St, Waltham" and pick it: the general area fills in as "Waltham, MA" and a small map shows the pin.
3. Drag the pin a little: "Pin moved." Then drag it far away (zoom out first if needed): it snaps back with a
   message about the 1 km limit. Leave **Approximate area** selected, then **Add unit**.
4. You land on the unit's own page with a green "Unit added" message, tiles for rent, rooms and move-in date, and a
   **Location** section saying renters see an approximate area without the street address.
5. Click **Edit unit**, change the rent, **Save changes**: back on the unit page with "Changes saved."
   Click **Dashboard**: the card shows the new rent, and the tiles count your units.
6. Add a second unit named **TEST inactive unit** with status **Inactive** (no address needed). Its page says it is
   hidden from renters.

### 3. Listings and map with the TEST unit (3 minutes, any browser)

1. Open **Listings**. **TEST room near campus** is in the list; **TEST inactive unit** is not.
2. On the map, the TEST unit shows as a pin inside a circle about 500 m wide, not on the exact building.
   Its card shows the area (Waltham, MA) but not the street address.
3. Click the pin, then **View listing**: the page scrolls to the TEST card and highlights it.
4. Search **Waltham**: the TEST unit is listed with its distance, nearest first. Search **02139** (Cambridge):
   it is no longer listed (unless you're in range of other listings, you'll see "No listings nearby"). Click **Clear**.
5. Click **Use my location** and allow it: listings near you, nearest first, and "Your location stays in this
   browser." Click it again and block it in the browser prompt: a message says you can still search by
   city, neighborhood or ZIP.

### 4. Renter, account B in browser 2 (5 minutes)

1. **Sign in** with account B, then **I'm a renter** (if B is new). You land on **Find your room**.
2. Fill in the questionnaire with a budget that covers the TEST unit's rent, area **Waltham** and the same move-in
   month, then **Save and see matches**. The page now starts with **Your preferences** as a summary and shows
   "Preferences saved."
3. Under **Matching rooms**, the TEST unit appears with a match percentage and reasons. Try **Sort by**.
4. On the TEST unit click **I'm interested**, write a short note starting with "TEST", **Send**. The card shows
   "Request sent" and the unit appears under **Landlords you've contacted**. (A note containing a phone number is refused.)
5. Click **Edit preferences**, tick **Show me to compatible renters**, **Save changes**.
   **Possible roommates** lists people with a score and what you have in common (people tagged Sample are fictional),
   or says there are no compatible renters yet.
6. Open `/landlord`: "This area is for landlords". Open `/admin`: "Not available".
7. **Sign out**, sign in again with B: still a renter, and the preferences and request are still there.

### 5. Back to the landlord, browser 1 (3 minutes)

1. Reload **Dashboard**. The **Requests** tile counts B's request and it appears under **Recent requests**.
2. Click **View**. Under **Interested renters** you see B's name, email and note, with **Reply by email**
   and **Remove**. You do not see B's questionnaire answers.
3. Click **Remove**, confirm in the dialog: "Request removed." In browser 2, B's
   **Landlords you've contacted** list no longer shows it after a reload.

### 6. Clean up (2 minutes)

1. As A, open each TEST unit, **Edit unit** → **Delete unit**. A dialog asks "Delete this unit?"; **Cancel** keeps
   it, **Delete unit** removes it and shows "Unit deleted." Check **Listings** no longer shows it.
2. If A or B were spare accounts made only for this test, open **Your account** (click your name or initials) and
   use **Delete my account** (type DELETE). Otherwise, as B, open **Edit preferences** and untick
   **Show me to compatible renters** if you don't want to appear to other renters.

### 7. Account page and admin (1 minute)

1. Click your name or initials in the top bar: **Your account** shows your name, email and account type.
   **Delete my account** only works after typing DELETE.
2. Owner only: **Admin** appears in the top bar. The page shows tiles for people, landlords and renters
   (and sample accounts, while any exist), and the user list with a unit count for landlords and
   "Preferences saved" for renters, but no questionnaire answers or notes.

### 8. On a phone

Open the site on a phone, or narrow the browser window. The top-bar links move to a second row, the map sits
above the list, cards stack in one column, and the admin list becomes one card per person. Nothing should scroll sideways.

### 9. The assistant (5 minutes, renter B)

These steps describe the redesigned assistant, live since 2026-10-12.

1. As B, click **Assistant**. The page says **Find your room. Find your people.** The chat on the right asks **Hey! What
   are you looking for?** with **A room**, **A roommate** and **Both**. The results area on the left says your matches
   will show up there.
2. Tap **A room**, then answer each question by tapping (no typing needed). Your answers appear as chips above the
   results. After two answers, **Early results** appear and refresh with each answer. A message with a phone number is
   refused, with a note under the box.
3. Each room card says what fits and what doesn't. Switch **List** / **Map**: tap a pin and its card is highlighted;
   tap **On map** on a card and its pin is highlighted.
4. Tap the budget chip, lower it and keep **Must-have** ticked until nothing fits. The results say which must-haves
   block them and offer a change to make; nothing is loosened until you tap one.
5. Open a card's **Details**, then **Save** it. It appears under **Saved**, below the results.
6. Turn on **Demo mode**. A banner appears and every card and pin says Demo. Change the goal chip to **Both** and
   answer the roommate questions. **Rooms** and **Roommates** tabs appear, the roommates have no contact details, and
   demo cards have no Save button. Turn Demo mode off: only real results again.
7. On a phone, switch **Chat** / **Results**: the chat and the map keep their place.
8. Reload: everything is still there. Then **Clear chat** and confirm: the chat and answers are gone, **Saved** stays.

### 10. Details and requests (8 minutes, renters B and C)

1. As B and as C, on **My matches**, tick **Show me to compatible renters** and **Share my details with my matches**,
   and save. Use similar answers (same area and month) so they match.
2. As B, open **Assistant**, choose **A roommate** (or **Both**), and open the **Roommates** tab. C's card shows
   two things in common and at most one important difference. Open **Details**: budget, move-in, area, lifestyle tags
   and differences. Untick sharing on one side and reload: those details are hidden again.
3. Click **Connect**, edit the introduction and click **Send request**. The card says **Request sent**; Details offers
   **Withdraw request**.
4. As C, open **My matches**: **Roommate requests** shows B's introduction with **Accept** and **Decline**. Click
   **Accept**, then **Message**, and send a short message. Try one with a phone number: it's refused.
5. As B, the card now says **Connected**; **Message** shows C's message.
6. As B, open a real room's **Details** in the assistant, click **I'm interested**, write a note and **Send**. A
   **Send this request?** box appears first. After sending, the card, Details, Listings and Saved all say
   **Request sent**; **Withdraw** removes it everywhere.
7. Turn on **Demo mode**: **Connect (preview)** and **I'm interested (preview)** only say "Demo only, nothing sent."
8. Clean up: withdraw the room request and decline or withdraw the roommate request.

### 11. Quick check-in (5 minutes, renter B, then signed out, then the owner)

1. As B, click the speech-bubble icon beside your name. A drawer slides in from the right with **Quick check-in**
   and "Your first check-in earns 100 coHabit Points". The page behind it doesn't change.
2. **Send feedback** is off until you answer something. Tap **Friends or classmates**, then **I haven't looked
   yet**: only the second stays selected. Tap **Not now**, open it again: your answer is still there.
3. Answer one more question, type a comment and click **Send feedback**: "Thanks for helping shape coHabit! You
   earned 100 coHabit Points 🎉". **Account** shows 100 points.
4. Open it again and send one answer: only "Thanks for helping shape coHabit!" (no more points).
5. Sign out, open the icon beside **Sign in**, answer one question and send: a plain thank-you, no account needed.
6. As the owner, **Admin → Check-in survey**: the totals and answers include these, without names or emails.
   **Download CSV** opens in a spreadsheet. Try **Without Demo mode** and **Demo mode only**.
7. On a phone, the drawer fills the screen, and **Not now** and **Send feedback** stay at the bottom.

### If something fails

Note the page address, what you clicked and what you saw, and tell the owner. For sign-in problems the owner
can run `npx wrangler tail` and try again to see the reason (see "Secrets and settings" above).
