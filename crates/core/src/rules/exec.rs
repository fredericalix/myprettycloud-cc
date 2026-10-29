//! Top-level execution entry points: `trigger_for_monitor` (called from the
//! webhook consumer + the poller after a state-mutating event) and
//! `execute_rule` (called per matching rule with cooldown, action exec,
//! recursive chain).

use crate::db::{rule_firings, rules};
use crate::rules::actions;
use crate::rules::condition::{Action, Condition};
use crate::rules::evaluator::evaluate;
use crate::rules::field::EvalCtx;
use crate::state::AppState;
use crate::realtime::{self, WsFrame};
use anyhow::Result;
use chrono::{DateTime, Utc};
use dashmap::DashSet;
use serde::Serialize;
use std::sync::Arc;
use uuid::Uuid;

pub const MAX_CHAIN_DEPTH: u32 = 8;

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    RuleChain { from_rule_id: Uuid },
    Poll { monitor_id: Uuid },
    Webhook,
    Escalation { from_rule_id: Uuid },
    /// A user manually set a monitor's state from the builder (custom/synthetic
    /// buildings) — the only state source synthetic monitors have besides rules,
    /// so it must trigger dependent workflows like any other transition.
    Manual { monitor_id: Uuid },
}

impl Trigger {
    pub fn kind(&self) -> &'static str {
        match self {
            Trigger::RuleChain { .. } => "rule_chain",
            Trigger::Poll { .. } => "poll",
            Trigger::Webhook => "webhook",
            Trigger::Escalation { .. } => "escalation",
            Trigger::Manual { .. } => "manual",
        }
    }

    pub fn ref_id(&self) -> Option<Uuid> {
        match self {
            Trigger::Poll { monitor_id } | Trigger::Manual { monitor_id } => Some(*monitor_id),
            Trigger::RuleChain { from_rule_id } | Trigger::Escalation { from_rule_id } => {
                Some(*from_rule_id)
            }
            Trigger::Webhook => None,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Matched,
    NotMatched,
    CooldownSkipped,
    Error,
}

/// In-flight set of monitor ids currently being mutated by a chain. The same
/// monitor must not be SetMonitorState'd twice in one chain.
#[derive(Default)]
pub struct InFlight {
    inner: DashSet<Uuid>,
}

impl InFlight {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }
    pub fn contains(&self, id: Uuid) -> bool {
        self.inner.contains(&id)
    }
    pub fn insert(&self, id: Uuid) {
        self.inner.insert(id);
    }
    pub fn remove(&self, id: Uuid) {
        self.inner.remove(&id);
    }
}

/// Public entrypoint. Called by the consumer (after a webhook-driven state
/// change) and the poller (after a metric_samples write). Triggers all rules
/// that depend on `monitor_id`, with chain depth 0.
pub async fn trigger_for_monitor(
    state: &AppState,
    user_id: Uuid,
    monitor_id: Uuid,
    trigger: Trigger,
) -> Result<u32> {
    let in_flight = InFlight::new();
    trigger_for_monitor_with_depth(state, user_id, monitor_id, trigger, 0, &in_flight).await
}

