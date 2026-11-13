-- Acolyte SA Automation Opportunity Index — schema
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS jobs (
    id                  TEXT PRIMARY KEY,          -- "<source>:<source_id>"
    source              TEXT NOT NULL,             -- 'adzuna' | 'demo'
    is_demo             BOOLEAN NOT NULL DEFAULT FALSE,
    title               TEXT NOT NULL,
    company             TEXT,
    description         TEXT,
    province            TEXT,
    city                TEXT,
    category            TEXT,                      -- source category, e.g. "Accounting & Finance Jobs"
    contract_type       TEXT,
    contract_time       TEXT,
    salary_min          NUMERIC,                   -- annual, ZAR
    salary_max          NUMERIC,
    salary_is_predicted BOOLEAN,
    posted_at           TIMESTAMPTZ,
    url                 TEXT,
    search_term         TEXT,
    fetched_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    raw                 JSONB
);
-- Added for enrichment (see crm.sql)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id INT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_description TEXT;     -- full ad text from the employer's own page
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_description_url TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS full_description_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS jobs_posted_idx ON jobs (posted_at);
CREATE INDEX IF NOT EXISTS jobs_demo_idx   ON jobs (is_demo);

CREATE TABLE IF NOT EXISTS classifications (
    job_id            TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    role_family       TEXT NOT NULL,
    automation_score  INT  NOT NULL CHECK (automation_score BETWEEN 0 AND 100),
    automatable_tasks TEXT[] NOT NULL DEFAULT '{}',
    acolyte_service   TEXT NOT NULL,
    rationale         TEXT,
    method            TEXT NOT NULL,             -- 'rules' | 'claude'
    model             TEXT,
    classified_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fetch_log (
    id          BIGSERIAL PRIMARY KEY,
    run_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    source      TEXT NOT NULL,
    search_term TEXT,
    page        INT,
    results     INT,
    status      TEXT
);

-- Typical annual salary per role family (ZAR). Used when a posting has no salary.
-- Rough planning figures — refine with real Adzuna salary data over time.
CREATE TABLE IF NOT EXISTS family_salary_default (
    role_family   TEXT PRIMARY KEY,
    annual_salary NUMERIC NOT NULL
);
