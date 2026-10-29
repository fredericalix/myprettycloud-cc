//! Execute one Action. SetMonitorState chains: it mutates a monitor's state,
//! writes history, broadcasts a WS frame, and re-triggers every rule that
//! watches this monitor (subject to anti-loop + max-depth guards).
//!
//! SendNotification inserts an alerts row in Phase 6 — the actual delivery
//! (email, Slack, Discord, generic webhook) is wired in Phase 9.
//!
//! Escalate logs in Phase 6 — the delayed re-evaluation via the Pulsar
//! `rule-escalations` topic is wired in Phase 8.

use crate::db::{monitor_state_history, monitors, rule_state_captures};
use crate::notifications::dispatch;
use crate::rules::condition::Action;
use crate::rules::exec::{InFlight, MAX_CHAIN_DEPTH, Trigger};
use crate::state::AppState;
use crate::realtime::{self, WsFrame};
use chrono::Utc;
use serde_json::json;
use uuid::Uuid;

/// Write a state to a monitor on behalf of a rule, with the full transition
/// machinery: ownership check, anti-loop guard, conditional persist, history,
/// WS broadcast, and chaining into dependent rules (depth-bounded). Shared by
/// the `set_monitor_state` action (`summary_kind = "set_monitor_state"`,
/// history source `rule_action`) and the recovery revert
/// (`summary_kind = "revert_monitor_state"`, history source `rule_revert`).
///
/// `capture_for_revert`: snapshot the pre-write state into
/// `rule_state_captures` (first capture of the episode wins) — set by actions
/// carrying `revert_on_recovery: true`, never by the revert itself.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn apply_monitor_state(
    state: &AppState,
    rule_id: Uuid,
    user_id: Uuid,
    target_monitor_id: Uuid,
    new_state: &str,
    message: Option<&str>,
    history_source: &str,
    summary_kind: &str,
    capture_for_revert: bool,
    in_flight: &InFlight,
    chain_depth: u32,
    cc_org_id_hint: Option<&str>,
) -> anyhow::Result<serde_json::Value> {
    // Verify the target monitor belongs to the same user as the rule.
    let monitor = match monitors::find_by_id_for_user(&state.db, user_id, target_monitor_id).await?
    {
        Some(m) => m,
        None => {
            return Ok(json!({
                "kind": summary_kind,
                "error": "target monitor not found or not owned by user",
            }));
        }
    };

    if in_flight.contains(target_monitor_id) {
        tracing::warn!(
            monitor_id = %target_monitor_id,
            rule_id = %rule_id,
            kind = summary_kind,
            "monitor state write skipped: monitor already in chain (anti-loop)"
        );
        return Ok(json!({
            "kind": summary_kind,
            "skipped": "anti_loop",
        }));
    }
    in_flight.insert(target_monitor_id);

    let before = monitor.current_state.clone();

    // Snapshot the pre-action state before overwriting it. ON CONFLICT DO
    // NOTHING: only the episode's FIRST matched firing captures — later ones
    // would snapshot the state this very rule already wrote.
    if capture_for_revert {
        let inserted = rule_state_captures::capture(
            &state.db,
            rule_id,
            target_monitor_id,
            &before,
            monitor.current_message.as_deref(),
        )
        .await?;
        if state.config.workflow_debug {
            tracing::info!(
                %rule_id,
                monitor_id = %target_monitor_id,
                inserted,
                prev_state = %before,
                "WORKFLOW_DEBUG: revert capture (inserted=false → an earlier firing of this episode already holds the snapshot)"
            );
        }
    }

    let now = Utc::now();
    let changed =
        monitors::set_state_if_changed(&state.db, target_monitor_id, new_state, message).await?;

    let mut chained_count = 0;
    let mut chain_err: Option<anyhow::Error> = None;
    if let Some((effective_state, since)) = changed {
        monitor_state_history::insert(
            &state.db,
            target_monitor_id,
            &effective_state,
            message,
            now,
            history_source,
        )
        .await?;

        let target_org_id = monitor
            .cc_org_id
            .clone()
            .or_else(|| cc_org_id_hint.map(|s| s.to_string()));
        if let Some(org) = target_org_id.as_deref() {
            let _ = realtime::broadcast_via_pg(
                &state.db,
                org,
                WsFrame::MonitorState {
                    monitor_id: target_monitor_id,
                    state: effective_state.clone(),
                    message: message.map(|s| s.to_string()),
                    since: Some(since),
                },
            )
            .await;
        }

        if chain_depth + 1 >= MAX_CHAIN_DEPTH {
            tracing::error!(
                chain_depth = chain_depth + 1,
                max = MAX_CHAIN_DEPTH,
                "rule chain max depth reached; truncating"
            );
        } else {
            // Box::pin breaks the async recursion cycle for the compiler.
            // Capture the result instead of `?`-propagating it so the
            // in-flight guard is always released below, even on error —
            // otherwise a chain error would wedge this monitor in the
            // anti-loop set for the rest of the parent chain.
            match Box::pin(crate::rules::exec::trigger_for_monitor_with_depth(
                state,
                user_id,
                target_monitor_id,
                Trigger::RuleChain { from_rule_id: rule_id },
                chain_depth + 1,
                in_flight,
            ))
            .await
            {
                Ok(c) => chained_count = c,
                Err(e) => chain_err = Some(e),
            }
        }
    }
    in_flight.remove(target_monitor_id);
    if let Some(e) = chain_err {
        return Err(e);
    }

    Ok(json!({
        "kind": summary_kind,
        "monitor_id": target_monitor_id,
        "before": before,
        "after": new_state,
        "chained_rules": chained_count,
    }))
}

