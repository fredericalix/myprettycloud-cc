//! Two-layer Warp10 read-token cache: an in-memory hot path (4h TTL) backed by
//! the durable, encrypted `warp10_tokens` table (so a restart keeps metrics
//! warm). CC issues tokens valid ~5 days; we refresh the durable copy every 4.

use crate::auth::encryption;
use crate::cc::CcClient;
use crate::db::warp10_tokens;
use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use sqlx::PgPool;
use uuid::Uuid;

const MEM_TTL: Duration = Duration::hours(4);
const DB_TTL: Duration = Duration::days(4);

#[derive(Default)]
pub struct TokenCache {
    inner: DashMap<(Uuid, String), (String, DateTime<Utc>)>,
}

impl TokenCache {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Return a valid Warp10 read token for (user, org), minting + persisting a
/// fresh one if neither cache layer has a live token.
pub async fn ensure_token(
    mem: &TokenCache,
    db: &PgPool,
    key: &[u8; 32],
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<String> {
    let now = Utc::now();
    let cache_key = (user_id, cc_org_id.to_string());

    // 1. In-memory hot path.
    if let Some(entry) = mem.inner.get(&cache_key) {
        let (token, expires) = entry.value();
        if expires > &now {
            return Ok(token.clone());
        }
    }

    // 2. Durable encrypted cache.
    if let Some(row) = warp10_tokens::find_valid_token(db, user_id, cc_org_id).await? {
        if row.token_nonce.len() >= 12 {
            if let Ok(bytes) = encryption::decrypt(&row.token_enc, &row.token_nonce[..12], key) {
                if let Ok(token) = String::from_utf8(bytes) {
                    mem.inner.insert(cache_key, (token.clone(), now + MEM_TTL));
                    return Ok(token);
                }
            }
        }
    }

    // 3. Mint fresh from CC, persist (best-effort), populate memory.
    let token = cc.get_metrics_token(cc_org_id).await?;
    let (enc, nonce) = encryption::encrypt(token.as_bytes(), key)?;
    if let Err(e) =
        warp10_tokens::upsert_token(db, user_id, cc_org_id, &enc, &nonce, now + DB_TTL).await
    {
        tracing::warn!(error = ?e, "failed to persist warp10 token (continuing with in-memory)");
    }
    mem.inner
        .insert((user_id, cc_org_id.to_string()), (token.clone(), now + MEM_TTL));
    Ok(token)
}
