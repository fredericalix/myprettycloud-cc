//! Tenant isolation. Adopted wholesale from myccmetrics: short-lived org
//! membership cache, per-user CC client construction, the `require_org_member`
//! gate, and `validate_cc_id` (blocks WarpScript/SQL injection via path params).

use crate::auth::encryption;
use crate::cc::CcClient;
use crate::db::users::User;
use crate::error::AppError;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use uuid::Uuid;

const ORG_CACHE_TTL: Duration = Duration::from_secs(300);

pub struct CachedOrgs {
    pub org_ids: Vec<String>,
    pub cached_at: Instant,
}

pub type OrgCache = Arc<RwLock<HashMap<Uuid, CachedOrgs>>>;

pub fn new_org_cache() -> OrgCache {
    Arc::new(RwLock::new(HashMap::new()))
}

/// Build a `CcClient` authenticated as `user` by decrypting their stored
/// OAuth tokens. The 24-byte nonce is two concatenated 12-byte AES-GCM nonces.
pub fn cc_client_for_user<'a>(state: &'a AppState, user: &User) -> Result<CcClient<'a>, AppError> {
    let nonce = &user.oauth_nonce;
    if nonce.len() < 24 {
        return Err(AppError::Internal(anyhow::anyhow!(
            "invalid oauth nonce length"
        )));
    }
    let token = encryption::decrypt(&user.oauth_token_enc, &nonce[..12], &state.config.encryption_key)
        .map_err(AppError::Internal)?;
    let secret = encryption::decrypt(&user.oauth_secret_enc, &nonce[12..24], &state.config.encryption_key)
        .map_err(AppError::Internal)?;

    let token_str = String::from_utf8(token).map_err(|e| AppError::Internal(e.into()))?;
    let secret_str = String::from_utf8(secret).map_err(|e| AppError::Internal(e.into()))?;

    Ok(CcClient::new(
        &state.http_client,
        &state.config,
        token_str,
        secret_str,
    ))
}

/// Organisation IDs the user belongs to, via a short-lived in-memory cache.
pub async fn user_org_ids(state: &AppState, user: &User) -> Result<Vec<String>, AppError> {
    {
        let cache = state.org_cache.read().await;
        if let Some(entry) = cache.get(&user.id) {
            if entry.cached_at.elapsed() < ORG_CACHE_TTL {
                return Ok(entry.org_ids.clone());
            }
        }
    }

    let client = cc_client_for_user(state, user)?;
    let orgs = client
        .list_organisations()
        .await
        .map_err(|e| AppError::CcApi(e.to_string()))?;
    let org_ids: Vec<String> = orgs.into_iter().map(|o| o.id).collect();

    {
        let mut cache = state.org_cache.write().await;
        cache.insert(
            user.id,
            CachedOrgs {
                org_ids: org_ids.clone(),
                cached_at: Instant::now(),
            },
        );
    }

    Ok(org_ids)
}

/// Ensure `user` is a member of `org_id`. Returns `Forbidden` otherwise.
pub async fn require_org_member(state: &AppState, user: &User, org_id: &str) -> Result<(), AppError> {
    let orgs = user_org_ids(state, user).await?;
    if orgs.iter().any(|o| o == org_id) {
        Ok(())
    } else {
        Err(AppError::Forbidden)
    }
}

/// Accept only Clever Cloud-style identifiers (alnum, underscore, hyphen) up
/// to 128 chars. Blocks WarpScript/SQL injection via path params interpolated
/// into queries.
pub fn validate_cc_id(id: &str) -> Result<(), AppError> {
    if id.is_empty() || id.len() > 128 {
        return Err(AppError::BadRequest("invalid id".to_string()));
    }
    let ok = id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-');
    if ok {
        Ok(())
    } else {
        Err(AppError::BadRequest("invalid id".to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_warpscript_injection() {
        assert!(validate_cc_id("app_abc123").is_ok());
        assert!(validate_cc_id("orga_5d2b-4f5b").is_ok());
        assert!(validate_cc_id("").is_err());
        assert!(validate_cc_id("app'").is_err());
        assert!(validate_cc_id("app } FETCH").is_err());
        assert!(validate_cc_id("a/b").is_err());
        assert!(validate_cc_id(&"x".repeat(200)).is_err());
    }
}