pub async fn trigger_for_monitor_with_depth(
    state: &AppState,
    user_id: Uuid,
    monitor_id: Uuid,
    trigger: Trigger,
    chain_depth: u32,
    in_flight: &InFlight,
) -> Result<u32> {
    // Inverse-lookup: which enabled rules of THIS user watch this monitor (directly
    // or via a group whose membership covers it)?
    let direct_rule_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT d.rule_id
        FROM rule_dependencies d
        JOIN rules r ON r.id = d.rule_id
        WHERE r.user_id = $1
          AND r.is_enabled = TRUE
          AND d.ref_kind = 'monitor'
          AND d.ref_id = $2
        "#,
    )
    .bind(user_id)
    .bind(monitor_id)
    .fetch_all(&state.db)
    .await?;

    let group_rule_ids: Vec<Uuid> = sqlx::query_scalar(
        r#"
        SELECT DISTINCT d.rule_id
        FROM rule_dependencies d
        JOIN rules r ON r.id = d.rule_id
        WHERE r.user_id = $1
          AND r.is_enabled = TRUE
          AND d.ref_kind = 'group'
          AND d.ref_id IN (
              SELECT g.id FROM monitor_groups g
              WHERE g.user_id = $1
                AND (
                    EXISTS (
                        SELECT 1 FROM monitor_group_members mgm
                        WHERE mgm.group_id = g.id AND mgm.monitor_id = $2
                    )
                    -- Auto-grouped rules: re-eval only groups whose kind filter
                    -- could include this monitor. Auto-matching is conjunctive
                    -- (kinds AND name_pattern), so a monitor whose kind isn't in
                    -- `kinds` can never be a member — skip those groups. Groups
                    -- with no kinds filter still match any kind by name, so keep
                    -- them (the regex is then checked inside compute_view).
                    OR (
                        g.auto_rules IS NOT NULL
                        AND (
                            g.auto_rules->'kinds' IS NULL
                            OR g.auto_rules->'kinds' = 'null'::jsonb
                            OR EXISTS (
                                SELECT 1 FROM monitors m
                                WHERE m.id = $2
                                  AND g.auto_rules->'kinds' @> to_jsonb(m.kind)
                            )
                        )
                    )
                )
          )
        "#,
    )
    .bind(user_id)
    .bind(monitor_id)
    .fetch_all(&state.db)
    .await?;

    let direct_count = direct_rule_ids.len();
    let group_count = group_rule_ids.len();
    let mut all_rule_ids = direct_rule_ids;
    all_rule_ids.extend(group_rule_ids);
    all_rule_ids.sort();
    all_rule_ids.dedup();

    tracing::info!(
        %monitor_id,
        %user_id,
        chain_depth,
        trigger_kind = trigger.kind(),
        direct_count,
        group_count,
        unique_rule_count = all_rule_ids.len(),
        "trigger_for_monitor: dependent rules looked up"
    );

    if state.config.workflow_debug && all_rule_ids.is_empty() {
        // Nothing watches this monitor: either no workflow references it, or the
        // referencing workflow is disabled / not indexed. A common reason a
        // freshly-built workflow "does nothing".
        tracing::info!(
            %monitor_id,
            %user_id,
            trigger_kind = trigger.kind(),
            "WORKFLOW_DEBUG: no enabled workflow depends on this monitor — nothing to evaluate"
        );
    }

    let mut fired = 0u32;
    for rule_id in all_rule_ids {
        let rule = match rules::find(&state.db, user_id, rule_id).await? {
            Some(r) => r,
            None => continue,
        };
        let outcome = execute_rule(state, &rule, trigger, chain_depth, in_flight).await?;
        tracing::info!(
            %rule_id,
            rule_name = %rule.name,
            outcome = ?outcome,
            "rule evaluated"
        );
        if matches!(outcome, Outcome::Matched) {
            fired += 1;
        }
    }
    Ok(fired)
}

pub async fn execute_rule(
    state: &AppState,
    rule: &rules::Rule,
    trigger: Trigger,
    chain_depth: u32,
    in_flight: &InFlight,
) -> Result<Outcome> {
    if !rule.is_enabled {
        tracing::info!(rule_id = %rule.id, rule_name = %rule.name, "rule disabled; skipping");
        return Ok(Outcome::NotMatched);
    }

    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        chain_depth,
        trigger_kind = trigger.kind(),
        "execute_rule entry"
    );

    let condition: Condition = serde_json::from_value(rule.condition.clone())?;
    let actions: Vec<Action> = serde_json::from_value(rule.actions.clone())?;

    // Evaluate
    let ctx = EvalCtx::new(&state.db, rule.user_id).with_debug(state.config.workflow_debug);
    let matched = evaluate(&ctx, &condition).await?;
    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        matched,
        action_count = actions.len(),
        "condition evaluated"
    );

    // Cooldown: skip if last_fired_at + cooldown > now AND the verdict hasn't
    // changed (recovery-exempt: we always let a transition fire).
    if matched
        && cooldown_decision(
            rule.last_fired_at,
            rule.last_outcome_state.as_deref(),
            rule.cooldown_seconds as i64,
            Utc::now(),
        ) == CooldownVerdict::Skip
    {
        tracing::info!(
            rule_id = %rule.id,
            rule_name = %rule.name,
            cooldown_seconds = rule.cooldown_seconds,
            "cooldown active and verdict unchanged; skipping"
        );
        rule_firings::insert(
            &state.db,
            rule.id,
            rule.user_id,
            trigger.kind(),
            trigger.ref_id(),
            "cooldown_skipped",
            None,
            None,
        )
        .await?;
        return Ok(Outcome::CooldownSkipped);
    }

    if !matched {
        // Record only if state changes — keeps the audit log signal-rich.
        if rule.last_outcome_state.as_deref() != Some("not_matched") {
            // Recovery: restore every revert-flagged target to its captured
            // pre-episode state. Best-effort — a revert failure must never
            // prevent the not_matched outcome from being recorded.
            let revert_summaries =
                run_recovery_reverts(state, rule, &actions, in_flight, chain_depth).await;
            rule_firings::insert(
                &state.db,
                rule.id,
                rule.user_id,
                trigger.kind(),
                trigger.ref_id(),
                "not_matched",
                if revert_summaries.is_empty() {
                    None
                } else {
                    Some(serde_json::Value::Array(revert_summaries))
                },
                None,
            )
            .await?;
            rules::update_outcome(&state.db, rule.id, "not_matched", false).await?;
        }
        return Ok(Outcome::NotMatched);
    }

    // Matched: execute actions in parallel (CLAUDE.md §10.2). InFlight is a
    // concurrent set and each action targets a distinct monitor, so the
    // anti-loop guard stays correct under concurrency. Results are folded back
    // in original order.
    let results = futures::future::join_all(actions.iter().map(|action| {
        actions::execute(state, rule.id, rule.user_id, action, in_flight, chain_depth, None)
    }))
    .await;

    let mut summaries = Vec::with_capacity(actions.len());
    let mut had_error = false;
    let mut error_messages: Vec<String> = Vec::new();
    for result in results {
        match result {
            Ok(summary) => summaries.push(summary),
            Err(e) => {
                tracing::error!(error = ?e, rule_id = %rule.id, "action execution failed");
                error_messages.push(format!("{e}"));
                had_error = true;
            }
        }
    }

    tracing::info!(
        rule_id = %rule.id,
        rule_name = %rule.name,
        action_count = actions.len(),
        had_error,
        "actions executed"
    );

    let outcome = if had_error { "error" } else { "matched" };
    rule_firings::insert(
        &state.db,
        rule.id,
        rule.user_id,
        trigger.kind(),
        trigger.ref_id(),
        outcome,
        Some(serde_json::Value::Array(summaries.clone())),
        if had_error {
            Some(error_messages.join("; "))
        } else {
            None
        },
    )
    .await?;
    rules::update_outcome(&state.db, rule.id, "matched", true).await?;

    let _ = realtime::broadcast_system(
        &state.db,
        WsFrame::RuleFiring {
            rule_id: rule.id,
            rule_name: rule.name.clone(),
            outcome: outcome.to_string(),
            fired_at: Utc::now(),
            trigger_kind: trigger.kind().to_string(),
            trigger_ref: trigger.ref_id(),
        },
    )
    .await;

    Ok(if had_error {
        Outcome::Error
    } else {
        Outcome::Matched
    })
}

