-- Append-only audit of monitor state transitions. Used by the workflow engine
-- for `for Xm` time-based conditions, and by the alerts UI. Retained ~30 days.

CREATE TABLE IF NOT EXISTS monitor_state_history (
    monitor_id UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
    state      TEXT NOT NULL,
    message    TEXT,
    changed_at TIMESTAMPTZ NOT NULL,
    source     TEXT NOT NULL,  -- 'webhook' | 'poller' | 'rule_action' | 'manual'
    PRIMARY KEY (monitor_id, changed_at)
);

CREATE INDEX IF NOT EXISTS monitor_state_history_monitor_changed_desc
    ON monitor_state_history (monitor_id, changed_at DESC);
