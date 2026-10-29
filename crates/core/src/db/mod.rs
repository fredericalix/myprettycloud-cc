//! Database repositories. All FKs cascade from `users`.

pub mod alerts;
pub mod maps;
pub mod metric_readings;
pub mod monitor_groups;
pub mod monitor_state_history;
pub mod monitors;
pub mod notification_channels;
pub mod orgs;
pub mod rule_firings;
pub mod rule_state_captures;
pub mod rules;
pub mod scene_templates;
pub mod users;
pub mod warp10_tokens;
pub mod webhook_configs;
pub mod webhook_dedup;
