-- Talent extras for the Talent Analyst (Scrappa): Glassdoor salary benchmarks and employer ratings.
-- Extra job ads from Google Jobs and LinkedIn go into the main `jobs` table (source 'google_jobs' / 'linkedin').
CREATE SCHEMA IF NOT EXISTS talent;

CREATE TABLE IF NOT EXISTS talent.salary_benchmarks (
    job_title      TEXT NOT NULL,          -- title searched, e.g. 'bookkeeper'
    role_family    TEXT,                   -- Acolyte role family it represents
    location       TEXT NOT NULL,          -- 'South Africa' or a province
    location_type  TEXT NOT NULL,          -- COUNTRY | STATE
    location_id    INT  NOT NULL,
    currency       TEXT,
    pay_period     TEXT,                   -- MONTHLY (Glassdoor SA)
    base_p10 NUMERIC, base_p25 NUMERIC, base_p50 NUMERIC, base_p75 NUMERIC, base_p90 NUMERIC,
    total_p50      NUMERIC,                -- base + additional pay, median
    salaries_count INT,
    confidence     TEXT,
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_title, location_id)
);

CREATE TABLE IF NOT EXISTS talent.employer_ratings (
    company        TEXT PRIMARY KEY,       -- Acolyte company name (companies.name)
    company_id     INT,
    glassdoor_id   INT,
    glassdoor_name TEXT,
    rating         NUMERIC,                -- 1-5
    review_count   INT,
    salary_count   INT,
    url            TEXT,
    matched        BOOLEAN NOT NULL,       -- FALSE = searched, no confident match
    fetched_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

DROP VIEW IF EXISTS analyst.salary_benchmarks, analyst.employer_ratings CASCADE;

CREATE VIEW analyst.salary_benchmarks AS
SELECT job_title, role_family, location, location_type, currency, pay_period,
       base_p10 AS monthly_p10, base_p25 AS monthly_p25, base_p50 AS monthly_median, base_p75 AS monthly_p75,
       base_p90 AS monthly_p90, total_p50 AS monthly_total_pay_median,
       base_p50 * 12 AS annual_median, salaries_count, confidence, fetched_at::date AS as_of
FROM talent.salary_benchmarks WHERE base_p50 IS NOT NULL;

CREATE VIEW analyst.employer_ratings AS
SELECT company AS employer, glassdoor_name, rating, review_count, salary_count, url, fetched_at::date AS as_of
FROM talent.employer_ratings WHERE matched;
