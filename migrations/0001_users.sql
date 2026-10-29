-- Users authenticated via Clever Cloud OAuth 1.0a.
--
-- Merge of the three prototypes' `users` tables (the single coupling point —
-- every monitor table FKs here). Base: myccmonitor (display_name, cc_user_id
-- TEXT) + the MCP columns (originally migration 0018). OAuth tokens are stored
-- AES-256-GCM-encrypted; oauth_nonce holds two concatenated 12-byte AES-GCM
-- nonces: token_nonce[12] || secret_nonce[12].

CREATE TABLE IF NOT EXISTS users (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    cc_user_id       TEXT UNIQUE NOT NULL,
    email            TEXT,
    display_name     TEXT,
    oauth_token_enc  BYTEA NOT NULL,
    oauth_secret_enc BYTEA NOT NULL,
    oauth_nonce      BYTEA NOT NULL,

    -- MCP (Model Context Protocol) per-user access. Token is never stored raw;
    -- only its sha256 hash + a short display prefix.
    mcp_enabled            BOOLEAN NOT NULL DEFAULT FALSE,
    mcp_token_hash         BYTEA,
    mcp_token_prefix       TEXT,
    mcp_token_created_at   TIMESTAMPTZ,
    mcp_token_last_used_at TIMESTAMPTZ,

    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS users_mcp_token_hash_idx
    ON users (mcp_token_hash)
    WHERE mcp_token_hash IS NOT NULL;
