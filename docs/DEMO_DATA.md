# Demo data (Demo mode)

Demo mode lets anyone try coHabit with made-up listings and roommates. This file is written by
`npm run demo:report` (scripts/demo-report.mjs) from the data itself, so the numbers below are the data's.

- **What:** 100 fictional room listings and 200 fictional roommate profiles, all in Waltham
  (197 profiles shown; 3 chose not to be found, which shows that rule working).
- **Where it lives:** in code, never in the database: the first 15 listings and 20 profiles are written by hand in
  [`src/assistant/demo-base.js`](../src/assistant/demo-base.js); the other 85 listings and 180 profiles are written to
  [`src/assistant/demo-generated.js`](../src/assistant/demo-generated.js) by [`scripts/demo-build.mjs`](../scripts/demo-build.mjs). Every id starts with `demo-`.
- **Where it shows:** only while Demo mode is on, always labeled Demo: Listings (all demo listings with filters, map, Details
  and Save), My matches (demo rooms and roommates that fit your saved preferences, plus "Browse all demo profiles"), the
  demo profile page (`/demo/people`) and the assistant. Never in real listings, real matches, requests, the admin user
  list or any count.
- **One switch:** a renter's Demo mode is saved on the server, so Listings, My matches and the assistant always agree;
  switching never touches chats, answers, preferences, requests or real saved options. For guests and landlords it's
  remembered in their browser only.
- **Safety:** no real places, people, addresses or contact details, and no sign-in accounts for anyone fictional. A request
  to a demo listing or profile is a preview that says "Demo only, nothing sent"; nothing is sent and nobody is notified.
  Locations are made-up points shown as 500 m approximate areas. There is no gender field, so it can't affect matching.
- **Matching:** coHabit's own matching code, unchanged except for two bug fixes (below). Nothing in the demo data scores
  anything itself.

## Managing it

| Task | How |
| --- | --- |
| Rebuild the generated part | `npm run demo:build` (the same output every time: fixed seeds, no clock) |
| Check it (repeatable, targets met) | `npm run demo:check`: fails if the file differs from what the script builds or a target is missed; `npm test` runs the same checks |
| Rewrite this file | `npm run demo:report` |
| Turn Demo mode off everywhere | Set the Worker variable `DEMO_DATA=off` (the switch disappears, `/api/demo/*` answers 404, nothing else changes) |
| Remove demo records from the database | The only ones are renters' saved demo cards (bookmarks to demo ids). Admin page, "Remove saved demo cards", or `POST /api/admin/demo/cleanup` with `{"confirm":"REMOVE"}`. Real saved options are never touched; the action is recorded in `admin_audit`. |
| Remove the demo data itself | Delete it from the two files above and deploy; nothing in the database depends on it |

No seeding into the database, so it can't be duplicated. Check-in answers given in Demo mode are labeled `demo` and can be
left out of results (admin survey page).

## Coverage (checked with the matching code)

Definitions (in [`scripts/demo-coverage.mjs`](../scripts/demo-coverage.mjs)):

- **A room suits a profile** when the assistant's room search returns it as matching everything for that profile's own
  answers: within budget (split for a whole place), enough rooms, available in the move-in month or a month earlier, in one
  of their areas, within their distance, a lease within a month of what they want, furnished if they asked. Their own
  must-haves apply; nothing is loosened.
- **Two profiles are mutually compatible roommates** when the roommate matching code says they're a possible match (shared
  area, move-in within a month, no pet or smoking dealbreaker, score 60+) and, checked both ways, their budgets overlap,
  their leases are within a month, a must-have move-in month means the same month, and a must-have area is shared. Only
  profiles that chose to be found count as candidates.

| Target | Result (min / median / max) |
| --- | --- |
| Each profile has 3+ suitable rooms | 3 / 6 / 23 rooms per profile (plus 20 partial matches at the median) |
| Each profile has 3+ mutually compatible roommates | 3 / 23 / 59 (the matching code alone allows 6 / 71 / 119) |
| Each room suits 3+ demo renters | 3 / 10 / 35 visible profiles per room |
| Targets missed | 0 |

Not everyone matches everyone. Of the 40,227 reasons counted across pairs of visible profiles
(a pair can have several), 2,384 pairs are compatible; the rest fail on:
move-in months more than a month apart (10,546), lease lengths more than a month apart (8,379), a must-have move-in month that differs (8,280), a must-have area the other isn't looking in (5,038), budgets don't overlap (2,477), lifestyle answers too far apart (score under 60) (1,650), one has a pet and the other wants no pets (960), one smokes and the other wants no smoking (513).

Listings by kind: Private room 53, Studio 5, Sublet 11, Lease takeover 6, Whole apartment 13, Replacing a roommate 8, Shared room 4. By neighborhood: Moody Street 15, South Side 9, Downtown 16, The Highlands 8, Warrendale 16, near Brandeis 22, Prospect Hill 9, Lakeview 5.

How coverage is reached without bending rules: the data is built in groups of people who want the same thing (month,
lease, neighborhoods, furnishing, rooms), with rooms made for each group; rents are set so each room is within budget for
at least three of them and each person can afford at least three rooms. Lifestyles are drawn at random per group and
redrawn for anyone left with fewer than three compatible people. Groups overlap where answers line up.

## Bugs found and fixed

1. **My matches hid whole apartments from people moving in together.** It compared a whole place's rent with one
   person's budget (a $2,700 two-bedroom against a $1,400 budget). It now splits a whole place's rent across the rooms
   needed, up to its bedrooms, as the assistant already did (`src/match.js`). Real coHabit units are priced per room,
   so their matches don't change.
2. **"Unfurnished" counted as wanting furnished.** The assistant treated any wish containing "furnish" as wanting a
   furnished place. A wish for unfurnished now prefers unfurnished places (`src/assistant/search.js`).
3. **Saving was blocked for demo cards,** so Save didn't work in Demo mode. Demo cards can now be saved from any page and
   show under Saved only in Demo mode.

## Found, not changed (owner's decision)

- **My matches lets a listing through without the right month when it's in your area.** Its rule shows a room scoring 70+,
  and within budget (40) + in your area (25) + enough rooms (15) = 80, so the move-in month doesn't matter then. With the
  area "Waltham", every Waltham listing is "in your area": for a June renter with a $1,300 budget, 81 of 100 demo
  listings match, 41 of them more than a month from June (all at 80%). The assistant doesn't do this (it needs the month
  within a month, or within three months when the month is flexible). This is the documented rule in `src/match.js` and
  affects real matches too, so it's left as is; requiring the month within a month would fix it.

## 20 representative searches

Room searches use the assistant's search with the answers shown (budget a must-have unless flexible; a distance is a
must-have when given; area and month flexible unless marked). "Partly" means the room meets every must-have but misses
something flexible, and the card says what. Roommate searches compare the answers with the 197 visible profiles.

### 1. Strong: A room in Waltham from June 2027, up to $1,300, a 12-month lease

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 71 of 100 rooms fit the must-haves: 24 match everything, 47 partly.
- **Hidden by must-haves:** 29 (budget 19, move-in month 10; a room can fail more than one).
- **First three:** demo-25 Bright furnished room on the South Side (matches everything); demo-82 Group house near Waltham Common needs a fifth (matches everything); demo-35 Room in a four-bedroom near the commuter rail (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,430) (+1); Consider a move-in month more than 3 months away (+10).

### 2. Strong: Furnished, near Brandeis or Warrendale, from August 2027, up to $1,300, 12 months

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 70 of 100 rooms fit the must-haves: 7 match everything, 63 partly.
- **Hidden by must-haves:** 30 (budget 19, move-in month 11; a room can fail more than one).
- **First three:** demo-62 Bed in a shared room near campus (matches everything); demo-81 Furnished room in Warrendale (matches everything); demo-44 Bright furnished room in Warrendale (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,430) (+1); Consider a move-in month more than 3 months away (+11).

### 3. Strong: Academic year from September 2027, Downtown or Moody Street, up to $1,000

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 26 of 100 rooms fit the must-haves: 5 match everything, 21 partly.
- **Hidden by must-haves:** 74 (budget 64, move-in month 19; a room can fail more than one).
- **First three:** demo-08 Shared bedroom for budget savers (matches everything); demo-21 Bed in a shared room off Moody Street (matches everything); demo-17 Second-floor room near Waltham Common (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,100) (+13); Consider a move-in month more than 3 months away (+10).

### 4. Strong: Two friends: 2 rooms from June 2027, up to $1,400 each, South Side or Moody Street

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 13 of 100 rooms fit the must-haves: 4 match everything, 9 partly.
- **Hidden by must-haves:** 87 (rooms 84, budget 10, move-in month 10; a room can fail more than one).
- **First three:** demo-64 Two open rooms near Moody Street (matches everything); demo-27 Whole two-bedroom near Moody Street (matches everything); demo-06 Whole two-bedroom for two friends (matches everything).
- **Offered, never applied without the renter:** Look for fewer than 2 rooms in one place (+67).

### 5. Strong: Three friends: 3 rooms from June 2027, up to $1,200 each, Downtown

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 4 of 100 rooms fit the must-haves: 3 match everything, 1 partly.
- **Hidden by must-haves:** 96 (rooms 96, budget 25, move-in month 10; a room can fail more than one).
- **First three:** demo-36 Three rooms in a five-bedroom near the commuter rail (matches everything); demo-10 Whole three-bedroom near Waltham Common (matches everything); demo-43 Three-bedroom apartment near Waltham Common (matches everything).
- **Offered, never applied without the renter:** Look for fewer than 3 rooms in one place (+61).

### 6. Strong: Furnished spring sublet from January 2027, about 5 months, up to $1,100, Prospect Hill or the Highlands

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 9 of 100 rooms fit the must-haves: 4 match everything, 5 partly.
- **Hidden by must-haves:** 91 (budget 46, move-in month 89; a room can fail more than one).
- **First three:** demo-76 Spring sublet on Prospect Hill (matches everything); demo-04 Spring sublet in a four-bedroom (matches everything); demo-49 Furnished corner room in the Highlands (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,210) (+1); Consider a move-in month more than 3 months away (+45).

### 7. Partial: From July 2027 in the Highlands (flexible area), up to $1,200, 12 months

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 61 of 100 rooms fit the must-haves: 2 match everything, 59 partly.
- **Hidden by must-haves:** 39 (budget 29, move-in month 10; a room can fail more than one).
- **First three:** demo-78 Furnished room with a desk in the Highlands (matches everything); demo-58 Bright private room in the Highlands (matches everything); demo-40 Furnished room in the Highlands (partial: Available Aug 1, 2027, 1 month after you want to move in).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,320) (+10); Consider a move-in month more than 3 months away (+10).

### 8. Partial: Near Brandeis from May 2027 (flexible month), up to $1,250

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 57 of 100 rooms fit the must-haves: 2 match everything, 55 partly.
- **Hidden by must-haves:** 43 (budget 22, move-in month 25; a room can fail more than one).
- **First three:** demo-80 Sunny room near the Brandeis stop (matches everything); demo-69 Bright furnished room near campus (matches everything); demo-23 Bright furnished room near the Brandeis stop (partial: Available Jun 1, 2027, 1 month after you want to move in).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,375) (+4); Consider a move-in month more than 3 months away (+21).

### 9. Partial: Moody Street from June 2027, up to $1,300, wants furnished

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 71 of 100 rooms fit the must-haves: 1 match everything, 70 partly.
- **Hidden by must-haves:** 29 (budget 19, move-in month 10; a room can fail more than one).
- **First three:** demo-32 Furnished corner room near Moody Street (matches everything); demo-01 Private room in a four-bedroom house (partial: Not furnished); demo-75 Top-floor room off Moody Street (partial: Not furnished).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,430) (+1); Consider a move-in month more than 3 months away (+10).

### 10. Partial: South Side from June 2027, budget $1,000 but flexible

- **Must-haves:** none (budget flexible); rooms needed always.
- **Result:** 45 of 100 rooms fit the must-haves: 1 match everything, 44 partly.
- **Hidden by must-haves:** 55 (budget 46, move-in month 10; a room can fail more than one).
- **First three:** demo-25 Bright furnished room on the South Side (matches everything); demo-19 Summer sublet on the South Side (partial: Summer sublet, June to July 2027, not the 12 months you want); demo-70 Furnished summer sublet on the South Side (partial: Summer sublet, June to August 2027, not the 12 months you want).
- **Offered, never applied without the renter:** Raise your budget above $1,100 (+45); Consider a move-in month more than 3 months away (+9).

