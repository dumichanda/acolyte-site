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

-- History: every Glassdoor refresh is also kept here, so pay and ratings can be tracked over time.
CREATE TABLE IF NOT EXISTS talent.salary_history (
    job_title TEXT NOT NULL, location_id INT NOT NULL, location TEXT, role_family TEXT, fetched_on DATE NOT NULL,
    base_p25 NUMERIC, base_p50 NUMERIC, base_p75 NUMERIC, total_p50 NUMERIC, salaries_count INT,
    PRIMARY KEY (job_title, location_id, fetched_on)
);
CREATE TABLE IF NOT EXISTS talent.rating_history (
    company TEXT NOT NULL, fetched_on DATE NOT NULL, rating NUMERIC, review_count INT,
    PRIMARY KEY (company, fetched_on)
);
-- Seed history from current values (idempotent).
INSERT INTO talent.salary_history SELECT job_title, location_id, location, role_family, fetched_at::date, base_p25, base_p50,
       base_p75, total_p50, salaries_count FROM talent.salary_benchmarks WHERE base_p50 IS NOT NULL ON CONFLICT DO NOTHING;
INSERT INTO talent.rating_history SELECT company, fetched_at::date, rating, review_count FROM talent.employer_ratings
       WHERE matched ON CONFLICT DO NOTHING;

DROP VIEW IF EXISTS analyst.salary_history, analyst.employer_rating_history, analyst.jobs_new_by_day CASCADE;

CREATE VIEW analyst.salary_history AS
SELECT job_title, role_family, location, fetched_on AS as_of, base_p50 AS monthly_median, base_p25 AS monthly_p25,
       base_p75 AS monthly_p75, salaries_count,
       base_p50 - lag(base_p50) OVER w AS change_vs_previous,
       round(100.0 * (base_p50 - lag(base_p50) OVER w) / NULLIF(lag(base_p50) OVER w, 0), 1) AS change_pct
FROM talent.salary_history WINDOW w AS (PARTITION BY job_title, location_id ORDER BY fetched_on);

CREATE VIEW analyst.employer_rating_history AS
SELECT company AS employer, fetched_on AS as_of, rating, review_count,
       rating - lag(rating) OVER w AS rating_change, review_count - lag(review_count) OVER w AS new_reviews
FROM talent.rating_history WINDOW w AS (PARTITION BY company ORDER BY fetched_on);

-- New ads per day (by posting date) for "what changed" questions.
CREATE VIEW analyst.jobs_new_by_day AS
SELECT posted_date AS day, role_family, province, source, count(*) AS new_ads
FROM analyst.jobs WHERE posted_date IS NOT NULL GROUP BY 1, 2, 3, 4;
