-- Enrichment + CRM layer. Safe to re-run.
--
--   jobs ──< job_insights          tools, skills, experience pulled from each ad
--   jobs >── companies             the employer behind each ad (recruiters flagged)
--   companies ──< contacts         published company contacts (generic inboxes first)
--   companies ──< opportunities    one sales opportunity per employer, with a stage
--   opportunities ──< activities   drafts, sent emails, replies, notes, stage changes
--   suppression                    opt-outs: never contact these again (POPIA s69)
--   daily_stats                    one row per day, for trends over time

-- (job columns company_id / full_description* are added in schema.sql)

CREATE TABLE IF NOT EXISTS companies (
    id            SERIAL PRIMARY KEY,
    name          TEXT NOT NULL,
    norm_key      TEXT NOT NULL UNIQUE,            -- lower-case name without Ltd/Pty/LLC, used to merge spellings
    is_recruiter  BOOLEAN NOT NULL DEFAULT FALSE,  -- advertises for other employers: not a sales lead
    website       TEXT,                            -- bare domain
    industry      TEXT,
    size_band     TEXT,
    hq_city       TEXT,
    hq_province   TEXT,
    lat           DOUBLE PRECISION,
    lon           DOUBLE PRECISION,
    linkedin_url  TEXT,
    description   TEXT,
    source        TEXT,                            -- 'research' | 'search' | 'jobs'
    confidence    TEXT,
    enriched_at   TIMESTAMPTZ,
    enrich_tries  INT NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Foreign firms (e.g. overseas companies hiring remote SA staff) are kept for market stats but left out of the sales pipeline.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_foreign BOOLEAN;   -- NULL = not checked yet

CREATE TABLE IF NOT EXISTS company_aliases (       -- every spelling seen in ads -> one company
    alias_key   TEXT PRIMARY KEY,
    company_id  INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS job_insights (
    job_id           TEXT PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    tools            TEXT[] NOT NULL DEFAULT '{}',  -- software named in the ad (Pastel, SAP, Excel…)
    skills           TEXT[] NOT NULL DEFAULT '{}',
    qualifications   TEXT[] NOT NULL DEFAULT '{}',
    experience_years INT,
    seniority        TEXT,                          -- junior | mid | senior | manager
    work_mode        TEXT,                          -- onsite | hybrid | remote
    languages        TEXT[] NOT NULL DEFAULT '{}',
    text_source      TEXT,                          -- 'snippet' | 'full'
    method           TEXT NOT NULL DEFAULT 'rules',
    extracted_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contacts (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    name            TEXT,                           -- blank for generic inboxes (info@, hello@)
    role            TEXT,
    email           TEXT,
    phone           TEXT,
    linkedin_url    TEXT,
    is_generic      BOOLEAN NOT NULL DEFAULT TRUE,
    source          TEXT,                           -- where it was published, e.g. the contact page URL
    consent_status  TEXT NOT NULL DEFAULT 'unknown' -- unknown | requested | granted | declined | opted_out
                    CHECK (consent_status IN ('unknown','requested','granted','declined','opted_out')),
    consent_at      TIMESTAMPTZ,
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (company_id, email)
);

CREATE TABLE IF NOT EXISTS opportunities (
    id              SERIAL PRIMARY KEY,
    company_id      INT NOT NULL UNIQUE REFERENCES companies(id) ON DELETE CASCADE,
    stage           TEXT NOT NULL DEFAULT 'new'
                    CHECK (stage IN ('new','researching','contacted','replied','meeting','proposal','won','lost','not_a_fit')),
    est_value       NUMERIC,                        -- automatable value of their open roles (R/yr)
    pitch           TEXT,                           -- the Acolyte service that fits best
    next_action     TEXT,
    next_action_at  DATE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activities (
    id              SERIAL PRIMARY KEY,
    opportunity_id  INT REFERENCES opportunities(id) ON DELETE CASCADE,
    company_id      INT REFERENCES companies(id) ON DELETE CASCADE,
    contact_id      INT REFERENCES contacts(id) ON DELETE SET NULL,
    kind            TEXT NOT NULL                   -- email_draft | email_sent | reply | call | meeting | note | stage
                    CHECK (kind IN ('email_draft','email_sent','reply','call','meeting','note','stage')),
    subject         TEXT,
    body            TEXT,
    meta            JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activities_opp_idx ON activities (opportunity_id, created_at);

CREATE TABLE IF NOT EXISTS suppression (            -- opt-outs and bounces: checked before every draft/send
    value       TEXT PRIMARY KEY,                   -- an email address or a whole domain
    reason      TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_stats (
    day                DATE PRIMARY KEY,
    jobs               INT,
    employers          INT,
    recruiter_jobs     INT,
    avg_score          NUMERIC,
    automatable_value  NUMERIC,
    top_tools          JSONB,
    by_family          JSONB
);

-- One row per hiring employer (recruiters excluded): the lead list.
CREATE OR REPLACE VIEW v_company_leads AS
SELECT c.*,
       count(v.id)                                   AS open_roles,
       round(avg(v.automation_score))                AS avg_score,
       sum(v.automatable_value_zar)                  AS automatable_value,
       (array_agg(v.role_family ORDER BY v.automatable_value_zar DESC))[1] AS main_family,
       (array_agg(v.acolyte_service ORDER BY v.automatable_value_zar DESC))[1] AS best_pitch,
       array_agg(DISTINCT v.role_family)             AS families,
       max(v.posted_at)                              AS last_posted
FROM companies c
JOIN v_jobs_value v ON v.company_id = c.id
GROUP BY c.id;
