use crate::auth::authz::{new_org_cache, OrgCache};
use crate::bus::{EscalationProducer, WebhookProducer};
use crate::config::Config;
use crate::realtime::OrgBus;
use crate::warp10::TokenCache;
use sqlx::PgPool;
use std::sync::Arc;

/// Shared application state, cloned into every handler.
///
/// Grows across milestones: M6 adds the poller's sticky deploy-state maps.
#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub http_client: reqwest::Client,
    pub config: Arc<Config>,
    /// Short-lived per-user org membership cache (tenant isolation).
    pub org_cache: OrgCache,
    /// In-memory Warp10 read-token cache (durable layer is `warp10_tokens`).
    pub warp10_cache: Arc<TokenCache>,
    /// Per-instance realtime hub. Frames arrive via the Postgres NOTIFY bridge.
    pub ws_bus: Arc<OrgBus>,
    /// Pulsar producer for the durable webhook inbox (disabled if no broker).
    pub bus: Arc<WebhookProducer>,
    /// Pulsar producer for delayed rule escalations (disabled if no broker).
    pub escalation_producer: Arc<EscalationProducer>,
}

impl AppState {
    /// Build state with Pulsar producers disabled (the default; real producers
    /// are attached via [`with_producers`] once a broker connection succeeds).
    pub fn new(db: PgPool, config: Config) -> Self {
        let http_client = reqwest::Client::builder()
            .user_agent("myprettycloud/0.1")
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        Self {
            db,
            http_client,
            config: Arc::new(config),
            org_cache: new_org_cache(),
            warp10_cache: Arc::new(TokenCache::new()),
            ws_bus: Arc::new(OrgBus::new()),
            bus: Arc::new(WebhookProducer::disabled()),
            escalation_producer: Arc::new(EscalationProducer::disabled()),
        }
    }

    /// Attach live Pulsar producers (alerting escalations + webhook inbox).
    pub fn with_producers(mut self, bus: WebhookProducer, escalation: EscalationProducer) -> Self {
        self.bus = Arc::new(bus);
        self.escalation_producer = Arc::new(escalation);
        self
    }
}
