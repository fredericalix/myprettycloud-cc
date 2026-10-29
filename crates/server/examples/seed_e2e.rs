//! Throwaway local-dev seeder for end-to-end testing of session-authenticated
//! endpoints (e.g. POST /api/rules/test-draft) without going through the CC
//! OAuth dance. Creates a user (dummy encrypted OAuth tokens), a synthetic
//! monitor in `critical` with a CPU metric history, and a real session row via
//! the same tower-sessions PostgresStore the server uses, then prints the
//! `mpc.sid` cookie to use with curl.
//!
//! Run the server with ENCRYPTION_KEY set to the base64 of 32 × 0x41 bytes
//! ("QUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUE=") so the seeded tokens
//! decrypt. Local dev only — never against a production database.

use mpc_core::auth::encryption;
use sqlx::postgres::PgPoolOptions;
use sqlx::types::Uuid;
use time::{Duration, OffsetDateTime};
use tower_sessions::SessionStore;
use tower_sessions::session::{Id, Record};
use tower_sessions_sqlx_store::PostgresStore;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let db_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://mpc:mpc@localhost:5433/myprettycloud".to_string());
    let pool = PgPoolOptions::new().connect(&db_url).await?;

    // Must match the server's ENCRYPTION_KEY (base64 of 32 'A' bytes).
    let key = [0x41u8; 32];

    // User with dummy (but decryptable) OAuth tokens.
    let (token_enc, token_nonce) = encryption::encrypt(b"dummy-token", &key)?;
    let (secret_enc, secret_nonce) = encryption::encrypt(b"dummy-secret", &key)?;
    let mut oauth_nonce = token_nonce.to_vec();
    oauth_nonce.extend_from_slice(&secret_nonce);

    let user_id: Uuid = sqlx::query_scalar(
        "INSERT INTO users (cc_user_id, email, display_name, oauth_token_enc, oauth_secret_enc, oauth_nonce)
         VALUES ($1, 'e2e@example.test', 'E2E Seeder', $2, $3, $4)
         ON CONFLICT (cc_user_id) DO UPDATE SET last_login_at = now()
         RETURNING id",
    )
    .bind("user_e2e_seed")
    .bind(&token_enc)
    .bind(&secret_enc)
    .bind(&oauth_nonce)
    .fetch_one(&pool)
    .await?;

    // Synthetic monitor, critical for 10 minutes.
    let monitor_id: Uuid = sqlx::query_scalar(
        "INSERT INTO monitors (user_id, kind, display_name, current_state, current_state_since)
         VALUES ($1, 'synthetic', 'e2e-seeded-monitor', 'critical', now() - interval '10 minutes')
         ON CONFLICT (user_id, display_name) WHERE kind = 'synthetic'
         DO UPDATE SET current_state = 'critical', current_state_since = now() - interval '10 minutes'
         RETURNING id",
    )
    .bind(user_id)
    .fetch_one(&pool)
    .await?;

    // CPU readings: ≥ 80 for the last ~6 minutes, with an anchor outside a
    // 5-minute window — so `cpu gte 80 for 300s` holds, `for 86400s` doesn't.
    sqlx::query("DELETE FROM metric_readings WHERE monitor_id = $1")
        .bind(monitor_id)
        .execute(&pool)
        .await?;
    for (secs_ago, value) in [(360i64, 90.0f64), (240, 92.0), (120, 88.0), (5, 91.0)] {
        sqlx::query(
            "INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
             VALUES ($1, 'cpu', now() - make_interval(secs => $2), $3)",
        )
        .bind(monitor_id)
        .bind(secs_ago as f64)
        .bind(value)
        .execute(&pool)
        .await?;
    }

    // Real session row via the server's own store.
    let store = PostgresStore::new(pool.clone());
    store.migrate().await?;
    let mut record = Record {
        id: Id::default(),
        data: [("user_id".to_string(), serde_json::json!(user_id))]
            .into_iter()
            .collect(),
        expiry_date: OffsetDateTime::now_utc() + Duration::days(1),
    };
    store.create(&mut record).await?;

    println!("user_id={user_id}");
    println!("monitor_id={monitor_id}");
    println!("cookie=mpc.sid={}", record.id);
    Ok(())
}
