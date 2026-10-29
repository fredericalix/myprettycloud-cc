use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Pulsar payload for the `cc-webhooks` topic. The raw CC body is passed
/// through verbatim; the consumer parses it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BusMessage {
    pub token: String,
    pub user_id: Uuid,
    pub cc_org_id: String,
    #[serde(with = "serde_bytes")]
    pub raw_body: Vec<u8>,
    pub received_at_ms: i64,
}
