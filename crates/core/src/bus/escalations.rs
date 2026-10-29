//! Delayed escalation delivery via Pulsar `deliver_at_time`.
//!
//! `Action::Escalate { delay_seconds, target_rule_id }` does not sleep
//! in-process (that would lose the escalation on restart). It publishes an
//! `EscalationMessage` on `rule-escalations` with `deliver_at_time = now +
//! delay`. The broker holds it; whichever instance is subscribed at that time
//! picks it up and re-evaluates the target rule with `Trigger::Escalation`.

use crate::db::rules;
use crate::rules::exec::{execute_rule, InFlight, Trigger};
use crate::state::AppState;
use anyhow::{Context, Result};
use chrono::Utc;
use futures::TryStreamExt;
use pulsar::{producer, Consumer, Pulsar, SubType, TokioExecutor};
use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EscalationMessage {
    pub user_id: Uuid,
    pub rule_id: Uuid,
    /// The rule that issued the Escalate action (`Trigger::Escalation::from_rule_id`).
    pub from_rule_id: Uuid,
    pub scheduled_at_ms: i64,
    pub scheduled_for_ms: i64,
}

pub struct EscalationProducer {
    inner: Option<Mutex<producer::Producer<TokioExecutor>>>,
}

impl EscalationProducer {
    pub async fn build(pulsar: &Pulsar<TokioExecutor>, topic: &str, instance_id: &str) -> Result<Self> {
        let unique = Uuid::new_v4().simple().to_string();
        let name = format!("myprettycloud-escalator-{instance_id}-{unique}");
        let inner = pulsar
            .producer()
            .with_topic(topic)
            .with_name(name)
            .build()
            .await
            .with_context(|| format!("build Pulsar producer on {topic}"))?;
        Ok(Self {
            inner: Some(Mutex::new(inner)),
        })
    }

    pub fn disabled() -> Self {
        Self { inner: None }
    }

    pub async fn schedule(
        &self,
        user_id: Uuid,
        rule_id: Uuid,
        from_rule_id: Uuid,
        delay_seconds: u32,
    ) -> Result<()> {
        let Some(inner) = &self.inner else {
            tracing::warn!(
                %rule_id,
                delay_seconds,
                "Pulsar disabled — escalation not scheduled (no delayed delivery)"
            );
            return Ok(());
        };
        let now_ms = Utc::now().timestamp_millis();
        let scheduled_for_ms = now_ms + (delay_seconds as i64) * 1000;
        let msg = EscalationMessage {
            user_id,
            rule_id,
            from_rule_id,
            scheduled_at_ms: now_ms,
            scheduled_for_ms,
        };
        let payload = serde_json::to_vec(&msg)?;
        let mut guard = inner.lock().await;
        let receipt = guard
            .send_non_blocking(producer::Message {
                partition_key: Some(rule_id.to_string()),
                payload,
                deliver_at_time: Some(scheduled_for_ms),
                ..Default::default()
            })
            .await?;
        drop(receipt); // don't block the user-facing action on broker ack
        Ok(())
    }
}

pub async fn run_consumer(
    pulsar: Pulsar<TokioExecutor>,
    topic: String,
    subscription: String,
    state: AppState,
) -> Result<()> {
    let mut consumer: Consumer<Vec<u8>, _> = pulsar
        .consumer()
        .with_topic(topic.clone())
        .with_subscription_type(SubType::Shared)
        .with_subscription(subscription)
        .build()
        .await?;
    tracing::info!(%topic, "Pulsar escalation consumer started");

    while let Some(msg) = consumer.try_next().await? {
        if let Err(e) = process_one(&state, &msg.payload.data).await {
            tracing::error!(error = ?e, "escalation processing failed; acking + dropping");
        }
        let _ = consumer.ack(&msg).await;
    }
    Ok(())
}

async fn process_one(state: &AppState, payload: &[u8]) -> Result<()> {
    let escalation: EscalationMessage = match serde_json::from_slice(payload) {
        Ok(m) => m,
        Err(e) => {
            tracing::error!(error = ?e, "failed to parse EscalationMessage");
            return Ok(());
        }
    };
    let rule = match rules::find(&state.db, escalation.user_id, escalation.rule_id).await? {
        Some(r) => r,
        None => {
            tracing::info!(rule_id = %escalation.rule_id, "escalation target rule gone; dropping");
            return Ok(());
        }
    };
    let in_flight = InFlight::new();
    let outcome = execute_rule(
        state,
        &rule,
        Trigger::Escalation {
            from_rule_id: escalation.from_rule_id,
        },
        0,
        &in_flight,
    )
    .await?;
    tracing::info!(rule_id = %rule.id, ?outcome, "escalation fired");
    Ok(())
}
