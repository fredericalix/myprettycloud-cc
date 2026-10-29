-- Cross-instance dedup window for incoming CC webhooks.
-- INSERT ... ON CONFLICT DO NOTHING: if the row exists, it's a duplicate, drop.
-- Purged periodically (rows past expires_at are eligible).

CREATE TABLE IF NOT EXISTS webhook_dedup (
    key        TEXT PRIMARY KEY,
    expires_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS webhook_dedup_expires_at ON webhook_dedup (expires_at);
