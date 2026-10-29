//! Compute the effective member list and rolled-up state of a group.
//!
//! Effective members = manual list ∪ auto-matched. Auto-matching evaluates
//! `auto_rules` (name_pattern regex on `display_name`, allowed `kinds`)
//! conjunctively. Rolled-up state: critical > warning > ok > unknown.

use crate::db::monitor_groups::{AutoRules, MonitorGroup};
use crate::db::monitors::Monitor;
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RolledState {
    Ok,
    Warning,
    Critical,
    Unknown,
}

impl RolledState {
    fn from_str(s: &str) -> Self {
        match s {
            "ok" => Self::Ok,
            "warning" => Self::Warning,
            "critical" => Self::Critical,
            _ => Self::Unknown,
        }
    }

    /// Return the worse-of-two state (critical wins, then warning, then ok, then
    /// unknown). Unknown is the identity: it only survives when *both* sides are
    /// unknown — so this must be folded from an `Unknown` seed, not `Ok`.
    fn merge(self, other: Self) -> Self {
        use RolledState::*;
        match (self, other) {
            (Critical, _) | (_, Critical) => Critical,
            (Warning, _) | (_, Warning) => Warning,
            (Ok, _) | (_, Ok) => Ok,
            _ => Unknown,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct GroupView {
    #[serde(flatten)]
    pub group: MonitorGroup,
    pub member_ids: Vec<Uuid>,
    pub rolled_state: RolledState,
    pub state_breakdown: StateBreakdown,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct StateBreakdown {
    pub ok: u32,
    pub warning: u32,
    pub critical: u32,
    pub unknown: u32,
    pub total: u32,
}

pub async fn compute_view(
    pool: &PgPool,
    user_id: Uuid,
    group: MonitorGroup,
    user_monitors: &[Monitor],
) -> anyhow::Result<GroupView> {
    let manual_ids: HashSet<Uuid> = sqlx::query_scalar::<_, Uuid>(
        "SELECT monitor_id FROM monitor_group_members WHERE group_id = $1",
    )
    .bind(group.id)
    .fetch_all(pool)
    .await?
    .into_iter()
    .collect();

    let auto_rules: Option<AutoRules> = match &group.auto_rules {
        Some(v) => serde_json::from_value(v.clone()).ok(),
        None => None,
    };

    // Pre-compile the regex once if present (skip if invalid; defensive).
    let name_re = auto_rules
        .as_ref()
        .and_then(|r| r.name_pattern.as_ref())
        .and_then(|p| regex::Regex::new(p).ok());
    let kinds: Option<&Vec<String>> = auto_rules.as_ref().and_then(|r| r.kinds.as_ref());

    let mut effective = manual_ids;
    if name_re.is_some() || kinds.is_some() {
        for m in user_monitors {
            if m.user_id != user_id {
                continue;
            }
            if let Some(ks) = kinds {
                if !ks.iter().any(|k| k == &m.kind) {
                    continue;
                }
            }
            if let Some(re) = name_re.as_ref() {
                if !re.is_match(&m.display_name) {
                    continue;
                }
            }
            effective.insert(m.id);
        }
    }

    // Now compute rollup from the actual monitor rows in `user_monitors`. Seed
    // from Unknown (the merge identity) so a group whose members are all unknown
    // — or a group with no members — rolls up to Unknown, not Ok. Seeding Ok was
    // a bug: `Ok.merge(Unknown)` is Ok, so all-grey groups reported healthy and
    // drove `group:<id>:state == ok` rules to fire falsely.
    let mut rolled = RolledState::Unknown;
    let mut breakdown = StateBreakdown::default();
    for m in user_monitors {
        if !effective.contains(&m.id) {
            continue;
        }
        let s = RolledState::from_str(&m.current_state);
        rolled = rolled.merge(s);
        breakdown.total += 1;
        match s {
            RolledState::Ok => breakdown.ok += 1,
            RolledState::Warning => breakdown.warning += 1,
            RolledState::Critical => breakdown.critical += 1,
            RolledState::Unknown => breakdown.unknown += 1,
        }
    }

    let mut member_ids: Vec<Uuid> = effective.into_iter().collect();
    member_ids.sort();

    Ok(GroupView {
        group,
        member_ids,
        rolled_state: rolled,
        state_breakdown: breakdown,
    })
}

#[cfg(test)]
mod tests {
    use super::RolledState::*;
    use super::*;

    /// Mirror of the rollup fold in `compute_view` (seed = Unknown identity).
    fn roll(states: &[RolledState]) -> RolledState {
        states.iter().copied().fold(Unknown, RolledState::merge)
    }

    #[test]
    fn all_unknown_rolls_to_unknown() {
        assert_eq!(roll(&[Unknown, Unknown, Unknown]), Unknown);
    }

    #[test]
    fn empty_group_rolls_to_unknown() {
        assert_eq!(roll(&[]), Unknown);
    }

    #[test]
    fn ok_beats_unknown() {
        assert_eq!(roll(&[Unknown, Ok, Unknown]), Ok);
    }

    #[test]
    fn worst_state_wins() {
        assert_eq!(roll(&[Ok, Warning, Unknown]), Warning);
        assert_eq!(roll(&[Ok, Warning, Critical]), Critical);
        assert_eq!(roll(&[Unknown, Critical]), Critical);
    }
}
