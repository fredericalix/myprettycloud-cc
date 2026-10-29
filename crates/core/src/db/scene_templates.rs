//! Scene templates — user-owned, reusable map layouts (tiles + decorations +
//! decorative buildings, no CC resource bindings). Private by default; can be
//! made public for any user to browse and apply. `cells_json` is opaque, like
//! `maps.cells_json`.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Template {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub visibility: String,
    pub cells_json: serde_json::Value,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// List-row for public templates: the template plus the owner's display name.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct TemplateListItem {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub name: String,
    pub visibility: String,
    pub owner_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

pub async fn create(
    pool: &PgPool,
    owner_id: Uuid,
    name: &str,
    visibility: &str,
    cells_json: &serde_json::Value,
) -> Result<Template, sqlx::Error> {
    sqlx::query_as::<_, Template>(
        r#"
        INSERT INTO scene_templates (owner_id, name, visibility, cells_json)
        VALUES ($1, $2, $3, $4)
        RETURNING *
        "#,
    )
    .bind(owner_id)
    .bind(name)
    .bind(visibility)
    .bind(cells_json)
    .fetch_one(pool)
    .await
}

/// Templates owned by this user (metadata only — no cells, for the list view).
pub async fn list_for_owner(
    pool: &PgPool,
    owner_id: Uuid,
) -> Result<Vec<TemplateListItem>, sqlx::Error> {
    sqlx::query_as::<_, TemplateListItem>(
        r#"
        SELECT t.id, t.owner_id, t.name, t.visibility, u.display_name AS owner_name, t.created_at
        FROM scene_templates t
        JOIN users u ON u.id = t.owner_id
        WHERE t.owner_id = $1
        ORDER BY t.created_at DESC
        "#,
    )
    .bind(owner_id)
    .fetch_all(pool)
    .await
}

/// All public templates (any owner), with the owner's display name.
pub async fn list_public(pool: &PgPool) -> Result<Vec<TemplateListItem>, sqlx::Error> {
    sqlx::query_as::<_, TemplateListItem>(
        r#"
        SELECT t.id, t.owner_id, t.name, t.visibility, u.display_name AS owner_name, t.created_at
        FROM scene_templates t
        JOIN users u ON u.id = t.owner_id
        WHERE t.visibility = 'public'
        ORDER BY t.created_at DESC
        "#,
    )
    .fetch_all(pool)
    .await
}

/// Fetch a template (with cells) if the user may use it: they own it OR it's public.
pub async fn get_accessible(
    pool: &PgPool,
    user_id: Uuid,
    id: Uuid,
) -> Result<Option<Template>, sqlx::Error> {
    sqlx::query_as::<_, Template>(
        r#"
        SELECT * FROM scene_templates
        WHERE id = $1 AND (owner_id = $2 OR visibility = 'public')
        "#,
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await
}

/// Update name and/or visibility, owner-only. Returns the row, or None if the
/// template doesn't exist or isn't owned by this user.
pub async fn update(
    pool: &PgPool,
    owner_id: Uuid,
    id: Uuid,
    name: Option<&str>,
    visibility: Option<&str>,
) -> Result<Option<Template>, sqlx::Error> {
    sqlx::query_as::<_, Template>(
        r#"
        UPDATE scene_templates
        SET name = COALESCE($3, name),
            visibility = COALESCE($4, visibility),
            updated_at = now()
        WHERE id = $1 AND owner_id = $2
        RETURNING *
        "#,
    )
    .bind(id)
    .bind(owner_id)
    .bind(name)
    .bind(visibility)
    .fetch_optional(pool)
    .await
}

/// Delete a template, owner-only. Returns the number of rows removed.
pub async fn delete(pool: &PgPool, owner_id: Uuid, id: Uuid) -> Result<u64, sqlx::Error> {
    let res = sqlx::query("DELETE FROM scene_templates WHERE id = $1 AND owner_id = $2")
        .bind(id)
        .bind(owner_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected())
}
