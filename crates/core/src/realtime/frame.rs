//! Unified WebSocket frame enum: the union of mycctown's city frames and
//! myccmonitor's alerting frames. Tagged with `type` (snake_case) so the
//! single frontend can switch on it. Serialize + Deserialize because frames
//! round-trip through the Postgres NOTIFY bridge.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WsFrame {
    // ---- Connection / session (mycctown) ----
    Hello {
        org_id: String,
        ts: i64,
    },
    /// Server can't decrypt the user's OAuth tokens (ENCRYPTION_KEY rotated) —
    /// the frontend forces a re-login so tokens get re-encrypted.
    SessionExpired {
        message: String,
    },
    Error {
        message: String,
    },

    // ---- City: live status + metrics (mycctown) ----
    AppStatus {
        app_id: String,
        state: String,
        last_deploy: Option<i64>,
        ts: i64,
    },
    AppMetrics {
        app_id: String,
        cpu_pct: f32,
        ram_pct: f32,
        // Optional + default so frames survive the NOTIFY bridge across a
        // rolling deploy where old/new instances disagree on the schema.
        #[serde(default)]
        disk_pct: Option<f32>,
        #[serde(default)]
        net_in_bps: Option<f32>,
        #[serde(default)]
        net_out_bps: Option<f32>,
        ts: i64,
    },
    AddonStatus {
        addon_id: String,
        healthy: bool,
        ts: i64,
    },
    AddonMetrics {
        addon_id: String,
        cpu_pct: f32,
        ram_pct: f32,
        #[serde(default)]
        disk_pct: Option<f32>,
        #[serde(default)]
        net_in_bps: Option<f32>,
        #[serde(default)]
        net_out_bps: Option<f32>,
        ts: i64,
    },
    AppRemoved {
        app_id: String,
        ts: i64,
    },
    AddonAdded {
        addon_id: String,
        provider: Option<String>,
        ts: i64,
    },
    AddonRemoved {
        addon_id: String,
        ts: i64,
    },

    // ---- Monitoring / alerting (myccmonitor) ----
    MonitorState {
        monitor_id: Uuid,
        state: String,
        message: Option<String>,
        since: Option<DateTime<Utc>>,
    },
    WebhookHealth {
        cc_org_id: String,
        last_received_at: DateTime<Utc>,
    },
    MetricsSnapshot {
        monitor_id: Uuid,
        ts: DateTime<Utc>,
        cpu: Option<f64>,
        mem: Option<f64>,
        disk: Option<f64>,
        net_in: Option<f64>,
        net_out: Option<f64>,
    },
    /// A rule produced a verdict — drives gamified city events (fire/bell) +
    /// alert toasts. Broadcast on the `__system__` channel.
    RuleFiring {
        rule_id: Uuid,
        rule_name: String,
        outcome: String,
        fired_at: DateTime<Utc>,
        trigger_kind: String,
        trigger_ref: Option<Uuid>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Old instances emit metrics frames without disk/net fields; the NOTIFY
    /// bridge must still deserialize them on new instances (rolling deploy).
    #[test]
    fn app_metrics_deserializes_without_disk_net_fields() {
        let old = r#"{"type":"app_metrics","app_id":"app_x","cpu_pct":12.5,"ram_pct":40.0,"ts":1}"#;
        let frame: WsFrame = serde_json::from_str(old).expect("old frame must parse");
        match frame {
            WsFrame::AppMetrics { disk_pct, net_in_bps, net_out_bps, .. } => {
                assert_eq!(disk_pct, None);
                assert_eq!(net_in_bps, None);
                assert_eq!(net_out_bps, None);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }

    #[test]
    fn addon_metrics_roundtrips_with_disk_net_fields() {
        let frame = WsFrame::AddonMetrics {
            addon_id: "addon_x".into(),
            cpu_pct: 1.0,
            ram_pct: 2.0,
            disk_pct: Some(30.0),
            net_in_bps: Some(1024.0),
            net_out_bps: None,
            ts: 1,
        };
        let json = serde_json::to_string(&frame).unwrap();
        let back: WsFrame = serde_json::from_str(&json).unwrap();
        match back {
            WsFrame::AddonMetrics { disk_pct, net_in_bps, net_out_bps, .. } => {
                assert_eq!(disk_pct, Some(30.0));
                assert_eq!(net_in_bps, Some(1024.0));
                assert_eq!(net_out_bps, None);
            }
            other => panic!("unexpected variant: {other:?}"),
        }
    }
}
