# Demo data (Demo mode)

Demo mode lets anyone try the assistant with made-up listings and roommates. This file is generated from
[`src/assistant/demo-data.js`](../src/assistant/demo-data.js), which is the only source of demo data.

- **Where it lives:** in code, never in the database. It can't be seeded twice, can't mix with real listings or
  accounts, and never appears in Listings, real matches, requests, saved options, admin counts or any user metric.
  Every id starts with `demo-`. Changing it means editing that file and deploying, so updates are repeatable and
  never create duplicates.
- **Counts:** 15 listings and 20 roommate profiles (17 shown; 3 chose not to be found, which shows that rule working).
- **Where:** all in Waltham (near Brandeis, Moody Street, the South Side, Downtown, the Highlands, Prospect Hill,
  Warrendale and Lakeview), as made-up approximate points shown as 500 m circles. No street addresses.
- **Labels:** every card, pin and dialog says Demo; photos say "Illustrative demo photo"; profiles say they are
  fictional with an illustrated avatar. Demo listings can't be saved or contacted, and demo profiles can't receive
  a real request.
- **Matching:** the normal matching code, unchanged. There is no gender field, so gender can't affect a score;
  avatars and names are never read by matching.

## Listings

| Id | Name | Kind | Area | From Brandeis | Rent | Available | Lease | Furnishing | Utilities | Laundry |
|---|---|---|---|---|---|---|---|---|---|---|
| demo-01 | Private room in a four-bedroom house | Private room | Moody Street | 1.8 km | $1,050 per room | Jun 1, 2027 | 12-month lease from June | Unfurnished | Heat and hot water included; electricity split four ways | Free washer and dryer in the basement |
| demo-02 | Furnished room on the South Side | Private room | South Side | 1.5 km | $1,200 per room | Jun 1, 2027 | 12-month lease from June | Furnished | Utilities and internet split four ways | Washer and dryer in the apartment |
| demo-03 | Furnished studio downtown | Studio | Downtown | 2.2 km | $1,650 whole place | Jul 1, 2027 | 12-month lease from July | Furnished | Heat included; electricity and internet extra | Coin laundry in the building |
| demo-04 | Spring sublet in a four-bedroom | Sublet | The Highlands | 1.8 km | $950 per room | Jan 15, 2027 | Spring sublet, mid-January to May 2027 | Furnished | Utilities included | Washer and dryer in the basement |
| demo-05 | Lease takeover in Warrendale | Lease takeover | Warrendale | 0.9 km | $1,100 per room | Feb 1, 2027 | Lease takeover, February to August 2027 | Unfurnished | Heat included; electricity split three ways | Laundromat a few minutes' walk away |
| demo-06 | Whole two-bedroom for two friends | Whole apartment | South Side | 1.9 km | $2,700 whole place | Jun 1, 2027 | 12-month lease from June | Unfurnished | Heat and hot water included | Shared laundry in the basement |
| demo-07 | Group house needs a fourth | Replacing a roommate | near Brandeis | 0.8 km | $975 per room | Jun 1, 2027 | Join the current lease to August 2027, then renew with the group | Unfurnished | Utilities split four ways | Washer and dryer in the basement |
| demo-08 | Shared bedroom for budget savers | Shared room | Downtown | 2.1 km | $700 per bed | Sep 1, 2027 | Academic-year lease, September to May | Furnished | Utilities included | Laundry room in the building |
| demo-09 | Garden-level room near campus | Private room | near Brandeis | 0.5 km | $1,300 per room | Aug 15, 2027 | 12-month lease from mid-August | Furnished | Utilities and internet included | Washer and dryer shared with the owners |
| demo-10 | Whole three-bedroom near Waltham Common | Whole apartment | Downtown | 2.0 km | $3,450 whole place | Jun 1, 2027 | 12-month lease from June | Unfurnished | All utilities extra | Washer and dryer in the apartment |
| demo-11 | Room on Prospect Hill | Private room | Prospect Hill | 2.5 km | $1,150 per room | Jul 1, 2027 | 12-month lease from July | Unfurnished | Utilities split three ways | Washer and dryer in the basement |
| demo-12 | Furnished summer sublet off Moody Street | Sublet | Moody Street | 1.9 km | $900 per room | Jun 1, 2027 | Summer sublet, June to August 2027 | Furnished | Utilities and internet included | Washer and dryer in the apartment |
| demo-13 | Small furnished studio in the Highlands | Studio | The Highlands | 1.9 km | $1,450 whole place | Aug 1, 2027 | 12-month lease from August | Furnished | Utilities included | Shared laundry in the basement |
| demo-14 | Room in a five-bedroom near campus | Private room | near Brandeis | 0.4 km | $890 per room | Aug 1, 2027 | 12-month lease from August | Unfurnished | Utilities split five ways | Washer and dryer in the basement |
| demo-15 | Whole one-bedroom by Hardy Pond | Whole apartment | Lakeview | 2.8 km | $1,950 whole place | Sep 1, 2027 | 12-month lease from September | Unfurnished | Heat and hot water included | Laundry room in the building |

