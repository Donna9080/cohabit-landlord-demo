# Demo data (Demo mode)

Demo mode lets anyone try coHabit with made-up listings and roommates. This file is written by
`npm run demo:report` (scripts/demo-report.mjs) from the data itself, so the numbers below are the data's.

- **What:** 50 fictional room listings and 50 fictional roommate profiles, all in Waltham, plus
  3 profiles that chose not to be found (never shown; they show that rule working). Of the 100 listings and
  200 profiles written, 52 profiles were taken out on 2026-11-15 (`REMOVED_PEOPLE`) and 50 listings and
  95 profiles archived on 2026-11-16 (`ARCHIVED_LISTINGS`, `ARCHIVED_PEOPLE`, both in
  [`src/assistant/demo-data.js`](../src/assistant/demo-data.js); see "Archived records" below). Their records stay in the
  files below, so any of them can be restored.
- **Where it lives:** in code, never in the database: the first 15 listings and 20 profiles are written by hand in
  [`src/assistant/demo-base.js`](../src/assistant/demo-base.js); the other 85 listings and 180 profiles are written to
  [`src/assistant/demo-generated.js`](../src/assistant/demo-generated.js) by [`scripts/demo-build.mjs`](../scripts/demo-build.mjs). Every id starts with `demo-`.
- **Labels:** every demo profile says "Demo profile • Fictional details." and every demo listing "Demo listing • Not
  currently available." Profiles have no photo (initials); listings have an illustrative photo or coHabit's drawing.
- **Where it shows:** only while Demo mode is on, always labeled: Listings (all demo listings with filters, map, Details
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
| Archive or restore a record | Add or delete its line in `ARCHIVED_LISTINGS` / `ARCHIVED_PEOPLE` (`src/assistant/demo-data.js`); `npm test` then says whether every shown profile still has 3+ rooms and roommates and every room a renter |
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
| Each shown profile has 3+ suitable rooms | 3 / 5 / 16 rooms per profile (plus 15 partial matches at the median) |
| Each shown profile has 3+ mutually compatible roommates | 3 / 11 / 22 (the matching code alone allows 3 / 19 / 29) |
| Strong matches (score 90+, the "Strong match" label) | 22 of 50 profiles have 3+, 45 have at least one (not a target; owner's decision 2026-11-16) |
| Each room suits 1+ shown profile | 1 / 5 / 16 visible profiles per room |
| An incompatible pair never scores 60+ | highest 59 across 816 incompatible pairs |
| Targets missed | 0 |

Not everyone matches everyone. Of the 2,185 reasons counted across pairs of visible profiles
(a pair can have several), 268 pairs are compatible; the rest fail on:
move-in months more than a month apart (698), lease lengths more than a month apart (488), a must-have move-in month that differs (318), a must-have area the other isn't looking in (223), one smokes and the other wants no smoking (86), lifestyle answers too far apart (score under 60) (68), budgets don't overlap (22), one has a pet and the other wants no pets (14).

Listings by kind: Private room 26, Studio 4, Sublet 6, Shared room 1, Whole apartment 6, Replacing a roommate 5, Lease takeover 2. By neighborhood: Moody Street 9, Downtown 9, The Highlands 4, near Brandeis 10, Prospect Hill 7, South Side 2, Warrendale 9.

How coverage is reached without bending rules: the data is built in groups of people who want the same thing (month,
lease, neighborhoods, furnishing, rooms), with rooms made for each group; rents are set so each room is within budget for
at least three of them and each person can afford at least three rooms. Lifestyles are drawn at random per group and
redrawn for anyone left with fewer than three compatible people. Groups overlap where answers line up.

## How the 50 listings and 50 profiles were chosen (2026-11-16)

With the owner's approval, Demo mode keeps the strongest 50 of each; the rest are archived, not deleted.

- **Rules every kept record meets:** every shown profile has 3+ mutually compatible kept roommates and 3+ kept rooms
  that match everything it asked for; every kept listing suits at least one kept profile; no listing repeats another's
  description word for word, has a move-in date already passed or costs over $1,700 per person; no profile budgets over
  $1,800; all in Waltham.
- **Then the best balance** (a computer search over many selections): more strong matches, roommates and rooms per
  profile and renters per room; a mix of programs, move-in months, sleep, tidiness, noise, guests and pets; a mix of room
  kinds (private and shared rooms, sublets, studios, whole apartments, lease takeovers, joining a group house); as few
  repeated photos as possible.
- **Kept together on purpose:** the one-semester exchange students (January to May) with their spring sublets, and the
  one shared room with the September renters on small budgets it suits.
- **Smokers swapped in (owner's request, the same day):** none of the first 50 smoked, so Gus and Ahmed, who both smoke,
  replaced Jules and Carmen (a senior and a Master's student like them; nobody else loses their only strong match).
  One swap wasn't enough: each smoker needs 3 kept roommates who don't want no smoking, so they need each other.
  Rania, the third smoker, has too few compatible roommates among the kept profiles to come back.
- **Not checked, because the data has no such fields:** gender, age, background, nationality, international or local.
  Nothing was guessed from names.
- **Archived listings:** not chosen 40, duplicate of demo-08 3, over $1,700 per person 2, move-in date passed 2, duplicate of demo-73 1, duplicate of demo-87 1, duplicate of demo-75 1.
- **Archived profiles:** not chosen 68, fewer than 3 suitable rooms 15, fewer than 3 compatible roommates 5, budget over $1,800 5, swapped out for the smokers demo-p07 and demo-p121 2.

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
  area "Waltham", every Waltham listing is "in your area": for a June renter with a $1,300 budget, 16 of 50 demo
  listings match, 0 of them more than a month from June (all at 80%). The assistant doesn't do this (it needs the month
  within a month, or within three months when the month is flexible). This is the documented rule in `src/match.js` and
  affects real matches too, so it's left as is; requiring the month within a month would fix it.

## 20 representative searches

Room searches use the assistant's search with the answers shown (budget a must-have unless flexible; a distance is a
must-have when given; area and month flexible unless marked). "Partly" means the room meets every must-have but misses
something flexible, and the card says what. Roommate searches compare the answers with the 50 visible profiles.

### 1. Strong: A room in Waltham from June 2027, up to $1,300, a 12-month lease

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 32 of 50 rooms fit the must-haves: 16 match everything, 16 partly.
- **Hidden by must-haves:** 18 (budget 10, move-in month 8; a room can fail more than one).
- **First three:** demo-64 Group house near Waltham Common needs a fifth (matches everything); demo-75 Bright furnished room on the South Side (matches everything); demo-27 Furnished room with a desk near Waltham Common (matches everything).
- **Offered, never applied without the renter:** Consider a move-in month more than 3 months away (+8).

### 2. Strong: Furnished, near Brandeis or Warrendale, from August 2027, up to $1,300, 12 months

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 32 of 50 rooms fit the must-haves: 4 match everything, 28 partly.
- **Hidden by must-haves:** 18 (budget 10, move-in month 8; a room can fail more than one).
- **First three:** demo-62 Furnished room in Warrendale (matches everything); demo-81 Bright furnished room in Warrendale (matches everything); demo-84 Furnished corner room near the Brandeis stop (matches everything).
- **Offered, never applied without the renter:** Consider a move-in month more than 3 months away (+8).

### 3. Strong: Academic year from September 2027, Downtown or Moody Street, up to $1,000

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 8 of 50 rooms fit the must-haves: 2 match everything, 6 partly.
- **Hidden by must-haves:** 42 (budget 34, move-in month 13; a room can fail more than one).
- **First three:** demo-08 Shared bedroom for budget savers (matches everything); demo-17 Join a friendly house near Moody Street (matches everything); demo-64 Group house near Waltham Common needs a fifth (partial: Available from Jun 1, 2027, 3 months before you want to move in (ask whether the start can be later)).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,100) (+10); Consider a move-in month more than 3 months away (+8).

### 4. Strong: Two friends: 2 rooms from June 2027, up to $1,400 each, South Side or Moody Street

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 7 of 50 rooms fit the must-haves: 3 match everything, 4 partly.
- **Hidden by must-haves:** 43 (rooms 41, budget 6, move-in month 8; a room can fail more than one).
- **First three:** demo-36 Two open rooms near Moody Street (matches everything); demo-51 Whole two-bedroom near Moody Street (matches everything); demo-43 Two-bedroom apartment on the South Side (matches everything).
- **Offered, never applied without the renter:** Look for fewer than 2 rooms in one place (+29).

### 5. Strong: Three friends: 3 rooms from June 2027, up to $1,200 each, Downtown

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 3 of 50 rooms fit the must-haves: 2 match everything, 1 partly.
- **Hidden by must-haves:** 47 (rooms 47, budget 10, move-in month 8; a room can fail more than one).
- **First three:** demo-35 Three rooms in a five-bedroom near the commuter rail (matches everything); demo-10 Whole three-bedroom near Waltham Common (matches everything); demo-94 Whole three-bedroom by the Riverwalk (partial: In Waltham, MA (Moody Street), not one of your areas (Downtown)).
- **Offered, never applied without the renter:** Look for fewer than 3 rooms in one place (+29).

### 6. Strong: Furnished spring sublet from January 2027, about 5 months, up to $1,100, Prospect Hill or the Highlands

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 8 of 50 rooms fit the must-haves: 4 match everything, 4 partly.
- **Hidden by must-haves:** 42 (budget 20, move-in month 42; a room can fail more than one).
- **First three:** demo-18 Spring sublet on Prospect Hill (matches everything); demo-04 Spring sublet in a four-bedroom (matches everything); demo-53 Furnished corner room in the Highlands (matches everything).
- **Offered, never applied without the renter:** Consider a move-in month more than 3 months away (+22).

### 7. Partial: From July 2027 in the Highlands (flexible area), up to $1,200, 12 months

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 29 of 50 rooms fit the must-haves: 0 match everything, 29 partly.
- **Hidden by must-haves:** 21 (budget 13, move-in month 8; a room can fail more than one).
- **First three:** demo-22 Furnished room in the Highlands (partial: Available Aug 1, 2027, 1 month after you want to move in); demo-50 Second-floor room near Prospect Hill Park (partial: In Waltham, MA (Prospect Hill), not one of your areas (The Highlands)); demo-90 Furnished room near the commuter rail (partial: In Waltham, MA (Downtown), not one of your areas (The Highlands)).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,320) (+3); Consider a move-in month more than 3 months away (+8).

