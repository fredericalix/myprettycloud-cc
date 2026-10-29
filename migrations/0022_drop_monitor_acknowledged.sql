-- The per-monitor acknowledged flag is removed from the product: rules can no
-- longer read it (condition `monitor:X:acknowledged`) or set it (the
-- set_monitor_state action's optional flag). Old rule JSON containing
-- "acknowledged" keys keeps deserializing (serde ignores unknown fields);
-- old conditions referencing it now fail field parsing and evaluate to false
-- (surfaced as a parse_error in the rule's Diagnose trace).
-- `alerts.acknowledged_at` is unrelated and untouched.

ALTER TABLE monitors DROP COLUMN IF EXISTS acknowledged;
