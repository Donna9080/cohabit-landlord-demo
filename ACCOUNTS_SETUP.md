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
```

There is no R2 bucket and no file upload. There is no external AI service:
matching is a small rule-based scorer in `src/match.js`.

## What is stored where

| Table (D1 `cohabit-db`) | What | Who can read it through the app |
| --- | --- | --- |
| `user` | id, display name, email, `role` (`user`/`admin`), `account_type` (`landlord`/`renter`), join date. Photo URL is dropped. | The person themself (`/api/me`); admin sees name, email, type, join date |
| `account` | Link from a Google subject ID (`accountId`) to a user. Google access/refresh/ID tokens are **not** kept (set to NULL by a hook in `src/auth.js`). | Nobody (server only) |
| `session` | Session token, expiry, user id. IP and user agent are **not** stored. | Nobody (server only; cookie holds a signed copy of the token) |
| `verification` | Short-lived OAuth state for sign-in in progress | Nobody |
| `rateLimit`, `app_rate_limits` | Request counters | Nobody |
| `units` | A landlord's units: name, general area, monthly rent, rooms available, move-in date, description, status; optionally a Massachusetts street address, pin (lat/lng), approximate/exact choice and the MapTiler attribution | Owner: everything. Everyone: active units' listing fields only (no owner, no status); the location as an approximate 500 m circle with no address, unless the landlord chose exact. Admin: a count per landlord |
| `match_preferences` | A renter's questionnaire: budget range, move-in month, area, rooms needed, sleep schedule, cleanliness, noise, guests, pets, smoking | Only that renter. Not landlords, not admin (admin sees "saved yes/no"). Other renters see nothing unless the renter turns on roommate matching (see below) |

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

## Who can do what

| | Visitor | Landlord | Renter | Admin |
| --- | --- | --- | --- | --- |
| Home, Listings (search and sort), Sample dashboard, Privacy, Terms | ✓ | ✓ | ✓ | ✓ |
| Sign in with Google, choose landlord/renter once | ✓ | | | |
| Create/view/edit/delete **own** units | | ✓ | | |
| Save/edit **own** preferences, see matches | | | ✓ | |
| See possible roommates (only after opting in; only others who opted in) | | | ✓ | |
| Tell a unit's landlord "I'm interested"; withdraw it | | | ✓ | |
| See and remove requests from renters on **own** units | | ✓ | | |
| Delete **own** account and everything saved with it (`/account`) | | ✓ | ✓ | ✓ (not the last admin) |
| Read-only user list (`/admin`) | | | | ✓ |

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
npm test                                # 230 automated checks (see below)
```

`npm test` (`tests/run-local.mjs`) wipes and recreates a separate local database in
`.wrangler/test-state`, starts `wrangler dev` on port 8788 with a random test secret
and fake Google client values, and signs fixture users in by writing session rows
and signed cookies. It never contacts Cloudflare's remote D1 or Google. Local D1
is Wrangler's local simulator (SQLite inside workerd), not the real D1 service.

Real Google sign-in locally needs your Google client values in `.dev.vars` and
`http://localhost:8787/api/auth/callback/google` registered in Google Cloud.

## Migrations and deploy (exact commands used)

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

Map search on the renter's matches page, distance-based matching, landlord tenant preferences, applicant tracking beyond the request list, private notes, saved matches,
in-app messaging threads, email notifications, listing photos / R2 uploads, landlord approval or verification, admin moderation/editing/deleting, admin stats,
role-management UI, admin deleting other people's accounts, changing account type, payments.

## Manual test for a group member (about 15 minutes)

Use two Google accounts and two browsers (or one normal window and one private window):
**A** will be the landlord, **B** the renter. Button and page names below are exactly as they
appear on the site. Listings and people tagged **Sample** are fictional; ignore them unless a step mentions them.

### 1. Signed out (2 minutes)

1. Open the site. The home page shows two cards, **I have rooms to rent** and **I'm looking for a room**,
   and two buttons, **Browse listings** and **View a sample dashboard**.
2. Click **Browse listings**. Type "Belmont" in **City, neighborhood or ZIP** and pick **Belmont, Massachusetts**:
   the list shows listings within a few km, nearest first, with a **Clear** link. A town outside Massachusetts
   ("Nashua") gives no suggestions. A real (untagged) listing says "Sign in as a renter to tell the landlord you're interested."
