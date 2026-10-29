-- Pre-action snapshot of a monitor's state, taken the first time a matched
-- rule's set_monitor_state action (with `revert_on_recovery: true`) overwrites
-- it in an episode (ON CONFLICT DO NOTHING — later matched firings of the same
-- episode must not re-capture the already-overwritten state). Consumed
-- (DELETE … RETURNING) when the rule's outcome transitions back to
-- not_matched, restoring the captured state + message. Rows are also purged
-- when the rule is saved (an edited rule's old captures may describe a
-- different action set) and cascade away with their rule or monitor.

CREATE TABLE IF NOT EXISTS rule_state_captures (
    rule_id      UUID NOT NULL REFERENCES rules ON DELETE CASCADE,
    monitor_id   UUID NOT NULL REFERENCES monitors ON DELETE CASCADE,
    prev_state   TEXT NOT NULL,
    prev_message TEXT,
    captured_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (rule_id, monitor_id)
);
