//! /api/templates — user-owned scene templates (reusable map layouts).
//!
//! Templates are NOT org-scoped: any logged-in user owns their own, and public
//! ones are visible to everyone. `cells_json` is opaque, validated only for
//! shape + safe building-asset ids (same rules as the map PUT handler).

use crate::auth::session::AuthUser;
use crate::db::scene_templates::{self, Template, TemplateListItem};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{DefaultBodyLimit, Path, State};
use axum::http::StatusCode;
use axum::routing::get;
use axum::{Json, Router};
use serde::Deserialize;
use tower_http::limit::RequestBodyLimitLayer;
use uuid::Uuid;

/// Same ceiling as maps — a hex layout is tiny; beyond this is abuse.
const TEMPLATE_PAYLOAD_LIMIT: usize = 512 * 1024;

fn is_safe_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 128
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/templates", get(list_mine).post(create))
        .route("/api/templates/public", get(list_public))
        .route(
            "/api/templates/{id}",
            get(get_one).patch(patch_one).delete(delete_one),
        )
        .layer(DefaultBodyLimit::disable())
        .layer(RequestBodyLimitLayer::new(TEMPLATE_PAYLOAD_LIMIT))
}

#[derive(Deserialize)]
struct CreateBody {
    name: String,
    #[serde(default)]
    visibility: Option<String>,
    cells: serde_json::Value,
}

#[derive(Deserialize)]
struct PatchBody {
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    visibility: Option<String>,
}

fn norm_visibility(v: &str) -> Result<&'static str, AppError> {
    match v {
        "private" => Ok("private"),
        "public" => Ok("public"),
        _ => Err(AppError::BadRequest(
            "visibility must be 'private' or 'public'".into(),
        )),
    }
}

/// Validate the cells payload: must be an array; building ids stay in the safe
/// charset (they become GLTF asset paths on the frontend).
fn validate_cells(cells: &serde_json::Value) -> Result<(), AppError> {
    let arr = cells
        .as_array()
        .ok_or_else(|| AppError::BadRequest("cells must be a JSON array".into()))?;
    for cell in arr {
        if let Some(b) = cell.get("building").and_then(|v| v.as_str()) {
            if !is_safe_id(b) {
                return Err(AppError::BadRequest(
                    "invalid building asset id: must match ^[A-Za-z0-9_-]+$".into(),
                ));
            }
        }
    }
    Ok(())
}

async fn list_mine(
    State(state): State<AppState>,
    user: AuthUser,
) -> Result<Json<Vec<TemplateListItem>>, AppError> {
    Ok(Json(
        scene_templates::list_for_owner(&state.db, user.0.id).await?,
    ))
}

async fn list_public(
    State(state): State<AppState>,
    _user: AuthUser,
) -> Result<Json<Vec<TemplateListItem>>, AppError> {
    Ok(Json(scene_templates::list_public(&state.db).await?))
}

async fn create(
    State(state): State<AppState>,
    user: AuthUser,
    Json(body): Json<CreateBody>,
) -> Result<Json<Template>, AppError> {
    let name = body.name.trim();
    if name.is_empty() {
        return Err(AppError::BadRequest("name must not be empty".into()));
    }
    let visibility = norm_visibility(body.visibility.as_deref().unwrap_or("private"))?;
    validate_cells(&body.cells)?;
    Ok(Json(
        scene_templates::create(&state.db, user.0.id, name, visibility, &body.cells).await?,
    ))
}

async fn get_one(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<Json<Template>, AppError> {
    let t = scene_templates::get_accessible(&state.db, user.0.id, id)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("template {id}")))?;
    Ok(Json(t))
}

async fn patch_one(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
    Json(body): Json<PatchBody>,
) -> Result<Json<Template>, AppError> {
    let name = body.name.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let visibility = match body.visibility.as_deref() {
        Some(v) => Some(norm_visibility(v)?),
        None => None,
    };
    let t = scene_templates::update(&state.db, user.0.id, id, name, visibility)
        .await?
        .ok_or_else(|| AppError::NotFound(format!("template {id}")))?;
    Ok(Json(t))
}

async fn delete_one(
    State(state): State<AppState>,
    user: AuthUser,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, AppError> {
    let n = scene_templates::delete(&state.db, user.0.id, id).await?;
    if n == 0 {
        Err(AppError::NotFound(format!("template {id}")))
    } else {
        Ok(StatusCode::NO_CONTENT)
    }
}
