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
| `units` | A landlord's units: name, general area, monthly rent, rooms available, move-in date, description, status | Owner: everything. Everyone: active units' listing fields only (no owner, no status). Admin: a count per landlord |
| `match_preferences` | A renter's questionnaire: budget range, move-in month, area, rooms needed, sleep schedule, cleanliness, noise, guests, pets, smoking | Only that renter. Not landlords, not other renters, not admin (admin sees "saved yes/no") |

Not collected: street addresses (rejected by validation), phone numbers, IDs,
dates of birth, financial or health details, profile photos.

The fictional sample dashboard (`/sample`, `/properties/<id>`) is still in
`public/data.js`. It is not in the database and is labeled "Fictional sample data".

## Who can do what

| | Visitor | Landlord | Renter | Admin |
| --- | --- | --- | --- | --- |
| Home, How it works, Listings, Sample dashboard | ✓ | ✓ | ✓ | ✓ |
| Sign in with Google, choose landlord/renter once | ✓ | | | |
| Create/view/edit/delete **own** units | | ✓ | | |
| Save/edit **own** preferences, see matches | | | ✓ | |
| Read-only user list (`/admin`) | | | | ✓ |

Rules enforced on the server (`src/index.js`), not in the page:

- The owner of a unit / preference record is always the signed-in user from the
  session. `landlord_user_id`, `user_id`, `role`, `account_type` in a request body are ignored.
- Landlord routes return 404 for another landlord's unit (no way to tell it exists).
- `account_type` is set once (`UPDATE … WHERE account_type IS NULL`), and a
  database trigger rejects any later change. Choosing a type never touches `role`.
- `role` defaults to `user`. No web endpoint changes it. Admin checks read the
  role from D1 on every request, so demotion is immediate.
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

There is no web page or endpoint that makes someone an admin, and the first
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

Locally the same names go in `.dev.vars` (git-ignored; copy `.dev.vars.example`).
Binding: `DB` → D1 `cohabit-db` (`0e413d91-d5f8-42ce-868c-fc382b0ca38c`).

Set production secrets (you type or paste the value at the prompt; it is never shown):

```powershell
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
# Generates a random value and sends it straight to Cloudflare without printing it:
node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret list
```

Changing `BETTER_AUTH_SECRET` signs everyone out.

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
npm test                                # 102 automated checks (see below)
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

Landlord tenant preferences, applicant or match tracking, private notes, saved matches,
messaging, listing photos / R2 uploads, landlord approval or verification, roommate
(person-to-person) matching, admin moderation/editing/deleting, admin stats,
role-management UI, account deletion UI, changing account type, payments.

## Manual test for a group member (about 10 minutes)

Use two Google accounts (A and B) and two browsers (or one normal + one private window).

1. Signed out, open the site. Home, **How it works**, **Browse current listings** and
   **See a sample landlord dashboard** all load.
2. Browser 1, account A: **Sign in** → Google → **I'm a landlord**. **Add a unit**
   (try "12 Main Street" as area: it should be refused; use "Waltham, MA").
   Reload: unit is there. Edit the rent, save, reload. Add a second unit, set it
   **Inactive**, then delete it.
3. Browser 2, account B: sign in → **I'm a renter**. Fill in the questionnaire with a
   budget that covers A's rent and the same area and month → **Save**. The unit shows
   under Matching rooms. Reload: answers are still there.
4. Browser 2: open `/landlord` → "This area is for landlords". Open `/admin` →
   "Not available". Open **Listings**: A's inactive unit is not there.
5. Browser 2: **Sign out**, sign in again with B: still a renter, answers still saved.
6. Browser 1 (A): open the unit edit page URL in browser 2 while signed in as B →
   "This area is for landlords".
7. Owner only: open `/admin` → user list with both accounts, unit count for A,
   "Preferences saved" for B, no questionnaire answers.
