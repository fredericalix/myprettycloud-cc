-- Per-metric time-series storage. Each Warp10 reading is its own row keyed by
-- (monitor_id, metric_name, ts). The poller inserts only metrics it actually
-- received and prunes to the last 10 per (monitor, metric). Display reads
-- "latest non-null" per metric independently, so disk's slow (~5 min) cadence
-- never makes the bar flicker between real values and n/a.
--
-- Created directly in its final form (the legacy wide-row metric_samples table
-- and its migration are intentionally dropped in the consolidated schema).

CREATE TABLE IF NOT EXISTS metric_readings (
    monitor_id  UUID NOT NULL REFERENCES monitors(id) ON DELETE CASCADE,
    metric_name TEXT NOT NULL CHECK (metric_name IN ('cpu','mem','disk','net_in','net_out')),
    ts          TIMESTAMPTZ NOT NULL,
    value       DOUBLE PRECISION NOT NULL,
    PRIMARY KEY (monitor_id, metric_name, ts)
);

CREATE INDEX IF NOT EXISTS metric_readings_monitor_metric_ts_desc
    ON metric_readings (monitor_id, metric_name, ts DESC);
