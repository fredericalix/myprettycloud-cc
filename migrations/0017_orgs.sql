-- Thin per-user cache of Clever Cloud organisations, refreshed from
-- /v2/organisations. Backs the monitor-domain handlers + MCP `list_orgs`.
-- (Tenant-isolation membership checks still go through the in-memory OrgCache
-- in authz; this table is a durable convenience list.)

CREATE TABLE IF NOT EXISTS orgs (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    cc_org_id    TEXT NOT NULL,
    name         TEXT,
    avatar_url   TEXT,
    refreshed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, cc_org_id)
);