/// The revert target of an action, if it opted into revert-on-recovery.
/// Pure selection logic, unit-tested.
fn wants_revert(action: &Action) -> Option<Uuid> {
    match action {
        Action::SetMonitorState {
            target_monitor_id,
            revert_on_recovery: Some(true),
            ..
        } => Some(*target_monitor_id),
        _ => None,
    }
}

/// On a matched → not_matched transition, restore every revert-flagged target
/// to the state captured when the episode opened. Each restore is a normal
/// transition (history source `rule_revert`, WS broadcast, chains dependent
/// rules under the same anti-loop set + depth budget). Errors are logged and
/// summarised, never propagated — the caller still records the not_matched
/// firing. Returns the summaries to attach to that firing.
async fn run_recovery_reverts(
    state: &AppState,
    rule: &rules::Rule,
    actions: &[Action],
    in_flight: &InFlight,
    chain_depth: u32,
) -> Vec<serde_json::Value> {
    let mut summaries = Vec::new();
    for monitor_id in actions.iter().filter_map(wants_revert) {
        let snapshot =
            match crate::db::rule_state_captures::take(&state.db, rule.id, monitor_id).await {
                Ok(Some(s)) => s,
                Ok(None) => {
                    // No capture: the episode never fired this action (or the
                    // snapshot was already consumed / purged on rule save).
                    if state.config.workflow_debug {
                        tracing::info!(
                            rule_id = %rule.id,
                            %monitor_id,
                            "WORKFLOW_DEBUG: recovery revert skipped — no capture for this target"
                        );
                    }
                    continue;
                }
                Err(e) => {
                    tracing::error!(rule_id = %rule.id, %monitor_id, error = %e, "revert capture lookup failed");
                    summaries.push(serde_json::json!({
                        "kind": "revert_monitor_state",
                        "monitor_id": monitor_id,
                        "error": format!("capture lookup failed: {e}"),
                    }));
                    continue;
                }
            };
        let (prev_state, prev_message) = snapshot;
        if state.config.workflow_debug {
            tracing::info!(
                rule_id = %rule.id,
                %monitor_id,
                %prev_state,
                "WORKFLOW_DEBUG: condition recovered — reverting target to its captured pre-episode state"
            );
        }
        match actions::apply_monitor_state(
            state,
            rule.id,
            rule.user_id,
            monitor_id,
            &prev_state,
            prev_message.as_deref(),
            "rule_revert",
            "revert_monitor_state",
            false,
            in_flight,
            chain_depth,
            None,
        )
        .await
        {
            Ok(summary) => summaries.push(summary),
            Err(e) => {
                tracing::error!(rule_id = %rule.id, %monitor_id, error = %e, "recovery revert failed");
                summaries.push(serde_json::json!({
                    "kind": "revert_monitor_state",
                    "monitor_id": monitor_id,
                    "error": format!("{e}"),
                }));
            }
        }
    }
    summaries
}

