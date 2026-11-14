-- Admin schema: usage log for the AI analyst + summary views for the admin page.
-- Read by the analyst server with its own login (analyst_admin), never by the AI's read-only login (analyst_web).
CREATE SCHEMA IF NOT EXISTS admin;

CREATE TABLE IF NOT EXISTS admin.analyst_usage (
    id           BIGSERIAL PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    visitor      TEXT,            -- daily-salted hash of the visitor's IP: counts unique visitors, stores no IP
    session_id   TEXT,
    country      TEXT,
    question     TEXT,
    mode         TEXT,
    tier         TEXT,
    models       TEXT[],
    status       TEXT,            -- done | error
    error        TEXT,
    queries      JSONB,           -- [{title, sql, rows}]
    charts       INT,
    report       BOOLEAN,
    cost_usd     NUMERIC,
    input_tokens INT, cache_read_tokens INT, cache_write_tokens INT, output_tokens INT,
    duration_ms  INT
);
CREATE INDEX IF NOT EXISTS analyst_usage_at_idx ON admin.analyst_usage (at);
-- Retention: questions are kept for 90 days (see the privacy notice).
DELETE FROM admin.analyst_usage WHERE at < now() - interval '90 days';

DROP VIEW IF EXISTS admin.agent_costs, admin.adzuna_usage, admin.pipeline_totals, admin.crm_totals CASCADE;

CREATE VIEW admin.agent_costs AS
SELECT id, agent, model, status, steps, tool_calls, cost_usd, left(summary, 300) AS summary, error, started_at, finished_at
FROM agent_runs;

CREATE VIEW admin.adzuna_usage AS
SELECT date_trunc('month', run_at)::date AS month, source, count(*) AS calls, sum(results) AS results
FROM fetch_log GROUP BY 1, 2;

CREATE VIEW admin.pipeline_totals AS
SELECT (SELECT count(*) FROM jobs WHERE NOT is_demo) AS jobs_total,
       (SELECT count(*) FROM v_jobs_value) AS jobs_open,
       (SELECT count(*) FROM jobs WHERE NOT is_demo AND fetched_at >= now() - interval '7 days') AS jobs_7d,
       (SELECT count(*) FROM companies) AS companies,
       (SELECT count(*) FROM companies WHERE is_recruiter) AS recruiters,
       (SELECT count(*) FROM companies WHERE COALESCE(is_foreign, FALSE)) AS foreign_firms,
       (SELECT count(*) FROM companies WHERE website IS NOT NULL) AS with_website,
       (SELECT max(run_at) FROM fetch_log) AS last_fetch;

CREATE VIEW admin.crm_totals AS
SELECT o.stage, count(*) AS opportunities,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id AND a.kind = 'email_draft')) AS with_draft,
       count(*) FILTER (WHERE EXISTS (SELECT 1 FROM activities a WHERE a.opportunity_id = o.id AND a.kind = 'email_sent')) AS emailed
FROM opportunities o GROUP BY 1;

-- ---------------------------------------------------------------- client accounts, chat history, dashboards
CREATE TABLE IF NOT EXISTS admin.accounts (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL,
    plan        TEXT NOT NULL DEFAULT 'junior' CHECK (plan IN ('junior', 'senior', 'owner')),
    pin_salt    TEXT NOT NULL,
    pin_hash    TEXT NOT NULL,          -- PBKDF2-SHA256; the PIN itself is never stored
    active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login  TIMESTAMPTZ
);
ALTER TABLE admin.analyst_usage ADD COLUMN IF NOT EXISTS account_id INT;
CREATE INDEX IF NOT EXISTS analyst_usage_account_idx ON admin.analyst_usage (account_id, at);

CREATE TABLE IF NOT EXISTS admin.conversations (
    id          TEXT PRIMARY KEY,       -- = analyst session id
    account_id  INT NOT NULL REFERENCES admin.accounts(id) ON DELETE CASCADE,
    title       TEXT,
    items       JSONB NOT NULL DEFAULT '[]',   -- what the chat shows
    artifacts   JSONB NOT NULL DEFAULT '{}',   -- charts and reports
    state       JSONB,                          -- model conversation + datasets, to continue later
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_account_idx ON admin.conversations (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS admin.dashboards (
    id          SERIAL PRIMARY KEY,
    account_id  INT NOT NULL REFERENCES admin.accounts(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS admin.dashboard_tiles (
    id           SERIAL PRIMARY KEY,
    dashboard_id INT NOT NULL REFERENCES admin.dashboards(id) ON DELETE CASCADE,
    position     INT NOT NULL DEFAULT 0,
    size         TEXT NOT NULL DEFAULT 'half' CHECK (size IN ('half', 'full')),
    spec         JSONB NOT NULL,        -- {type, x, y, title, subtitle, value_format, sql}: re-run live
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
