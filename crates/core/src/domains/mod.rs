//! Feature domains layered on the shared foundation. Each owns its routes and
//! domain logic but shares `AppState`, `db`, `realtime` and the rule engine.

pub mod metrics;
pub mod town;
