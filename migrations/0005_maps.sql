-- One city map per (user, org). Cells serialized as JSONB by the frontend
-- (hex coord, tile, building, app/addon binding, elevation, rotation). The
-- unified poller reads cells_json to know which resources to render live.

CREATE TABLE IF NOT EXISTS maps (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    cc_org_id  TEXT NOT NULL,
    name       TEXT NOT NULL DEFAULT 'My City',
    cells_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    version    INT NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, cc_org_id)
);

CREATE INDEX IF NOT EXISTS maps_user_org ON maps (user_id, cc_org_id);