### 11. Partial: Summer only (3 months) from June 2027, up to $1,050, Waltham

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 37 of 100 rooms fit the must-haves: 7 match everything, 30 partly.
- **Hidden by must-haves:** 63 (budget 55, move-in month 10; a room can fail more than one).
- **First three:** demo-19 Summer sublet on the South Side (matches everything); demo-12 Furnished summer sublet off Moody Street (matches everything); demo-54 Summer sublet in Warrendale (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,155) (+16); Consider a move-in month more than 3 months away (+8).

### 12. Strict: Within 1 km of Brandeis (must-have), from August 2027, up to $1,000

- **Must-haves:** budget_max, max_distance_km; rooms needed always.
- **Result:** 15 of 100 rooms fit the must-haves: 8 match everything, 7 partly.
- **Hidden by must-haves:** 85 (budget 64, move-in month 11, distance 57; a room can fail more than one).
- **First three:** demo-62 Bed in a shared room near campus (matches everything); demo-68 Bed in a shared room a short walk from campus (matches everything); demo-14 Room in a five-bedroom near campus (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,100) (+5); Consider a move-in month more than 3 months away (+3); Look farther than 1 km from Brandeis (+15).

### 13. Strict: Lakeview only (must-have area), from June 2027, up to $1,100

- **Must-haves:** budget_max, areas; rooms needed always.
- **Result:** 2 of 100 rooms fit the must-haves: 2 match everything, 0 partly.
- **Hidden by must-haves:** 98 (budget 46, move-in month 10, area 95; a room can fail more than one).
- **First three:** demo-55 Bright furnished room near Hardy Pond (matches everything); demo-26 Group house in Lakeview needs a fourth (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,210) (+1); Look outside Lakeview (+43).

### 14. Strict: February 2027 only (must-have month), up to $1,100, about 7 months

- **Must-haves:** budget_max, move_in_month; rooms needed always.
- **Result:** 8 of 100 rooms fit the must-haves: 3 match everything, 5 partly.
- **Hidden by must-haves:** 92 (budget 46, move-in month 91; a room can fail more than one).
- **First three:** demo-18 Lease takeover a short walk from campus (matches everything); demo-05 Lease takeover in Warrendale (matches everything); demo-53 Take over a lease in Warrendale (matches everything).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,210) (+1); Be flexible on the move-in month (up to 3 months either way) (+7).

### 15. Strict: Just for me, Downtown only (must-have), from July 2027, up to $1,700, furnished

- **Must-haves:** budget_max, areas; rooms needed always.
- **Result:** 13 of 100 rooms fit the must-haves: 3 match everything, 10 partly.
- **Hidden by must-haves:** 87 (budget 13, move-in month 10, area 84; a room can fail more than one).
- **First three:** demo-94 Furnished room near the commuter rail (matches everything); demo-03 Furnished studio downtown (matches everything); demo-83 Furnished room with a desk near Waltham Common (matches everything).
- **Offered, never applied without the renter:** Look outside Downtown (+64).

### 16. No match: Up to $600 in Waltham from June 2027

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 0 of 100 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 100 (budget 100, move-in month 10; a room can fail more than one).
- **First three:** none.
- **Offered changes:** none needed or none would help.

### 17. No match: Within 1 km of Brandeis (must-have), from June 2027 (must-have), up to $800

- **Must-haves:** budget_max, max_distance_km, move_in_month; rooms needed always.
- **Result:** 0 of 100 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 100 (budget 95, move-in month 63, distance 57; a room can fail more than one).
- **First three:** none.
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $880) (+1); Be flexible on the move-in month (up to 3 months either way) (+2).

### 18. No match: Four rooms in one place from June 2027, up to $1,200 each

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 0 of 100 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 100 (rooms 100, budget 25, move-in month 10; a room can fail more than one).
- **First three:** none.
- **Offered, never applied without the renter:** Look for fewer than 4 rooms in one place (+65).

### 19. Strong: A roommate for June 2027: early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking, $900–$1,300

- **Result:** 76 of 197 visible profiles are possible roommates: 14 strong (90+), 62 partial. The 3 hidden profiles are never compared.
- **Not a match (first reason each):** lifestyle answers too far apart (score under 60) 11; move-in months more than a month apart 107; one smokes and the other wants no smoking 3.
- **First three:** demo-p01 Ari 100%; demo-p21 Priya 100%; demo-p79 Ilana 100%.

### 20. No match: A roommate moving in November 2027 (nobody in the demo data moves then or a month either side)

- **Result:** 0 of 197 visible profiles are possible roommates: 0 strong (90+), 0 partial. The 3 hidden profiles are never compared.
- **Not a match (first reason each):** move-in months more than a month apart 197.
- **First three:** none.

## Listings

"Suits" counts the visible demo profiles for whom the room matches everything.

