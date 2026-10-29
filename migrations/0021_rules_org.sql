-- Tag each rule with the Clever Cloud org it belongs to, so the Workflows
-- manager can list rules per org. Rules stay user-scoped (user_id is still the
-- owner / execution context); cc_org_id is purely a filter dimension derived
-- from the monitors a rule watches. TEXT to match `monitors.cc_org_id`.

ALTER TABLE rules ADD COLUMN IF NOT EXISTS cc_org_id TEXT;

CREATE INDEX IF NOT EXISTS rules_user_org ON rules (user_id, cc_org_id);

-- Backfill from each rule's monitor dependencies: a rule belongs to the org of
-- the monitors it watches. Pick one org per rule (rules realistically reference
-- a single org's monitors). Group-only rules and rules with deleted monitors
-- stay NULL until their next save re-tags them.
UPDATE rules r
SET cc_org_id = sub.cc_org_id
FROM (
    SELECT DISTINCT ON (d.rule_id) d.rule_id, m.cc_org_id
    FROM rule_dependencies d
    JOIN monitors m ON m.id = d.ref_id
    WHERE d.ref_kind = 'monitor' AND m.cc_org_id IS NOT NULL
    ORDER BY d.rule_id, m.cc_org_id
) sub
WHERE r.id = sub.rule_id
  AND r.cc_org_id IS NULL;