### 8. Partial: Near Brandeis from May 2027 (flexible month), up to $1,250

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 25 of 50 rooms fit the must-haves: 1 match everything, 24 partly.
- **Hidden by must-haves:** 25 (budget 12, move-in month 13; a room can fail more than one).
- **First three:** demo-19 Sunny room near the Brandeis stop (matches everything); demo-25 Bright furnished room near campus (partial: Available Jun 1, 2027, 1 month after you want to move in); demo-46 Group house a short walk from campus needs a fifth (partial: Available Aug 1, 2027, 3 months after you want to move in).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,375) (+2); Consider a move-in month more than 3 months away (+13).

### 9. Partial: Moody Street from June 2027, up to $1,300, wants furnished

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 32 of 50 rooms fit the must-haves: 0 match everything, 32 partly.
- **Hidden by must-haves:** 18 (budget 10, move-in month 8; a room can fail more than one).
- **First three:** demo-01 Private room in a four-bedroom house (partial: Not furnished); demo-92 Top-floor room off Moody Street (partial: Not furnished); demo-36 Two open rooms near Moody Street (partial: Not furnished).
- **Offered, never applied without the renter:** Consider a move-in month more than 3 months away (+8).

### 10. Partial: South Side from June 2027, budget $1,000 but flexible

- **Must-haves:** none (budget flexible); rooms needed always.
- **Result:** 22 of 50 rooms fit the must-haves: 1 match everything, 21 partly.
- **Hidden by must-haves:** 28 (budget 20, move-in month 8; a room can fail more than one).
- **First three:** demo-75 Bright furnished room on the South Side (matches everything); demo-64 Group house near Waltham Common needs a fifth (partial: In Waltham, MA (Downtown), not one of your areas (South Side)); demo-27 Furnished room with a desk near Waltham Common (partial: In Waltham, MA (Downtown), not one of your areas (South Side)).
- **Offered, never applied without the renter:** Raise your budget above $1,100 (+20); Consider a move-in month more than 3 months away (+8).

