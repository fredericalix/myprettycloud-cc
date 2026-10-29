//! Town domain: the 3D city's persistent map (hex cells binding CC resources to
//! buildings) + the city-facing org data (apps/addons/dependencies/webhook
//! setup) the builder and scene consume. Live status/metrics that animate the
//! city are produced by the poller and delivered over the realtime layer.

mod orgs;
mod routes;

use crate::state::AppState;
use axum::Router;

pub fn router() -> Router<AppState> {
    Router::new().merge(routes::router()).merge(orgs::router())
}
