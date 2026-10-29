//! myprettycloud core library.
//!
//! Holds the shared foundation (config, errors, auth, CC client, DB, state)
//! and — across later milestones — the Warp10 client, realtime hub, unified
//! poller, rule engine, notifications, Pulsar bus, webhooks, feature domains
//! (town / metrics / monitor) and the MCP server.

pub mod auth;
pub mod bus;
pub mod cc;
pub mod config;
pub mod db;
pub mod domains;
pub mod error;
pub mod groups;
pub mod handlers;
pub mod monitors;
pub mod mcp;
pub mod notifications;
pub mod poller;
pub mod realtime;
pub mod rules;
pub mod state;
pub mod warp10;
pub mod webhooks;

pub use config::Config;
pub use error::{AppError, AppResult};
pub use state::AppState;
