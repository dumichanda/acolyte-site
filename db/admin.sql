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
