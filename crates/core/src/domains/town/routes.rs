use crate::auth::authz;
use crate::auth::session::AuthUser;
use crate::db::maps;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::routing::get;
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use tower_http::limit::RequestBodyLimitLayer;

/// 512 KB is plenty for a hex map (real ones sit under ~50 KB). Beyond this is
/// a runaway client or an attempt to OOM the backend via PUT /map.
const MAP_PAYLOAD_LIMIT: usize = 512 * 1024;

/// CC resource ids and building asset ids are alphanumeric + `-_`. Anything
/// else is suspicious: appIds are interpolated into WarpScript and building
/// values become GLTF asset paths on the frontend.
fn is_safe_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 128 && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/orgs/{org_id}/map", get(get_map).put(put_map))
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(MAP_PAYLOAD_LIMIT))
}

#[derive(Debug, Serialize)]
pub struct MapResponse {
    pub name: String,
    pub cells: serde_json::Value,
    pub settings: serde_json::Value,
    pub version: i32,
}

#[derive(Debug, Deserialize)]
pub struct MapPayload {
    #[serde(default = "default_name")]
    pub name: String,
    pub cells: serde_json::Value,
    #[serde(default = "default_settings")]
    pub settings: serde_json::Value,
}

fn default_settings() -> serde_json::Value {
    serde_json::json!({})
}

fn default_name() -> String {
    "My City".to_string()
}

async fn get_map(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<MapResponse>, AppError> {
    authz::validate_cc_id(&org_id)?;
    authz::require_org_member(&state, &user.0, &org_id).await?;

    let row = maps::get_or_create(&state.db, user.0.id, &org_id).await?;
    Ok(Json(MapResponse {
        name: row.name,
        cells: row.cells_json,
        settings: row.settings,
        version: row.version,
    }))
}

async fn put_map(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
    Json(payload): Json<MapPayload>,
) -> Result<Json<MapResponse>, AppError> {
    authz::validate_cc_id(&org_id)?;
    authz::require_org_member(&state, &user.0, &org_id).await?;

    let cells = payload
        .cells
        .as_array()
        .ok_or_else(|| AppError::BadRequest("cells must be a JSON array".into()))?;

    for cell in cells {
        for field in ["appId", "addonId"] {
            if let Some(id) = cell.get(field).and_then(|v| v.as_str()) {
                if !is_safe_id(id) {
                    return Err(AppError::BadRequest(format!(
                        "invalid {field}: must match ^[A-Za-z0-9_-]+$"
                    )));
                }
            }
        }
        if let Some(building) = cell.get("building").and_then(|v| v.as_str()) {
            if !is_safe_id(building) {
                return Err(AppError::BadRequest(
                    "invalid building asset id: must match ^[A-Za-z0-9_-]+$".into(),
                ));
            }
        }
    }

    let row = maps::upsert_cells(
        &state.db,
        user.0.id,
        &org_id,
        &payload.name,
        &payload.cells,
        &payload.settings,
    )
    .await?;
    Ok(Json(MapResponse {
        name: row.name,
        cells: row.cells_json,
        settings: row.settings,
        version: row.version,
    }))
}
