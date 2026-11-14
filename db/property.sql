-- SA property dataset (Private Property via the Scrappa API; Property24 can be added as another `portal`).
-- Listing pages are sampled daily per region; stock counts cover every region in full.
-- POPIA: agent names and photos are NOT stored, only the agency/office (a business).
-- Raw tables live in their own schema `property`; the AI analyst only sees the curated views in `analyst`.
CREATE SCHEMA IF NOT EXISTS property;

CREATE TABLE IF NOT EXISTS property.locations (
    portal      TEXT NOT NULL,
    location_id INT  NOT NULL,
    name        TEXT NOT NULL,
    level       INT  NOT NULL,            -- 1 province, 2 region
    province    TEXT NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (portal, location_id)
);

CREATE TABLE IF NOT EXISTS property.listings (
    portal        TEXT NOT NULL,
    listing_id    BIGINT NOT NULL,
    portal_ref    TEXT,
    deal_type     TEXT NOT NULL,          -- sale | rent
    category      TEXT NOT NULL,          -- residential | commercial | farm
    province      TEXT,
    region        TEXT,
    suburb        TEXT,
    property_type TEXT,                   -- House, Apartment / Flat, Townhouse, Vacant Land, ...
    title         TEXT,
    price         NUMERIC,                -- rand; monthly for rentals
    price_type    TEXT,                   -- PerMonth etc. (rentals)
    is_poa        BOOLEAN,
    on_auction    BOOLEAN,
    beds          NUMERIC,
    baths         NUMERIC,
    garages       NUMERIC,
    parking       NUMERIC,
    floor_m2      NUMERIC,
    land_m2       NUMERIC,
    agency        TEXT,
    office        TEXT,
    is_new        BOOLEAN,
    price_reduced BOOLEAN,
    offer_pending BOOLEAN,
    is_sold       BOOLEAN,
    url           TEXT,
    first_seen    DATE NOT NULL DEFAULT current_date,
    last_seen     DATE NOT NULL DEFAULT current_date,
    first_price   NUMERIC,
    PRIMARY KEY (portal, listing_id)
);
CREATE INDEX IF NOT EXISTS property_listings_area ON property.listings (province, region, deal_type);

-- Daily asking-price observations: shows reductions and how long listings stay up.
CREATE TABLE IF NOT EXISTS property.prices (
    portal     TEXT NOT NULL,
    listing_id BIGINT NOT NULL,
    seen_on    DATE NOT NULL,
    price      NUMERIC,
    PRIMARY KEY (portal, listing_id, seen_on)
);

-- Full listing counts per region, per day: supply on the market.
CREATE TABLE IF NOT EXISTS property.stock (
    portal      TEXT NOT NULL,
    day         DATE NOT NULL,
    location_id INT  NOT NULL,
    province    TEXT NOT NULL,
    region      TEXT,                     -- NULL = whole province
    deal_type   TEXT NOT NULL,
    category    TEXT NOT NULL,
    listings    INT  NOT NULL,
    PRIMARY KEY (portal, day, location_id, deal_type, category)
);

CREATE TABLE IF NOT EXISTS property.bond_rate (
    day  DATE PRIMARY KEY,
    rate NUMERIC NOT NULL
);

-- ---------------- Analyst views (read-only semantic layer) ----------------
DROP VIEW IF EXISTS analyst.property_listings, analyst.property_stock, analyst.property_price_changes,
                    analyst.bond_rate CASCADE;

CREATE VIEW analyst.property_listings AS
SELECT portal, listing_id, deal_type, category, replace(province, 'KwaZulu Natal', 'KwaZulu-Natal') AS province,
       region, suburb, property_type, title,
       price AS price_zar, price_type, is_poa, on_auction, beds, baths, garages, parking, floor_m2, land_m2,
       CASE WHEN floor_m2 > 0 AND price > 0 THEN round(price / floor_m2) END AS price_per_m2,
       COALESCE(agency, 'Private seller / not stated') AS agency, office, is_new, price_reduced, offer_pending, is_sold,
       first_price AS first_price_zar,
       CASE WHEN first_price > 0 AND price IS NOT NULL THEN round(100.0 * (price - first_price) / first_price, 1) END
                                              AS price_change_pct,
       first_seen, last_seen, (last_seen - first_seen) AS days_tracked,
       (last_seen >= current_date - 3)        AS active,
       url
FROM property.listings;

CREATE VIEW analyst.property_stock AS
SELECT portal, day, replace(province, 'KwaZulu Natal', 'KwaZulu-Natal') AS province, COALESCE(region, '(whole province)') AS region,
       (region IS NULL) AS is_province_total, deal_type, category, listings
FROM property.stock;

CREATE VIEW analyst.property_price_changes AS
SELECT p.portal, p.listing_id, replace(l.province, 'KwaZulu Natal', 'KwaZulu-Natal') AS province, l.region, l.suburb, l.deal_type, l.property_type,
       p.seen_on, p.price AS price_zar,
       p.price - lag(p.price) OVER (PARTITION BY p.portal, p.listing_id ORDER BY p.seen_on) AS change_zar
FROM property.prices p JOIN property.listings l USING (portal, listing_id);

CREATE VIEW analyst.bond_rate AS SELECT day, rate AS prime_bond_rate_pct FROM property.bond_rate;
