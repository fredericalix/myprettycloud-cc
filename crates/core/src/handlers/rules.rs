//! /api/rules CRUD + versions + restore + test endpoints.

use crate::auth::AuthenticatedUser;
use crate::db::orgs;
use crate::db::rule_firings::{self, RuleFiring};
use crate::db::rules::{self, Rule, RuleVersion};
use crate::error::AppError;
use crate::rules::condition::{Action, Condition, validate_actions, validate_condition};
use crate::rules::cycle::{self, PendingRule};
use crate::rules::debug::{self as rule_debug, RuleDebugResponse};
use crate::rules::dependencies;
use crate::rules::exec::{self, DryRunResult};
use crate::rules::field::EvalCtx;
use crate::state::AppState;
use axum::Json;
use axum::Router;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::routing::{get, post};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/rules", get(list).post(create))
        // Org-scoped listing for the Workflows manager (still the caller's own
        // rules, filtered to one org — see decision in the plan).
        .route("/api/orgs/{cc_org_id}/rules", get(list_by_org))
        .route("/api/rules/generate", post(generate))
        // Draft dry-run: evaluate an unsaved condition live, with a per-leaf
        // trace — powers the rule editor's "Test" overlay. Static segment,
        // takes precedence over `/api/rules/{id}`.
        .route("/api/rules/test-draft", post(test_draft))
        .route("/api/rules/{id}", get(read).put(update).delete(delete))
        .route("/api/rules/{id}/enabled", post(set_enabled))
        .route("/api/rules/{id}/firings", get(recent_firings))
        .route("/api/rules/{id}/versions", get(list_versions))
        .route(
            "/api/rules/{id}/versions/{version_id}/restore",
            post(restore_version),
        )
        .route("/api/rules/{id}/test", post(test_dry_run))
        .route("/api/rules/{id}/debug", get(get_debug))
}

#[derive(Debug, Deserialize)]
pub struct UpsertInput {
    pub name: String,
    #[serde(default = "default_enabled")]
    pub is_enabled: bool,
    pub condition: Condition,
    pub actions: Vec<Action>,
    #[serde(default = "default_cooldown")]
    pub cooldown_seconds: i32,
    #[serde(default)]
    pub metadata: Option<serde_json::Value>,
    #[serde(default)]
    pub comment: Option<String>,
    /// Org to tag the rule with. The frontend sends the selected org; when
    /// omitted (MCP, restore), `save_inner` derives it from the watched
    /// monitors.
    #[serde(default)]
    pub cc_org_id: Option<String>,
}

fn default_enabled() -> bool {
    true
}
fn default_cooldown() -> i32 {
    300
}

async fn list(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
) -> Result<Json<Vec<Rule>>, AppError> {
    Ok(Json(rules::list_for_user(&state.db, auth.id).await?))
}

/// The caller's rules for one org — powers the Workflows manager. Membership is
/// verified the same way `list_monitors` does (the org must belong to the user);
/// the rows are then filtered to the caller's `user_id`, so a user only ever
/// sees their own workflows (see plan: per-user, org-filtered).
async fn list_by_org(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(cc_org_id): Path<String>,
) -> Result<Json<Vec<Rule>>, AppError> {
    orgs::find_by_user_and_cc_id(&state.db, auth.id, &cc_org_id)
        .await?
        .ok_or(AppError::Forbidden)?;
    Ok(Json(
        rules::list_for_user_org(&state.db, auth.id, &cc_org_id).await?,
    ))
}

#[derive(Debug, Deserialize)]
struct SetEnabledInput {
    is_enabled: bool,
}

/// Toggle a rule on/off without a full save (no version churn). 404 when the
/// rule isn't owned by the caller — same shape as `delete`.
async fn set_enabled(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(input): Json<SetEnabledInput>,
) -> Result<Json<Rule>, AppError> {
    let n = rules::set_enabled(&state.db, auth.id, id, input.is_enabled).await?;
    if n == 0 {
        return Err(AppError::NotFound(format!("rule {id}")));
    }
    let rule = rules::find(&state.db, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(rule))
}

async fn create(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<UpsertInput>,
) -> Result<Json<Rule>, AppError> {
    save_inner(&state, auth.id, None, input).await.map(Json)
}

#[derive(Debug, Deserialize)]
struct GenerateInput {
    text: String,
    monitor_id: Uuid,
}

/// Natural-language → rule. Generates the rule JSON via an OpenAI-compatible
/// chat-completions endpoint (LM Studio; disabled with a 400 when
/// `LMSTUDIO_BASE_URL` is unset), scoped to `monitor_id`, then persists it
/// through the normal save path.
async fn generate(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<GenerateInput>,
) -> Result<Json<Rule>, AppError> {
    let value = crate::rules::nl::generate(&state, auth.id, &input.text, input.monitor_id).await?;
    let upsert: UpsertInput = serde_json::from_value(value)
        .map_err(|e| AppError::BadRequest(format!("generated rule invalid: {e}")))?;
    save_inner(&state, auth.id, None, upsert).await.map(Json)
}

