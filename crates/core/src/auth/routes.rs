//! OAuth 1.0a login flow: redirect to Clever Cloud, handle the callback,
//! upsert the user, store `user_id` in the session.

use crate::auth::session::SESSION_USER_KEY;
use crate::auth::{encryption, oauth};
use crate::db::users;
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::{Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use tower_sessions::Session;

pub fn router() -> Router<AppState> {
    Router::new()
        .route("/auth/login", get(login))
        .route("/auth/callback", get(callback))
        .route("/auth/logout", post(logout))
}

async fn login(State(state): State<AppState>) -> Result<Response, AppError> {
    let (oauth_token, oauth_token_secret) =
        oauth::request_temporary_token(&state.config, &state.http_client)
            .await
            .map_err(|e| AppError::CcApi(format!("failed to get request token: {e}")))?;

    // Stash the request-token secret encrypted in a short-lived cookie so the
    // callback can complete the exchange without server-side state.
    let (encrypted, nonce) =
        encryption::encrypt(oauth_token_secret.as_bytes(), &state.config.encryption_key)
            .map_err(AppError::Internal)?;

    let mut cookie_value = Vec::with_capacity(nonce.len() + encrypted.len());
    cookie_value.extend_from_slice(&nonce);
    cookie_value.extend_from_slice(&encrypted);
    let cookie_b64 =
        base64::Engine::encode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, &cookie_value);

    let authorize_url = format!(
        "{}/v2/oauth/authorize?oauth_token={}",
        state.config.cc_api_base_url, oauth_token
    );

    let is_secure = state.config.app_url.starts_with("https://");
    let cookie = format!(
        "oauth_state={}; Path=/; HttpOnly;{} SameSite=Lax; Max-Age=600",
        cookie_b64,
        if is_secure { " Secure;" } else { "" }
    );

    Ok((
        StatusCode::SEE_OTHER,
        [(header::LOCATION, authorize_url), (header::SET_COOKIE, cookie)],
    )
        .into_response())
}

#[derive(Deserialize)]
struct CallbackParams {
    oauth_token: String,
    oauth_verifier: String,
}

async fn callback(
    State(state): State<AppState>,
    session: Session,
    Query(params): Query<CallbackParams>,
    headers: axum::http::HeaderMap,
) -> Result<Response, AppError> {
    let cookie_header = headers
        .get(header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    let oauth_state = cookie_header
        .split(';')
        .map(|s| s.trim())
        .find(|s| s.starts_with("oauth_state="))
        .and_then(|s| s.strip_prefix("oauth_state="))
        .ok_or_else(|| AppError::BadRequest("missing oauth_state cookie".to_string()))?;

    let cookie_bytes =
        base64::Engine::decode(&base64::engine::general_purpose::URL_SAFE_NO_PAD, oauth_state)
            .map_err(|_| AppError::BadRequest("invalid oauth_state cookie".to_string()))?;

    if cookie_bytes.len() < 13 {
        return Err(AppError::BadRequest("oauth_state cookie too short".to_string()));
    }

    let (nonce, ciphertext) = cookie_bytes.split_at(12);
    let oauth_token_secret = encryption::decrypt(ciphertext, nonce, &state.config.encryption_key)
        .map_err(|_| AppError::BadRequest("failed to decrypt oauth_state".to_string()))?;
    let oauth_token_secret = String::from_utf8(oauth_token_secret)
        .map_err(|_| AppError::BadRequest("invalid oauth_token_secret".to_string()))?;

    let (access_token, access_secret) = oauth::exchange_access_token(
        &state.config,
        &state.http_client,
        &params.oauth_token,
        &oauth_token_secret,
        &params.oauth_verifier,
    )
    .await
    .map_err(|e| AppError::CcApi(format!("failed to exchange access token: {e}")))?;

    // Fetch the CC user identity using the freshly minted access token.
    let temp_client = crate::cc::CcClient::new(
        &state.http_client,
        &state.config,
        access_token.clone(),
        access_secret.clone(),
    );
    let user_json = temp_client
        .get_self()
        .await
        .map_err(|e| AppError::CcApi(format!("failed to fetch CC user: {e}")))?;

    let cc_user_id = user_json["id"]
        .as_str()
        .ok_or_else(|| AppError::CcApi("missing user id in CC response".to_string()))?;
    let email = user_json["email"].as_str();
    let display_name = user_json["name"].as_str();

    let (token_enc, token_nonce) =
        encryption::encrypt(access_token.as_bytes(), &state.config.encryption_key)
            .map_err(AppError::Internal)?;
    let (secret_enc, secret_nonce) =
        encryption::encrypt(access_secret.as_bytes(), &state.config.encryption_key)
            .map_err(AppError::Internal)?;

    let mut combined_nonce = Vec::with_capacity(24);
    combined_nonce.extend_from_slice(&token_nonce);
    combined_nonce.extend_from_slice(&secret_nonce);

    let user = users::upsert_user(
        &state.db,
        cc_user_id,
        email,
        display_name,
        &token_enc,
        &secret_enc,
        &combined_nonce,
    )
    .await?;

    session
        .insert(SESSION_USER_KEY, user.id)
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("session insert failed: {e}")))?;

    let clear_cookie = "oauth_state=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";
    let redirect_url = format!("{}/", state.config.frontend_url);

    Ok((
        StatusCode::SEE_OTHER,
        [
            (header::LOCATION, redirect_url),
            (header::SET_COOKIE, clear_cookie.to_string()),
        ],
    )
        .into_response())
}

async fn logout(session: Session) -> Result<StatusCode, AppError> {
    session
        .delete()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("session delete failed: {e}")))?;
    Ok(StatusCode::OK)
}
