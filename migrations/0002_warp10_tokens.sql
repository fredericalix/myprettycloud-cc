-- Cached Warp10 read tokens, per (user, org).
--
-- Per-user (not per-org) is mandatory: sharing a single token across users in
-- the same org is a data leak — one user could read metrics fetched with
-- another user's CC OAuth credentials. (mycctown migration 002.)

CREATE TABLE IF NOT EXISTS warp10_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id   TEXT NOT NULL,
    token_enc   BYTEA NOT NULL,
    token_nonce BYTEA NOT NULL,
    fetched_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at  TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS warp10_tokens_user_org
    ON warp10_tokens (user_id, cc_org_id);
CREATE INDEX IF NOT EXISTS warp10_tokens_expiry
    ON warp10_tokens (expires_at);
