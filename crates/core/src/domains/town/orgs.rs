//! City-facing org data: the app/addon lists + dependency graph the builder and
//! scene use, plus webhook-setup info. CC API passthroughs reusing the per-user
//! `CcClient`, tenant-isolated.

use crate::auth::authz;
use crate::auth::session::AuthUser;
use crate::cc::{CcAddon, CcApplication, SUBSCRIBED_EVENTS};
use crate::db::webhook_configs;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Path, State};
use axum::routing::get;
use axum::{Json, Router};
use base64::Engine;
use rand::RngCore;
use serde::Serialize;
use std::collections::HashMap;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/api/orgs/{org_id}/apps", get(list_apps))
        .route("/api/orgs/{org_id}/addons", get(list_addons))
        .route("/api/orgs/{org_id}/dependencies", get(dependencies))
        .route("/api/orgs/{org_id}/webhook-setup", get(webhook_setup))
}

async fn guard(state: &AppState, user: &AuthUser, org_id: &str) -> Result<(), AppError> {
    authz::validate_cc_id(org_id)?;
    authz::require_org_member(state, &user.0, org_id).await
}

async fn list_apps(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<Vec<CcApplication>>, AppError> {
    guard(&state, &user, &org_id).await?;
    let cc = authz::cc_client_for_user(&state, &user.0)?;
    let apps = cc.list_applications(&org_id).await.map_err(|e| AppError::CcApi(e.to_string()))?;
    Ok(Json(apps))
}

async fn list_addons(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<Vec<CcAddon>>, AppError> {
    guard(&state, &user, &org_id).await?;
    let cc = authz::cc_client_for_user(&state, &user.0)?;
    let addons = cc.list_addons(&org_id).await.map_err(|e| AppError::CcApi(e.to_string()))?;
    Ok(Json(addons))
}

/// `{ appId: [addonId, ...] }` — addons linked to each app.
async fn dependencies(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<HashMap<String, Vec<String>>>, AppError> {
    guard(&state, &user, &org_id).await?;
    let cc = authz::cc_client_for_user(&state, &user.0)?;
    let apps = cc.list_applications(&org_id).await.map_err(|e| AppError::CcApi(e.to_string()))?;

    let mut out: HashMap<String, Vec<String>> = HashMap::new();
    for app in apps {
        match cc.list_linked_addons(&org_id, &app.id).await {
            Ok(linked) => {
                out.insert(app.id, linked.into_iter().map(|a| a.id).collect());
            }
            Err(e) => tracing::warn!(app = %app.id, error = ?e, "list_linked_addons failed"),
        }
    }
    Ok(Json(out))
}

#[derive(Serialize)]
struct WebhookSetupInfo {
    enabled: bool,
    url: Option<String>,
    events: Vec<String>,
    console_url: String,
    configured: bool,
}

/// Provision (idempotently) a webhook token for this (user, org) and return the
/// URL to paste into the CC console, plus whether a hook is already wired.
async fn webhook_setup(
    State(state): State<AppState>,
    user: AuthUser,
    Path(org_id): Path<String>,
) -> Result<Json<WebhookSetupInfo>, AppError> {
    guard(&state, &user, &org_id).await?;

    let existing = webhook_configs::list_for_user(&state.db, user.0.id)
        .await?
        .into_iter()
        .find(|c| c.cc_org_id == org_id);

    let (token, configured) = match existing {
        Some(c) => (c.token, c.cc_webhook_id.is_some()),
        None => {
            let mut buf = [0u8; 32];
            rand::thread_rng().fill_bytes(&mut buf);
            let token = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(buf);
            let events: Vec<String> = SUBSCRIBED_EVENTS.iter().map(|s| s.to_string()).collect();
            webhook_configs::create(&state.db, user.0.id, &org_id, &token, None, &events).await?;
            (token, false)
        }
    };

    let public = state
        .config
        .webhooks_public_url
        .clone()
        .unwrap_or_else(|| state.config.app_url.clone());

    Ok(Json(WebhookSetupInfo {
        enabled: state.config.use_webhooks,
        url: Some(format!("{public}/webhooks/cc/{token}")),
        events: SUBSCRIBED_EVENTS.iter().map(|s| s.to_string()).collect(),
        console_url: format!("https://console.clever-cloud.com/organisations/{org_id}/notifications"),
        configured,
    }))
}
