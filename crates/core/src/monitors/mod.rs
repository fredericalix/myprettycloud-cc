//! Monitor sync (reconcile CC apps/addons → monitor rows) + state-name mapping.
//! The unified poller lives in `crate::poller`.

pub mod state_map;
pub mod sync;
