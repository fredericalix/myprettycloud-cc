-- Scene templates: user-owned, reusable map layouts (tiles + decorations +
-- decorative buildings) with no CC resource bindings. Can be private or shared
-- publicly with every other user. Not org-scoped — reused across orgs freely.
CREATE TABLE IF NOT EXISTS scene_templates (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id   UUID NOT NULL REFERENCES users ON DELETE CASCADE,
    name       TEXT NOT NULL,
    visibility TEXT NOT NULL DEFAULT 'private' CHECK (visibility IN ('private', 'public')),
    cells_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scene_templates_owner ON scene_templates (owner_id);
CREATE INDEX IF NOT EXISTS scene_templates_public
    ON scene_templates (visibility) WHERE visibility = 'public';
