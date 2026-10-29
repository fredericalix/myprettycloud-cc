use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Rule {
    pub id: Uuid,
    pub user_id: Uuid,
    /// Clever Cloud org this rule belongs to (the org of the monitors it
    /// watches). Used to filter the Workflows manager per org; `None` for
    /// group-only / legacy rules until their next save re-tags them.
    pub cc_org_id: Option<String>,
    pub name: String,
    pub is_enabled: bool,
    pub condition: serde_json::Value,
    pub actions: serde_json::Value,
    pub cooldown_seconds: i32,
    pub last_fired_at: Option<DateTime<Utc>>,
    pub last_outcome_state: Option<String>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub last_modified_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct RuleVersion {
    pub rule_id: Uuid,
    pub version_id: String,
    pub rule: serde_json::Value,
    pub comment: Option<String>,
    pub saved_at: DateTime<Utc>,
}

const VERSIONS_PER_RULE: i64 = 5;

/// Save (insert or update) a rule + its dependencies index + a version row.
/// Caller MUST have validated cycle absence and cross-user references.
#[allow(clippy::too_many_arguments)]
pub async fn save(
    pool: &PgPool,
    user_id: Uuid,
    id: Option<Uuid>,
    cc_org_id: Option<&str>,
    name: &str,
    is_enabled: bool,
    condition: &serde_json::Value,
    actions: &serde_json::Value,
    cooldown_seconds: i32,
    metadata: Option<&serde_json::Value>,
    dependencies: &[(String, Uuid)],
    comment: Option<&str>,
) -> Result<Rule, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let row: Rule = match id {
        Some(id) => {
            // Keep an existing org tag if the caller couldn't resolve one
            // (COALESCE: only overwrite cc_org_id when a new value is given).
            sqlx::query_as::<_, Rule>(
                r#"
                UPDATE rules SET
                    name = $3,
                    is_enabled = $4,
                    condition = $5,
                    actions = $6,
                    cooldown_seconds = $7,
                    metadata = $8,
                    cc_org_id = COALESCE($9, cc_org_id),
                    last_modified_at = now()
                WHERE id = $1 AND user_id = $2
                RETURNING *
                "#,
            )
            .bind(id)
            .bind(user_id)
            .bind(name)
            .bind(is_enabled)
            .bind(condition)
            .bind(actions)
            .bind(cooldown_seconds)
            .bind(metadata)
            .bind(cc_org_id)
            .fetch_one(&mut *tx)
            .await?
        }
        None => {
            sqlx::query_as::<_, Rule>(
                r#"
                INSERT INTO rules (user_id, cc_org_id, name, is_enabled, condition, actions, cooldown_seconds, metadata)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                "#,
            )
            .bind(user_id)
            .bind(cc_org_id)
            .bind(name)
            .bind(is_enabled)
            .bind(condition)
            .bind(actions)
            .bind(cooldown_seconds)
            .bind(metadata)
            .fetch_one(&mut *tx)
            .await?
        }
    };

    // Refresh rule_dependencies for this rule.
    sqlx::query("DELETE FROM rule_dependencies WHERE rule_id = $1")
        .bind(row.id)
        .execute(&mut *tx)
        .await?;

    // Purge revert captures: an edited rule's old snapshots may describe a
    // different action set, and a stale restore is worse than a lost revert.
    crate::db::rule_state_captures::delete_for_rule(&mut *tx, row.id).await?;
    for (kind, ref_id) in dependencies {
        sqlx::query(
            "INSERT INTO rule_dependencies (rule_id, ref_kind, ref_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(row.id)
        .bind(kind)
        .bind(ref_id)
        .execute(&mut *tx)
        .await?;
    }

    // Append a new version + prune to last 5.
    let version_id = format!("v{}", Utc::now().timestamp());
    let snapshot = serde_json::to_value(&row).expect("Rule serialises");
    sqlx::query(
        r#"
        INSERT INTO rule_versions (rule_id, version_id, rule, comment)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (rule_id, version_id) DO NOTHING
        "#,
    )
    .bind(row.id)
    .bind(&version_id)
    .bind(&snapshot)
    .bind(comment)
    .execute(&mut *tx)
    .await?;

    sqlx::query(
        r#"
        DELETE FROM rule_versions
        WHERE rule_id = $1
          AND version_id NOT IN (
              SELECT version_id FROM rule_versions
              WHERE rule_id = $1
              ORDER BY saved_at DESC
              LIMIT $2
          )
        "#,
    )
    .bind(row.id)
    .bind(VERSIONS_PER_RULE)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;
    Ok(row)
}

pub async fn find(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<Option<Rule>, sqlx::Error> {
    sqlx::query_as::<_, Rule>("SELECT * FROM rules WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .fetch_optional(pool)
        .await
}

pub async fn list_for_user(pool: &PgPool, user_id: Uuid) -> Result<Vec<Rule>, sqlx::Error> {
    sqlx::query_as::<_, Rule>("SELECT * FROM rules WHERE user_id = $1 ORDER BY name")
        .bind(user_id)
        .fetch_all(pool)
        .await
}

/// The user's rules tagged for a given Clever Cloud org — backs the Workflows
/// manager (`GET /api/orgs/{cc_org_id}/rules`).
pub async fn list_for_user_org(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Vec<Rule>, sqlx::Error> {
    sqlx::query_as::<_, Rule>(
        "SELECT * FROM rules WHERE user_id = $1 AND cc_org_id = $2 ORDER BY name",
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_all(pool)
    .await
}

/// Flip a rule's enabled flag without going through the full `save` path —
/// avoids re-running cycle detection / dependency reindex / version churn for a
/// simple on/off toggle. Returns the number of rows affected (0 if not owned).
pub async fn set_enabled(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
    is_enabled: bool,
) -> Result<u64, sqlx::Error> {
    let res = sqlx::query(
        "UPDATE rules SET is_enabled = $3, last_modified_at = now() WHERE id = $1 AND user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .bind(is_enabled)
    .execute(pool)
    .await?;
    Ok(res.rows_affected())
}

pub async fn delete(pool: &PgPool, user_id: Uuid, id: Uuid) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM rules WHERE id = $1 AND user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}

pub async fn list_versions(
    pool: &PgPool,
    user_id: Uuid,
    rule_id: Uuid,
) -> Result<Vec<RuleVersion>, sqlx::Error> {
    sqlx::query_as::<_, RuleVersion>(
        r#"
        SELECT v.* FROM rule_versions v
        JOIN rules r ON r.id = v.rule_id
        WHERE v.rule_id = $1 AND r.user_id = $2
        ORDER BY v.saved_at DESC
        "#,
    )
    .bind(rule_id)
    .bind(user_id)
    .fetch_all(pool)
    .await
}

pub async fn find_version_payload(
    pool: &PgPool,
    user_id: Uuid,
    rule_id: Uuid,
    version_id: &str,
) -> Result<Option<serde_json::Value>, sqlx::Error> {
    sqlx::query_scalar::<_, serde_json::Value>(
        r#"
        SELECT v.rule FROM rule_versions v
        JOIN rules r ON r.id = v.rule_id
        WHERE v.rule_id = $1 AND v.version_id = $2 AND r.user_id = $3
        "#,
    )
    .bind(rule_id)
    .bind(version_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

pub async fn update_outcome(
    pool: &PgPool,
    rule_id: Uuid,
    outcome: &str,
    fired: bool,
) -> Result<(), sqlx::Error> {
    if fired {
        sqlx::query(
            "UPDATE rules SET last_fired_at = now(), last_outcome_state = $2 WHERE id = $1",
        )
        .bind(rule_id)
        .bind(outcome)
        .execute(pool)
        .await?;
    } else {
        sqlx::query("UPDATE rules SET last_outcome_state = $2 WHERE id = $1")
            .bind(rule_id)
            .bind(outcome)
            .execute(pool)
            .await?;
    }
    Ok(())
}
