use crate::auth::authz::{self, require_org_member, validate_cc_id};
use crate::auth::session::AuthUser;
use crate::domains::metrics::client::{self, MetricsResponse};
use crate::domains::metrics::templates;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, Query, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;

pub fn router() -> Router<AppState> {
    Router::new().route("/api/metrics/{org_id}/{app_id}", get(get_metrics))
}

#[derive(Deserialize)]
struct MetricsQuery {
    panel: String,
    #[serde(default = "default_duration")]
    duration: String,
    #[serde(default)]
    bucket_span: Option<String>,
}

fn default_duration() -> String {
    "1h".to_string()
}

/// Historical time-series for one panel (cpu/memory/network/disk) over a range,
/// bucketized. Drives the building Metrics drawer.
async fn get_metrics(
    State(state): State<AppState>,
    user: AuthUser,
    Path((org_id, app_id)): Path<(String, String)>,
    Query(query): Query<MetricsQuery>,
) -> Result<Json<MetricsResponse>, AppError> {
    validate_cc_id(&org_id)?;
    validate_cc_id(&app_id)?;
    require_org_member(&state, &user.0, &org_id).await?;

    let template = templates::get_template(&query.panel)
        .ok_or_else(|| AppError::BadRequest(format!("unknown panel: {}", query.panel)))?;
    let duration = templates::parse_duration(&query.duration)
        .ok_or_else(|| AppError::BadRequest(format!("invalid duration: {}", query.duration)))?;
    let bucket_input = query
        .bucket_span
        .as_deref()
        .unwrap_or_else(|| templates::default_bucket_for_duration(&query.duration));
    let bucket_span = templates::parse_bucket_span(bucket_input)
        .ok_or_else(|| AppError::BadRequest(format!("invalid bucket_span: {bucket_input}")))?;
    let bucket_span_us: i64 = bucket_span
        .parse()
        .map_err(|_| AppError::BadRequest(format!("invalid bucket_span: {bucket_input}")))?;

    // Warp10 read token via the shared two-layer cache.
    let cc = authz::cc_client_for_user(&state, &user.0)?;
    let token = crate::warp10::tokens::ensure_token(
        &state.warp10_cache,
        &state.db,
        &state.config.encryption_key,
        &cc,
        user.0.id,
        &org_id,
    )
    .await
    .map_err(|e| AppError::Warp10(e.to_string()))?;

    let params = templates::WarpScriptParams {
        token,
        app_id,
        duration,
        bucket_span,
    };
    let script = templates::render(template, &params);

    let raw = crate::warp10::client::execute_warpscript(
        &state.http_client,
        &state.config.warp10_endpoint,
        &script,
    )
    .await
    .map_err(|e| AppError::Warp10(e.to_string()))?;

    Ok(Json(client::parse_gts_response(&raw, &query.panel, bucket_span_us)))
}
