//! Durable cache of CC Warp10 read tokens, per (user, org), encrypted at rest.
//! (mycctown's per-user shape.)

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, sqlx::FromRow)]
pub struct Warp10Token {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: String,
    pub token_enc: Vec<u8>,
    pub token_nonce: Vec<u8>,
    pub fetched_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
}

pub async fn find_valid_token(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Option<Warp10Token>, sqlx::Error> {
    sqlx::query_as::<_, Warp10Token>(
        "SELECT id, user_id, cc_org_id, token_enc, token_nonce, fetched_at, expires_at \
         FROM warp10_tokens \
         WHERE user_id = $1 AND cc_org_id = $2 AND expires_at > NOW() \
         ORDER BY fetched_at DESC LIMIT 1",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_optional(pool)
    .await
}

pub async fn upsert_token(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    token_enc: &[u8],
    token_nonce: &[u8],
    expires_at: DateTime<Utc>,
) -> Result<(), sqlx::Error> {
    // One valid token per (user, org): replace any prior row.
    sqlx::query("DELETE FROM warp10_tokens WHERE user_id = $1 AND cc_org_id = $2")
        .bind(user_id)
        .bind(cc_org_id)
        .execute(pool)
        .await?;

    sqlx::query(
        "INSERT INTO warp10_tokens (user_id, cc_org_id, token_enc, token_nonce, expires_at) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(token_enc)
    .bind(token_nonce)
    .bind(expires_at)
    .execute(pool)
    .await?;
    Ok(())
}