/// Dry-run: evaluate but don't execute actions or record firings.
pub async fn evaluate_dry(
    state: &AppState,
    rule: &rules::Rule,
) -> Result<DryRunResult> {
    let condition: Condition = serde_json::from_value(rule.condition.clone())?;
    let actions: Vec<Action> = serde_json::from_value(rule.actions.clone())?;
    let ctx = EvalCtx::new(&state.db, rule.user_id).with_debug(state.config.workflow_debug);
    let matched = evaluate(&ctx, &condition).await?;
    Ok(DryRunResult {
        matched,
        actions_that_would_run: if matched { actions.len() } else { 0 },
    })
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum CooldownVerdict {
    Fire,
    Skip,
}

/// Cooldown decision for a rule whose condition just matched. Skips only when
/// still inside the cooldown window *and* the previous outcome was also
/// `matched` (recovery-exempt: a verdict transition always fires). Pure —
/// unit-tested.
pub(crate) fn cooldown_decision(
    last_fired_at: Option<DateTime<Utc>>,
    last_outcome_state: Option<&str>,
    cooldown_seconds: i64,
    now: DateTime<Utc>,
) -> CooldownVerdict {
    match (last_fired_at, last_outcome_state) {
        (Some(last), Some(prev)) => {
            let elapsed = now.signed_duration_since(last).num_seconds();
            let in_cooldown = elapsed < cooldown_seconds;
            let verdict_unchanged = prev == "matched";
            if in_cooldown && verdict_unchanged {
                CooldownVerdict::Skip
            } else {
                CooldownVerdict::Fire
            }
        }
        _ => CooldownVerdict::Fire,
    }
}

#[derive(Debug, Serialize)]
pub struct DryRunResult {
    pub matched: bool,
    pub actions_that_would_run: usize,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_ever_match_fires() {
        let now = Utc::now();
        assert_eq!(cooldown_decision(None, None, 300, now), CooldownVerdict::Fire);
    }

    #[test]
    fn repeat_match_inside_cooldown_skips() {
        let now = Utc::now();
        let last = now - chrono::Duration::seconds(60);
        assert_eq!(
            cooldown_decision(Some(last), Some("matched"), 300, now),
            CooldownVerdict::Skip
        );
    }

    #[test]
    fn repeat_match_after_cooldown_fires() {
        let now = Utc::now();
        let last = now - chrono::Duration::seconds(400);
        assert_eq!(
            cooldown_decision(Some(last), Some("matched"), 300, now),
            CooldownVerdict::Fire
        );
    }

    #[test]
    fn wants_revert_selects_only_flagged_set_monitor_state() {
        let target = Uuid::new_v4();
        let actions = [
            Action::SetMonitorState {
                target_monitor_id: target,
                state: "critical".to_string(),
                message: None,
                revert_on_recovery: Some(true),
            },
            Action::SetMonitorState {
                target_monitor_id: Uuid::new_v4(),
                state: "warning".to_string(),
                message: None,
                revert_on_recovery: None,
            },
            Action::SetMonitorState {
                target_monitor_id: Uuid::new_v4(),
                state: "warning".to_string(),
                message: None,
                revert_on_recovery: Some(false),
            },
            Action::SendNotification {
                channel_id: Uuid::new_v4(),
                message: "x".to_string(),
                subject: None,
            },
        ];
        let targets: Vec<Uuid> = actions.iter().filter_map(wants_revert).collect();
        assert_eq!(targets, vec![target]);
    }

    #[test]
    fn zero_cooldown_always_fires() {
        let now = Utc::now();
        // cooldown_seconds = 0 → elapsed (0) < 0 is false, never in cooldown
        assert_eq!(
            cooldown_decision(Some(now), Some("matched"), 0, now),
            CooldownVerdict::Fire
        );
    }

    #[test]
    fn verdict_transition_is_recovery_exempt() {
        let now = Utc::now();
        let last = now - chrono::Duration::seconds(60);
        // previous outcome was not "matched" → a fresh match always fires even
        // inside the cooldown window
        assert_eq!(
            cooldown_decision(Some(last), Some("not_matched"), 300, now),
            CooldownVerdict::Fire
        );
    }
}