| Id | Name | Kind | Area | From Brandeis | Rent | Rooms free | Available | Lease | Furnishing | Photo | Suits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo-01 | Private room in a four-bedroom house | Private room | Moody Street | 1.8 km | $1,050 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k01 | 35 |
| demo-02 | Furnished room on the South Side | Private room | South Side | 1.5 km | $1,200 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b02 | 11 |
| demo-03 | Furnished studio downtown | Studio | Downtown | 2.2 km | $1,650 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Furnished | s03 | 5 |
| demo-04 | Spring sublet in a four-bedroom | Sublet | The Highlands | 1.8 km | $950 per room | 1 of 4 | Jan 15, 2027 | Spring sublet, mid-January to May 2027 | Furnished | b04 | 8 |
| demo-05 | Lease takeover in Warrendale | Lease takeover | Warrendale | 0.9 km | $1,100 per room | 1 of 3 | Feb 1, 2027 | Lease takeover, February to August 2027 | Unfurnished | e05 | 6 |
| demo-06 | Whole two-bedroom for two friends | Whole apartment | South Side | 1.9 km | $2,700 whole place | 2 of 2 | Jun 1, 2027 | 12-month lease from June | Unfurnished | e06 | 7 |
| demo-07 | Group house needs a fourth | Replacing a roommate | near Brandeis | 0.8 km | $975 per room | 1 of 4 | Jun 1, 2027 | Join the current lease to August 2027, then renew with the group | Unfurnished | l07 | 6 |
| demo-08 | Shared bedroom for budget savers | Shared room | Downtown | 2.1 km | $700 per bed | 1 of 3 | Sep 1, 2027 | Academic-year lease, September to May | Furnished | h08 | 13 |
| demo-09 | Garden-level room near campus | Private room | near Brandeis | 0.5 km | $1,300 per room | 1 of 3 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | b09 | 15 |
| demo-10 | Whole three-bedroom near Waltham Common | Whole apartment | Downtown | 2 km | $3,450 whole place | 3 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k10 | 6 |
| demo-11 | Room on Prospect Hill | Private room | Prospect Hill | 2.5 km | $1,150 per room | 1 of 3 | Jul 1, 2027 | 12-month lease from July | Unfurnished | e11 | 16 |
| demo-12 | Furnished summer sublet off Moody Street | Sublet | Moody Street | 1.9 km | $900 per room | 1 of 3 | Jun 1, 2027 | Summer sublet, June to August 2027 | Furnished | b12 | 8 |
| demo-13 | Small furnished studio in the Highlands | Studio | The Highlands | 1.9 km | $1,450 whole place | 1 of 1 | Aug 1, 2027 | 12-month lease from August | Furnished | s13 | 14 |
| demo-14 | Room in a five-bedroom near campus | Private room | near Brandeis | 0.4 km | $890 per room | 2 of 5 | Aug 1, 2027 | 12-month lease from August | Unfurnished | l14 | 27 |
| demo-15 | Whole one-bedroom by Hardy Pond | Whole apartment | Lakeview | 2.8 km | $1,950 whole place | 1 of 1 | Sep 1, 2027 | 12-month lease from September | Unfurnished | e15 | 4 |
| demo-16 | Furnished room off Moody Street | Private room | Moody Street | 2.1 km | $1,150 per room | 1 of 4 | Jul 1, 2027 | 12-month lease from July | Furnished | b21 | 15 |
| demo-17 | Second-floor room near Waltham Common | Private room | Downtown | 2 km | $800 per room | 1 of 5 | Sep 1, 2027 | Academic-year lease, September 2027 to May 2028 | Unfurnished | k32 | 13 |
| demo-18 | Lease takeover a short walk from campus | Lease takeover | near Brandeis | 0.7 km | $1,050 per room | 1 of 3 | Feb 1, 2027 | Lease takeover, February to August 2027 | Furnished | b41 | 6 |
| demo-19 | Summer sublet on the South Side | Sublet | South Side | 1.5 km | $850 per room | 1 of 3 | Jun 1, 2027 | Summer sublet, June to July 2027 | Furnished | b38 | 8 |
| demo-20 | Bright furnished room on Prospect Hill | Private room | Prospect Hill | 2.7 km | $1,150 per room | 1 of 4 | Sep 1, 2027 | 12-month lease from September | Furnished | b02 | 11 |
| demo-21 | Bed in a shared room off Moody Street | Shared room | Moody Street | 2 km | $750 per bed | 1 of 3 | Sep 1, 2027 | Academic-year lease, September 2027 to May 2028 | Furnished | h19 | 13 |
| demo-22 | Room in a four-bedroom on Prospect Hill | Private room | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | e05 | 21 |
| demo-23 | Bright furnished room near the Brandeis stop | Private room | near Brandeis | 0.7 km | $1,150 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b16 | 11 |
| demo-24 | Furnished corner room near the Brandeis stop | Private room | near Brandeis | 0.6 km | $1,200 per room | 1 of 3 | Aug 1, 2027 | 12-month lease from August | Furnished | b31 | 17 |
| demo-25 | Bright furnished room on the South Side | Private room | South Side | 1.8 km | $950 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b25 | 13 |
| demo-26 | Group house in Lakeview needs a fourth | Replacing a roommate | Lakeview | 2.8 km | $950 per room | 1 of 4 | May 15, 2027 | Join the group's lease, mid-May 2027 to mid-May 2028 | Unfurnished | e15 | 6 |
| demo-27 | Whole two-bedroom near Moody Street | Whole apartment | Moody Street | 2.1 km | $2,600 whole place | 2 of 2 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k10 | 7 |
| demo-28 | Furnished room near Waltham Common | Private room | Downtown | 2.2 km | $1,150 per room | 1 of 3 | Aug 15, 2027 | 10-month lease, mid-August 2027 to mid-June 2028 | Furnished | b09 | 7 |
| demo-29 | Housemates in Warrendale need a fourth | Replacing a roommate | Warrendale | 1 km | $1,000 per room | 1 of 4 | May 15, 2027 | Join the group's lease, mid-May 2027 to mid-May 2028 | Unfurnished | k23 | 18 |
| demo-30 | Studio in the Highlands | Studio | The Highlands | 1.8 km | $1,600 whole place | 1 of 1 | Sep 1, 2027 | 12-month lease from September | Unfurnished | s40 | 6 |
| demo-31 | Top-floor room in Warrendale | Private room | Warrendale | 0.8 km | $950 per room | 1 of 3 | Aug 1, 2027 | 10-month lease, August 2027 to May 2028 | Unfurnished | l36 | 6 |
| demo-32 | Furnished corner room near Moody Street | Private room | Moody Street | 2.1 km | $1,300 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b12 | 26 |
| demo-33 | Furnished corner room near campus | Private room | near Brandeis | 0.4 km | $1,100 per room | 1 of 4 | Sep 1, 2027 | 12-month lease from September | Furnished | b12 | 10 |
| demo-34 | Two rooms in a four-bedroom on the South Side | Private room | South Side | 1.5 km | $1,200 per room | 2 of 4 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | e30 | 7 |
| demo-35 | Room in a four-bedroom near the commuter rail | Private room | Downtown | 2.2 km | $1,000 per room | 1 of 4 | Jun 15, 2027 | 12-month lease from mid-June | Unfurnished | k32 | 27 |
| demo-36 | Three rooms in a five-bedroom near the commuter rail | Private room | Downtown | 1.9 km | $1,050 per room | 3 of 5 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k01 | 34 |
| demo-37 | Room with a bay window near Prospect Hill Park | Private room | Prospect Hill | 2.5 km | $1,100 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | l37 | 13 |
| demo-38 | Take over a lease near Prospect Hill Park | Lease takeover | Prospect Hill | 2.6 km | $1,200 per room | 1 of 3 | Sep 1, 2027 | Lease takeover, September 2027 to August 2028 | Unfurnished | k33 | 11 |
| demo-39 | Spring semester sublet in Warrendale | Sublet | Warrendale | 1.1 km | $950 per room | 1 of 3 | Jan 15, 2027 | Spring sublet, mid-January to mid-May 2027 | Furnished | b20 | 8 |
| demo-40 | Furnished room in the Highlands | Private room | The Highlands | 1.9 km | $1,100 per room | 1 of 3 | Aug 1, 2027 | 12-month lease from August | Furnished | b09 | 19 |
| demo-41 | Furnished room with a desk downtown | Private room | Downtown | 2 km | $950 per room | 1 of 4 | Sep 1, 2027 | Academic-year lease, September 2027 to May 2028 | Furnished | b21 | 10 |
| demo-42 | Furnished corner room in Warrendale | Private room | Warrendale | 1.2 km | $1,100 per room | 1 of 4 | May 15, 2027 | 12-month lease from mid-May | Furnished | b17 | 18 |
| demo-43 | Three-bedroom apartment near Waltham Common | Whole apartment | Downtown | 2.4 km | $3,600 whole place | 3 of 3 | May 15, 2027 | 12-month lease from mid-May | Unfurnished | l35 | 4 |
| demo-44 | Bright furnished room in Warrendale | Private room | Warrendale | 1.1 km | $1,150 per room | 1 of 4 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | b27 | 24 |
| demo-45 | Corner room in Warrendale | Private room | Warrendale | 1 km | $1,000 per room | 1 of 3 | Sep 1, 2027 | 12-month lease from September | Unfurnished | k10 | 10 |
| demo-46 | Room with a bay window in Warrendale | Private room | Warrendale | 1.1 km | $1,000 per room | 1 of 3 | Jul 15, 2027 | 12-month lease from mid-July | Unfurnished | k34 | 10 |
| demo-47 | Summer room near the Brandeis stop | Sublet | near Brandeis | 0.3 km | $1,000 per room | 1 of 4 | Jun 1, 2027 | Summer sublet, June to August 2027 | Furnished | b04 | 6 |
| demo-48 | Top-floor room by the Riverwalk | Private room | Moody Street | 1.7 km | $1,050 per room | 1 of 4 | Sep 1, 2027 | Academic-year lease, September 2027 to May 2028 | Unfurnished | l35 | 7 |
| demo-49 | Furnished corner room in the Highlands | Private room | The Highlands | 2 km | $1,000 per room | 1 of 4 | Jan 15, 2027 | Five-month lease, mid-January to mid-June 2027 | Furnished | b21 | 8 |
| demo-50 | Small furnished studio by the Riverwalk | Studio | Moody Street | 2 km | $1,550 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Furnished | s40 | 5 |
| demo-51 | Whole three-bedroom by the Riverwalk | Whole apartment | Moody Street | 2 km | $3,300 whole place | 3 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | e29 | 6 |
| demo-52 | Bright furnished room in the Highlands | Private room | The Highlands | 2 km | $1,250 per room | 1 of 3 | Jun 15, 2027 | 12-month lease from mid-June | Furnished | b22 | 7 |
| demo-53 | Take over a lease in Warrendale | Lease takeover | Warrendale | 0.9 km | $1,000 per room | 1 of 4 | Jan 15, 2027 | Lease takeover, mid-January to mid-September 2027 | Furnished | b16 | 6 |
| demo-54 | Summer sublet in Warrendale | Sublet | Warrendale | 0.7 km | $900 per room | 1 of 3 | Jun 1, 2027 | Summer sublet, June to September 2027 | Unfurnished | k34 | 6 |
| demo-55 | Bright furnished room near Hardy Pond | Private room | Lakeview | 2.5 km | $1,000 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b25 | 8 |
| demo-56 | Whole one-bedroom in Lakeview | Whole apartment | Lakeview | 2.6 km | $1,850 whole place | 1 of 1 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | l07 | 6 |
| demo-57 | Second-floor room in Warrendale | Private room | Warrendale | 0.7 km | $1,050 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | l37 | 11 |
| demo-58 | Bright private room in the Highlands | Private room | The Highlands | 1.9 km | $1,200 per room | 1 of 3 | Jul 15, 2027 | 12-month lease from mid-July | Furnished | b02 | 15 |
| demo-59 | Spring sublet near Prospect Hill Park | Sublet | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Dec 15, 2026 | Spring sublet, mid-December 2026 to mid-June 2027 | Furnished | b24 | 6 |
| demo-60 | Second-floor room near Prospect Hill Park | Private room | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Jul 15, 2027 | 12-month lease from mid-July | Unfurnished | k33 | 16 |
| demo-61 | Furnished room with a desk near the Brandeis stop | Private room | near Brandeis | 0.4 km | $1,150 per room | 1 of 3 | Jan 1, 2027 | Six-month lease, January to June 2027 | Furnished | b28 | 11 |
| demo-62 | Bed in a shared room near campus | Shared room | near Brandeis | 0.3 km | $700 per bed | 1 of 3 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | h26 | 30 |
| demo-63 | Large room near the commuter rail | Private room | Downtown | 2.4 km | $1,250 per room | 1 of 3 | Sep 1, 2027 | 12-month lease from September | Unfurnished | e11 | 11 |
| demo-64 | Two open rooms near Moody Street | Private room | Moody Street | 1.8 km | $1,250 per room | 2 of 4 | Jun 1, 2027 | 12-month lease from June | Unfurnished | e15 | 35 |
| demo-65 | Room in a four-bedroom near Moody Street | Private room | Moody Street | 1.7 km | $1,000 per room | 1 of 4 | May 15, 2027 | 12-month lease from mid-May | Unfurnished | k33 | 20 |
| demo-66 | Two open rooms a short walk from campus | Private room | near Brandeis | 0.2 km | $1,100 per room | 2 of 4 | Aug 1, 2027 | 12-month lease from August | Unfurnished | l36 | 24 |
| demo-67 | Two-bedroom apartment in Warrendale | Whole apartment | Warrendale | 0.8 km | $2,400 whole place | 2 of 2 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | l37 | 7 |
| demo-68 | Bed in a shared room a short walk from campus | Shared room | near Brandeis | 0.7 km | $750 per bed | 1 of 3 | Aug 15, 2027 | Academic-year lease, mid-August 2027 to mid-May 2028 | Furnished | h26 | 6 |
| demo-69 | Bright furnished room near campus | Private room | near Brandeis | 0.7 km | $1,250 per room | 1 of 3 | Apr 15, 2027 | 12-month lease from mid-April | Furnished | b22 | 6 |
| demo-70 | Furnished summer sublet on the South Side | Sublet | South Side | 1.9 km | $950 per room | 1 of 3 | Jun 1, 2027 | Summer sublet, June to August 2027 | Furnished | b25 | 8 |
| demo-71 | Join a friendly house in Warrendale | Replacing a roommate | Warrendale | 1.2 km | $950 per room | 1 of 4 | Sep 1, 2027 | Join the group's lease, September 2027 to August 2028 | Unfurnished | k23 | 10 |
| demo-72 | Top-floor room a short walk from campus | Private room | near Brandeis | 0.6 km | $1,250 per room | 1 of 2 | Jun 15, 2027 | 12-month lease from mid-June | Unfurnished | e29 | 10 |
| demo-73 | Furnished corner room on the South Side | Private room | South Side | 1.6 km | $1,250 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b18 | 10 |
| demo-74 | Take over a lease on Prospect Hill | Lease takeover | Prospect Hill | 2.7 km | $1,150 per room | 1 of 3 | Aug 1, 2027 | Lease takeover, August 2027 to July 2028 | Unfurnished | l14 | 21 |
| demo-75 | Top-floor room off Moody Street | Private room | Moody Street | 1.9 km | $1,100 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | l35 | 33 |
| demo-76 | Spring sublet on Prospect Hill | Sublet | Prospect Hill | 2.7 km | $900 per room | 1 of 3 | Jan 1, 2027 | Spring sublet, January to May 2027 | Furnished | b27 | 6 |
| demo-77 | Group house in Warrendale needs a fourth | Replacing a roommate | Warrendale | 0.8 km | $1,050 per room | 1 of 4 | May 1, 2027 | Join the group's lease, May 2027 to April 2028 | Unfurnished | e30 | 18 |
| demo-78 | Furnished room with a desk in the Highlands | Private room | The Highlands | 1.7 km | $1,100 per room | 1 of 3 | Jul 1, 2027 | 12-month lease from July | Furnished | b24 | 16 |
| demo-79 | Furnished room with a desk near the commuter rail | Private room | Downtown | 2.3 km | $1,350 per room | 1 of 3 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | b27 | 10 |
| demo-80 | Sunny room near the Brandeis stop | Private room | near Brandeis | 0.4 km | $1,200 per room | 1 of 3 | May 1, 2027 | 12-month lease from May | Unfurnished | l36 | 18 |
| demo-81 | Furnished room in Warrendale | Private room | Warrendale | 0.7 km | $950 per room | 1 of 4 | Aug 1, 2027 | 12-month lease from August | Furnished | b28 | 30 |
| demo-82 | Group house near Waltham Common needs a fifth | Replacing a roommate | Downtown | 2 km | $950 per room | 1 of 5 | Jun 1, 2027 | Join the group's lease, June 2027 to May 2028 | Unfurnished | k32 | 27 |
| demo-83 | Furnished room with a desk near Waltham Common | Private room | Downtown | 2 km | $1,000 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b17 | 27 |
| demo-84 | Furnished room with a desk a short walk from campus | Private room | near Brandeis | 0.3 km | $1,250 per room | 1 of 3 | Jul 15, 2027 | 12-month lease from mid-July | Furnished | b20 | 10 |
| demo-85 | Spring sublet near campus | Sublet | near Brandeis | 0.3 km | $1,000 per room | 1 of 4 | Jan 1, 2027 | Spring sublet, January to May 2027 | Furnished | b18 | 7 |
| demo-86 | Group house a short walk from campus needs a fifth | Replacing a roommate | near Brandeis | 0.6 km | $900 per room | 1 of 5 | Aug 1, 2027 | Join the group's lease, August 2027 to July 2028 | Unfurnished | e30 | 20 |
| demo-87 | Join a friendly house near Moody Street | Replacing a roommate | Moody Street | 2 km | $900 per room | 1 of 5 | Sep 1, 2027 | Join the current lease, September 2027 to May 2028 | Unfurnished | k34 | 10 |
| demo-88 | Whole two-bedroom on the South Side | Whole apartment | South Side | 1.5 km | $2,650 whole place | 2 of 2 | Sep 1, 2027 | 12-month lease from September | Unfurnished | l14 | 6 |
| demo-89 | Summer room by the Riverwalk | Sublet | Moody Street | 2 km | $1,000 per room | 1 of 4 | May 15, 2027 | Summer sublet, mid-May to mid-August 2027 | Furnished | b31 | 8 |
| demo-90 | Lease takeover by the Riverwalk | Lease takeover | Moody Street | 1.9 km | $1,200 per room | 1 of 3 | Jul 1, 2027 | Lease takeover, July 2027 to June 2028 | Unfurnished | e06 | 15 |
| demo-91 | Furnished room near the Brandeis stop | Private room | near Brandeis | 0.3 km | $1,000 per room | 1 of 4 | Aug 15, 2027 | Academic-year lease, mid-August 2027 to mid-May 2028 | Furnished | b20 | 6 |
| demo-92 | Two-bedroom apartment on the South Side | Whole apartment | South Side | 1.5 km | $2,800 whole place | 2 of 2 | Jun 1, 2027 | 12-month lease from June | Unfurnished | e11 | 7 |
| demo-93 | Bright furnished room a short walk from campus | Private room | near Brandeis | 0.3 km | $1,200 per room | 1 of 3 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | b31 | 17 |
| demo-94 | Furnished room near the commuter rail | Private room | Downtown | 2.1 km | $1,100 per room | 1 of 3 | Jul 1, 2027 | 12-month lease from July | Furnished | b38 | 15 |
| demo-95 | Studio near Waltham Common | Studio | Downtown | 1.9 km | $1,700 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Unfurnished | s39 | 5 |
| demo-96 | Furnished corner room a short walk from campus | Private room | near Brandeis | 0.4 km | $1,300 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b41 | 9 |
| demo-97 | Whole two-bedroom in Warrendale | Whole apartment | Warrendale | 0.8 km | $2,600 whole place | 2 of 2 | Jul 15, 2027 | 12-month lease from mid-July | Unfurnished | l07 | 3 |
| demo-98 | Sunny room near Hardy Pond | Private room | Lakeview | 2.9 km | $1,150 per room | 1 of 3 | Sep 1, 2027 | 12-month lease from September | Unfurnished | k01 | 8 |
| demo-99 | Whole two-bedroom downtown | Whole apartment | Downtown | 2.2 km | $2,500 whole place | 2 of 2 | Sep 1, 2027 | 12-month lease from September | Unfurnished | e05 | 6 |
| demo-100 | Two-bedroom apartment near the Brandeis stop | Whole apartment | near Brandeis | 0.6 km | $2,500 whole place | 2 of 2 | Aug 1, 2027 | 12-month lease from August | Unfurnished | k23 | 7 |

