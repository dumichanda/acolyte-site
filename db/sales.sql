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
