//! JSON-serialisable Condition + Action types — the contract between the
//! rule editor (Phase 7), the storage layer (rules.condition / rules.actions
//! JSONB), and the runtime evaluator.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CompOp {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
    Contains,
    NotContains,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum LogicalOp {
    And,
    Or,
}

/// `{ seconds: 300 }` — duration for time-based conditions like
/// `monitor:X:state == critical for 5m`.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct DurationSpec {
    pub seconds: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Condition {
    Comparison {
        /// `monitor:{uuid}:property` or `group:{uuid}:property`.
        field: String,
        operator: CompOp,
        value: serde_json::Value,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        for_duration: Option<DurationSpec>,
    },
    Logical {
        op: LogicalOp,
        children: Vec<Condition>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Action {
    /// Mutate the state of a monitor (CC-backed or synthetic). Chains: every
    /// rule that watches this monitor is re-evaluated, with anti-loop guards.
    SetMonitorState {
        target_monitor_id: Uuid,
        state: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        /// When true, the target's pre-action state (+message) is captured on
        /// the episode's first matched firing and restored when the rule's
        /// condition recovers (outcome transitions matched → not_matched).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        revert_on_recovery: Option<bool>,
    },
    /// Send a notification. Phase 6 inserts an `alerts` row; Phase 9 wires
    /// the actual delivery (email, Slack, Discord, webhook).
    SendNotification {
        channel_id: Uuid,
        message: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        subject: Option<String>,
    },
    /// Defer + re-evaluate another rule. Phase 6 logs + stubs; Phase 8 wires
    /// the actual delayed-message delivery via the Pulsar `rule-escalations`
    /// topic.
    Escalate {
        delay_seconds: u32,
        target_rule_id: Uuid,
    },
}

/// Validate the static shape: at least one action, well-formed condition tree.
/// Cross-user reference checks happen at save time in `db::rules::save`.
pub fn validate_condition(c: &Condition) -> Result<(), String> {
    match c {
        Condition::Comparison { field, .. } => {
            if !field.starts_with("monitor:") && !field.starts_with("group:") {
                return Err(format!(
                    "field must start with 'monitor:' or 'group:' (got `{field}`)"
                ));
            }
            Ok(())
        }
        Condition::Logical { children, .. } => {
            if children.is_empty() {
                return Err("logical condition needs at least one child".to_string());
            }
            for child in children {
                validate_condition(child)?;
            }
            Ok(())
        }
    }
}

pub fn validate_actions(actions: &[Action]) -> Result<(), String> {
    if actions.is_empty() {
        return Err("a rule needs at least one action".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn leaf(field: &str) -> Condition {
        Condition::Comparison {
            field: field.to_string(),
            operator: CompOp::Gte,
            value: json!(80),
            for_duration: None,
        }
    }

    #[test]
    fn validate_rejects_unknown_field_prefix() {
        assert!(validate_condition(&leaf("widget:abc:state")).is_err());
    }

    #[test]
    fn validate_rejects_empty_logical_children() {
        let top_level = Condition::Logical {
            op: LogicalOp::And,
            children: vec![],
        };
        assert!(validate_condition(&top_level).is_err());

        let nested = Condition::Logical {
            op: LogicalOp::And,
            children: vec![
                leaf("monitor:x:cpu"),
                Condition::Logical {
                    op: LogicalOp::Or,
                    children: vec![],
                },
            ],
        };
        assert!(validate_condition(&nested).is_err());
    }

    #[test]
    fn validate_accepts_nested_tree() {
        let cond = Condition::Logical {
            op: LogicalOp::And,
            children: vec![
                Condition::Logical {
                    op: LogicalOp::Or,
                    children: vec![leaf("monitor:x:cpu"), leaf("group:y:critical_count")],
                },
                leaf("monitor:z:state"),
            ],
        };
        assert!(validate_condition(&cond).is_ok());
    }

    #[test]
    fn serde_roundtrip_preserves_for_duration_and_omits_when_absent() {
        let without = serde_json::to_value(leaf("monitor:x:cpu")).unwrap();
        assert!(without.get("for_duration").is_none());

        let with = Condition::Comparison {
            field: "monitor:x:cpu".to_string(),
            operator: CompOp::Gte,
            value: json!(80),
            for_duration: Some(DurationSpec { seconds: 300 }),
        };
        let v = serde_json::to_value(&with).unwrap();
        assert_eq!(v["for_duration"]["seconds"], json!(300));
        let back: Condition = serde_json::from_value(v).unwrap();
        match back {
            Condition::Comparison { for_duration, .. } => {
                assert_eq!(for_duration, Some(DurationSpec { seconds: 300 }));
            }
            _ => panic!("expected comparison"),
        }
    }

    #[test]
    fn validate_actions_requires_at_least_one() {
        assert!(validate_actions(&[]).is_err());
        let one = vec![Action::SendNotification {
            channel_id: Uuid::nil(),
            message: "hi".to_string(),
            subject: None,
        }];
        assert!(validate_actions(&one).is_ok());
    }

    #[test]
    fn set_monitor_state_revert_flag_roundtrips_and_is_omitted_when_none() {
        let without = Action::SetMonitorState {
            target_monitor_id: Uuid::nil(),
            state: "warning".to_string(),
            message: None,
            revert_on_recovery: None,
        };
        let v = serde_json::to_value(&without).unwrap();
        assert!(v.get("revert_on_recovery").is_none());

        let with = Action::SetMonitorState {
            target_monitor_id: Uuid::nil(),
            state: "warning".to_string(),
            message: Some("down".to_string()),
            revert_on_recovery: Some(true),
        };
        let v = serde_json::to_value(&with).unwrap();
        assert_eq!(v["revert_on_recovery"], json!(true));
        let back: Action = serde_json::from_value(v).unwrap();
        match back {
            Action::SetMonitorState { revert_on_recovery, .. } => {
                assert_eq!(revert_on_recovery, Some(true));
            }
            _ => panic!("expected set_monitor_state"),
        }
    }

    #[test]
    fn legacy_action_json_with_acknowledged_still_deserializes() {
        // `acknowledged` was removed from the schema; rules saved before the
        // removal still carry the key in JSONB. Serde must ignore it.
        let legacy = json!({
            "type": "set_monitor_state",
            "target_monitor_id": "00000000-0000-0000-0000-000000000000",
            "state": "critical",
            "acknowledged": true,
        });
        let action: Action = serde_json::from_value(legacy).unwrap();
        assert!(matches!(action, Action::SetMonitorState { .. }));
    }
}
