-- Supporting index for the poller's per-tick "due monitors" query
-- (poller.rs::poll_once): it filters on the static predicates below and orders
-- by last_poll_at ASC NULLS FIRST with a LIMIT. Without this, every 60s tick on
-- every instance does a full seq scan + sort of `monitors`, degrading linearly
-- with monitor count. The partial predicate matches the query's static filters;
-- the (now() - interval) range and the LIMIT are then satisfied straight from
-- the index order.
CREATE INDEX IF NOT EXISTS monitors_due
    ON monitors (last_poll_at ASC NULLS FIRST)
    WHERE enabled
      AND kind <> 'synthetic'
      AND cc_org_id IS NOT NULL
      AND cc_resource_id IS NOT NULL
      AND cc_metrics_id IS NOT NULL;
