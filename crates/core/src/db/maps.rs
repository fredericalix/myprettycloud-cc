//! City maps: one per (user, org). `cells_json` is the frontend-authored array
//! of hex cells (coord, tile, building, app/addon binding, elevation, rotation).

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MapRow {
    pub id: Uuid,
    pub user_id: Uuid,
    pub cc_org_id: String,
    pub name: String,
    pub cells_json: serde_json::Value,
    /// Per-scene ambiance toggles (wind/water/day-night/particles/clouds),
    /// authored by the frontend. Opaque JSON object.
    pub settings: serde_json::Value,
    pub version: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

pub async fn get_or_create(pool: &PgPool, user_id: Uuid, cc_org_id: &str) -> Result<MapRow, sqlx::Error> {
    if let Some(row) =
        sqlx::query_as::<_, MapRow>("SELECT * FROM maps WHERE user_id = $1 AND cc_org_id = $2")
            .bind(user_id)
            .bind(cc_org_id)
            .fetch_optional(pool)
            .await?
    {
        return Ok(row);
    }

    sqlx::query_as::<_, MapRow>(
        r#"
        INSERT INTO maps (user_id, cc_org_id, name, cells_json)
        VALUES ($1, $2, 'My City', '[]'::jsonb)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET updated_at = maps.updated_at
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_one(pool)
    .await
}

/// Upsert a map's cells; increments `version` on update.
pub async fn upsert_cells(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
    name: &str,
    cells_json: &serde_json::Value,
    settings: &serde_json::Value,
) -> Result<MapRow, sqlx::Error> {
    sqlx::query_as::<_, MapRow>(
        r#"
        INSERT INTO maps (user_id, cc_org_id, name, cells_json, settings)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (user_id, cc_org_id) DO UPDATE SET
            name       = EXCLUDED.name,
            cells_json = EXCLUDED.cells_json,
            settings   = EXCLUDED.settings,
            version    = maps.version + 1,
            updated_at = NOW()
        RETURNING *
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .bind(name)
    .bind(cells_json)
    .bind(settings)
    .fetch_one(pool)
    .await
}

/// The `(appId, addonId)` sets bound to a building in this map. The unified
/// poller unions this with the user's monitored resources to know what to
/// fetch for the live city.
pub async fn mapped_resource_ids(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<(HashSet<String>, HashSet<String>), sqlx::Error> {
    let cells_json: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT cells_json FROM maps WHERE user_id = $1 AND cc_org_id = $2")
            .bind(user_id)
            .bind(cc_org_id)
            .fetch_optional(pool)
            .await?;

    let mut apps = HashSet::new();
    let mut addons = HashSet::new();
    let Some(serde_json::Value::Array(cells)) = cells_json else {
        return Ok((apps, addons));
    };
    for cell in cells {
        let has_building = cell.get("building").map(|v| !v.is_null()).unwrap_or(false);
        if !has_building {
            continue;
        }
        if let Some(app_id) = cell.get("appId").and_then(|v| v.as_str()) {
            apps.insert(app_id.to_string());
            continue;
        }
        if let Some(addon_id) = cell.get("addonId").and_then(|v| v.as_str()) {
            addons.insert(addon_id.to_string());
        }
    }
    Ok((apps, addons))
}

/// Distinct orgs that currently have a saved map, across all users. Used by the
/// poller to enumerate cities to keep live. Returns `(user_id, cc_org_id)`.
pub async fn all_mapped_orgs(pool: &PgPool) -> Result<Vec<(Uuid, String)>, sqlx::Error> {
    let rows: Vec<(Uuid, String)> =
        sqlx::query_as("SELECT DISTINCT user_id, cc_org_id FROM maps")
            .fetch_all(pool)
            .await?;
    Ok(rows)
}

/// Map owners (user ids) that have a saved map for one org. The on-connect city
/// poll runs `poll_city_org` for each, mirroring `city_pass`, because the CC
/// client and mapped resources are keyed on the map OWNER — never the connecting
/// WS member (who may not be the author).
pub async fn map_owners_for_org(pool: &PgPool, cc_org_id: &str) -> Result<Vec<Uuid>, sqlx::Error> {
    let rows: Vec<(Uuid,)> =
        sqlx::query_as("SELECT DISTINCT user_id FROM maps WHERE cc_org_id = $1")
            .bind(cc_org_id)
            .fetch_all(pool)
            .await?;
    Ok(rows.into_iter().map(|(u,)| u).collect())
}