## Listing photos (sources and licenses)

Illustrative stock photos of ordinary rooms; none shows the listing it's on or any real Waltham property, and each is
labeled "Illustrative demo photo" with a credit in Details. All are free photos under the
[Unsplash License](https://unsplash.com/license) (not Unsplash+), each checked on its photo page (the first 15 on
2026-10-14, the other 26 on 2026-10-17). They load from Unsplash's image server, resized for the card or dialog; nothing
is downloaded into this project, and if a photo can't load the card shows coHabit's drawing instead. Furnished rooms use
bedroom photos, unfurnished places empty rooms, kitchens or living rooms, studios studio photos and shared rooms photos
with two beds. No photo is used for more than three listings.

| Key | Kind | What it shows | Photographer | Source | Used by |
| --- | --- | --- | --- | --- | --- |
| k01 | kitchen | a small white kitchen with a gas stove | [Andrea Davis](https://unsplash.com/@andreaedavis?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/Wj6oZNCAzs4?utm_source=cohabit&utm_medium=referral) | demo-01, demo-36, demo-98 |
| b02 | bedroom | a bedroom with a white desk beside the bed | [Gabriel Beaudry](https://unsplash.com/@gbeaudry?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WuQME0I_oZA?utm_source=cohabit&utm_medium=referral) | demo-02, demo-20, demo-58 |
| s03 | studio | a studio with a kitchenette and a small dining table | [Aquilion Property](https://unsplash.com/@aquilionproperty?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/NoPzk4m4jHc?utm_source=cohabit&utm_medium=referral) | demo-03 |
| b04 | bedroom | a student's bedroom with a wall map and a guitar | [Emma Dau](https://unsplash.com/@daugirl?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/26OziLnJHFs?utm_source=cohabit&utm_medium=referral) | demo-04, demo-47 |
| e05 | empty | an empty room with white walls and wood floors | [Brian Wangenheim](https://unsplash.com/@brianwangenheim?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/SCbkyJR3QSM?utm_source=cohabit&utm_medium=referral) | demo-05, demo-22, demo-99 |
| e06 | empty | an empty room with grey walls and a window | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/nLTk9N2eg2U?utm_source=cohabit&utm_medium=referral) | demo-06, demo-90 |
| l07 | living | a living room with a grey loveseat and plants | [Patrick Perkins](https://unsplash.com/@patrickperkins?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/3wylDrjxH-E?utm_source=cohabit&utm_medium=referral) | demo-07, demo-56, demo-97 |
| h08 | shared | a bedroom with two single beds and a desk | [Febrian Zakaria](https://unsplash.com/@febrianzakaria?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/M6S1WvfW68A?utm_source=cohabit&utm_medium=referral) | demo-08 |
| b09 | bedroom | a bedroom with a single bed and a desk | [Zac Gudakov](https://unsplash.com/@zacgudakov?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/qnYbBALP4dA?utm_source=cohabit&utm_medium=referral) | demo-09, demo-28, demo-40 |
| k10 | kitchen | a narrow white kitchen with pans on the wall | [Dinh Ng.](https://unsplash.com/@dinhnext?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/2Cc0KnE3lCs?utm_source=cohabit&utm_medium=referral) | demo-10, demo-27, demo-45 |
| e11 | empty | an empty room with grey walls | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/47c3k8CIKzQ?utm_source=cohabit&utm_medium=referral) | demo-11, demo-63, demo-92 |
| b12 | bedroom | a bedroom with string lights and a round mirror | [Jonathan Borba](https://unsplash.com/@jonathanborba?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/wD3dur3v9aE?utm_source=cohabit&utm_medium=referral) | demo-12, demo-32, demo-33 |
| s13 | studio | a furnished studio with a table and a sofa | [deborah cortelazzi](https://unsplash.com/@deborah_cortelazzi?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/gREquCUXQLI?utm_source=cohabit&utm_medium=referral) | demo-13 |
| l14 | living | a shared living room with a sofa and armchairs | [Evan Wise](https://unsplash.com/@evanthewise?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/i4WbkwwvRj4?utm_source=cohabit&utm_medium=referral) | demo-14, demo-74, demo-88 |
| e15 | empty | an empty room with a large window | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/fbCqpQreg4Q?utm_source=cohabit&utm_medium=referral) | demo-15, demo-26, demo-64 |
| b16 | bedroom | a lived-in bedroom with a bed, a desk and a chair | [Aim / @photobypitcha](https://unsplash.com/@aimpitcha?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/jM-dZdFtnbk?utm_source=cohabit&utm_medium=referral) | demo-23, demo-53 |
| b17 | bedroom | a bedroom with a bed, a desk and a window | [Lotus Design N Print](https://unsplash.com/@lotusdnp?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WDUtNbot6Qw?utm_source=cohabit&utm_medium=referral) | demo-42, demo-83 |
| b18 | bedroom | a bright room with a desk, a pink chair and window blinds | [JEJOONG LEE](https://unsplash.com/@rfcking?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/KGo29e3zjI0?utm_source=cohabit&utm_medium=referral) | demo-73, demo-85 |
| h19 | shared | a black metal bunk bed | [Marcus Loke](https://unsplash.com/@marcusloke?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WQJvWU_HZFo?utm_source=cohabit&utm_medium=referral) | demo-21 |
| b20 | bedroom | a student room with a desk, chairs and luggage | [Robiul Islam](https://unsplash.com/@connect2robiul?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/mORrLn55f0M?utm_source=cohabit&utm_medium=referral) | demo-39, demo-84, demo-91 |
| b21 | bedroom | a cozy bed beside a white cabinet | [Shashi Chaturvedula](https://unsplash.com/@thephotographermom?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/xdY1s1I6J8U?utm_source=cohabit&utm_medium=referral) | demo-16, demo-41, demo-49 |
| b22 | bedroom | a small bedroom with a nightstand by the window | [Daria Shevtsova](https://unsplash.com/@daria_shevtsova?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/RP4mtXJM7es?utm_source=cohabit&utm_medium=referral) | demo-52, demo-69 |
| k23 | kitchen | a small apartment kitchen | [Y K](https://unsplash.com/@yokeboy?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/bn4Ve3NjQ8g?utm_source=cohabit&utm_medium=referral) | demo-29, demo-71, demo-100 |
| b24 | bedroom | a bedroom with blue and white sheets and a black bed frame | [CHUTTERSNAP](https://unsplash.com/@chuttersnap?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/ftG8WcHwg7o?utm_source=cohabit&utm_medium=referral) | demo-59, demo-78 |
| b25 | bedroom | a bedroom with a desk, a globe and a radio | [Ivona Rož](https://unsplash.com/@ivonar?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/qDeMuOXFYXU?utm_source=cohabit&utm_medium=referral) | demo-25, demo-55, demo-70 |
| h26 | shared | two wooden beds with white mattresses | [yi sk](https://unsplash.com/@bemerrychristmas?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/i7-zqldb2os?utm_source=cohabit&utm_medium=referral) | demo-62, demo-68 |
| b27 | bedroom | a bedroom with a wooden nightstand | [Clay Banks](https://unsplash.com/@claybanks?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/tstSvl2Z3_0?utm_source=cohabit&utm_medium=referral) | demo-44, demo-76, demo-79 |
| b28 | bedroom | a bed with white linen | [Sam Moghadam](https://unsplash.com/@sammoghadam?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/eU4kIKCMGk8?utm_source=cohabit&utm_medium=referral) | demo-61, demo-81 |
| e29 | empty | an empty room with grey walls and white doors | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/CYj8RjUeFlY?utm_source=cohabit&utm_medium=referral) | demo-51, demo-72 |
| e30 | empty | an empty room with grey walls and light wood floors | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/y2mAxcgm19s?utm_source=cohabit&utm_medium=referral) | demo-34, demo-77, demo-86 |
| b31 | bedroom | a cozy bedroom with a bedside table and a lamp | [Franco Debartolo](https://unsplash.com/@francotheshooter?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/kUd6KkVfbCY?utm_source=cohabit&utm_medium=referral) | demo-24, demo-89, demo-93 |
| k32 | kitchen | a kitchen with a steel refrigerator | [Naomi Hébert](https://unsplash.com/@naomish?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/MP0bgaS_d1c?utm_source=cohabit&utm_medium=referral) | demo-17, demo-35, demo-82 |
| k33 | kitchen | a kitchen with white and brown cabinets | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/2fJB9gwnA6U?utm_source=cohabit&utm_medium=referral) | demo-38, demo-60, demo-65 |
| k34 | kitchen | a white kitchen with a microwave | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/0t5erEPTFuk?utm_source=cohabit&utm_medium=referral) | demo-46, demo-54, demo-87 |
| l35 | living | a living room with a grey sofa and a wooden coffee table | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/DmOhItSo49k?utm_source=cohabit&utm_medium=referral) | demo-43, demo-48, demo-75 |
| l36 | living | a bright living room | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/6japTIjUQoI?utm_source=cohabit&utm_medium=referral) | demo-31, demo-66, demo-80 |
| l37 | living | a living room with wooden furniture | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/yYUu4R4Wuwk?utm_source=cohabit&utm_medium=referral) | demo-37, demo-57, demo-67 |
| b38 | bedroom | a black platform bed with a white mattress | [Sonnie Hiles](https://unsplash.com/@sonniehiles?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/DhFHtkECn7Q?utm_source=cohabit&utm_medium=referral) | demo-19, demo-94 |
| s39 | studio | a white bed by a white window | [Julia](https://unsplash.com/@beazy?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/ABohRftG_Os?utm_source=cohabit&utm_medium=referral) | demo-95 |
| s40 | studio | a compact kitchen with a microwave, a mini-fridge and a sink | [Alexander Mass](https://unsplash.com/@alexandermassph?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/Rjnzt2wvMQE?utm_source=cohabit&utm_medium=referral) | demo-30, demo-50 |
| b41 | bedroom | a small room with a white bed by the window | [Andrea Davis](https://unsplash.com/@andreaedavis?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/NngNVT74o6s?utm_source=cohabit&utm_medium=referral) | demo-18, demo-96 |

## Roommate profiles

Fictional seniors and graduate students. Avatars are illustrations drawn by coHabit's own code from a few settings, not
photos or likenesses of anyone. No contact details, references, verification or testimonials. "Rooms" counts rooms that
match everything for them; "Roommates" counts visible profiles mutually compatible with them.

| Id | Name | Program | Looking in | Move-in | Budget | Wants | Lifestyle | Rooms | Roommates | Shown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo-p01 | Ari | PhD student in neuroscience, 2nd year | near Brandeis, Warrendale | Jun 2027 | $950–$1,350 | 12 mo, 1 room, ≤1.5 km | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 8 | 41 | Yes |
| demo-p02 | Bea | Incoming master's student in global health | Moody Street, South Side | Jun 2027 | $1,000–$1,450 | 12 mo, 1 room, must: month | early, average tidiness, quiet, guests rarely, no pets, no smoking | 8 | 34 | Yes |
| demo-p03 | Cam | Senior in music and computer science | Downtown, Moody Street | Jul 2027 | $800–$1,200 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 9 | 55 | Yes |
| demo-p04 | Dev | MBA student, 1st year | Moody Street, Downtown | Jun 2027 | $1,100–$1,600 | 12 mo, 1 room | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK | 9 | 26 | Yes |
| demo-p05 | Eli | Senior in environmental studies | South Side, Moody Street | Jun 2027 | $750–$1,050 | 12 mo, 1 room, must: area | night owl, average tidiness, some noise, guests sometimes, has a pet, no smoking | 3 | 21 | Yes |
| demo-p06 | Fern | PhD student in chemistry, 3rd year | The Highlands, Prospect Hill | Aug 2027 | $1,100–$1,500 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 8 | 41 | Yes |
| demo-p07 | Gus | Master's student in sustainable development | Downtown, Moody Street | Jun 2027 | $900–$1,300 | 12 mo, 1 room | night owl, average tidiness, some noise, guests often, OK with pets, smokes | 9 | 8 | Yes |
| demo-p08 | Hana | Master's student in public policy, 2nd year | near Brandeis, Warrendale | May 2027 | $950–$1,350 | 12 mo, 1 room, must: month | early, very tidy, quiet, guests rarely, no pets, no smoking | 5 | 6 | Yes |
| demo-p09 | Ira | PhD student in English and teaching assistant | Warrendale, near Brandeis | Jun 2027 | $1,000–$1,400 | 12 mo, 1 room | flexible sleep, very tidy, quiet, guests sometimes, OK with pets, no smoking | 8 | 46 | Yes |
| demo-p10 | Jules | Senior in economics | Downtown, Moody Street | Sep 2027 | $1,000–$1,400 | 9 mo, 1 room | night owl, average tidiness, lively, guests often, OK with pets, no smoking | 7 | 8 | Yes |
| demo-p11 | Kai | Senior in computer science | Moody Street, Downtown | Jun 2027 | $800–$1,100 | 12 mo, 1 room | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK | 7 | 24 | Yes |
| demo-p12 | Lena | PhD student in history, writing a thesis | Prospect Hill, The Highlands | Jan 2027 | $800–$1,100 | 5 mo, 1 room, furnished, must: month | early, very tidy, quiet, guests rarely, no pets, no smoking | 4 | 9 | Yes |
| demo-p13 | Milo | Incoming PhD student in economics | South Side, Moody Street | Jun 2027 | $1,000–$1,500 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 8 | 56 | Yes |
| demo-p14 | Noor | Incoming master's student in biotechnology | near Brandeis, Warrendale | Aug 2027 | $900–$1,300 | 12 mo, 1 room, furnished | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking | 7 | 43 | Yes |
| demo-p15 | Omar | Master's student in computer science | Downtown, Prospect Hill | Sep 2027 | $1,100–$1,600 | 12 mo, 1 room | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 6 | 40 | Yes |
| demo-p16 | Pia | PhD student in biology | near Brandeis, Warrendale | Jun 2027 | $900–$1,400 | 12 mo, 1 room | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 8 | 42 | No (never shown) |
| demo-p17 | Quinn | Senior in psychology | Moody Street, South Side | Jun 2027 | $900–$1,300 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 8 | 49 | No (never shown) |
| demo-p18 | Rosa | Senior in sociology | Lakeview, Prospect Hill | Jun 2027 | $900–$1,250 | 12 mo, 1 room | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 50 | Yes |
| demo-p19 | Sam | Senior in film and media | Moody Street, Downtown | Sep 2027 | $800–$1,200 | 9 mo, 1 room | night owl, average tidiness, lively, guests often, OK with pets, no smoking | 7 | 13 | Yes |
| demo-p20 | Theo | Master's student in finance | The Highlands, Prospect Hill | Jul 2027 | $1,000–$1,400 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, no pets, no smoking | 6 | 44 | No (never shown) |
| demo-p21 | Priya | Senior in health science | Lakeview, Prospect Hill | Jun 2027 | $550–$1,150 | 12 mo, 1 room | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 3 | 42 | Yes |
| demo-p22 | Bilal | Senior in environmental studies | near Brandeis, Warrendale | Jun 2027 | $650–$1,050 | 3 mo, 1 room, must: month | flexible sleep, very tidy, some noise, guests sometimes, no pets, no smoking | 3 | 9 | Yes |
| demo-p23 | Jonah | Senior in mathematics | near Brandeis, Warrendale | Aug 2027 | $800–$1,100 | 12 mo, 1 room, must: month | night owl, average tidiness, lively, guests sometimes, has a pet, no smoking | 6 | 20 | Yes |
| demo-p24 | Nell | PhD student in physics, 5th year | South Side, Downtown | Sep 2027 | $1,250–$1,550 | 12 mo, 2 rooms, must: month | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 3 | 16 | Yes |
| demo-p25 | Yusuf | MBA student, 2nd year | Downtown, Moody Street | Jul 2027 | $1,500–$1,800 | 12 mo, 1 room, must: month | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 14 | 4 | Yes |
| demo-p26 | Selin | PhD student in neuroscience, 4th year | near Brandeis, Warrendale | May 2027 | $750–$1,300 | 12 mo, 1 room | flexible sleep, average tidiness, some noise, guests rarely, no pets, no smoking | 5 | 26 | Yes |
| demo-p27 | Iris | Master's student in nonprofit management, 2nd year | Downtown, Moody Street | Jul 2027 | $1,200–$1,850 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 14 | 52 | Yes |
| demo-p28 | Uri | Senior in environmental studies | Moody Street, Downtown | Sep 2027 | $750–$1,350 | 9 mo, 1 room | night owl, very tidy, lively, guests sometimes, OK with pets, no smoking | 7 | 12 | Yes |
| demo-p29 | Kenji | Senior in sociology | Moody Street, Downtown | Jun 2027 | $900–$1,450 | 12 mo, 1 room | night owl, very tidy, lively, guests sometimes, OK with pets, no smoking | 9 | 53 | Yes |
| demo-p30 | Ren | Master's student in teaching, 2nd year | Moody Street, Downtown | Jul 2027 | $1,450–$1,850 | 12 mo, 1 room | early, average tidiness, quiet, guests sometimes, OK with pets, no smoking | 14 | 12 | Yes |
| demo-p31 | Gemma | PhD student in social policy, 4th year | near Brandeis, Warrendale | Jan 2027 | $800–$1,250 | 5 mo, 1 room, furnished | early, relaxed tidiness, some noise, guests sometimes, no pets, smoking outside OK | 3 | 11 | Yes |
| demo-p32 | Gabe | Senior in economics and anthropology | near Brandeis, Warrendale | May 2027 | $600–$1,250 | 12 mo, 1 room | night owl, average tidiness, quiet, guests sometimes, OK with pets, no smoking | 5 | 26 | Yes |
| demo-p33 | Xavier | PhD student in social policy, 4th year | Lakeview, The Highlands | Sep 2027 | $1,600–$1,850 | 12 mo, 1 room, must: month, must: area | flexible sleep, average tidiness, some noise, guests often, OK with pets, no smoking | 5 | 5 | Yes |
| demo-p34 | Cleo | Master's student in public policy, 2nd year | Warrendale, near Brandeis | Aug 2027 | $950–$1,450 | 12 mo, 2 rooms | flexible sleep, average tidiness, quiet, guests rarely, OK with pets, no smoking | 5 | 51 | Yes |
| demo-p35 | Marisol | Senior in history | near Brandeis, Warrendale | Aug 2027 | $600–$900 | 12 mo, 1 room, must: area | night owl, average tidiness, some noise, guests often, OK with pets, no smoking | 3 | 26 | Yes |
| demo-p36 | Isla | PhD student in physics, 6th year | near Brandeis, Warrendale, The Highlands | Feb 2027 | $1,000–$1,250 | 7 mo, 1 room, must: area | flexible sleep, average tidiness, quiet, guests sometimes, no pets, no smoking | 4 | 4 | Yes |
| demo-p37 | Ada | Master's student in biotechnology | Prospect Hill, The Highlands | Aug 2027 | $1,000–$1,500 | 12 mo, 1 room | early, relaxed tidiness, some noise, guests rarely, OK with pets, no smoking | 8 | 44 | Yes |
| demo-p38 | Clara | Senior in chemistry | Warrendale, near Brandeis | Aug 2027 | $550–$1,000 | 9 mo, 1 room, ≤1.5 km, must: month | night owl, average tidiness, lively, guests often, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p39 | Pilar | Master's student in international economics and finance, 2nd year | Downtown, Moody Street | Jun 2027 | $750–$1,350 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests often, no pets, no smoking | 9 | 51 | Yes |
| demo-p40 | Chiara | Senior in environmental studies and biology | Warrendale, near Brandeis | Jan 2027 | $600–$1,150 | 5 mo, 1 room, furnished | flexible sleep, average tidiness, some noise, guests rarely, OK with pets, no smoking | 3 | 12 | Yes |
| demo-p41 | Sami | PhD student in chemistry, 3rd year | Warrendale, near Brandeis | Jun 2027 | $600–$1,200 | 12 mo, 1 room | early, very tidy, some noise, guests rarely, OK with pets, smoking outside OK | 6 | 41 | Yes |
| demo-p42 | Mina | PhD student in anthropology, 2nd year | The Highlands, Prospect Hill | Jul 2027 | $800–$1,150 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests often, no pets, no smoking | 4 | 46 | Yes |
| demo-p43 | Nadia | Senior in history | Moody Street, Downtown | Jul 2027 | $900–$1,200 | 12 mo, 1 room, must: area | night owl, very tidy, some noise, guests rarely, OK with pets, no smoking | 9 | 23 | Yes |
| demo-p44 | Sara | Senior in film and media | near Brandeis, Warrendale, The Highlands | Aug 2027 | $800–$1,050 | 9 mo, 1 room, must: month | flexible sleep, average tidiness, some noise, guests often, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p45 | Rowan | MBA student, 2nd year | Downtown, Prospect Hill | Sep 2027 | $900–$1,350 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 6 | 29 | Yes |
| demo-p46 | Esther | PhD student in chemistry, 1st year | Moody Street, South Side | Jun 2027 | $850–$1,450 | 12 mo, 1 room, must: month | early, very tidy, quiet, guests rarely, no pets, no smoking | 8 | 32 | Yes |
| demo-p47 | Uma | Incoming master's student in computer science | near Brandeis, Warrendale | Sep 2027 | $800–$1,150 | 12 mo, 1 room | flexible sleep, average tidiness, lively, guests sometimes, OK with pets, no smoking | 9 | 39 | Yes |
| demo-p48 | Rhea | Master's student in business analytics | Prospect Hill, Downtown | Sep 2027 | $900–$1,500 | 12 mo, 1 room, must: area | flexible sleep, very tidy, some noise, guests often, OK with pets, no smoking | 6 | 17 | Yes |
| demo-p49 | Petra | Master's student in sustainable international development, 2nd year | Prospect Hill, The Highlands | Jul 2027 | $600–$1,200 | 12 mo, 1 room | flexible sleep, average tidiness, quiet, guests sometimes, OK with pets, no smoking | 5 | 54 | Yes |
| demo-p50 | Bianca | Visiting master's student in teaching | within 2 km | Jan 2027 | $600–$1,150 | 5 mo, 1 room, furnished, ≤2 km, must: month | night owl, relaxed tidiness, lively, guests sometimes, OK with pets, no smoking | 5 | 8 | Yes |
| demo-p51 | Tamar | Master's student in genetic counseling | Prospect Hill, The Highlands | Jan 2027 | $550–$1,200 | 5 mo, 1 room, furnished | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking | 4 | 11 | Yes |
| demo-p52 | Alma | Senior in politics | South Side, Moody Street, Downtown | Jun 2027 | $700–$1,100 | 3 mo, 1 room, furnished, must: area | night owl, very tidy, some noise, guests often, no pets, no smoking | 4 | 5 | Yes |
| demo-p53 | Keiko | Master's student in business analytics, 2nd year | Downtown, Moody Street | Sep 2027 | $700–$1,150 | 9 mo, 1 room, must: area | flexible sleep, average tidiness, some noise, guests often, OK with pets, no smoking | 7 | 12 | Yes |
| demo-p54 | Zuri | Senior in anthropology | Warrendale, near Brandeis | Sep 2027 | $500–$1,100 | 12 mo, 1 room, ≤1.5 km | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 8 | 37 | Yes |
| demo-p55 | Idris | Senior in computer science | Warrendale, near Brandeis | Aug 2027 | $800–$1,250 | 12 mo, 2 rooms | night owl, very tidy, lively, guests sometimes, has a pet, no smoking | 4 | 32 | Yes |
| demo-p56 | Yasmin | Master's student in international economics and finance | Warrendale, near Brandeis | Aug 2027 | $900–$1,400 | 12 mo, 1 room, furnished, must: month | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 7 | 31 | Yes |
| demo-p57 | Luka | Master's student in global health policy | Downtown, Moody Street | Jul 2027 | $700–$1,300 | 12 mo, 1 room | night owl, very tidy, lively, guests often, OK with pets, no smoking | 11 | 45 | Yes |
| demo-p58 | Hugo | Senior in East Asian studies | Warrendale, near Brandeis | Aug 2027 | $550–$1,150 | 12 mo, 1 room, must: month | early, relaxed tidiness, lively, guests often, has a pet, no smoking | 7 | 20 | Yes |
| demo-p59 | Leila | Incoming PhD student in economics | Downtown, Prospect Hill | Sep 2027 | $1,200–$1,550 | 12 mo, 1 room, must: month | early, very tidy, quiet, guests sometimes, no pets, no smoking | 6 | 18 | Yes |
| demo-p60 | Sana | Senior in computer science | Downtown, Moody Street | Jun 2027 | $650–$1,300 | 12 mo, 1 room, must: month | flexible sleep, average tidiness, some noise, guests sometimes, no pets, no smoking | 9 | 38 | Yes |
| demo-p61 | Kemal | Master's student in international economics and finance, 2nd year | Prospect Hill, The Highlands | Jul 2027 | $700–$1,300 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 6 | 10 | Yes |
| demo-p62 | Bryn | Master's student in teaching, 2nd year | near Brandeis, Warrendale | Aug 2027 | $800–$1,300 | 12 mo, 1 room, furnished | early, average tidiness, some noise, guests rarely, no pets, no smoking | 7 | 43 | Yes |
| demo-p63 | Cyrus | Master's student in sustainable international development | near Brandeis, Warrendale | Aug 2027 | $1,000–$1,300 | 12 mo, 1 room, furnished | early, very tidy, lively, guests sometimes, OK with pets, no smoking | 7 | 47 | Yes |
| demo-p64 | Amara | Incoming master's student in teaching | within 2 km | Sep 2027 | $1,050–$1,300 | 12 mo, 1 room, ≤2 km | night owl, average tidiness, some noise, guests often, OK with pets, no smoking | 15 | 27 | Yes |
| demo-p65 | Hedda | PhD student in biochemistry, 3rd year | Prospect Hill, The Highlands | Jan 2027 | $550–$1,200 | 5 mo, 1 room, furnished | night owl, relaxed tidiness, some noise, guests sometimes, no pets, no smoking | 4 | 9 | Yes |
| demo-p66 | Victor | Incoming master's student in genetic counseling | near Brandeis, Warrendale | May 2027 | $700–$1,200 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests rarely, OK with pets, smoking outside OK | 4 | 29 | Yes |
| demo-p67 | Calla | PhD student in chemistry, 1st year | South Side, Moody Street | Jun 2027 | $1,050–$1,450 | 12 mo, 2 rooms, must: month, must: area | flexible sleep, relaxed tidiness, lively, guests sometimes, no pets, no smoking | 4 | 23 | Yes |
| demo-p68 | Mariam | PhD student in psychology, 5th year | The Highlands, Prospect Hill, Warrendale | Jan 2027 | $600–$1,200 | 5 mo, 1 room, furnished, must: month, must: area | flexible sleep, very tidy, some noise, guests rarely, OK with pets, no smoking | 5 | 11 | Yes |
| demo-p69 | Aditi | MBA student, 1st year | South Side, Downtown | Sep 2027 | $950–$1,500 | 12 mo, 2 rooms, must: month, must: area | early, very tidy, lively, guests sometimes, OK with pets, no smoking | 3 | 15 | Yes |
| demo-p70 | Ivan | PhD student in English, 6th year | Warrendale, near Brandeis, The Highlands | Jun 2027 | $1,050–$1,350 | 12 mo, 1 room, ≤1.5 km | early, very tidy, some noise, guests sometimes, has a pet, no smoking | 9 | 28 | Yes |
| demo-p71 | Tess | Master's student in social impact management | Moody Street, South Side | Jun 2027 | $1,250–$1,500 | 12 mo, 2 rooms | night owl, relaxed tidiness, some noise, guests sometimes, OK with pets, no smoking | 4 | 36 | Yes |
| demo-p72 | Eamon | Master's student in Jewish professional leadership, 2nd year | South Side, Downtown, Moody Street | Sep 2027 | $800–$1,400 | 12 mo, 2 rooms, must: month | night owl, average tidiness, lively, guests often, no pets, no smoking | 3 | 15 | Yes |
| demo-p73 | Adaeze | Master's student in Jewish professional leadership | Downtown, South Side | Sep 2027 | $900–$1,500 | 12 mo, 2 rooms, must: month, must: area | flexible sleep, average tidiness, some noise, guests sometimes, no pets, no smoking | 3 | 14 | Yes |
| demo-p74 | Liam | Incoming PhD student in history | Warrendale, near Brandeis | Aug 2027 | $750–$1,350 | 12 mo, 1 room, furnished, ≤1.5 km | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 7 | 55 | Yes |
| demo-p75 | Anika | Master's student in genetic counseling, 2nd year | Warrendale, near Brandeis | Aug 2027 | $600–$1,100 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 6 | 38 | Yes |
| demo-p76 | Zain | Master's student in social impact management, 2nd year | near Brandeis, Warrendale | Feb 2027 | $700–$1,250 | 7 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 4 | 5 | Yes |
| demo-p77 | Jade | Master's student in conflict resolution and coexistence, 2nd year | South Side, Moody Street, Downtown | Jun 2027 | $500–$1,000 | 3 mo, 1 room, furnished, must: month, must: area | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 4 | 6 | Yes |
| demo-p78 | Hiro | MBA student, 2nd year | Downtown, Moody Street, South Side | Jun 2027 | $800–$1,350 | 12 mo, 1 room, must: month | flexible sleep, average tidiness, some noise, guests often, no pets, no smoking | 12 | 38 | Yes |
| demo-p79 | Ilana | PhD student in biophysics, 4th year | near Brandeis, Warrendale | Jun 2027 | $850–$1,400 | 12 mo, 1 room, must: month | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 8 | 30 | Yes |
| demo-p80 | Wren | PhD student in anthropology, 2nd year | Prospect Hill, The Highlands | Jan 2027 | $950–$1,250 | 5 mo, 1 room, furnished | flexible sleep, average tidiness, quiet, guests sometimes, no pets, no smoking | 4 | 11 | Yes |
| demo-p81 | Jasper | Master's student in computer science | South Side, Moody Street | Jun 2027 | $500–$1,050 | 3 mo, 1 room, furnished | night owl, very tidy, some noise, guests sometimes, no pets, no smoking | 4 | 12 | Yes |
| demo-p82 | Camila | PhD student in anthropology, 4th year | near Brandeis, Warrendale | Jun 2027 | $900–$1,400 | 12 mo, 1 room | flexible sleep, very tidy, lively, guests sometimes, OK with pets, no smoking | 8 | 47 | Yes |
| demo-p83 | Nia | Senior in psychology | Downtown, Moody Street | Jul 2027 | $750–$1,350 | 12 mo, 1 room, must: area | night owl, very tidy, some noise, guests often, OK with pets, no smoking | 11 | 27 | Yes |
| demo-p84 | Paloma | PhD student in mathematics, 1st year | Downtown, Prospect Hill, The Highlands | Sep 2027 | $950–$1,350 | 12 mo, 1 room | night owl, average tidiness, lively, guests sometimes, no pets, no smoking | 7 | 31 | Yes |
| demo-p85 | Owen | Senior in film and media | Lakeview, Prospect Hill | Jun 2027 | $700–$1,250 | 12 mo, 1 room, must: area | early, average tidiness, quiet, guests rarely, OK with pets, no smoking | 3 | 7 | Yes |
| demo-p86 | Elif | PhD student in structural biology, 5th year | Prospect Hill, The Highlands, Lakeview | Aug 2027 | $1,050–$1,300 | 12 mo, 1 room, must: area | flexible sleep, very tidy, quiet, guests rarely, no pets, no smoking | 7 | 19 | Yes |
| demo-p87 | Harper | Master's student in sustainable international development | South Side, Moody Street, Downtown | Jun 2027 | $750–$1,150 | 3 mo, 1 room, furnished, must: month, must: area | flexible sleep, very tidy, lively, guests often, OK with pets, no smoking | 4 | 6 | Yes |
| demo-p88 | Aurora | PhD student in economics, 2nd year | The Highlands, Prospect Hill, Lakeview | Jul 2027 | $950–$1,350 | 12 mo, 1 room, must: area | flexible sleep, very tidy, some noise, guests sometimes, no pets, no smoking | 7 | 17 | Yes |
| demo-p89 | Hannah | Incoming PhD student in philosophy | near Brandeis, Warrendale | Sep 2027 | $650–$1,300 | 12 mo, 1 room, must: area | early, very tidy, some noise, guests sometimes, has a pet, no smoking | 12 | 18 | Yes |
| demo-p90 | Farah | PhD student in biochemistry, 2nd year | Warrendale, near Brandeis | Jun 2027 | $750–$1,250 | 12 mo, 1 room | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking | 7 | 42 | Yes |
| demo-p91 | Dalia | Incoming master's student in genetic counseling | Warrendale, near Brandeis | Aug 2027 | $1,150–$1,400 | 12 mo, 1 room, furnished | night owl, relaxed tidiness, lively, guests often, OK with pets, no smoking | 7 | 26 | Yes |
| demo-p92 | Leo | Senior in economics | The Highlands, Prospect Hill | Aug 2027 | $900–$1,550 | 12 mo, 1 room, must: month, must: area | flexible sleep, very tidy, some noise, guests sometimes, no pets, no smoking | 8 | 12 | Yes |
| demo-p93 | Fatima | PhD student in structural biology, 1st year | near Brandeis, Warrendale | Jan 2027 | $800–$1,150 | 5 mo, 1 room, furnished, must: month | flexible sleep, average tidiness, some noise, guests sometimes, no pets, no smoking | 3 | 12 | Yes |
| demo-p94 | Rafael | Senior in chemistry | Downtown, Moody Street, South Side | Sep 2027 | $550–$800 | 9 mo, 1 room, must: area | early, average tidiness, quiet, guests rarely, no pets, no smoking | 3 | 7 | Yes |
| demo-p95 | Valentina | Senior in physics and history | Warrendale, near Brandeis | Aug 2027 | $850–$1,250 | 12 mo, 2 rooms | night owl, relaxed tidiness, some noise, guests sometimes, no pets, no smoking | 4 | 39 | Yes |
| demo-p96 | Galen | Visiting master's student in teaching | near Brandeis, Warrendale | Jan 2027 | $650–$1,150 | 5 mo, 1 room, furnished | early, very tidy, quiet, guests rarely, no pets, no smoking | 3 | 10 | Yes |
| demo-p97 | Malik | PhD student in biochemistry, 2nd year | The Highlands, Prospect Hill, Warrendale | Aug 2027 | $900–$1,550 | 12 mo, 1 room, must: month, must: area | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 11 | 31 | Yes |
| demo-p98 | Eden | Senior in education studies and economics | Warrendale, near Brandeis, The Highlands | Aug 2027 | $600–$1,000 | 9 mo, 1 room, must: month | flexible sleep, average tidiness, lively, guests often, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p99 | Basil | PhD student in social policy, 1st year | Moody Street, South Side | Jun 2027 | $1,150–$1,400 | 12 mo, 2 rooms, must: area | night owl, average tidiness, lively, guests sometimes, has a pet, no smoking | 4 | 22 | Yes |
| demo-p100 | Lucia | Master's student in conflict resolution and coexistence, 2nd year | Prospect Hill, Lakeview | Jun 2027 | $750–$1,150 | 12 mo, 1 room | night owl, relaxed tidiness, some noise, guests often, OK with pets, no smoking | 3 | 32 | Yes |
| demo-p101 | Dov | PhD student in politics, 1st year | Downtown, South Side | Sep 2027 | $1,100–$1,500 | 12 mo, 2 rooms, must: month | flexible sleep, relaxed tidiness, lively, guests often, has a pet, no smoking | 3 | 13 | Yes |
| demo-p102 | Daniela | Senior in theater arts | near Brandeis, Warrendale | Aug 2027 | $800–$1,150 | 12 mo, 1 room | night owl, average tidiness, some noise, guests sometimes, no pets, smoking outside OK | 7 | 41 | Yes |
| demo-p103 | Juno | Master's student in social impact management | Downtown, Moody Street | Sep 2027 | $500–$1,000 | 9 mo, 1 room | flexible sleep, relaxed tidiness, lively, guests often, no pets, no smoking | 5 | 12 | Yes |
| demo-p104 | Rina | Master's student in conflict resolution and coexistence | near Brandeis, Warrendale | Aug 2027 | $500–$1,150 | 12 mo, 1 room | early, relaxed tidiness, lively, guests often, OK with pets, no smoking | 7 | 36 | Yes |
| demo-p105 | Rania | Master's student in global health policy, 2nd year | Moody Street, Downtown | Jul 2027 | $850–$1,300 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, OK with pets, smoking outside OK | 11 | 53 | Yes |
| demo-p106 | Kofi | PhD student in chemistry, 4th year | Warrendale, near Brandeis | Feb 2027 | $650–$1,250 | 7 mo, 1 room | night owl, very tidy, quiet, guests rarely, OK with pets, no smoking | 4 | 5 | Yes |
| demo-p107 | Wen | Senior in psychology | Warrendale, near Brandeis, The Highlands | Aug 2027 | $550–$900 | 12 mo, 1 room, must: month | flexible sleep, average tidiness, lively, guests often, has a pet, no smoking | 3 | 16 | Yes |
| demo-p108 | Thea | PhD student in English, 6th year | within 2 km | Feb 2027 | $800–$1,100 | 7 mo, 1 room, ≤2 km | night owl, average tidiness, some noise, guests sometimes, no pets, no smoking | 3 | 4 | Yes |
| demo-p109 | Ines | Senior in music | near Brandeis, Warrendale | Aug 2027 | $850–$1,100 | 12 mo, 1 room, must: month | flexible sleep, very tidy, some noise, guests rarely, no pets, no smoking | 6 | 27 | Yes |
| demo-p110 | Lina | Senior in East Asian studies | Prospect Hill, Lakeview | Jun 2027 | $700–$1,150 | 12 mo, 1 room, must: month | night owl, very tidy, some noise, guests sometimes, OK with pets, no smoking | 3 | 36 | Yes |
| demo-p111 | Diego | Senior in Hispanic studies | Prospect Hill, Lakeview | Jun 2027 | $850–$1,300 | 12 mo, 1 room, must: area | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 3 | 8 | Yes |
| demo-p112 | Gael | PhD student in molecular and cell biology, 4th year | near Brandeis, Warrendale, The Highlands | Aug 2027 | $800–$1,450 | 12 mo, 2 rooms | flexible sleep, very tidy, lively, guests often, no pets, no smoking | 5 | 45 | Yes |
| demo-p113 | Sora | MBA student, 2nd year | Downtown, Moody Street | Jul 2027 | $1,300–$1,800 | 12 mo, 1 room, must: month, must: area | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 14 | 9 | Yes |
| demo-p114 | Dami | Senior in sociology | The Highlands, Prospect Hill, Warrendale | Aug 2027 | $950–$1,450 | 12 mo, 1 room | early, relaxed tidiness, quiet, guests sometimes, OK with pets, no smoking | 11 | 47 | Yes |
| demo-p115 | Anaya | Senior in environmental studies | Downtown, Moody Street, South Side | Sep 2027 | $550–$850 | 9 mo, 1 room, must: area | early, average tidiness, some noise, guests sometimes, has a pet, no smoking | 3 | 7 | Yes |
| demo-p116 | Zev | PhD student in biochemistry, 5th year | Prospect Hill, Downtown | Sep 2027 | $800–$1,350 | 12 mo, 1 room, must: area | early, very tidy, quiet, guests sometimes, no pets, smoking outside OK | 6 | 15 | Yes |
| demo-p117 | Lars | Senior in physics | Moody Street, South Side, Downtown | Jun 2027 | $850–$1,100 | 3 mo, 1 room, furnished | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 4 | 12 | Yes |
| demo-p118 | Vera | PhD student in philosophy, 3rd year | The Highlands, Prospect Hill | Aug 2027 | $750–$1,400 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests rarely, OK with pets, no smoking | 7 | 29 | Yes |
| demo-p119 | Jamal | PhD student in philosophy, 6th year | Warrendale, near Brandeis | May 2027 | $1,000–$1,450 | 12 mo, 1 room, ≤1.5 km, must: month, must: area | flexible sleep, very tidy, quiet, guests sometimes, OK with pets, no smoking | 5 | 6 | Yes |
| demo-p120 | Chidi | Senior in theater arts | Moody Street, Downtown | Jun 2027 | $850–$1,200 | 12 mo, 3 rooms | flexible sleep, very tidy, lively, guests sometimes, no pets, no smoking | 4 | 50 | Yes |
| demo-p121 | Ahmed | Master's student in Jewish professional leadership | The Highlands, Prospect Hill | Jul 2027 | $1,100–$1,350 | 12 mo, 1 room, must: month, must: area | early, average tidiness, quiet, guests sometimes, OK with pets, no smoking | 6 | 5 | Yes |
| demo-p122 | Maya | Incoming master's student in data science | Warrendale, near Brandeis | Aug 2027 | $1,100–$1,400 | 12 mo, 1 room, furnished, must: area | flexible sleep, very tidy, some noise, guests often, no pets, no smoking | 7 | 26 | Yes |
| demo-p123 | Freya | PhD student in social policy, 2nd year | near Brandeis, Warrendale | Jun 2027 | $1,050–$1,400 | 12 mo, 1 room | early, very tidy, lively, guests sometimes, OK with pets, no smoking | 8 | 42 | Yes |
| demo-p124 | Cedric | MBA student, 1st year | Moody Street, Downtown | Jul 2027 | $1,100–$1,750 | 12 mo, 1 room, must: month | night owl, relaxed tidiness, quiet, guests often, OK with pets, no smoking | 14 | 16 | Yes |
| demo-p125 | Grace | Senior in mathematics | near Brandeis, Warrendale | Jun 2027 | $1,000–$1,400 | 12 mo, 1 room, ≤1.5 km | early, very tidy, quiet, guests rarely, no pets, no smoking | 8 | 39 | Yes |
| demo-p126 | Noa | Incoming master's student in teaching | near Brandeis, Warrendale | Aug 2027 | $750–$1,350 | 12 mo, 1 room, furnished, ≤1.5 km | night owl, relaxed tidiness, lively, guests rarely, OK with pets, no smoking | 7 | 32 | Yes |
| demo-p127 | Enzo | Master's student in conflict resolution and coexistence, 2nd year | Warrendale, near Brandeis, The Highlands | Jan 2027 | $650–$1,300 | 5 mo, 1 room, furnished, ≤1.5 km, must: month | flexible sleep, very tidy, lively, guests sometimes, no pets, smoking outside OK | 5 | 12 | Yes |
| demo-p128 | Sofia | Visiting master's student in Jewish professional leadership | near Brandeis, Warrendale | Jan 2027 | $700–$1,150 | 5 mo, 1 room, furnished, must: area | night owl, very tidy, some noise, guests often, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p129 | Gia | Senior in politics and anthropology | Moody Street, Downtown, South Side | Sep 2027 | $500–$950 | 9 mo, 1 room | night owl, very tidy, some noise, guests often, OK with pets, smoking outside OK | 5 | 10 | Yes |
| demo-p130 | Mehmet | Master's student in public policy | near Brandeis, Warrendale | Aug 2027 | $950–$1,300 | 12 mo, 2 rooms, ≤1.5 km | night owl, relaxed tidiness, lively, guests often, no pets, smoking outside OK | 5 | 22 | Yes |
| demo-p131 | Carmen | Master's student in business analytics | The Highlands, Lakeview, Prospect Hill | Sep 2027 | $1,600–$1,950 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, has a pet, no smoking | 10 | 5 | Yes |
| demo-p132 | Saanvi | PhD student in economics, 4th year | Warrendale, near Brandeis | Aug 2027 | $650–$1,050 | 12 mo, 1 room, must: month | early, average tidiness, lively, guests often, OK with pets, no smoking | 5 | 30 | Yes |
| demo-p133 | Felix | MBA student, 1st year | Moody Street, Downtown | Jun 2027 | $650–$1,300 | 12 mo, 1 room | night owl, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 9 | 59 | Yes |
| demo-p134 | Kiara | Master's student in public policy | South Side, Downtown | Sep 2027 | $1,200–$1,450 | 12 mo, 2 rooms | night owl, average tidiness, lively, guests sometimes, OK with pets, smoking outside OK | 3 | 26 | Yes |
| demo-p135 | Darius | Master's student in nonprofit management, 2nd year | Prospect Hill, The Highlands | Jul 2027 | $750–$1,300 | 12 mo, 1 room | night owl, average tidiness, quiet, guests rarely, OK with pets, smoking outside OK | 6 | 37 | Yes |
| demo-p136 | Tal | Senior in theater arts | Warrendale, near Brandeis | Aug 2027 | $800–$1,100 | 9 mo, 1 room | flexible sleep, very tidy, some noise, guests often, OK with pets, no smoking | 3 | 11 | Yes |
| demo-p137 | Ayumi | Master's student in sustainable international development | Downtown, Moody Street | Jul 2027 | $800–$1,350 | 12 mo, 1 room | flexible sleep, average tidiness, some noise, guests sometimes, has a pet, no smoking | 11 | 45 | Yes |
| demo-p138 | Dana | Senior in East Asian studies | near Brandeis, Warrendale | Sep 2027 | $750–$1,350 | 12 mo, 1 room, must: month | flexible sleep, relaxed tidiness, some noise, guests rarely, OK with pets, no smoking | 12 | 20 | Yes |
| demo-p139 | Orla | Incoming master's student in public policy | Downtown, Prospect Hill, Lakeview | Sep 2027 | $1,050–$1,400 | 12 mo, 1 room, must: area | early, relaxed tidiness, some noise, guests rarely, OK with pets, no smoking | 7 | 16 | Yes |
| demo-p140 | Olu | PhD student in politics, 5th year | South Side, Moody Street | Jun 2027 | $750–$1,050 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 3 | 37 | Yes |
| demo-p141 | Hamza | Senior in mathematics | Moody Street, Downtown, South Side | Jun 2027 | $850–$1,450 | 12 mo, 1 room | night owl, average tidiness, lively, guests often, has a pet, no smoking | 12 | 35 | Yes |
| demo-p142 | Anya | Master's student in global health policy, 2nd year | The Highlands, Prospect Hill | Aug 2027 | $900–$1,500 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests sometimes, no pets, no smoking | 8 | 25 | Yes |
| demo-p143 | Eun | Senior in business | near Brandeis, Warrendale | Aug 2027 | $750–$1,150 | 12 mo, 1 room, must: area | night owl, relaxed tidiness, some noise, guests sometimes, OK with pets, no smoking | 7 | 29 | Yes |
| demo-p144 | Sunny | PhD student in biochemistry, 4th year | Downtown, Moody Street | Sep 2027 | $600–$1,200 | 9 mo, 1 room | early, average tidiness, lively, guests sometimes, OK with pets, no smoking | 7 | 12 | Yes |
| demo-p145 | Pedro | Master's student in international economics and finance | Lakeview, The Highlands | Sep 2027 | $1,500–$1,900 | 12 mo, 1 room | flexible sleep, very tidy, quiet, guests rarely, no pets, smoking outside OK | 5 | 8 | Yes |
| demo-p146 | Esme | Senior in sociology | Moody Street, Downtown | Jun 2027 | $550–$1,150 | 12 mo, 3 rooms | night owl, relaxed tidiness, lively, guests often, OK with pets, smokes | 3 | 3 | Yes |
| demo-p147 | Mira | Senior in music | Moody Street, Downtown | Sep 2027 | $700–$1,350 | 9 mo, 1 room, must: month | early, very tidy, some noise, guests often, no pets, no smoking | 7 | 10 | Yes |
| demo-p148 | Mateo | Incoming PhD student in anthropology | Downtown, Prospect Hill | Sep 2027 | $800–$1,400 | 12 mo, 1 room, must: month | flexible sleep, average tidiness, quiet, guests rarely, no pets, smoking outside OK | 6 | 20 | Yes |
| demo-p149 | Naomi | PhD student in English, 4th year | within 2 km | Jun 2027 | $500–$1,050 | 3 mo, 1 room, ≤2 km | night owl, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 7 | 9 | Yes |
| demo-p150 | Femi | Senior in music | Warrendale, near Brandeis | Aug 2027 | $800–$1,100 | 9 mo, 1 room, ≤1.5 km, must: month | flexible sleep, average tidiness, quiet, guests rarely, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p151 | Tariq | PhD student in philosophy, 6th year | Moody Street, South Side, Downtown | Jun 2027 | $1,200–$1,550 | 12 mo, 2 rooms | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, smokes | 5 | 6 | Yes |
| demo-p152 | Oren | Senior in music | Moody Street, Downtown | Jun 2027 | $650–$1,250 | 12 mo, 3 rooms, must: month, must: area | night owl, average tidiness, some noise, guests often, OK with pets, no smoking | 4 | 27 | Yes |
| demo-p153 | Amir | Senior in computer science and business | Downtown, Moody Street, South Side | Jun 2027 | $1,100–$1,350 | 12 mo, 3 rooms, must: area | flexible sleep, average tidiness, lively, guests often, no pets, no smoking | 4 | 30 | Yes |
| demo-p154 | Rio | Master's student in computer science | Moody Street, South Side | Jun 2027 | $1,050–$1,450 | 12 mo, 2 rooms, must: month, must: area | early, average tidiness, quiet, guests often, OK with pets, no smoking | 4 | 24 | Yes |
| demo-p155 | Tomas | Master's student in biotechnology, 2nd year | Moody Street, Downtown | Sep 2027 | $550–$850 | 9 mo, 1 room, must: month, must: area | early, very tidy, some noise, guests sometimes, no pets, no smoking | 3 | 9 | Yes |
| demo-p156 | Marco | PhD student in structural biology, 5th year | Moody Street, South Side, Downtown | Jun 2027 | $950–$1,200 | 12 mo, 1 room, must: month | early, relaxed tidiness, some noise, guests sometimes, OK with pets, no smoking | 9 | 40 | Yes |
| demo-p157 | Ibrahim | PhD student in politics, 6th year | South Side, Moody Street | Jun 2027 | $650–$1,300 | 12 mo, 1 room | night owl, very tidy, lively, guests sometimes, has a pet, no smoking | 8 | 36 | Yes |
| demo-p158 | Gideon | PhD student in philosophy, 4th year | Warrendale, near Brandeis, The Highlands | Jun 2027 | $1,050–$1,450 | 12 mo, 1 room | early, very tidy, quiet, guests often, no pets, no smoking | 9 | 40 | Yes |
| demo-p159 | Bao | PhD student in neuroscience, 6th year | Prospect Hill, The Highlands | Aug 2027 | $800–$1,450 | 12 mo, 1 room, must: month | early, relaxed tidiness, lively, guests sometimes, OK with pets, no smoking | 8 | 31 | Yes |
| demo-p160 | Mara | Master's student in international economics and finance | Downtown, Moody Street | Jul 2027 | $700–$1,200 | 12 mo, 1 room, must: area | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 9 | 26 | Yes |
| demo-p161 | Moses | Master's student in social impact management, 2nd year | South Side, Moody Street | Jun 2027 | $850–$1,450 | 12 mo, 2 rooms, must: area | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 4 | 37 | Yes |
| demo-p162 | Taye | PhD student in anthropology, 1st year | near Brandeis, Warrendale, The Highlands | Aug 2027 | $800–$1,250 | 12 mo, 2 rooms, must: area | flexible sleep, very tidy, some noise, guests rarely, OK with pets, no smoking | 4 | 43 | Yes |
| demo-p163 | Zara | Incoming PhD student in biochemistry | Downtown, Prospect Hill | Sep 2027 | $1,100–$1,400 | 12 mo, 1 room, must: month | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 6 | 22 | Yes |
| demo-p164 | Ezra | PhD student in biophysics, 5th year | Warrendale, near Brandeis | Aug 2027 | $950–$1,300 | 12 mo, 1 room, furnished, ≤1.5 km, must: area | early, relaxed tidiness, some noise, guests sometimes, OK with pets, smoking outside OK | 7 | 30 | Yes |
| demo-p165 | Andre | Incoming master's student in data science | Warrendale, near Brandeis | Sep 2027 | $750–$1,100 | 12 mo, 1 room, must: area | early, very tidy, some noise, guests often, OK with pets, no smoking | 8 | 22 | Yes |
| demo-p166 | Nate | Senior in business | near Brandeis, Warrendale | Sep 2027 | $1,000–$1,300 | 12 mo, 1 room, must: month, must: area | early, average tidiness, quiet, guests sometimes, OK with pets, smoking outside OK | 12 | 8 | Yes |
| demo-p167 | Mei | Senior in African and African American studies | Warrendale, near Brandeis | Feb 2027 | $750–$1,250 | 7 mo, 1 room | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 4 | 5 | Yes |
| demo-p168 | Leah | Master's student in computer science | Warrendale, near Brandeis, The Highlands | Aug 2027 | $650–$1,250 | 12 mo, 2 rooms, must: area | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 4 | 48 | Yes |
| demo-p169 | Paolo | Senior in physics | Moody Street, Downtown | Jul 2027 | $1,000–$1,250 | 12 mo, 1 room, must: area | night owl, average tidiness, some noise, guests often, has a pet, no smoking | 10 | 22 | Yes |
| demo-p170 | Niko | Senior in film and media | near Brandeis, Warrendale, The Highlands | Jun 2027 | $700–$1,100 | 3 mo, 1 room, ≤1.5 km | night owl, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 9 | Yes |
| demo-p171 | Zoe | Master's student in Jewish professional leadership, 2nd year | Moody Street, South Side | Jun 2027 | $1,150–$1,400 | 12 mo, 2 rooms | early, average tidiness, some noise, guests sometimes, no pets, no smoking | 4 | 47 | Yes |
| demo-p172 | Santiago | Senior in education studies | near Brandeis, Warrendale, The Highlands | Sep 2027 | $750–$1,250 | 12 mo, 1 room | early, average tidiness, some noise, guests rarely, has a pet, no smoking | 12 | 28 | Yes |
| demo-p173 | Javier | Master's student in global health policy | Prospect Hill, The Highlands | Jan 2027 | $700–$1,100 | 5 mo, 1 room, furnished | flexible sleep, very tidy, some noise, guests rarely, OK with pets, no smoking | 4 | 11 | Yes |
| demo-p174 | Soren | PhD student in English, 6th year | Lakeview, The Highlands | Sep 2027 | $1,550–$2,000 | 12 mo, 1 room | flexible sleep, average tidiness, some noise, guests rarely, OK with pets, no smoking | 6 | 8 | Yes |
| demo-p175 | Ellis | Master's student in teaching, 2nd year | South Side, Moody Street | Jun 2027 | $850–$1,300 | 12 mo, 1 room | early, very tidy, some noise, guests rarely, no pets, no smoking | 8 | 46 | Yes |
| demo-p176 | Lucy | Master's student in social impact management, 2nd year | Prospect Hill, Downtown, Lakeview | Sep 2027 | $750–$1,400 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests often, no pets, smoking outside OK | 7 | 19 | Yes |
| demo-p177 | Dmitri | Master's student in public policy | Warrendale, near Brandeis | Jun 2027 | $500–$1,050 | 3 mo, 1 room | early, average tidiness, some noise, guests rarely, OK with pets, smoking outside OK | 3 | 9 | Yes |
| demo-p178 | Mabel | Master's student in genetic counseling | The Highlands, Prospect Hill | Aug 2027 | $900–$1,500 | 12 mo, 1 room, must: month | early, very tidy, some noise, guests sometimes, no pets, smoking outside OK | 8 | 25 | Yes |
| demo-p179 | Simone | Master's student in teaching, 2nd year | within 2 km | Jun 2027 | $800–$1,450 | 12 mo, 1 room, ≤2 km | flexible sleep, very tidy, quiet, guests rarely, OK with pets, no smoking | 23 | 44 | Yes |
| demo-p180 | Beto | Master's student in social impact management | South Side, Moody Street | Jun 2027 | $1,000–$1,300 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, no pets, no smoking | 8 | 48 | Yes |
| demo-p181 | Laila | PhD student in computer science, 3rd year | Lakeview, The Highlands | Sep 2027 | $1,750–$2,050 | 12 mo, 1 room | night owl, relaxed tidiness, quiet, guests sometimes, OK with pets, no smoking | 6 | 5 | Yes |
| demo-p182 | Luis | Incoming master's student in data science | Warrendale, near Brandeis | Sep 2027 | $750–$1,300 | 12 mo, 1 room | early, average tidiness, quiet, guests sometimes, OK with pets, no smoking | 12 | 37 | Yes |
| demo-p183 | Shira | Senior in neuroscience | Downtown, Moody Street | Jun 2027 | $950–$1,300 | 12 mo, 1 room, must: area | early, relaxed tidiness, lively, guests sometimes, no pets, no smoking | 9 | 27 | Yes |
| demo-p184 | Chen | Senior in English | Warrendale, near Brandeis | Sep 2027 | $700–$1,200 | 12 mo, 1 room, ≤1.5 km | night owl, average tidiness, quiet, guests often, OK with pets, no smoking | 11 | 34 | Yes |
| demo-p185 | Rahul | Senior in anthropology | Downtown, Moody Street | Sep 2027 | $700–$950 | 9 mo, 1 room, must: area | night owl, relaxed tidiness, lively, guests often, OK with pets, no smoking | 5 | 8 | Yes |
| demo-p186 | Yara | PhD student in chemistry, 3rd year | Warrendale, near Brandeis | Jun 2027 | $500–$1,150 | 3 mo, 1 room | flexible sleep, very tidy, quiet, guests rarely, OK with pets, no smoking | 3 | 8 | Yes |
| demo-p187 | Imani | Incoming master's student in global health policy | near Brandeis, Warrendale | Aug 2027 | $1,100–$1,350 | 12 mo, 1 room, furnished | flexible sleep, average tidiness, some noise, guests rarely, no pets, no smoking | 7 | 45 | Yes |
| demo-p188 | Emil | Senior in chemistry | near Brandeis, Warrendale | May 2027 | $950–$1,250 | 12 mo, 1 room, must: area | early, average tidiness, some noise, guests sometimes, no pets, no smoking | 5 | 14 | Yes |
| demo-p189 | Ulises | Master's student in Jewish professional leadership | Moody Street, South Side | Jun 2027 | $800–$1,150 | 3 mo, 1 room, furnished | early, average tidiness, some noise, guests rarely, OK with pets, smoking outside OK | 4 | 12 | Yes |
| demo-p190 | Yael | Master's student in nonprofit management | Downtown, Moody Street | Jun 2027 | $650–$1,150 | 12 mo, 3 rooms, must: month | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 40 | Yes |
| demo-p191 | Lior | Master's student in computer science | Warrendale, near Brandeis | Feb 2027 | $600–$1,100 | 7 mo, 1 room | night owl, average tidiness, some noise, guests sometimes, no pets, no smoking | 3 | 5 | Yes |
| demo-p192 | Bruno | Senior in music | Downtown, Moody Street | Sep 2027 | $700–$1,300 | 9 mo, 1 room, must: month | flexible sleep, average tidiness, lively, guests sometimes, OK with pets, no smoking | 7 | 12 | Yes |
| demo-p193 | Jin | Senior in Hispanic studies | Moody Street, Downtown, South Side | Jul 2027 | $850–$1,300 | 12 mo, 1 room, must: month | flexible sleep, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK | 14 | 14 | Yes |
| demo-p194 | Aiko | Senior in sociology | near Brandeis, Warrendale | Jun 2027 | $650–$1,000 | 3 mo, 1 room, must: month | night owl, very tidy, quiet, guests rarely, OK with pets, no smoking | 3 | 8 | Yes |
| demo-p195 | Aisha | Master's student in business analytics | Moody Street, Downtown | Jul 2027 | $850–$1,250 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 10 | 56 | Yes |
| demo-p196 | Isaac | Senior in mathematics | Warrendale, near Brandeis, The Highlands | Aug 2027 | $850–$1,200 | 9 mo, 1 room, must: month, must: area | night owl, relaxed tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 5 | Yes |
| demo-p197 | Jaya | Master's student in biotechnology | Moody Street, South Side | Jun 2027 | $700–$1,100 | 3 mo, 1 room, furnished, must: month | flexible sleep, relaxed tidiness, lively, guests sometimes, OK with pets, smoking outside OK | 4 | 9 | Yes |
| demo-p198 | Arjun | Incoming master's student in business analytics | near Brandeis, Warrendale | May 2027 | $850–$1,250 | 12 mo, 1 room, ≤1.5 km, must: month | flexible sleep, very tidy, quiet, guests sometimes, OK with pets, no smoking | 5 | 6 | Yes |
| demo-p199 | Abby | Master's student in computer science | Downtown, Moody Street, South Side | Jun 2027 | $850–$1,300 | 12 mo, 3 rooms, must: month | flexible sleep, average tidiness, lively, guests often, no pets, no smoking | 4 | 38 | Yes |
| demo-p200 | Elena | PhD student in anthropology, 6th year | The Highlands, Lakeview | Sep 2027 | $1,600–$2,050 | 12 mo, 1 room | flexible sleep, very tidy, quiet, guests rarely, OK with pets, no smoking | 6 | 6 | Yes |
