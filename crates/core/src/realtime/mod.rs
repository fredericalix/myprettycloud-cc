//! Real-time WebSocket layer. Each backend instance keeps a local in-memory
//! `OrgBus` (DashMap of broadcast channels per org). Producers (poller, Pulsar
//! consumers, rule engine) emit `pg_notify('ws_broadcast', payload)`; a
//! dedicated `PgListener` task on every instance picks them up and pushes onto
//! its local org channels. Clients connect to `GET /ws?org=<cc_org_id>` and
//! receive frames regardless of which instance produced them — multi-instance
//! correct. (myccmonitor base; town's per-org local poller is replaced by this.)

pub mod frame;
mod handler;

pub use frame::WsFrame;
pub use handler::router;

use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use sqlx::postgres::PgListener;
use sqlx::PgPool;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

/// Org-agnostic channel for frames not tied to a single org (e.g. rule firings).
pub const SYSTEM_CHANNEL: &str = "__system__";

const BROADCAST_CAPACITY: usize = 256;

/// Payload of `pg_notify('ws_broadcast', ...)`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BroadcastPayload {
    pub cc_org_id: String,
    pub frame: WsFrame,
}

#[derive(Default)]
pub struct OrgBus {
    inner: DashMap<String, broadcast::Sender<WsFrame>>,
    /// Last time an on-connect city poll was kicked for an org (monotonic).
    /// Throttles the burst of polls a single scene-open triggers (StrictMode
    /// double-connect, reconnect backoff, multiple tabs).
    last_poll: DashMap<String, Instant>,
}

impl OrgBus {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn subscribe(&self, cc_org_id: &str) -> broadcast::Receiver<WsFrame> {
        self.inner
            .entry(cc_org_id.to_string())
            .or_insert_with(|| broadcast::channel(BROADCAST_CAPACITY).0)
            .subscribe()
    }

    /// Push a frame to local subscribers of `cc_org_id`. Called only from the
    /// `PgListener` loop — producers go through `broadcast_via_pg`.
    pub fn send(&self, cc_org_id: &str, frame: WsFrame) {
        if let Some(tx) = self.inner.get(cc_org_id) {
            let _ = tx.send(frame); // Err only means "no current subscribers".
        }
    }

    /// Whether any WS client on this instance is currently subscribed to the
    /// org. The poller uses this to only do live city work for watched orgs.
    pub fn has_subscribers(&self, cc_org_id: &str) -> bool {
        self.inner
            .get(cc_org_id)
            .map(|tx| tx.receiver_count() > 0)
            .unwrap_or(false)
    }

    /// Returns `true` at most once per `min_interval` per org, then records the
    /// instant — an atomic check-and-set via the DashMap entry write-lock. Used
    /// to coalesce the on-connect city poll across the burst of WebSocket
    /// connects a single scene-open produces (StrictMode, reconnect backoff,
    /// multiple tabs). Not a correctness gate — the poll is idempotent — purely
    /// a cost guard.
    pub fn try_mark_polled(&self, cc_org_id: &str, min_interval: Duration) -> bool {
        let mut entry = self
            .last_poll
            .entry(cc_org_id.to_string())
            // Seed in the past so the very first connect is allowed through.
            .or_insert_with(|| Instant::now() - min_interval * 2);
        if entry.elapsed() >= min_interval {
            *entry = Instant::now();
            true
        } else {
            false
        }
    }
}

/// Emit a frame to every instance via Postgres LISTEN/NOTIFY (~50ms fan-out).
pub async fn broadcast_via_pg(pool: &PgPool, cc_org_id: &str, frame: WsFrame) -> anyhow::Result<()> {
    let payload = serde_json::to_string(&BroadcastPayload {
        cc_org_id: cc_org_id.to_string(),
        frame,
    })?;
    sqlx::query("SELECT pg_notify('ws_broadcast', $1)")
        .bind(&payload)
        .execute(pool)
        .await?;
    Ok(())
}

/// Broadcast an org-agnostic frame on the `__system__` channel.
pub async fn broadcast_system(pool: &PgPool, frame: WsFrame) -> anyhow::Result<()> {
    broadcast_via_pg(pool, SYSTEM_CHANNEL, frame).await
}

/// Long-running task: LISTEN ws_broadcast and route notifications to the local
/// `OrgBus`. One per backend instance.
pub async fn run_listen_notify(pool: PgPool, bus: Arc<OrgBus>) -> anyhow::Result<()> {
    let mut listener = PgListener::connect_with(&pool).await?;
    listener.listen("ws_broadcast").await?;
    tracing::info!("LISTEN ws_broadcast active");

    loop {
        let notification = listener.recv().await?;
        let payload = notification.payload();
        match serde_json::from_str::<BroadcastPayload>(payload) {
            Ok(p) => bus.send(&p.cc_org_id, p.frame),
            Err(e) => tracing::warn!(error = ?e, payload, "bad ws_broadcast payload"),
        }
    }
}
