-- Audit log of every rule evaluation that produced a verdict. Used by the
-- alerts UI and for debugging ("why did this rule fire / not fire"). ~30 days.

CREATE TABLE IF NOT EXISTS rule_firings (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id          UUID REFERENCES rules ON DELETE CASCADE,
    user_id          UUID REFERENCES users ON DELETE CASCADE,
    fired_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
    trigger_kind     TEXT NOT NULL,   -- monitor_update | rule_chain | poll | webhook | escalation | test
    trigger_ref      UUID,
    outcome          TEXT NOT NULL,   -- matched | not_matched | cooldown_skipped | error
    actions_executed JSONB,
    error_message    TEXT
);

CREATE INDEX IF NOT EXISTS rule_firings_rule_fired_desc
    ON rule_firings (rule_id, fired_at DESC);
CREATE INDEX IF NOT EXISTS rule_firings_user_fired_desc
    ON rule_firings (user_id, fired_at DESC);
