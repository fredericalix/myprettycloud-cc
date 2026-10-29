//! Session-backed request extractor. A handler taking `AuthUser` is rejected
//! with 401 unless a valid `user_id` is present in the session and resolves to
//! a row in `users`.

use crate::auth::encryption;
use crate::db::users::{self, User};
use crate::error::AppError;
use crate::state::AppState;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use tower_sessions::Session;
use uuid::Uuid;

pub const SESSION_USER_KEY: &str = "user_id";

pub struct AuthUser(pub User);

impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthorized)?;

        let user_id: Option<Uuid> = session
            .get(SESSION_USER_KEY)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let user_id = user_id.ok_or(AppError::Unauthorized)?;

        let user = users::find_by_id(&state.db, user_id)
            .await?
            .ok_or(AppError::Unauthorized)?;

        Ok(AuthUser(user))
    }
}

/// Decrypt a user's stored OAuth (access_token, access_secret) pair. The
/// 24-byte nonce is two concatenated 12-byte AES-GCM nonces.
pub fn decrypt_user_oauth(user: &User, key: &[u8; 32]) -> anyhow::Result<(String, String)> {
    if user.oauth_nonce.len() != 24 {
        anyhow::bail!("invalid oauth_nonce length: {}", user.oauth_nonce.len());
    }
    let (token_nonce, secret_nonce) = user.oauth_nonce.split_at(12);
    let token_bytes = encryption::decrypt(&user.oauth_token_enc, token_nonce, key)?;
    let secret_bytes = encryption::decrypt(&user.oauth_secret_enc, secret_nonce, key)?;
    Ok((String::from_utf8(token_bytes)?, String::from_utf8(secret_bytes)?))
}

/// Richer extractor used by the monitor-domain handlers: resolves the session
/// user AND decrypts their OAuth tokens for immediate CC API calls.
#[derive(Debug, Clone)]
pub struct AuthenticatedUser {
    pub id: Uuid,
    pub user: User,
    pub access_token: String,
    pub access_secret: String,
}

impl FromRequestParts<AppState> for AuthenticatedUser {
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Self::Rejection> {
        let session = Session::from_request_parts(parts, state)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let user_id: Option<Uuid> = session
            .get(SESSION_USER_KEY)
            .await
            .map_err(|_| AppError::Unauthorized)?;
        let user_id = user_id.ok_or(AppError::Unauthorized)?;

        let user = users::find_by_id(&state.db, user_id)
            .await?
            .ok_or(AppError::Unauthorized)?;
        let (access_token, access_secret) =
            decrypt_user_oauth(&user, &state.config.encryption_key).map_err(AppError::Internal)?;

        Ok(Self {
            id: user_id,
            user,
            access_token,
            access_secret,
        })
    }
}