pub async fn execute(
    state: &AppState,
    rule_id: Uuid,
    user_id: Uuid,
    action: &Action,
    in_flight: &InFlight,
    chain_depth: u32,
    cc_org_id_hint: Option<&str>,
) -> anyhow::Result<serde_json::Value> {
    match action {
        Action::SetMonitorState {
            target_monitor_id,
            state: new_state,
            message,
            revert_on_recovery,
        } => {
            apply_monitor_state(
                state,
                rule_id,
                user_id,
                *target_monitor_id,
                new_state,
                message.as_deref(),
                "rule_action",
                "set_monitor_state",
                revert_on_recovery.unwrap_or(false),
                in_flight,
                chain_depth,
                cc_org_id_hint,
            )
            .await
        }
        Action::SendNotification {
            channel_id,
            message,
            subject,
        } => {
            // Phase 9: real dispatch. Loads the rule, looks up the channel,
            // renders handlebars message+subject, retries 3× with exponential
            // backoff. Inserts an `alerts` row whether the send succeeded or
            // failed (with `delivered: true|false` in payload).
            let rule = match crate::db::rules::find(&state.db, user_id, rule_id).await? {
                Some(r) => r,
                None => {
                    return Ok(json!({
                        "kind": "send_notification",
                        "error": "rule disappeared mid-action",
                    }));
                }
            };
            let _ = cc_org_id_hint; // not used by the dispatcher; trigger ref isn't a monitor here
            match dispatch::dispatch(
                state,
                *channel_id,
                &rule,
                user_id,
                "rule_action",
                None,
                message,
                subject.as_deref(),
            )
            .await
            {
                Ok(alert_id) => Ok(json!({
                    "kind": "send_notification",
                    "delivered": true,
                    "alert_id": alert_id,
                    "channel_id": channel_id,
                })),
                Err(e) => Ok(json!({
                    "kind": "send_notification",
                    "delivered": false,
                    "channel_id": channel_id,
                    "error": format!("{e}"),
                })),
            }
        }
        Action::Escalate {
            delay_seconds,
            target_rule_id,
        } => {
            // Phase 8: schedule a delayed Pulsar message on `rule-escalations`.
            // The broker holds it until `now + delay_seconds`; whatever instance
            // is subscribed at that time picks it up and re-evaluates the target
            // rule with Trigger::Escalation.
            state
                .escalation_producer
                .schedule(user_id, *target_rule_id, rule_id, *delay_seconds)
                .await?;
            tracing::info!(
                rule_id = %rule_id,
                target_rule_id = %target_rule_id,
                delay_seconds,
                "escalation scheduled on Pulsar"
            );
            Ok(json!({
                "kind": "escalate",
                "scheduled": true,
                "target_rule_id": target_rule_id,
                "delay_seconds": delay_seconds,
            }))
        }
    }
}
