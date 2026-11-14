-- SA retail prices (Google Shopping South Africa via Scrappa): a fixed FMCG basket searched daily.
-- Google Shopping lists offers from grocery chains, pharmacies, wholesalers and online marketplaces
-- (Amazon.co.za, Takealot). Raw tables in schema `retail`; the analyst reads the curated views in `analyst`.
CREATE SCHEMA IF NOT EXISTS retail;

CREATE TABLE IF NOT EXISTS retail.basket (
    item     TEXT PRIMARY KEY,        -- e.g. 'Coca-Cola 2L'
    category TEXT NOT NULL,
    queries  TEXT[] NOT NULL,
    match    TEXT[] NOT NULL          -- lower-case tokens the offer title must all contain
);

ALTER TABLE retail.basket ADD COLUMN IF NOT EXISTS brand_type TEXT NOT NULL DEFAULT 'name brand';  -- or 'house brand'
ALTER TABLE retail.basket ADD COLUMN IF NOT EXISTS size_value NUMERIC;   -- in size_unit
ALTER TABLE retail.basket ADD COLUMN IF NOT EXISTS size_unit TEXT;       -- kg, l or units

CREATE TABLE IF NOT EXISTS retail.offers (
    day          DATE NOT NULL,
    item         TEXT NOT NULL,
    product_id   TEXT NOT NULL,       -- Google Shopping product id
    seller       TEXT,                -- as shown, e.g. 'Makro - Makro Business'
    retailer     TEXT,                -- normalised, e.g. 'Makro'
    channel      TEXT,                -- grocery chain, wholesale, pharmacy, online marketplace, quick commerce, other online store
    title        TEXT NOT NULL,
    price        NUMERIC,             -- rand
    rating       NUMERIC,
    reviews      INT,
    position     INT,
    matches_item BOOLEAN NOT NULL,    -- title contains every match token
    query        TEXT,
    PRIMARY KEY (day, item, product_id, seller)
);
CREATE INDEX IF NOT EXISTS offers_item_day ON retail.offers (item, day);

-- ---------------------------------------------------------------- analyst views
DROP VIEW IF EXISTS analyst.retail_offers, analyst.retail_prices, analyst.retail_basket_cost CASCADE;

-- Every offer seen. price_vs_item_median flags multipacks and wrong sizes (e.g. 4.0 = a 6-pack or a case).
CREATE VIEW analyst.retail_offers AS
SELECT o.day, o.item, b.category, o.retailer, o.seller, o.channel, o.title, o.price AS price_zar,
       o.rating, o.reviews, o.position, o.matches_item,
       round(o.price / NULLIF(percentile_cont(0.5) WITHIN GROUP (ORDER BY o2.price), 0)::numeric, 2) AS price_vs_item_median,
       'https://www.google.com/shopping/product/' || o.product_id AS link
FROM retail.offers o
JOIN retail.basket b USING (item)
LEFT JOIN retail.offers o2 ON o2.day = o.day AND o2.item = o.item AND o2.matches_item AND o2.price > 0
GROUP BY o.day, o.item, b.category, o.retailer, o.seller, o.channel, o.title, o.price, o.rating, o.reviews,
         o.position, o.matches_item, o.product_id;

-- Clean comparable prices: matching titles, known retailers, no multipacks (within 0.5x-2x of the item median).
CREATE VIEW analyst.retail_prices AS
SELECT day, item, category, retailer, channel, min(price_zar) AS price_zar, count(*) AS offers
FROM analyst.retail_offers
WHERE matches_item AND price_zar > 0 AND channel <> 'other online store'
  AND price_vs_item_median BETWEEN 0.5 AND 2.0
GROUP BY day, item, category, retailer, channel;

-- Basket cost per retailer per day, over the items that retailer listed that day (coverage shows how complete it is).
CREATE VIEW analyst.retail_basket_cost AS
SELECT day, retailer, channel, count(*) AS items_priced,
       (SELECT count(*) FROM retail.basket) AS basket_items,
       sum(price_zar) AS basket_cost_zar
FROM analyst.retail_prices GROUP BY day, retailer, channel;

-- What changed: each item-retailer price vs the previous day it was seen.
DROP VIEW IF EXISTS analyst.retail_price_changes CASCADE;
CREATE VIEW analyst.retail_price_changes AS
SELECT day, item, category, retailer, channel, price_zar,
       lag(day) OVER w AS previous_day, lag(price_zar) OVER w AS previous_price_zar,
       price_zar - lag(price_zar) OVER w AS change_zar,
       round(100.0 * (price_zar - lag(price_zar) OVER w) / NULLIF(lag(price_zar) OVER w, 0), 1) AS change_pct
FROM analyst.retail_prices WINDOW w AS (PARTITION BY item, retailer ORDER BY day);

-- Price per kg / litre / unit, and name vs house brand, for fair comparisons across pack sizes.
DROP VIEW IF EXISTS analyst.retail_unit_prices CASCADE;
CREATE VIEW analyst.retail_unit_prices AS
SELECT p.day, p.item, p.category, b.brand_type, p.retailer, p.channel, p.price_zar, b.size_value, b.size_unit,
       round(p.price_zar / NULLIF(b.size_value, 0), 2) AS price_per_unit_zar,
       CASE b.size_unit WHEN 'kg' THEN 'per kg' WHEN 'l' THEN 'per litre' ELSE 'per unit' END AS unit_basis
FROM analyst.retail_prices p JOIN retail.basket b USING (item);