async fn read(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Rule>, AppError> {
    let rule = rules::find(&state.db, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(rule))
}

async fn update(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
    Json(input): Json<UpsertInput>,
) -> Result<Json<Rule>, AppError> {
    save_inner(&state, auth.id, Some(id), input).await.map(Json)
}

async fn delete(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = rules::delete(&state.db, auth.id, id).await?;
    if n == 0 {
        Err(AppError::NotFound(format!("rule {id}")))
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}

async fn recent_firings(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<RuleFiring>>, AppError> {
    Ok(Json(
        rule_firings::list_recent_for_rule(&state.db, auth.id, id, 50).await?,
    ))
}

async fn list_versions(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<RuleVersion>>, AppError> {
    Ok(Json(rules::list_versions(&state.db, auth.id, id).await?))
}

async fn restore_version(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path((id, version_id)): Path<(Uuid, String)>,
) -> Result<Json<Rule>, AppError> {
    let payload = rules::find_version_payload(&state.db, auth.id, id, &version_id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id} version {version_id}")))?;
    // Parse the stored Rule snapshot back into UpsertInput shape.
    let snap: Rule = serde_json::from_value(payload).map_err(|e| AppError::BadRequest(e.to_string()))?;
    let condition: Condition = serde_json::from_value(snap.condition.clone())
        .map_err(|e| AppError::BadRequest(format!("decode condition: {e}")))?;
    let actions: Vec<Action> = serde_json::from_value(snap.actions.clone())
        .map_err(|e| AppError::BadRequest(format!("decode actions: {e}")))?;
    let restored = save_inner(
        &state,
        auth.id,
        Some(id),
        UpsertInput {
            name: snap.name,
            is_enabled: snap.is_enabled,
            condition,
            actions,
            cooldown_seconds: snap.cooldown_seconds,
            metadata: snap.metadata,
            comment: Some(format!("restore from {version_id}")),
            // The snapshot carries the org; re-derived from deps on save.
            cc_org_id: snap.cc_org_id,
        },
    )
    .await?;
    Ok(Json(restored))
}

#[derive(Debug, Deserialize)]
struct TestDraftInput {
    condition: Condition,
    /// Optional: a graph being edited may have no actions wired up yet.
    #[serde(default)]
    actions: Vec<Action>,
}

#[derive(Debug, Serialize)]
struct DraftDryRunResponse {
    matched: bool,
    /// Same shape as `RuleDebugResponse.condition_summary` (per-leaf
    /// actual/verdict/instantaneous trace).
    condition_trace: serde_json::Value,
    actions_total: usize,
    actions_that_would_run: usize,
}

/// Evaluate an unsaved rule body against live data. Nothing is persisted or
/// executed: no cycle check, no cooldown, no name required. The verdict comes
/// from the trace root, so every leaf carries its own verdict (the trace
/// never short-circuits) — exactly what the editor overlay needs.
async fn test_draft(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Json(input): Json<TestDraftInput>,
) -> Result<Json<DraftDryRunResponse>, AppError> {
    validate_condition(&input.condition).map_err(AppError::BadRequest)?;
    // Same cross-tenant enforcement as save. Condition refs are safe without
    // it: every fetch is user_id-scoped, a foreign id just resolves to Null.
    validate_action_refs(&state, auth.id, &input.actions).await?;

    let ctx = EvalCtx::new(&state.db, auth.id).with_debug(state.config.workflow_debug);
    let condition_trace = rule_debug::trace(&ctx, &input.condition).await;
    let matched = condition_trace
        .get("verdict")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    Ok(Json(DraftDryRunResponse {
        matched,
        condition_trace,
        actions_total: input.actions.len(),
        actions_that_would_run: if matched { input.actions.len() } else { 0 },
    }))
}

async fn test_dry_run(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<DryRunResult>, AppError> {
    let rule = rules::find(&state.db, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(
        exec::evaluate_dry(&state, &rule)
            .await
            .map_err(AppError::Internal)?,
    ))
}

async fn get_debug(
    State(state): State<AppState>,
    auth: AuthenticatedUser,
    Path(id): Path<Uuid>,
) -> Result<Json<RuleDebugResponse>, AppError> {
    let rule = rules::find(&state.db, auth.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("rule {id}")))?;
    Ok(Json(
        rule_debug::build(&state, auth.id, &rule)
            .await
            .map_err(AppError::Internal)?,
    ))
}

/// Shared save path between the REST handler and the MCP server. Validates
/// the rule (name, cooldown, condition tree, action shapes, cross-tenant
/// refs, static DAG cycle) and persists it with its dependency index.
pub async fn save_inner(
    state: &AppState,
    user_id: Uuid,
    id: Option<Uuid>,
    input: UpsertInput,
) -> Result<Rule, AppError> {
    if input.name.trim().is_empty() {
        return Err(AppError::BadRequest("name must not be empty".to_string()));
    }
    if input.cooldown_seconds < 0 {
        return Err(AppError::BadRequest("cooldown must be >= 0".to_string()));
    }
    validate_condition(&input.condition).map_err(AppError::BadRequest)?;
    validate_actions(&input.actions).map_err(AppError::BadRequest)?;

    // Reject cross-user references in actions (target monitor / channel / target rule).
    validate_action_refs(state, user_id, &input.actions).await?;

    // Static cycle detection.
    cycle::check_no_cycle(
        &state.db,
        user_id,
        PendingRule {
            id,
            condition: &input.condition,
            actions: &input.actions,
        },
    )
    .await
    .map_err(|e| AppError::BadRequest(e.to_string()))?;

    let condition_json = serde_json::to_value(&input.condition).map_err(AppError::from)?;
    let actions_json = serde_json::to_value(&input.actions).map_err(AppError::from)?;
    let deps = dependencies::extract(&input.condition);

    // Tag the rule with its org: trust the client's value when present,
    // otherwise derive it from the monitors the condition watches.
    let cc_org_id = resolve_org(state, user_id, &input, &deps).await?;

    if state.config.workflow_debug {
        tracing::info!(
            rule_id = ?id,
            rule_name = %input.name.trim(),
            cc_org_id = ?cc_org_id,
            dep_count = deps.len(),
            deps = ?deps,
            "WORKFLOW_DEBUG: saving rule (dependency index about to be rebuilt)"
        );
    }

    Ok(rules::save(
        &state.db,
        user_id,
        id,
        cc_org_id.as_deref(),
        input.name.trim(),
        input.is_enabled,
        &condition_json,
        &actions_json,
        input.cooldown_seconds,
        input.metadata.as_ref(),
        &deps,
        input.comment.as_deref(),
    )
    .await?)
}

/// Resolve the org tag for a rule: prefer the client-supplied `cc_org_id`, else
/// derive it from the first watched monitor that has an org. Returns `None` when
/// neither is available (e.g. a group-only rule) — left untouched on update.
async fn resolve_org(
    state: &AppState,
    user_id: Uuid,
    input: &UpsertInput,
    deps: &[(String, Uuid)],
) -> Result<Option<String>, AppError> {
    if let Some(org) = input.cc_org_id.as_deref().filter(|s| !s.is_empty()) {
        return Ok(Some(org.to_string()));
    }
    let monitor_ids: Vec<Uuid> = deps
        .iter()
        .filter(|(kind, _)| kind == "monitor")
        .map(|(_, id)| *id)
        .collect();
    if monitor_ids.is_empty() {
        return Ok(None);
    }
    let org = sqlx::query_scalar::<_, String>(
        "SELECT cc_org_id FROM monitors WHERE user_id = $1 AND id = ANY($2) AND cc_org_id IS NOT NULL LIMIT 1",
    )
    .bind(user_id)
    .bind(&monitor_ids)
    .fetch_optional(&state.db)
    .await?;
    Ok(org)
}

async fn validate_action_refs(
    state: &AppState,
    user_id: Uuid,
    actions: &[Action],
) -> Result<(), AppError> {
    // Collect the distinct ids referenced per ref-kind, then verify each set
    // with a single `= ANY($1)` query rather than one round-trip per action.
    let mut monitor_ids = Vec::new();
    let mut rule_ids = Vec::new();
    let mut channel_ids = Vec::new();
    for action in actions {
        match action {
            Action::SetMonitorState { target_monitor_id, .. } => monitor_ids.push(*target_monitor_id),
            Action::Escalate { target_rule_id, .. } => rule_ids.push(*target_rule_id),
            Action::SendNotification { channel_id, .. } => channel_ids.push(*channel_id),
        }
    }

    all_owned(state, user_id, "monitors", &mut monitor_ids).await?;
    all_owned(state, user_id, "rules", &mut rule_ids).await?;
    all_owned(state, user_id, "notification_channels", &mut channel_ids).await?;
    Ok(())
}

/// Returns Ok only if every id in `ids` exists in `table` for `user_id`.
/// `ids` is sorted/deduped in place. `table` is a hard-coded literal from the
/// caller — never user input — so interpolating it into the query is safe.
async fn all_owned(
    state: &AppState,
    user_id: Uuid,
    table: &str,
    ids: &mut Vec<Uuid>,
) -> Result<(), AppError> {
    ids.sort();
    ids.dedup();
    if ids.is_empty() {
        return Ok(());
    }
    let found: i64 = sqlx::query_scalar(&format!(
        "SELECT COUNT(*) FROM {table} WHERE user_id = $1 AND id = ANY($2)"
    ))
    .bind(user_id)
    .bind(&*ids)
    .fetch_one(&state.db)
    .await?;
    if (found as usize) != ids.len() {
        return Err(AppError::Forbidden);
    }
    Ok(())
}