### 11. Partial: Summer only (3 months) from June 2027, up to $1,050, Waltham

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 17 of 50 rooms fit the must-haves: 0 match everything, 17 partly.
- **Hidden by must-haves:** 33 (budget 26, move-in month 8; a room can fail more than one).
- **First three:** demo-64 Group house near Waltham Common needs a fifth (partial: Join the group's lease, June 2027 to May 2028, not the 3 months you want); demo-75 Bright furnished room on the South Side (partial: 12-month lease from June, not the 3 months you want); demo-27 Furnished room with a desk near Waltham Common (partial: 12-month lease from June, not the 3 months you want).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,155) (+9); Consider a move-in month more than 3 months away (+7).

### 12. Strict: Within 1 km of Brandeis (must-have), from August 2027, up to $1,000

- **Must-haves:** budget_max, max_distance_km; rooms needed always.
- **Result:** 3 of 50 rooms fit the must-haves: 2 match everything, 1 partly.
- **Hidden by must-haves:** 47 (budget 34, move-in month 8, distance 30; a room can fail more than one).
- **First three:** demo-46 Group house a short walk from campus needs a fifth (matches everything); demo-62 Furnished room in Warrendale (matches everything); demo-83 Housemates in Warrendale need a fourth (partial: Available from May 15, 2027, 3 months before you want to move in (ask whether the start can be later)).
- **Offered, never applied without the renter:** Allow up to 10% over budget (up to $1,100) (+4); Consider a move-in month more than 3 months away (+3); Look farther than 1 km from Brandeis (+7).

### 13. Strict: Lakeview only (must-have area), from June 2027, up to $1,100

- **Must-haves:** budget_max, areas; rooms needed always.
- **Result:** 0 of 50 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 50 (budget 20, move-in month 8, area 50; a room can fail more than one).
- **First three:** none.
- **Offered, never applied without the renter:** Look outside Lakeview (+22).

### 14. Strict: February 2027 only (must-have month), up to $1,100, about 7 months

- **Must-haves:** budget_max, move_in_month; rooms needed always.
- **Result:** 5 of 50 rooms fit the must-haves: 0 match everything, 5 partly.
- **Hidden by must-haves:** 45 (budget 20, move-in month 45; a room can fail more than one).
- **First three:** demo-18 Spring sublet on Prospect Hill (partial: Spring sublet, January to May 2027, not the 7 months you want); demo-04 Spring sublet in a four-bedroom (partial: Spring sublet, mid-January to May 2027, not the 7 months you want); demo-69 Spring semester sublet in Warrendale (partial: Spring sublet, mid-January to mid-May 2027, not the 7 months you want).
- **Offered, never applied without the renter:** Be flexible on the move-in month (up to 3 months either way) (+7).

### 15. Strict: Just for me, Downtown only (must-have), from July 2027, up to $1,700, furnished

- **Must-haves:** budget_max, areas; rooms needed always.
- **Result:** 8 of 50 rooms fit the must-haves: 3 match everything, 5 partly.
- **Hidden by must-haves:** 42 (budget 6, move-in month 8, area 41; a room can fail more than one).
- **First three:** demo-90 Furnished room near the commuter rail (matches everything); demo-03 Furnished studio downtown (matches everything); demo-27 Furnished room with a desk near Waltham Common (matches everything).
- **Offered, never applied without the renter:** Look outside Downtown (+28).

### 16. No match: Up to $600 in Waltham from June 2027

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 0 of 50 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 50 (budget 50, move-in month 8; a room can fail more than one).
- **First three:** none.
- **Offered changes:** none needed or none would help.

### 17. No match: Within 1 km of Brandeis (must-have), from June 2027 (must-have), up to $800

- **Must-haves:** budget_max, max_distance_km, move_in_month; rooms needed always.
- **Result:** 0 of 50 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 50 (budget 49, move-in month 30, distance 30; a room can fail more than one).
- **First three:** none.
- **Offered changes:** none needed or none would help.

### 18. No match: Four rooms in one place from June 2027, up to $1,200 each

- **Must-haves:** budget_max; rooms needed always.
- **Result:** 0 of 50 rooms fit the must-haves: 0 match everything, 0 partly.
- **Hidden by must-haves:** 50 (rooms 50, budget 10, move-in month 8; a room can fail more than one).
- **First three:** none.
- **Offered, never applied without the renter:** Look for fewer than 4 rooms in one place (+32).

### 19. Strong: A roommate for June 2027: early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking, $900–$1,300

- **Result:** 20 of 50 visible profiles are possible roommates: 5 strong (90+), 15 partial. The 3 hidden profiles are never compared.
- **Not a match (first reason each):** lifestyle answers too far apart (score under 60) 3; move-in months more than a month apart 25; one smokes and the other wants no smoking 2.
- **First three:** demo-p01 Ari 100%; demo-p141 Hamza 100%; demo-p09 Ira 95%.

### 20. No match: A roommate moving in November 2027 (nobody in the demo data moves then or a month either side)

- **Result:** 0 of 50 visible profiles are possible roommates: 0 strong (90+), 0 partial. The 3 hidden profiles are never compared.
- **Not a match (first reason each):** move-in months more than a month apart 50.
- **First three:** none.

## Listings

"Suits" counts the visible demo profiles for whom the room matches everything.

| Id | Name | Kind | Area | From Brandeis | Rent | Rooms free | Available | Lease | Furnishing | Photo | Suits |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo-01 | Private room in a four-bedroom house | Private room | Moody Street | 1.8 km | $1,050 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k01 | 15 |
| demo-03 | Furnished studio downtown | Studio | Downtown | 2.2 km | $1,650 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Furnished | s03 | 1 |
| demo-04 | Spring sublet in a four-bedroom | Sublet | The Highlands | 1.8 km | $950 per room | 1 of 4 | Jan 15, 2027 | Spring sublet, mid-January to May 2027 | Furnished | b04 | 7 |
| demo-08 | Shared bedroom for budget savers | Shared room | Downtown | 2.1 km | $700 per bed | 1 of 3 | Sep 1, 2027 | Academic-year lease, September to May | Furnished | h08 | 4 |
| demo-09 | Garden-level room near campus | Private room | near Brandeis | 0.5 km | $1,300 per room | 1 of 3 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | b09 | 4 |
| demo-10 | Whole three-bedroom near Waltham Common | Whole apartment | Downtown | 2 km | $3,450 whole place | 3 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k10 | 3 |
| demo-13 | Small furnished studio in the Highlands | Studio | The Highlands | 1.9 km | $1,450 whole place | 1 of 1 | Aug 1, 2027 | 12-month lease from August | Furnished | s13 | 3 |
| demo-17 | Join a friendly house near Moody Street | Replacing a roommate | Moody Street | 2 km | $900 per room | 1 of 5 | Sep 1, 2027 | Join the current lease, September 2027 to May 2028 | Unfurnished | l35 | 4 |
| demo-18 | Spring sublet on Prospect Hill | Sublet | Prospect Hill | 2.7 km | $900 per room | 1 of 3 | Jan 1, 2027 | Spring sublet, January to May 2027 | Furnished | b27 | 5 |
| demo-19 | Sunny room near the Brandeis stop | Private room | near Brandeis | 0.4 km | $1,200 per room | 1 of 3 | May 1, 2027 | 12-month lease from May | Unfurnished | l37 | 7 |
| demo-20 | Bright furnished room on Prospect Hill | Private room | Prospect Hill | 2.7 km | $1,150 per room | 1 of 4 | Sep 1, 2027 | 12-month lease from September | Furnished | b02 | 2 |
| demo-21 | Top-floor room by the Riverwalk | Private room | Moody Street | 1.7 km | $1,050 per room | 1 of 4 | Sep 1, 2027 | Academic-year lease, September 2027 to May 2028 | Unfurnished | e06 | 4 |
| demo-22 | Furnished room in the Highlands | Private room | The Highlands | 1.9 km | $1,100 per room | 1 of 3 | Aug 1, 2027 | 12-month lease from August | Furnished | b31 | 5 |
| demo-24 | Small furnished studio by the Riverwalk | Studio | Moody Street | 2 km | $1,550 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Furnished | s40 | 1 |
| demo-25 | Bright furnished room near campus | Private room | near Brandeis | 0.7 km | $1,150 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b12 | 7 |
| demo-27 | Furnished room with a desk near Waltham Common | Private room | Downtown | 2 km | $1,000 per room | 1 of 4 | Jun 1, 2027 | 12-month lease from June | Furnished | b16 | 13 |
| demo-35 | Three rooms in a five-bedroom near the commuter rail | Private room | Downtown | 1.9 km | $1,050 per room | 3 of 5 | Jun 1, 2027 | 12-month lease from June | Unfurnished | drawing (k01 is on an earlier listing) | 16 |
| demo-36 | Two open rooms near Moody Street | Private room | Moody Street | 1.8 km | $1,250 per room | 2 of 4 | Jun 1, 2027 | 12-month lease from June | Unfurnished | k23 | 11 |
| demo-38 | Take over a lease near Prospect Hill Park | Lease takeover | Prospect Hill | 2.6 km | $1,200 per room | 1 of 3 | Sep 1, 2027 | Lease takeover, September 2027 to August 2028 | Unfurnished | k34 | 2 |
| demo-42 | Spring sublet near campus | Sublet | near Brandeis | 0.3 km | $1,000 per room | 1 of 4 | Jan 1, 2027 | Spring sublet, January to May 2027 | Furnished | b17 | 3 |
| demo-43 | Two-bedroom apartment on the South Side | Whole apartment | South Side | 1.5 km | $2,800 whole place | 2 of 2 | Jun 1, 2027 | 12-month lease from June | Unfurnished | l07 | 1 |
| demo-44 | Studio near Waltham Common | Studio | Downtown | 1.9 km | $1,700 whole place | 1 of 1 | Jul 1, 2027 | 12-month lease from July | Unfurnished | s39 | 1 |
| demo-46 | Group house a short walk from campus needs a fifth | Replacing a roommate | near Brandeis | 0.6 km | $900 per room | 1 of 5 | Aug 1, 2027 | Join the group's lease, August 2027 to July 2028 | Unfurnished | e30 | 3 |
| demo-47 | Furnished corner room in Warrendale | Private room | Warrendale | 1.2 km | $1,100 per room | 1 of 4 | May 15, 2027 | 12-month lease from mid-May | Furnished | b28 | 7 |
| demo-49 | Furnished room with a desk in Warrendale | Private room | Warrendale | 0.8 km | $1,100 per room | 1 of 3 | Dec 15, 2026 | Six-month lease, mid-December 2026 to mid-June 2027 | Furnished | b20 | 3 |
| demo-50 | Second-floor room near Prospect Hill Park | Private room | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Jul 15, 2027 | 12-month lease from mid-July | Unfurnished | k33 | 4 |
| demo-51 | Whole two-bedroom near Moody Street | Whole apartment | Moody Street | 2.1 km | $2,600 whole place | 2 of 2 | Jun 1, 2027 | 12-month lease from June | Unfurnished | e11 | 1 |
| demo-53 | Furnished corner room in the Highlands | Private room | The Highlands | 2 km | $1,000 per room | 1 of 4 | Jan 15, 2027 | Five-month lease, mid-January to mid-June 2027 | Furnished | b21 | 7 |
| demo-54 | Group house in Warrendale needs a fourth | Replacing a roommate | Warrendale | 0.8 km | $1,050 per room | 1 of 4 | May 1, 2027 | Join the group's lease, May 2027 to April 2028 | Unfurnished | drawing (l35 is on an earlier listing) | 7 |
| demo-58 | Room in a four-bedroom on Prospect Hill | Private room | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | e05 | 6 |
| demo-60 | Room in a four-bedroom near the commuter rail | Private room | Downtown | 2.2 km | $1,000 per room | 1 of 4 | Jun 15, 2027 | 12-month lease from mid-June | Unfurnished | k32 | 13 |
| demo-62 | Furnished room in Warrendale | Private room | Warrendale | 0.7 km | $950 per room | 1 of 4 | Aug 1, 2027 | 12-month lease from August | Furnished | drawing (b04 is on an earlier listing) | 7 |
| demo-64 | Group house near Waltham Common needs a fifth | Replacing a roommate | Downtown | 2 km | $950 per room | 1 of 5 | Jun 1, 2027 | Join the group's lease, June 2027 to May 2028 | Unfurnished | drawing (k10 is on an earlier listing) | 13 |
| demo-65 | Second-floor room in Warrendale | Private room | Warrendale | 0.7 km | $1,050 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | l36 | 7 |
| demo-66 | Two-bedroom apartment in Warrendale | Whole apartment | Warrendale | 0.8 km | $2,400 whole place | 2 of 2 | Aug 15, 2027 | 12-month lease from mid-August | Unfurnished | drawing (l36 is on an earlier listing) | 1 |
| demo-67 | Two-bedroom apartment near the Brandeis stop | Whole apartment | near Brandeis | 0.6 km | $2,500 whole place | 2 of 2 | Aug 1, 2027 | 12-month lease from August | Unfurnished | l14 | 1 |
| demo-69 | Spring semester sublet in Warrendale | Sublet | Warrendale | 1.1 km | $950 per room | 1 of 3 | Jan 15, 2027 | Spring sublet, mid-January to mid-May 2027 | Furnished | b18 | 3 |
| demo-73 | Furnished corner room a short walk from campus | Private room | near Brandeis | 0.4 km | $1,300 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b41 | 7 |
| demo-75 | Bright furnished room on the South Side | Private room | South Side | 1.8 km | $950 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Furnished | b25 | 3 |
| demo-76 | Spring semester sublet near campus | Sublet | near Brandeis | 0.5 km | $1,000 per room | 1 of 4 | Dec 1, 2026 | Spring sublet, December 2026 to May 2027 | Furnished | b24 | 3 |
| demo-80 | Spring sublet near Prospect Hill Park | Sublet | Prospect Hill | 2.7 km | $1,050 per room | 1 of 4 | Dec 15, 2026 | Spring sublet, mid-December 2026 to mid-June 2027 | Furnished | b22 | 5 |
| demo-81 | Bright furnished room in Warrendale | Private room | Warrendale | 1.1 km | $1,150 per room | 1 of 4 | Aug 15, 2027 | 12-month lease from mid-August | Furnished | drawing (b27 is on an earlier listing) | 6 |
| demo-82 | Room in a four-bedroom near Moody Street | Private room | Moody Street | 1.7 km | $1,000 per room | 1 of 4 | May 15, 2027 | 12-month lease from mid-May | Unfurnished | e29 | 8 |
| demo-83 | Housemates in Warrendale need a fourth | Replacing a roommate | Warrendale | 1 km | $1,000 per room | 1 of 4 | May 15, 2027 | Join the group's lease, mid-May 2027 to mid-May 2028 | Unfurnished | drawing (k23 is on an earlier listing) | 7 |
| demo-84 | Furnished corner room near the Brandeis stop | Private room | near Brandeis | 0.6 km | $1,200 per room | 1 of 3 | Aug 1, 2027 | 12-month lease from August | Furnished | drawing (b28 is on an earlier listing) | 5 |
| demo-90 | Furnished room near the commuter rail | Private room | Downtown | 2.1 km | $1,100 per room | 1 of 3 | Jul 1, 2027 | 12-month lease from July | Furnished | b38 | 7 |
| demo-92 | Top-floor room off Moody Street | Private room | Moody Street | 1.9 km | $1,100 per room | 1 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | drawing (e30 is on an earlier listing) | 15 |
| demo-94 | Whole three-bedroom by the Riverwalk | Whole apartment | Moody Street | 2 km | $3,300 whole place | 3 of 3 | Jun 1, 2027 | 12-month lease from June | Unfurnished | drawing (e29 is on an earlier listing) | 3 |
| demo-97 | Two open rooms a short walk from campus | Private room | near Brandeis | 0.2 km | $1,100 per room | 2 of 4 | Aug 1, 2027 | 12-month lease from August | Unfurnished | drawing (k34 is on an earlier listing) | 4 |
| demo-100 | Take over a lease on Prospect Hill | Lease takeover | Prospect Hill | 2.7 km | $1,150 per room | 1 of 3 | Aug 1, 2027 | Lease takeover, August 2027 to July 2028 | Unfurnished | e15 | 6 |

## Listing photos (sources and licenses)

Illustrative stock photos of ordinary rooms; none shows the listing it's on or any real Waltham property, and each is
labeled "Illustrative demo photo" with a credit in Details. All are free photos under the
[Unsplash License](https://unsplash.com/license) (not Unsplash+), each checked on its photo page (the first 15 on
2026-10-14, the other 26 on 2026-10-17; the 39 shown on kept listings re-checked on 2026-11-16, all still "Free Photo on
Unsplash"). They load from Unsplash's image server, resized for the card or dialog; nothing is downloaded into this
project, and if a photo can't load the card shows coHabit's drawing instead. Furnished rooms use bedroom photos,
unfurnished places empty rooms, kitchens or living rooms, studios studio photos and shared rooms photos with two beds.
No photo is on two kept listings: the 11 kept listings whose photo is already on an earlier kept listing show
coHabit's drawing instead. Each listing has one illustrative photo, not a set.

| Key | Kind | What it shows | Photographer | Source | Used by |
| --- | --- | --- | --- | --- | --- |
| k01 | kitchen | a small white kitchen with a gas stove | [Andrea Davis](https://unsplash.com/@andreaedavis?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/Wj6oZNCAzs4?utm_source=cohabit&utm_medium=referral) | demo-01 |
| b02 | bedroom | a bedroom with a white desk beside the bed | [Gabriel Beaudry](https://unsplash.com/@gbeaudry?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WuQME0I_oZA?utm_source=cohabit&utm_medium=referral) | demo-20 |
| s03 | studio | a studio with a kitchenette and a small dining table | [Aquilion Property](https://unsplash.com/@aquilionproperty?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/NoPzk4m4jHc?utm_source=cohabit&utm_medium=referral) | demo-03 |
| b04 | bedroom | a student's bedroom with a wall map and a guitar | [Emma Dau](https://unsplash.com/@daugirl?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/26OziLnJHFs?utm_source=cohabit&utm_medium=referral) | demo-04 |
| e05 | empty | an empty room with white walls and wood floors | [Brian Wangenheim](https://unsplash.com/@brianwangenheim?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/SCbkyJR3QSM?utm_source=cohabit&utm_medium=referral) | demo-58 |
| e06 | empty | an empty room with grey walls and a window | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/nLTk9N2eg2U?utm_source=cohabit&utm_medium=referral) | demo-21 |
| l07 | living | a living room with a grey loveseat and plants | [Patrick Perkins](https://unsplash.com/@patrickperkins?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/3wylDrjxH-E?utm_source=cohabit&utm_medium=referral) | demo-43 |
| h08 | shared | a bedroom with two single beds and a desk | [Febrian Zakaria](https://unsplash.com/@febrianzakaria?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/M6S1WvfW68A?utm_source=cohabit&utm_medium=referral) | demo-08 |
| b09 | bedroom | a bedroom with a single bed and a desk | [Zac Gudakov](https://unsplash.com/@zacgudakov?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/qnYbBALP4dA?utm_source=cohabit&utm_medium=referral) | demo-09 |
| k10 | kitchen | a narrow white kitchen with pans on the wall | [Dinh Ng.](https://unsplash.com/@dinhnext?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/2Cc0KnE3lCs?utm_source=cohabit&utm_medium=referral) | demo-10 |
| e11 | empty | an empty room with grey walls | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/47c3k8CIKzQ?utm_source=cohabit&utm_medium=referral) | demo-51 |
| b12 | bedroom | a bedroom with string lights and a round mirror | [Jonathan Borba](https://unsplash.com/@jonathanborba?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/wD3dur3v9aE?utm_source=cohabit&utm_medium=referral) | demo-25 |
| s13 | studio | a furnished studio with a table and a sofa | [deborah cortelazzi](https://unsplash.com/@deborah_cortelazzi?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/gREquCUXQLI?utm_source=cohabit&utm_medium=referral) | demo-13 |
| l14 | living | a shared living room with a sofa and armchairs | [Evan Wise](https://unsplash.com/@evanthewise?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/i4WbkwwvRj4?utm_source=cohabit&utm_medium=referral) | demo-67 |
| e15 | empty | an empty room with a large window | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/fbCqpQreg4Q?utm_source=cohabit&utm_medium=referral) | demo-100 |
| b16 | bedroom | a lived-in bedroom with a bed, a desk and a chair | [Aim / @photobypitcha](https://unsplash.com/@aimpitcha?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/jM-dZdFtnbk?utm_source=cohabit&utm_medium=referral) | demo-27 |
| b17 | bedroom | a bedroom with a bed, a desk and a window | [Lotus Design N Print](https://unsplash.com/@lotusdnp?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WDUtNbot6Qw?utm_source=cohabit&utm_medium=referral) | demo-42 |
| b18 | bedroom | a bright room with a desk, a pink chair and window blinds | [JEJOONG LEE](https://unsplash.com/@rfcking?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/KGo29e3zjI0?utm_source=cohabit&utm_medium=referral) | demo-69 |
| h19 | shared | a black metal bunk bed | [Marcus Loke](https://unsplash.com/@marcusloke?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WQJvWU_HZFo?utm_source=cohabit&utm_medium=referral) |  |
| b20 | bedroom | a student room with a desk, chairs and luggage | [Robiul Islam](https://unsplash.com/@connect2robiul?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/mORrLn55f0M?utm_source=cohabit&utm_medium=referral) | demo-49 |
| b21 | bedroom | a cozy bed beside a white cabinet | [Shashi Chaturvedula](https://unsplash.com/@thephotographermom?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/xdY1s1I6J8U?utm_source=cohabit&utm_medium=referral) | demo-53 |
| b22 | bedroom | a small bedroom with a nightstand by the window | [Daria Shevtsova](https://unsplash.com/@daria_shevtsova?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/RP4mtXJM7es?utm_source=cohabit&utm_medium=referral) | demo-80 |
| k23 | kitchen | a small apartment kitchen | [Y K](https://unsplash.com/@yokeboy?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/bn4Ve3NjQ8g?utm_source=cohabit&utm_medium=referral) | demo-36 |
| b24 | bedroom | a bedroom with blue and white sheets and a black bed frame | [CHUTTERSNAP](https://unsplash.com/@chuttersnap?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/ftG8WcHwg7o?utm_source=cohabit&utm_medium=referral) | demo-76 |
| b25 | bedroom | a bedroom with a desk, a globe and a radio | [Ivona Rož](https://unsplash.com/@ivonar?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/qDeMuOXFYXU?utm_source=cohabit&utm_medium=referral) | demo-75 |
| h26 | shared | two wooden beds with white mattresses | [yi sk](https://unsplash.com/@bemerrychristmas?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/i7-zqldb2os?utm_source=cohabit&utm_medium=referral) |  |
| b27 | bedroom | a bedroom with a wooden nightstand | [Clay Banks](https://unsplash.com/@claybanks?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/tstSvl2Z3_0?utm_source=cohabit&utm_medium=referral) | demo-18 |
| b28 | bedroom | a bed with white linen | [Sam Moghadam](https://unsplash.com/@sammoghadam?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/eU4kIKCMGk8?utm_source=cohabit&utm_medium=referral) | demo-47 |
| e29 | empty | an empty room with grey walls and white doors | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/CYj8RjUeFlY?utm_source=cohabit&utm_medium=referral) | demo-82 |
| e30 | empty | an empty room with grey walls and light wood floors | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/y2mAxcgm19s?utm_source=cohabit&utm_medium=referral) | demo-46 |
| b31 | bedroom | a cozy bedroom with a bedside table and a lamp | [Franco Debartolo](https://unsplash.com/@francotheshooter?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/kUd6KkVfbCY?utm_source=cohabit&utm_medium=referral) | demo-22 |
| k32 | kitchen | a kitchen with a steel refrigerator | [Naomi Hébert](https://unsplash.com/@naomish?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/MP0bgaS_d1c?utm_source=cohabit&utm_medium=referral) | demo-60 |
| k33 | kitchen | a kitchen with white and brown cabinets | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/2fJB9gwnA6U?utm_source=cohabit&utm_medium=referral) | demo-50 |
| k34 | kitchen | a white kitchen with a microwave | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/0t5erEPTFuk?utm_source=cohabit&utm_medium=referral) | demo-38 |
| l35 | living | a living room with a grey sofa and a wooden coffee table | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/DmOhItSo49k?utm_source=cohabit&utm_medium=referral) | demo-17 |
| l36 | living | a bright living room | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/6japTIjUQoI?utm_source=cohabit&utm_medium=referral) | demo-65 |
| l37 | living | a living room with wooden furniture | [Francesca Tosolini](https://unsplash.com/@fromitaly?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/yYUu4R4Wuwk?utm_source=cohabit&utm_medium=referral) | demo-19 |
| b38 | bedroom | a black platform bed with a white mattress | [Sonnie Hiles](https://unsplash.com/@sonniehiles?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/DhFHtkECn7Q?utm_source=cohabit&utm_medium=referral) | demo-90 |
| s39 | studio | a white bed by a white window | [Julia](https://unsplash.com/@beazy?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/ABohRftG_Os?utm_source=cohabit&utm_medium=referral) | demo-44 |
| s40 | studio | a compact kitchen with a microwave, a mini-fridge and a sink | [Alexander Mass](https://unsplash.com/@alexandermassph?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/Rjnzt2wvMQE?utm_source=cohabit&utm_medium=referral) | demo-24 |
| b41 | bedroom | a small room with a white bed by the window | [Andrea Davis](https://unsplash.com/@andreaedavis?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/NngNVT74o6s?utm_source=cohabit&utm_medium=referral) | demo-73 |

## Roommate profiles

Fictional seniors and graduate students, labeled "Demo profile • Fictional details." No photos (initials, see "Profile
photos" below), contact details, references, verification or testimonials. "Rooms" counts rooms that match everything
for them; "Roommates" counts visible profiles mutually compatible with them.

| Id | Name | Program | Looking in | Move-in | Budget | Wants | Lifestyle | Rooms | Roommates | Shown |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| demo-p01 | Ari | PhD student in neuroscience, 2nd year | near Brandeis, Warrendale | Jun 2027 | $950–$1,350 | 12 mo, 1 room, ≤1.5 km | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 7 | 15 | Yes |
| demo-p03 | Cam | Senior in music and computer science | Downtown, Moody Street | Jul 2027 | $800–$1,200 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 7 | 22 | Yes |
| demo-p04 | Dev | MBA student, 1st year | Moody Street, Downtown | Jun 2027 | $1,100–$1,600 | 12 mo, 1 room | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK | 8 | 8 | Yes |
| demo-p06 | Fern | PhD student in chemistry, 3rd year | The Highlands, Prospect Hill | Aug 2027 | $1,100–$1,500 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 5 | 12 | Yes |
| demo-p07 | Gus | Master's student in sustainable development | Downtown, Moody Street | Jun 2027 | $900–$1,300 | 12 mo, 1 room | night owl, average tidiness, some noise, guests often, OK with pets, smokes | 8 | 3 | Yes |
| demo-p09 | Ira | PhD student in English and teaching assistant | Warrendale, near Brandeis | Jun 2027 | $1,000–$1,400 | 12 mo, 1 room | flexible sleep, very tidy, quiet, guests sometimes, OK with pets, no smoking | 7 | 16 | Yes |
| demo-p11 | Kai | Senior in computer science | Moody Street, Downtown | Jun 2027 | $800–$1,100 | 12 mo, 1 room | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK | 7 | 8 | Yes |
| demo-p12 | Lena | PhD student in history, writing a thesis | Prospect Hill, The Highlands | Jan 2027 | $800–$1,100 | 5 mo, 1 room, furnished, must: month | early, very tidy, quiet, guests rarely, no pets, no smoking | 4 | 5 | Yes |
| demo-p13 | Milo | Incoming PhD student in economics | South Side, Moody Street | Jun 2027 | $1,000–$1,500 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 5 | 18 | Yes |
| demo-p14 | Noor | Incoming master's student in biotechnology | near Brandeis, Warrendale | Aug 2027 | $900–$1,300 | 12 mo, 1 room, furnished | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking | 4 | 13 | Yes |
| demo-p15 | Omar | Master's student in computer science | Downtown, Prospect Hill | Sep 2027 | $1,100–$1,600 | 12 mo, 1 room | early, very tidy, some noise, guests sometimes, OK with pets, no smoking | 4 | 10 | Yes |
| demo-p16 | Pia | PhD student in biology | near Brandeis, Warrendale | Jun 2027 | $900–$1,400 | 12 mo, 1 room | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 7 | 16 | No (never shown) |
| demo-p17 | Quinn | Senior in psychology | Moody Street, South Side | Jun 2027 | $900–$1,300 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, OK with pets, no smoking | 5 | 18 | No (never shown) |
| demo-p19 | Sam | Senior in film and media | Moody Street, Downtown | Sep 2027 | $800–$1,200 | 9 mo, 1 room | night owl, average tidiness, lively, guests often, OK with pets, no smoking | 3 | 3 | Yes |
| demo-p20 | Theo | Master's student in finance | The Highlands, Prospect Hill | Jul 2027 | $1,000–$1,400 | 12 mo, 1 room | early, very tidy, quiet, guests rarely, no pets, no smoking | 1 | 19 | No (never shown) |
| demo-p26 | Selin | Visiting master's student in teaching | within 2 km | Jan 2027 | $600–$1,150 | 5 mo, 1 room, furnished, ≤2 km, must: month | night owl, relaxed tidiness, lively, guests sometimes, OK with pets, no smoking | 6 | 6 | Yes |
| demo-p29 | Kenji | Master's student in teaching, 2nd year | within 2 km | Jun 2027 | $800–$1,450 | 12 mo, 1 room, ≤2 km | flexible sleep, very tidy, quiet, guests rarely, OK with pets, no smoking | 16 | 16 | Yes |
| demo-p30 | Ren | Senior in history | Moody Street, Downtown | Jul 2027 | $900–$1,200 | 12 mo, 1 room, must: area | night owl, very tidy, some noise, guests rarely, OK with pets, no smoking | 7 | 10 | Yes |
| demo-p36 | Isla | PhD student in anthropology, 2nd year | Prospect Hill, The Highlands | Jan 2027 | $950–$1,250 | 5 mo, 1 room, furnished | flexible sleep, average tidiness, quiet, guests sometimes, no pets, no smoking | 4 | 7 | Yes |
| demo-p39 | Pilar | PhD student in anthropology, 4th year | near Brandeis, Warrendale | Jun 2027 | $900–$1,400 | 12 mo, 1 room | flexible sleep, very tidy, lively, guests sometimes, OK with pets, no smoking | 7 | 18 | Yes |
| demo-p47 | Uma | Incoming master's student in teaching | within 2 km | Sep 2027 | $1,050–$1,300 | 12 mo, 1 room, ≤2 km | night owl, average tidiness, some noise, guests often, OK with pets, no smoking | 7 | 6 | Yes |
| demo-p48 | Rhea | PhD student in biochemistry, 4th year | Downtown, Moody Street | Sep 2027 | $600–$1,200 | 9 mo, 1 room | early, average tidiness, lively, guests sometimes, OK with pets, no smoking | 3 | 3 | Yes |
| demo-p49 | Petra | Senior in psychology | Downtown, Moody Street | Jul 2027 | $700–$1,300 | 12 mo, 1 room, must: area | night owl, very tidy, some noise, guests often, OK with pets, no smoking | 8 | 11 | Yes |
| demo-p52 | Alma | Master's student in conflict resolution and coexistence, 2nd year | Warrendale, near Brandeis, The Highlands | Jan 2027 | $650–$1,300 | 5 mo, 1 room, furnished, ≤1.5 km, must: month | flexible sleep, very tidy, lively, guests sometimes, no pets, smoking outside OK | 6 | 7 | Yes |
| demo-p53 | Keiko | PhD student in biochemistry, 2nd year | The Highlands, Prospect Hill, Warrendale | Aug 2027 | $900–$1,550 | 12 mo, 1 room, must: month, must: area | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 7 | 8 | Yes |
| demo-p54 | Zuri | Senior in English | Warrendale, near Brandeis | Sep 2027 | $700–$1,200 | 12 mo, 1 room, ≤1.5 km | night owl, average tidiness, quiet, guests often, OK with pets, no smoking | 5 | 6 | Yes |
| demo-p55 | Idris | Master's student in biotechnology | Prospect Hill, The Highlands | Aug 2027 | $1,000–$1,500 | 12 mo, 1 room | early, relaxed tidiness, some noise, guests rarely, OK with pets, no smoking | 5 | 12 | Yes |
| demo-p57 | Luka | Master's student in social impact management, 2nd year | South Side, Moody Street | Jun 2027 | $850–$1,450 | 12 mo, 2 rooms, must: area | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 3 | 12 | Yes |
| demo-p60 | Sana | PhD student in philosophy, 4th year | Warrendale, near Brandeis, The Highlands | Jun 2027 | $1,050–$1,450 | 12 mo, 1 room | early, very tidy, quiet, guests often, no pets, no smoking | 7 | 15 | Yes |
| demo-p61 | Kemal | Senior in theater arts | Moody Street, Downtown | Jun 2027 | $850–$1,200 | 12 mo, 3 rooms | flexible sleep, very tidy, lively, guests sometimes, no pets, no smoking | 3 | 20 | Yes |
| demo-p62 | Bryn | MBA student, 2nd year | Downtown, Moody Street | Jul 2027 | $1,300–$1,800 | 12 mo, 1 room, must: month, must: area | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 11 | 3 | Yes |
| demo-p63 | Cyrus | Master's student in sustainable international development | Downtown, Moody Street | Jul 2027 | $750–$1,300 | 12 mo, 1 room | flexible sleep, average tidiness, some noise, guests sometimes, has a pet, no smoking | 8 | 17 | Yes |
| demo-p66 | Victor | PhD student in social policy, 4th year | near Brandeis, Warrendale | Jan 2027 | $800–$1,250 | 5 mo, 1 room, furnished | early, relaxed tidiness, some noise, guests sometimes, no pets, smoking outside OK | 4 | 7 | Yes |
| demo-p71 | Tess | Senior in sociology | Moody Street, Downtown | Jun 2027 | $800–$1,250 | 12 mo, 1 room | night owl, very tidy, lively, guests sometimes, OK with pets, no smoking | 8 | 21 | Yes |
| demo-p78 | Hiro | PhD student in social policy, 2nd year | near Brandeis, Warrendale | Jun 2027 | $1,050–$1,400 | 12 mo, 1 room | early, very tidy, lively, guests sometimes, OK with pets, no smoking | 7 | 16 | Yes |
| demo-p94 | Rafael | Master's student in computer science | Warrendale, near Brandeis, The Highlands | Aug 2027 | $650–$1,250 | 12 mo, 2 rooms, must: area | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 9 | Yes |
| demo-p95 | Valentina | PhD student in structural biology, 5th year | Prospect Hill, The Highlands, Lakeview | Aug 2027 | $1,050–$1,300 | 12 mo, 1 room, must: area | flexible sleep, very tidy, quiet, guests rarely, no pets, no smoking | 4 | 6 | Yes |
| demo-p106 | Kofi | Master's student in global health policy | Prospect Hill, The Highlands | Jan 2027 | $700–$1,100 | 5 mo, 1 room, furnished | flexible sleep, very tidy, some noise, guests rarely, OK with pets, no smoking | 4 | 7 | Yes |
| demo-p107 | Wen | Incoming PhD student in history | Warrendale, near Brandeis | Aug 2027 | $750–$1,350 | 12 mo, 1 room, furnished, ≤1.5 km | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 4 | 14 | Yes |
| demo-p108 | Thea | Master's student in genetic counseling | Prospect Hill, The Highlands | Jan 2027 | $550–$1,200 | 5 mo, 1 room, furnished | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking | 4 | 7 | Yes |
| demo-p113 | Sora | Master's student in business analytics | Moody Street, Downtown | Jul 2027 | $800–$1,200 | 12 mo, 1 room | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking | 7 | 22 | Yes |
| demo-p114 | Dami | Master's student in teaching, 2nd year | near Brandeis, Warrendale | Aug 2027 | $800–$1,300 | 12 mo, 1 room, furnished | early, average tidiness, some noise, guests rarely, no pets, no smoking | 4 | 11 | Yes |
| demo-p118 | Vera | Senior in theater arts | near Brandeis, Warrendale | Aug 2027 | $800–$1,100 | 12 mo, 1 room | night owl, average tidiness, some noise, guests sometimes, no pets, smoking outside OK | 3 | 12 | Yes |
| demo-p119 | Jamal | PhD student in biochemistry, 3rd year | Prospect Hill, The Highlands | Jan 2027 | $550–$1,200 | 5 mo, 1 room, furnished | night owl, relaxed tidiness, some noise, guests sometimes, no pets, no smoking | 4 | 6 | Yes |
| demo-p120 | Chidi | Senior in computer science | Downtown, Moody Street | Jun 2027 | $550–$1,200 | 12 mo, 1 room, must: month | flexible sleep, average tidiness, some noise, guests sometimes, no pets, no smoking | 7 | 15 | Yes |
| demo-p121 | Ahmed | Senior in sociology | Moody Street, Downtown | Jun 2027 | $550–$1,150 | 12 mo, 3 rooms | night owl, relaxed tidiness, lively, guests often, OK with pets, smokes | 3 | 3 | Yes |
| demo-p124 | Cedric | Master's student in global health policy | Downtown, Moody Street | Jul 2027 | $700–$1,300 | 12 mo, 1 room | night owl, very tidy, lively, guests often, OK with pets, no smoking | 8 | 19 | Yes |
| demo-p135 | Darius | Master's student in nonprofit management | Downtown, Moody Street | Jun 2027 | $650–$1,150 | 12 mo, 3 rooms, must: month | early, average tidiness, some noise, guests sometimes, OK with pets, no smoking | 3 | 13 | Yes |
| demo-p139 | Orla | Senior in music | Downtown, Moody Street | Sep 2027 | $750–$1,300 | 9 mo, 1 room, must: month | flexible sleep, average tidiness, lively, guests sometimes, OK with pets, no smoking | 3 | 3 | Yes |
| demo-p141 | Hamza | PhD student in biophysics, 4th year | near Brandeis, Warrendale | Jun 2027 | $850–$1,400 | 12 mo, 1 room, must: month | early, very tidy, quiet, guests sometimes, OK with pets, no smoking | 7 | 12 | Yes |
| demo-p144 | Sunny | Master's student in business analytics, 2nd year | Downtown, Moody Street | Sep 2027 | $800–$1,150 | 9 mo, 1 room, must: area | flexible sleep, average tidiness, some noise, guests often, OK with pets, no smoking | 3 | 3 | Yes |
| demo-p148 | Mateo | Master's student in business analytics | Prospect Hill, Downtown | Sep 2027 | $900–$1,500 | 12 mo, 1 room, must: area | flexible sleep, very tidy, some noise, guests often, OK with pets, no smoking | 4 | 3 | Yes |
| demo-p151 | Tariq | Master's student in social impact management | South Side, Moody Street | Jun 2027 | $1,000–$1,300 | 12 mo, 1 room | early, average tidiness, some noise, guests sometimes, no pets, no smoking | 5 | 17 | Yes |

## Profile photos

None. Demo profiles show their initials, like real renters (coHabit has no profile photo upload, and real accounts never
get a generated or stock photo). There are no AI-generated images of people and no stock photos of people.

From 2026-11-15 to 2026-11-16 the shown profiles had AI-generated portraits (FLUX.1 [schnell] on Cloudflare Workers AI,
Apache License 2.0). They were taken off with the owner's approval; the files are kept, not served, in
`archive/demo-faces/` (see `archive/README.md`).

## Archived records

Archived on 2026-11-16: left out of Demo mode everywhere (Listings, Roommates, My matches, Vibe, the assistant, Details,
counts) but kept in the data files. A bookmark to one shows "no longer available"; the database row isn't touched. To
restore one, delete its line from `ARCHIVED_LISTINGS` or `ARCHIVED_PEOPLE` in `src/assistant/demo-data.js`.

| Id | Name | Why archived |
| --- | --- | --- |
| demo-02 | Furnished room on the South Side | not chosen |
| demo-05 | Lease takeover in Warrendale | not chosen |
| demo-06 | Whole two-bedroom for two friends | not chosen |
| demo-07 | Group house needs a fourth | not chosen |
| demo-11 | Room on Prospect Hill | not chosen |
| demo-12 | Furnished summer sublet off Moody Street | not chosen |
| demo-14 | Room in a five-bedroom near campus | not chosen |
| demo-15 | Whole one-bedroom by Hardy Pond | over $1,700 per person |
| demo-16 | Three-bedroom apartment near Waltham Common | not chosen |
| demo-23 | Furnished summer sublet on the South Side | not chosen |
| demo-26 | Group house in Lakeview needs a fourth | not chosen |
| demo-28 | Bed in a shared room off Moody Street | duplicate of demo-08 |
| demo-29 | Summer room near the Brandeis stop | not chosen |
| demo-30 | Studio in the Highlands | not chosen |
| demo-31 | Top-floor room in Warrendale | not chosen |
| demo-32 | Furnished corner room on the South Side | not chosen |
| demo-33 | Furnished corner room near campus | not chosen |
| demo-34 | Two rooms in a four-bedroom on the South Side | not chosen |
| demo-37 | Room with a bay window near Prospect Hill Park | not chosen |
| demo-39 | Bright furnished room by the Riverwalk | not chosen |
| demo-40 | Bed in a shared room near campus | duplicate of demo-08 |
| demo-41 | Whole two-bedroom in Warrendale | not chosen |
| demo-45 | Corner room in Warrendale | not chosen |
| demo-48 | Furnished room with a desk downtown | not chosen |
| demo-52 | Furnished room with a desk in the Highlands | not chosen |
| demo-55 | Bright furnished room near Hardy Pond | not chosen |
| demo-56 | Whole one-bedroom in Lakeview | over $1,700 per person |
| demo-57 | Summer room by the Riverwalk | not chosen |
| demo-59 | Sublet in Warrendale | move-in date passed |
| demo-61 | Room to take over near Waltham Common | move-in date passed |
| demo-63 | Large room near the commuter rail | not chosen |
| demo-68 | Bed in a shared room a short walk from campus | duplicate of demo-08 |
| demo-70 | Lease takeover a short walk from campus | not chosen |
| demo-71 | Join a friendly house in Warrendale | not chosen |
| demo-72 | Summer sublet in Warrendale | not chosen |
| demo-74 | Bright private room in the Highlands | duplicate of demo-73 |
| demo-77 | Furnished room with a desk near the Brandeis stop | not chosen |
| demo-78 | Furnished room off Moody Street | not chosen |
| demo-79 | Furnished room with a desk near the commuter rail | not chosen |
| demo-85 | Top-floor room near the commuter rail | not chosen |
| demo-86 | Furnished room with a desk a short walk from campus | not chosen |
| demo-87 | Furnished room near Waltham Common | not chosen |
| demo-88 | Whole two-bedroom on the South Side | not chosen |
| demo-89 | Take over a lease in Warrendale | not chosen |
| demo-91 | Furnished room near the Brandeis stop | not chosen |
| demo-93 | Bright furnished room near the Brandeis stop | duplicate of demo-87 |
| demo-95 | Bright furnished room in the Highlands | duplicate of demo-75 |
| demo-96 | Summer sublet on the South Side | not chosen |
| demo-98 | Sunny room near Hardy Pond | not chosen |
| demo-99 | Whole two-bedroom downtown | not chosen |
| demo-p02 | Bea | not chosen |
| demo-p05 | Eli | not chosen |
| demo-p08 | Hana | fewer than 3 compatible roommates |
| demo-p10 | Jules | swapped out for the smokers demo-p07 and demo-p121 |
| demo-p18 | Rosa | not chosen |
| demo-p21 | Priya | not chosen |
| demo-p22 | Bilal | not chosen |
| demo-p23 | Jonah | not chosen |
| demo-p24 | Nell | not chosen |
| demo-p25 | Yusuf | not chosen |
| demo-p27 | Iris | not chosen |
| demo-p28 | Uri | not chosen |
| demo-p31 | Gemma | fewer than 3 suitable rooms |
| demo-p32 | Gabe | fewer than 3 compatible roommates |
| demo-p33 | Xavier | budget over $1,800 |
| demo-p34 | Cleo | not chosen |
| demo-p35 | Marisol | not chosen |
| demo-p37 | Ada | not chosen |
| demo-p38 | Clara | fewer than 3 compatible roommates |
| demo-p40 | Chiara | fewer than 3 suitable rooms |
| demo-p41 | Sami | not chosen |
| demo-p42 | Mina | not chosen |
| demo-p43 | Nadia | not chosen |
| demo-p45 | Rowan | not chosen |
| demo-p46 | Esther | not chosen |
| demo-p50 | Bianca | fewer than 3 suitable rooms |
| demo-p51 | Tamar | fewer than 3 suitable rooms |
| demo-p56 | Yasmin | not chosen |
| demo-p58 | Hugo | not chosen |
| demo-p59 | Leila | fewer than 3 suitable rooms |
| demo-p64 | Amara | not chosen |
| demo-p65 | Hedda | fewer than 3 suitable rooms |
| demo-p68 | Mariam | fewer than 3 suitable rooms |
| demo-p69 | Aditi | not chosen |
| demo-p70 | Ivan | not chosen |
| demo-p72 | Eamon | not chosen |
| demo-p73 | Adaeze | not chosen |
| demo-p74 | Liam | not chosen |
| demo-p75 | Anika | not chosen |
| demo-p76 | Zain | fewer than 3 suitable rooms |
| demo-p77 | Jade | not chosen |
| demo-p79 | Ilana | not chosen |
| demo-p80 | Wren | fewer than 3 suitable rooms |
| demo-p81 | Jasper | not chosen |
| demo-p82 | Camila | not chosen |
| demo-p83 | Nia | not chosen |
| demo-p84 | Paloma | not chosen |
| demo-p85 | Owen | not chosen |
| demo-p86 | Elif | fewer than 3 suitable rooms |
| demo-p87 | Harper | not chosen |
| demo-p88 | Aurora | not chosen |
| demo-p89 | Hannah | budget over $1,800 |
| demo-p90 | Farah | not chosen |
| demo-p91 | Dalia | not chosen |
| demo-p92 | Leo | not chosen |
| demo-p93 | Fatima | fewer than 3 suitable rooms |
| demo-p96 | Galen | fewer than 3 suitable rooms |
| demo-p97 | Malik | not chosen |
| demo-p98 | Eden | fewer than 3 suitable rooms |
| demo-p99 | Basil | not chosen |
| demo-p101 | Dov | not chosen |
| demo-p102 | Daniela | not chosen |
| demo-p103 | Juno | not chosen |
| demo-p104 | Rina | budget over $1,800 |
| demo-p105 | Rania | not chosen |
| demo-p109 | Ines | not chosen |
| demo-p110 | Lina | not chosen |
| demo-p111 | Diego | not chosen |
| demo-p112 | Gael | not chosen |
| demo-p115 | Anaya | not chosen |
| demo-p116 | Zev | not chosen |
| demo-p117 | Lars | not chosen |
| demo-p122 | Maya | not chosen |
| demo-p123 | Freya | not chosen |
| demo-p125 | Grace | not chosen |
| demo-p126 | Noa | not chosen |
| demo-p127 | Enzo | fewer than 3 suitable rooms |
| demo-p128 | Sofia | fewer than 3 suitable rooms |
| demo-p129 | Gia | not chosen |
| demo-p130 | Mehmet | not chosen |
| demo-p131 | Carmen | swapped out for the smokers demo-p07 and demo-p121 |
| demo-p132 | Saanvi | not chosen |
| demo-p133 | Felix | not chosen |
| demo-p134 | Kiara | not chosen |
| demo-p136 | Tal | not chosen |
| demo-p137 | Ayumi | not chosen |
| demo-p138 | Dana | not chosen |
| demo-p140 | Olu | not chosen |
| demo-p142 | Anya | not chosen |
| demo-p143 | Eun | budget over $1,800 |
| demo-p145 | Pedro | budget over $1,800 |
| demo-p146 | Esme | not chosen |
| demo-p147 | Mira | not chosen |
| demo-p149 | Naomi | fewer than 3 compatible roommates |
| demo-p150 | Femi | fewer than 3 compatible roommates |
