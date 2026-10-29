//! Apache Pulsar event bus: producers for `cc-webhooks` (30d retention, audit
//! log) and `rule-escalations` (delayed delivery via `deliver_at_time`).
//!
//! Pulsar is OPTIONAL: when `PULSAR_URL` is unset (or the broker is
//! unreachable) the producers run in a disabled mode that logs and no-ops, so
//! the city + metrics + synchronous rule evaluation still work — only durable
//! escalations and the webhook inbox are degraded.

pub mod consumer;
pub mod escalations;
pub mod message;
pub mod producer;

pub use escalations::EscalationProducer;
pub use message::BusMessage;
pub use producer::WebhookProducer;

use crate::config::Config;
use anyhow::{Context, Result};
use pulsar::{Authentication, Pulsar, TokioExecutor};

/// Connect to Pulsar if configured. `Ok(None)` when `PULSAR_URL` is unset.
pub async fn connect(cfg: &Config) -> Result<Option<Pulsar<TokioExecutor>>> {
    let Some(url) = cfg.pulsar_url.clone() else {
        tracing::info!("PULSAR_URL not set — alerting escalations + webhook inbox disabled");
        return Ok(None);
    };
    let mut builder = Pulsar::builder(url, TokioExecutor);
    if let Some(token) = cfg.pulsar_token.clone().filter(|t| !t.is_empty()) {
        builder = builder.with_auth(Authentication {
            name: "token".to_string(),
            data: token.into_bytes(),
        });
    }
    let pulsar = builder.build().await.context("connect to Pulsar broker")?;
    Ok(Some(pulsar))
}

/// Build the fully-qualified Pulsar topic name. Clever Cloud's managed Pulsar
/// assigns a tenant + namespace; topics must be
/// `persistent://{tenant}/{namespace}/{topic}`. Falls back gracefully when only
/// a namespace (or neither) is configured.
pub fn topic_name(cfg: &Config, bare: &str) -> String {
    match (&cfg.pulsar_tenant, &cfg.pulsar_namespace) {
        (Some(t), Some(ns)) if !t.is_empty() && !ns.is_empty() => {
            format!("persistent://{t}/{ns}/{bare}")
        }
        (None, Some(ns)) if !ns.is_empty() => format!("persistent://{ns}/{bare}"),
        _ => bare.to_string(),
    }
}
