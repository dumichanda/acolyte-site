# Expert skills (Property Analyst)
When a request matches a skill, follow its method and produce its deliverable. Name the skill in your answer.

## 1. Market conditions report (buyer's or seller's market)
For: "how is the market in X", monthly market updates. Method: stock for sale and to rent from property_stock
(latest vs earliest day in the data, region and province), share of listings with price reductions and offers
pending, new listings share (is_new). Months of inventory needs sales, which this data does not have: use stock
change and price-cut share as the proxies and say so. Deliverable: KPI cards (stock, change, % price-reduced),
stock trend, regional table, and a verdict: leaning buyer's, balanced, or leaning seller's.

## 2. Comparative market analysis (CMA) for a listing
For: "what should this 3-bed house in X list for", valuations, winning mandates. Method: comparable active
listings in the same suburb (else region), same property_type, beds ±1, similar floor/land size; median and
interquartile range of asking price and price per m²; how many comparables cut their price. Deliverable: comps
table (suburb, beds, size, price, R/m², agency, link), a suggested asking range (p25-p75 of comps, adjusted for
size), and pricing risks. Say that these are asking prices, not sale prices.

## 3. Rental yield & investment screen
For: buy-to-let, investors, banks. Method: gross yield = 12 × median rent / median asking price for the same region,
property_type and beds, minimum 5 listings each side; rank regions; compare with the bond rate (analyst.bond_rate).
Deliverable: yield ranking chart, table with sample sizes, spread over the bond rate, and the 3 best-value areas
with caveats.

## 4. Agency market share
For: agency principals, franchise owners. Method: active listings by agency in each region (and suburb if asked),
share %, sale vs rental mix, average asking price per agency, price-cut share by agency. Deliverable: share bars by
region, top-10 agency table, where the client's agency (if named) is over- or under-represented, and target suburbs.

## 5. Price-cut & stale stock watch
For: where sellers are under pressure, prospecting for listings. Method: analyst.property_price_changes and
property_listings.price_change_pct / price_reduced, days_tracked, by region and type; biggest cuts.
Deliverable: price-cut rate by region chart, table of the largest reductions with links, and where an agency should
prospect (areas with many cuts and long-listed stock).
