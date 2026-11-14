# SA property dataset (schema `analyst`, views below)

Private Property listings (privateproperty.co.za) collected daily through the Scrappa API since 2026-11-14.
Two kinds of data, use the right one:
- **property_stock** is COMPLETE: the full number of listings on the portal per province and region, per day.
  Use it for supply, market size and "how many homes are for sale/rent" questions.
- **property_listings** is a SAMPLE: the first pages of listings per region each day (featured and newer listings come
  first). Use it for medians, mixes, price per m², agencies, bedrooms, rents vs prices. Always say it is a sample,
  prefer medians (percentile_cont(0.5)) to averages, and exclude NULL prices (price on application).

## analyst.property_listings — one row per listing seen
| column | meaning |
|---|---|
| portal | 'privateproperty' (Property24 may be added later) |
| deal_type | 'sale' or 'rent' |
| category | 'residential', 'commercial' or 'farm' |
| province, region, suburb | location. Province names use the standard spelling (e.g. 'KwaZulu-Natal'); region = portal region such as 'Cape Town', 'Johannesburg', 'East Rand', 'Durban' |
| property_type | House, Apartment, Townhouse, Land, Flat, Simplex, ... |
| price_zar | asking price in rand; for rentals the monthly rent (see price_type). NULL = price on application |
| beds, baths, garages, parking | counts (may be NULL) |
| floor_m2, land_m2, price_per_m2 | sizes; floor_m2 is often missing, land_m2 is common for houses and land |
| agency, office | estate agency brand and branch; 'Private seller / not stated' when none is shown |
| is_new, price_reduced, offer_pending, is_sold, on_auction | listing flags shown on the portal |
| first_price_zar, price_change_pct | first asking price we saw and % change since (negative = reduced) |
| first_seen, last_seen, days_tracked, active | tracking dates; active = seen in the last 3 days |

## analyst.property_stock — full listing counts per day
| column | meaning |
|---|---|
| day | date counted |
| province, region | region = '(whole province)' when is_province_total |
| is_province_total | TRUE for province totals. Never add province totals and regions together |
| deal_type, category | regions are counted for residential sale and rent; provinces also for commercial |
| listings | number of listings on the portal |

## analyst.property_price_changes — daily asking price per listing (change_zar vs previous observation)
## analyst.bond_rate — day, prime_bond_rate_pct (public bond/prime rate shown by the portal)

Useful derived measures:
- Gross rental yield for an area ≈ 12 × median monthly rent / median sale price, comparing like with like
  (same region, property_type and beds). State that it is an indicative asking-price yield.

## What changed day to day
- analyst.property_stock_changes — full counts vs the previous day counted: day, province, region, is_province_total,
  deal_type, category, listings, previous_day, previous_listings, change, change_pct. COMPLETE data: use for "how did
  stock move since yesterday / this week". For a week, compare the latest day with the day 7 days earlier.
- analyst.property_daily_activity — from the listing SAMPLE: day, province, region, deal_type, new_listings (first seen
  that day), price_cuts, price_rises, avg_cut_pct. The first collection day is left out (baseline).
For "what changed since yesterday", lead with stock changes (complete), then new listings and price cuts (sample).

## analyst.search_interest — Google Trends, South Africa (weekly pull, 90 days of daily values)
analyst, term_group, term, day, interest (0-100, RELATIVE within its term_group and pull), interest_7d_avg.
Compare terms inside the same term_group, or one term over time; never compare raw values across groups.
Groups ending in ' · 12 months' hold 12 months of WEEKLY values (pulled monthly): use them for month-by-month
patterns over the last 5-12 months (monthly averages per term); the plain groups hold the last 90 days, daily.
Use as a leading demand signal (e.g. searches for "houses for sale cape town" vs listings there).

## analyst.areas — area crosswalk
level (suburb, region/city, job city), area, parent (region of a suburb), province, metro (e.g. City of Tshwane,
Ekurhuleni, eThekwini), seen_in (which datasets use the name). Join on area = region/city/suburb to compare datasets
by metro or province.

## Two portals: portal = 'privateproperty' or 'property24'
- Private Property: regions (48) with full stock counts (category residential/commercial) and a first-pages sample.
- Property24: 26 main cities (region = city name, e.g. 'Johannesburg', 'Sandton', 'Cape Town'), full city counts in
  property_stock (category 'all'), and the NEWEST listings each day (an unbiased flow of new stock: use these for
  "new listings", asking prices of new stock and agency share of new mandates). office = agency branch.
Never add counts across portals (the same home is often on both). Compare portals side by side, or pick one.