3. Above the list, the map of Greater Boston shows circles for approximate listings and grey pins for Sample ones.
   After the Belmont search it shows only the matching pins.
   Click a pin, then **View listing**: the page scrolls to that card and highlights it.
4. Click **Use my location** and allow it: listings near you, nearest first. Try again and block it: a message says
   you can still search by city, neighborhood or ZIP.
5. Click **View a sample dashboard**, open a property, then use **Sample dashboard** to go back. Both pages
   start with a "Sample data" notice.
6. Open `/landlord` and `/admin` directly: both ask you to sign in.

### 2. Landlord, account A in browser 1 (5 minutes)

1. Click **Sign in**, choose account A, then **I'm a landlord**. You land on **Your units** and the top bar
   shows **Dashboard** and **Listings**.
2. Click **Add a unit**. Enter "12 Main Street" as the unit name: it is refused with a message under the field.
   Use a name like "Sunny room near campus", a rent, rooms and a move-in date. In **Street address** type
   "415 South St, Waltham" and pick it: the general area fills in as "Waltham, MA" and a small map shows the pin.
   Drag the pin a little. Leave **Approximate area** selected, then **Add unit**.
3. You land on the unit's own page with a green "Unit added" message, tiles for rent, rooms and move-in date, and a
   **Location** section saying renters see an approximate area without the street address.
4. Click **Edit unit**, change the rent, **Save changes**: back on the unit page with "Changes saved."
   Click **Dashboard**: the card shows the new rent, and the tiles count your units.
5. Add a second unit with status **Inactive**. Its page says it is hidden from renters. Leave it for now.
6. Reload the dashboard: both units are still there, one tagged Active and one Inactive.

### 3. Renter, account B in browser 2 (5 minutes)

1. **Sign in** with account B, then **I'm a renter**. You land on **Find your room**.
2. Fill in the questionnaire with a budget that covers A's rent, the same area and the same move-in month,
   then **Save and see matches**. The page now starts with **Your preferences** as a summary and shows
   "Preferences saved."
3. Under **Matching rooms**, A's unit appears with a match percentage and reasons. Try **Sort by**.
4. On A's unit click **I'm interested**, write a short note, **Send**. The card shows "Request sent" and the
   unit appears under **Landlords you've contacted**. (A note containing a phone number is refused.)
   Sample listings say there is no landlord to contact.
5. Click **Edit preferences**, tick **Show me to compatible renters**, **Save changes**.
   **Possible roommates** now lists people (sample ones are tagged) with a score and what you have in common.
6. Open `/landlord`: "This area is for landlords". Open `/admin`: "Not available".
7. Click **Listings**: A's active unit is there, A's inactive unit is not.
8. **Sign out**, sign in again with B: still a renter, and the preferences and request are still there.

### 4. Back to the landlord, browser 1 (3 minutes)

1. Reload **Dashboard**. The **Requests** tile counts B's request and it appears under **Recent requests**.
2. Click **View**. Under **Interested renters** you see B's name, email and note, with **Reply by email**
   and **Remove**. You do not see B's questionnaire answers.
3. Click **Remove**, confirm in the dialog: "Request removed." In browser 2, B's
   **Landlords you've contacted** list is empty after a reload.
4. Go back to **Dashboard**, open the inactive unit, click **Edit unit** → **Delete unit**. A dialog asks
   "Delete this unit?"; **Cancel** keeps it, **Delete unit** removes it and shows "Unit deleted."

### 5. Account page and admin (1 minute)

1. Click your name or initials in the top bar: **Your account** shows your name, email and account type.
   **Delete my account** only works after typing DELETE. Only try it with a spare Google account:
   it removes the account and everything saved with it.
2. Owner only: **Admin** appears in the top bar. The page shows tiles for people, landlords, renters and
   sample accounts, and a list with both test accounts: a unit count for A, "Preferences saved" for B,
   and no questionnaire answers or notes.

### 6. On a phone

Open the site on a phone, or narrow the browser window. The top-bar links move to a second row, cards stack
in one column, and the admin list becomes one card per person. Nothing should scroll sideways.

### If something fails

Note the page address, what you clicked and what you saw, and tell the owner. For sign-in problems the owner
can run `npx wrangler tail` and try again to see the reason (see "Secrets and settings" above).
