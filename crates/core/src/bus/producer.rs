use crate::bus::BusMessage;
use anyhow::{Context, Result};
use pulsar::{producer, Pulsar, TokioExecutor};
use tokio::sync::Mutex;

/// Producer for the `cc-webhooks` topic. `inner` is `None` when Pulsar is
/// disabled — `send_webhook` then logs and no-ops.
pub struct WebhookProducer {
    inner: Option<Mutex<producer::Producer<TokioExecutor>>>,
}

impl WebhookProducer {
    pub async fn build(pulsar: &Pulsar<TokioExecutor>, topic: &str, instance_id: &str) -> Result<Self> {
        // Producer name unique per instance to avoid ProducerBusy on stale conns.
        let unique = uuid::Uuid::new_v4().simple().to_string();
        let name = format!("myprettycloud-producer-{instance_id}-{unique}");
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

    /// A no-op producer used when Pulsar is not configured.
    pub fn disabled() -> Self {
        Self { inner: None }
    }

    pub fn is_enabled(&self) -> bool {
        self.inner.is_some()
    }

    pub async fn send_webhook(&self, msg: &BusMessage) -> Result<()> {
        let Some(inner) = &self.inner else {
            tracing::warn!("Pulsar disabled — dropping webhook (no durable inbox)");
            return Ok(());
        };
        let payload = serde_json::to_vec(msg)?;
        let partition_key = msg.cc_org_id.clone();
        let mut guard = inner.lock().await;
        let receipt = guard
            .send_non_blocking(producer::Message {
                partition_key: Some(partition_key),
                payload,
                ..Default::default()
            })
            .await?;
        receipt.await?; // block on broker ack (correctness over throughput)
        Ok(())
    }
}
