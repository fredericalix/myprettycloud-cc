//! Metrics domain: the historical, bucketized time-series query API behind the
//! building "Metrics" drawer (ECharts). Distinct from the live-status
//! `warp10::fetch_metrics` "last point" path used by the poller.

pub mod client;
mod routes;
pub mod templates;

pub use routes::router;
