-- Per-scene ambiance settings (wind / water / day-night / particles / clouds),
-- stored alongside the map so each org's city reloads its own toggles.
ALTER TABLE maps
    ADD COLUMN IF NOT EXISTS settings JSONB NOT NULL DEFAULT '{}'::jsonb;
