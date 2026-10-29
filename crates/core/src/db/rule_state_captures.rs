//! Repository for `rule_state_captures` — the pre-action snapshots backing the
//! `revert_on_recovery` option of set_monitor_state actions. One row per
//! (rule, target monitor) episode: written on the episode's first matched
//! firing, consumed when the rule recovers (matched → not_matched).

use sqlx::PgPool;
use uuid::Uuid;

/// Snapshot the target's pre-action state. First capture of an episode wins:
/// ON CONFLICT DO NOTHING, so repeated matched firings don't overwrite the
/// snapshot with an already-overwritten state. Returns true when a row was
/// inserted (i.e. this firing opened the episode).
pub async fn capture(
    pool: &PgPool,
    rule_id: Uuid,
    monitor_id: Uuid,
    prev_state: &str,
    prev_message: Option<&str>,
) -> Result<bool, sqlx::Error> {
    let res = sqlx::query(
        r#"
        INSERT INTO rule_state_captures (rule_id, monitor_id, prev_state, prev_message)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (rule_id, monitor_id) DO NOTHING
        "#,
    )
    .bind(rule_id)
    .bind(monitor_id)
    .bind(prev_state)
    .bind(prev_message)
    .execute(pool)
    .await?;
    Ok(res.rows_affected() > 0)
}

/// Atomically consume the snapshot for (rule, monitor): DELETE … RETURNING,
/// so concurrent recoveries on other instances can't double-revert.
pub async fn take(
    pool: &PgPool,
    rule_id: Uuid,
    monitor_id: Uuid,
) -> Result<Option<(String, Option<String>)>, sqlx::Error> {
    sqlx::query_as::<_, (String, Option<String>)>(
        r#"
        DELETE FROM rule_state_captures
        WHERE rule_id = $1 AND monitor_id = $2
        RETURNING prev_state, prev_message
        "#,
    )
    .bind(rule_id)
    .bind(monitor_id)
    .fetch_optional(pool)
    .await
}

/// Purge every capture of a rule. Called inside the save transaction: an
/// edited rule's old captures may describe a different action set, and a
/// stale restore is worse than a lost revert.
pub async fn delete_for_rule<'e, E>(executor: E, rule_id: Uuid) -> Result<u64, sqlx::Error>
where
    E: sqlx::Executor<'e, Database = sqlx::Postgres>,
{
    let res = sqlx::query("DELETE FROM rule_state_captures WHERE rule_id = $1")
        .bind(rule_id)
        .execute(executor)
        .await?;
    Ok(res.rows_affected())
}
