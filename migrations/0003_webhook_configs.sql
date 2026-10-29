-- One CC notification webhook per (user, org). `token` is the opaque secret
-- embedded in the URL CC posts to — the only auth on the receiver, since CC
-- webhooks carry no HMAC. `cc_webhook_id` lets us delete the webhook later.
-- (myccmonitor's richer shape: subscribed_events + delivery health.)

CREATE TABLE IF NOT EXISTS webhook_configs (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id         TEXT NOT NULL,
    token             TEXT UNIQUE NOT NULL,
    cc_webhook_id     TEXT,
    subscribed_events TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    last_received_at  TIMESTAMPTZ,
    failure_count     INT NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, cc_org_id)
);

CREATE INDEX IF NOT EXISTS webhook_configs_token ON webhook_configs (token);
