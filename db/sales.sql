-- Acolyte's own sales CRM: who to sell each industry analyst to, ranked from our datasets, and the pipeline.
-- Private: only the analyst_admin login (admin key) can read or write it; the AI analyst and clients cannot.
-- POPIA: prospects are businesses. A contact person is added by the owner only, from a business source,
-- and can be deleted at any time; opt-outs go in sales.suppression and block drafting.
CREATE SCHEMA IF NOT EXISTS sales;

CREATE TABLE IF NOT EXISTS sales.prospects (
    id           SERIAL PRIMARY KEY,
    analyst      TEXT NOT NULL CHECK (analyst IN ('property', 'retail', 'marketplace', 'jobs')),
    name         TEXT NOT NULL,                 -- the business (agency, retailer, store, employer)
    segment      TEXT,                          -- e.g. 'Estate agency', 'Grocery chain', 'Recruitment agency'
    score        NUMERIC NOT NULL DEFAULT 0,    -- 0-100 fit, recomputed from the data
    rank         INT,                           -- position within the analyst's list
    reasons      JSONB NOT NULL DEFAULT '[]',   -- plain-language reasons with numbers
    metrics      JSONB NOT NULL DEFAULT '{}',
    pitch        TEXT,                          -- which analyst skills to lead with
    stage        TEXT NOT NULL DEFAULT 'prospect'
                 CHECK (stage IN ('prospect', 'researching', 'contacted', 'meeting', 'proposal', 'won', 'lost')),
    pinned       BOOLEAN NOT NULL DEFAULT FALSE,   -- on the board (the rest stay in the ranked list)
    website      TEXT,
    contact_name TEXT, contact_role TEXT, contact_email TEXT,
    next_step    TEXT, next_date DATE,
    value_zar    NUMERIC,                       -- expected monthly subscription
    notes        TEXT,
    scored_at    TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (analyst, name)
);
CREATE INDEX IF NOT EXISTS sales_prospects_board ON sales.prospects (analyst, pinned, stage);

CREATE TABLE IF NOT EXISTS sales.activities (
    id          SERIAL PRIMARY KEY,
    prospect_id INT NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
    at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    kind        TEXT NOT NULL,                  -- note | stage | email_draft | call | meeting
    text        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sales_activities_prospect ON sales.activities (prospect_id, at DESC);

CREATE TABLE IF NOT EXISTS sales.suppression (   -- businesses or addresses that asked not to be contacted
    value      TEXT PRIMARY KEY,
    reason     TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- the team and the funnel
-- Account agents: the people who work the leads. They sign in to the CRM with their own PIN and see only their leads.
CREATE TABLE IF NOT EXISTS sales.agents (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    email      TEXT NOT NULL UNIQUE,         -- where assignment and task emails go (ZeptoMail)
    analysts   TEXT[] NOT NULL DEFAULT '{property,retail,marketplace,jobs}',   -- which analysts they sell
    max_open   INT NOT NULL DEFAULT 25,      -- most open leads at once (auto-assignment stops there)
    active     BOOLEAN NOT NULL DEFAULT TRUE,
    pin_hash   TEXT, pin_salt TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login TIMESTAMPTZ
);
ALTER TABLE sales.prospects ADD COLUMN IF NOT EXISTS agent_id INT REFERENCES sales.agents(id) ON DELETE SET NULL;
ALTER TABLE sales.prospects ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
-- POPIA s69: one unsolicited email asking permission; anything further only after a yes.
ALTER TABLE sales.prospects ADD COLUMN IF NOT EXISTS consent TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE sales.prospects ADD COLUMN IF NOT EXISTS consent_at TIMESTAMPTZ;
ALTER TABLE sales.prospects ADD COLUMN IF NOT EXISTS last_emailed_at TIMESTAMPTZ;
DO $$ BEGIN
  ALTER TABLE sales.prospects ADD CONSTRAINT prospects_consent_check
    CHECK (consent IN ('unknown', 'requested', 'granted', 'declined', 'no_response', 'opted_out'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS sales_prospects_agent ON sales.prospects (agent_id, stage);

-- Every outreach email: drafted by the platform, approved by the agent (or auto-approved), then sent.
CREATE TABLE IF NOT EXISTS sales.outbox (
    id          SERIAL PRIMARY KEY,
    prospect_id INT NOT NULL REFERENCES sales.prospects(id) ON DELETE CASCADE,
    agent_id    INT REFERENCES sales.agents(id) ON DELETE SET NULL,
    kind        TEXT NOT NULL CHECK (kind IN ('permission', 'pack', 'followup')),
    step        INT NOT NULL DEFAULT 1,
    to_email    TEXT NOT NULL,
    subject     TEXT NOT NULL,
    body        TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'manual', 'skipped', 'failed')),
    due_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at     TIMESTAMPTZ,
    transport   TEXT,                       -- smtp | brevo | manual (sent by the agent from their own mail app)
    error       TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (prospect_id, kind, step)
);
CREATE INDEX IF NOT EXISTS sales_outbox_queue ON sales.outbox (status, due_at);

-- Funnel switches, set on the CRM's Team & settings panel.
CREATE TABLE IF NOT EXISTS sales.settings (
    key   TEXT PRIMARY KEY,
    value JSONB NOT NULL
);
INSERT INTO sales.settings (key, value) VALUES
  ('auto_assign', 'true'), ('assign_per_run', '5'), ('auto_draft', 'true'), ('auto_send', 'false'),
  ('daily_send_cap', '20'), ('followup_days', '[3, 10]'), ('no_reply_days', '14'), ('notify_agents', 'true')
ON CONFLICT (key) DO NOTHING;

-- Website enquiries (the Contact sales form). Each one also becomes a pinned prospect for the analyst asked about.
CREATE TABLE IF NOT EXISTS sales.enquiries (
    id           SERIAL PRIMARY KEY,
    at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    first_name   TEXT NOT NULL, last_name TEXT NOT NULL,
    email        TEXT NOT NULL, phone TEXT NOT NULL,
    job_role     TEXT NOT NULL, company TEXT NOT NULL, company_type TEXT NOT NULL, industry TEXT NOT NULL,
    province     TEXT NOT NULL, postal_code TEXT,
    analyst      TEXT NOT NULL,            -- property | retail | marketplace | jobs | own_data | not_sure
    nature       TEXT NOT NULL,            -- sales | support | billing | privacy
    message      TEXT,
    marketing    BOOLEAN NOT NULL DEFAULT FALSE,   -- ticked "send me the monthly report and news"
    prospect_id  INT REFERENCES sales.prospects(id) ON DELETE SET NULL,
    handled      BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS sales_enquiries_at ON sales.enquiries (at DESC);