## Listing photos (sources and licenses)

Illustrative stock photos of ordinary rooms. None of them shows the listing it's on or any real Waltham property,
and each is labeled "Illustrative demo photo" with a credit in Details. All are free photos under the
[Unsplash License](https://unsplash.com/license) (not Unsplash+), checked on 2026-10-14: free to use, including
commercially, without permission; attribution is appreciated and given. They load from Unsplash's image server
(`images.unsplash.com`), resized for the card or dialog; nothing is downloaded into this project. If a photo can't
load, the card shows coHabit's drawing instead. Unfurnished listings use photos of empty rooms or shared spaces;
furnished ones use furnished rooms or studios.

| Listing | What the photo shows | Photographer | Source | License |
|---|---|---|---|---|
| demo-01 | a small white kitchen with a gas stove | [Andrea Davis](https://unsplash.com/@andreaedavis?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/Wj6oZNCAzs4?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-02 | a bedroom with a white desk beside the bed | [Gabriel Beaudry](https://unsplash.com/@gbeaudry?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/WuQME0I_oZA?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-03 | a studio with a kitchenette and a small dining table | [Aquilion Property](https://unsplash.com/@aquilionproperty?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/NoPzk4m4jHc?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-04 | a student's bedroom with a wall map and a guitar | [Emma Dau](https://unsplash.com/@daugirl?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/26OziLnJHFs?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-05 | an empty room with white walls and wood floors | [Brian Wangenheim](https://unsplash.com/@brianwangenheim?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/SCbkyJR3QSM?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-06 | an empty room with grey walls and a window | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/nLTk9N2eg2U?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-07 | a living room with a grey loveseat and plants | [Patrick Perkins](https://unsplash.com/@patrickperkins?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/3wylDrjxH-E?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-08 | a bedroom with two single beds and a desk | [Febrian Zakaria](https://unsplash.com/@febrianzakaria?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/M6S1WvfW68A?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-09 | a bedroom with a single bed and a desk | [Zac Gudakov](https://unsplash.com/@zacgudakov?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/qnYbBALP4dA?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-10 | a narrow white kitchen with pans on the wall | [Dinh Ng.](https://unsplash.com/@dinhnext?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/2Cc0KnE3lCs?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-11 | an empty room with grey walls | [Josh Lemmon](https://unsplash.com/@wolfiex2?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/47c3k8CIKzQ?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-12 | a bedroom with string lights and a round mirror | [Jonathan Borba](https://unsplash.com/@jonathanborba?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/wD3dur3v9aE?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-13 | a furnished studio with a table and a sofa | [deborah cortelazzi](https://unsplash.com/@deborah_cortelazzi?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/gREquCUXQLI?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-14 | a shared living room with a sofa and armchairs | [Evan Wise](https://unsplash.com/@evanthewise?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/i4WbkwwvRj4?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |
| demo-15 | an empty room with a large window | [Point3D Commercial Imaging Ltd.](https://unsplash.com/@3dottawa?utm_source=cohabit&utm_medium=referral) | [Photo page](https://unsplash.com/photos/fbCqpQreg4Q?utm_source=cohabit&utm_medium=referral) | [Unsplash License](https://unsplash.com/license) |

## Roommate profiles

Fictional seniors and graduate students. Avatars are illustrations drawn by coHabit's own code from a few settings
(skin and hair color, hair style, shirt, background, glasses, beard), not photos or likenesses of anyone. No contact
details, references, verification or testimonials.

| Id | Name | Program | Area | Move-in | Budget | Lifestyle | Interests | Shown |
|---|---|---|---|---|---|---|---|---|
| demo-p01 | Ari | PhD student in neuroscience, 2nd year | near Brandeis | Jun 2027 | $950–$1,350 | early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking, chore schedule | Trail running, Baking bread, Board games | Yes |
| demo-p02 | Bea | Incoming master's student in global health | Moody Street | Jun 2027 | $1,000–$1,450 | early bird, average tidiness, quiet, guests rarely, no pets, no smoking, chores by task | Yoga, Podcasts, Thrift shopping | Yes |
| demo-p03 | Cam | Senior in music and computer science | Downtown | Jul 2027 | $800–$1,200 | flexible sleep, very tidy, some noise, guests sometimes, OK with pets, no smoking, chores as needed | Jazz piano, Cooking, Pickup basketball | Yes |
| demo-p04 | Dev | MBA student, 1st year | Moody Street | Jun 2027 | $1,100–$1,600 | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK, chores as needed | Soccer, Hosting dinners, Startups | Yes |
| demo-p05 | Eli | Senior in environmental studies | South Side | Jun 2027 | $750–$1,050 | night owl, average tidiness, some noise, guests sometimes, has a pet, no smoking, chores by task | Hiking, Film photography, Houseplants | Yes |
| demo-p06 | Fern | PhD student in chemistry, 3rd year | The Highlands | Aug 2027 | $1,100–$1,500 | early bird, very tidy, quiet, guests rarely, OK with pets, no smoking, chore schedule | Cycling, Rock climbing, Mystery novels | Yes |
| demo-p07 | Gus | Master's student in sustainable development | Downtown | Jun 2027 | $900–$1,300 | night owl, average tidiness, some noise, guests often, OK with pets, smokes, chores as needed | Guitar, Watching soccer, Cooking chili | Yes |
| demo-p08 | Hana | Master's student in public policy, 2nd year | near Brandeis | May 2027 | $950–$1,350 | early bird, very tidy, quiet, guests rarely, no pets, no smoking, chore schedule | Swimming, Journaling, Korean cooking | Yes |
| demo-p09 | Ira | PhD student in English and teaching assistant | Warrendale | Jun 2027 | $1,000–$1,400 | flexible sleep, very tidy, quiet, guests sometimes, OK with pets, no smoking, chores by task | Poetry, Long walks, Tea | Yes |
| demo-p10 | Jules | Senior in economics | Downtown | Sep 2027 | $1,000–$1,400 | night owl, average tidiness, lively, guests often, OK with pets, no smoking, chores as needed | Basketball, Cooking, Concerts | Yes |
| demo-p11 | Kai | Senior in computer science | Moody Street | Jun 2027 | $800–$1,100 | night owl, relaxed tidiness, lively, guests often, OK with pets, smoking outside OK, chores as needed | Board games, Video games, Climbing | Yes |
| demo-p12 | Lena | PhD student in history, writing a thesis | Prospect Hill | Jan 2027 | $800–$1,100 | early bird, very tidy, quiet, guests rarely, no pets, no smoking, chore schedule | Archives, Running, Knitting | Yes |
| demo-p13 | Milo | Incoming PhD student in economics | South Side | Jun 2027 | $1,000–$1,500 | early bird, average tidiness, some noise, guests sometimes, OK with pets, no smoking, chores by task | Cooking, Chess, Soccer | Yes |
| demo-p14 | Noor | Incoming master's student in biotechnology | near Brandeis | Aug 2027 | $900–$1,300 | flexible sleep, very tidy, quiet, guests sometimes, no pets, no smoking, chore schedule | Badminton, Baking, Museums | Yes |
| demo-p15 | Omar | Master's student in computer science | Downtown | Sep 2027 | $1,100–$1,600 | early bird, very tidy, some noise, guests sometimes, OK with pets, no smoking, chores by task | Gym, Photography, Soccer | Yes |
| demo-p16 | Pia | PhD student in biology | near Brandeis | Jun 2027 | $900–$1,400 | early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking, chore schedule | Birding, Pottery, Running | No (never shown) |
| demo-p17 | Quinn | Senior in psychology | Moody Street | Jun 2027 | $900–$1,300 | early bird, very tidy, quiet, guests rarely, OK with pets, no smoking, chores by task | Theater, Running, Podcasts | No (never shown) |
| demo-p18 | Rosa | Senior in sociology | Lakeview | Jun 2027 | $900–$1,250 | flexible sleep, average tidiness, some noise, guests sometimes, OK with pets, no smoking, chore schedule | Volleyball, Cooking together, Movies | Yes |
| demo-p19 | Sam | Senior in film and media | Moody Street | Sep 2027 | $800–$1,200 | night owl, average tidiness, lively, guests often, OK with pets, no smoking, chores as needed | Filmmaking, Skateboarding, Live music | Yes |
| demo-p20 | Theo | Master's student in finance | The Highlands | Jul 2027 | $1,000–$1,400 | early bird, very tidy, quiet, guests rarely, no pets, no smoking, chore schedule | Tennis, Investing clubs, Cooking | No (never shown) |

## Example searches (checked locally, 2026-10-14)

1. **A room in Waltham for June 2027, up to $1,300 (must-have), 1 room:** 8 rooms fit, 4 match everything
   (demo-12, demo-07, demo-01, demo-02) and 4 partly, each with its reason (demo-11 July, demo-08 September,
   demo-14 and demo-09 August).
2. **A furnished spring sublet from January 2027, about 5 months, up to $1,100:** the spring sublet (demo-04)
   matches everything; the Warrendale lease takeover (demo-05) is a partial match (available February, 7 months).
3. **A roommate in Waltham for June 2027 (early bird, very tidy, quiet, guests sometimes, OK with pets, no smoking,
   up to $1,300):** 8 people: Ari 100% and Ira 95% are strong matches; Hana, Bea, Milo, Cam, Rosa and Eli are
   partial (Eli's card names the difference: night owl). The smoker (Gus) and the three hidden profiles never
   appear; people moving in January, August or September don't match June.
4. **No match:** a room within 1 km of Brandeis (must-have) under $800 for June finds nothing and offers
   "Look farther than 1 km from Brandeis (+1)" without loosening anything; a roommate moving in March 2027 finds
   nobody.
