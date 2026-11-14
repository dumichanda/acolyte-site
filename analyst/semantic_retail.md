# SA retail prices dataset (schema `analyst`)

Google Shopping South Africa, searched daily (via Scrappa) for a fixed basket of ~48 everyday FMCG items
(beverages, dairy, bakery & breakfast, pantry, snacks, household, personal care, baby) since 2026-11-14.
Google Shopping lists offers from grocery chains (Woolworths, Checkers, Shoprite, Pick n Pay, SPAR), wholesale
(Makro, Game, Superb Hyper), pharmacies (Dis-Chem, Clicks), quick commerce (Checkers Sixty60, Mr D) and online
marketplaces (Amazon.co.za, Takealot), plus many small online stores.
It is what retailers advertise online, not till prices, and not every retailer lists every item every day.
Coverage differs by retailer, so compare like with like: the same item on the same day.

## analyst.retail_prices — CLEAN comparable prices (use this first)
One row per day, item, retailer: the lowest matching offer. Only offers whose title matches the item's brand and
size, from known retailers, and within 0.5x-2x of the item's median price (removes multipacks and wrong sizes).
| column | meaning |
|---|---|
| day | date seen |
| item | basket item, e.g. 'Sunlight dishwashing liquid 750ml' |
| category | basket category |
| retailer | normalised retailer, e.g. 'Makro', 'Amazon.co.za', 'Checkers Sixty60' |
| channel | 'grocery chain', 'wholesale', 'pharmacy', 'quick commerce', 'online marketplace' |
| price_zar | lowest matching price |
| offers | matching offers at that retailer that day |

## analyst.retail_offers — every offer seen (for detail and audits)
day, item, category, retailer, seller (as shown), channel ('other online store' = small sellers), title, price_zar,
rating, reviews, position (rank in the search), matches_item, price_vs_item_median (e.g. 6.0 = likely a case),
link. Filter matches_item AND channel <> 'other online store' unless asked about small sellers.

## analyst.retail_basket_cost — basket cost per retailer per day
day, retailer, channel, items_priced, basket_items, basket_cost_zar (sum over the items that retailer priced).
Only compare basket costs over the SAME items: build the comparison in SQL from retail_prices for items every
compared retailer has, and say how many items that is.

Useful measures (define them in the answer):
- Price index vs a reference retailer = 100 × retailer price / reference price, averaged over common items.
- Price gap to cheapest = (price − cheapest price for that item that day) / cheapest.
- Price change = latest price vs the earliest day in the data for the same item and retailer.

## analyst.retail_price_changes — what changed day to day
day, item, category, retailer, channel, price_zar, previous_day, previous_price_zar, change_zar, change_pct.
Each item-retailer price vs the previous day it was seen. Moves of −10% or more are likely promotions; a return to
the earlier price later means the promotion ended. For "what changed since yesterday" filter day = latest day.

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

## analyst.retail_unit_prices — price per kg / litre / unit, and name vs house brand
day, item, category, brand_type ('name brand' or 'house brand', e.g. Ritebrand at Shoprite, Checkers Housebrand,
PnP own brand, Woolworths own), retailer, channel, price_zar, size_value, size_unit, price_per_unit_zar, unit_basis.
Use for fair comparisons across pack sizes and for the house-brand discount vs name brands in the same category.
