-- Agent harness audit log: every run and every step (model turn or tool call) is recorded.
CREATE TABLE IF NOT EXISTS agent_runs (
    id          BIGSERIAL PRIMARY KEY,
    agent       TEXT NOT NULL,
    model       TEXT NOT NULL,
    task        TEXT,
    status      TEXT NOT NULL DEFAULT 'running',   -- running | done | budget | max_steps | error
    steps       INT NOT NULL DEFAULT 0,
    tool_calls  INT NOT NULL DEFAULT 0,
    cost_usd    NUMERIC NOT NULL DEFAULT 0,
    summary     TEXT,
    error       TEXT,
    started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS agent_steps (
    id          BIGSERIAL PRIMARY KEY,
    run_id      BIGINT NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    n           INT NOT NULL,
    kind        TEXT NOT NULL,                     -- model | tool
    name        TEXT,
    input       JSONB,
    output      TEXT,                              -- truncated
    is_error    BOOLEAN NOT NULL DEFAULT FALSE,
    cost_usd    NUMERIC,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_steps_run_idx ON agent_steps (run_id, n);
