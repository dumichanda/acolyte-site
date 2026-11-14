-- Demand signals: Google Trends search interest in South Africa (via Scrappa), pulled weekly.
-- Values are relative (0-100) WITHIN a group of up to 5 terms pulled together; compare terms inside a group,
-- and the same term over time.
CREATE SCHEMA IF NOT EXISTS signals;

CREATE TABLE IF NOT EXISTS signals.search_interest (
    term       TEXT NOT NULL,
    term_group TEXT NOT NULL,          -- e.g. 'property: buying vs renting'
    analyst    TEXT NOT NULL,          -- jobs, property, retail, marketplace
    day        DATE NOT NULL,
    interest   INT,                    -- 0-100, relative within the group and pull
    pulled_on  DATE NOT NULL,
    PRIMARY KEY (term, term_group, day)
);

DROP VIEW IF EXISTS analyst.search_interest CASCADE;
CREATE VIEW analyst.search_interest AS
SELECT analyst, term_group, term, day, interest,
       round(avg(interest) OVER (PARTITION BY term, term_group ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW), 1)
           AS interest_7d_avg,
       pulled_on
FROM signals.search_interest;
