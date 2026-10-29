//! Phase 11f: per-metric storage. Replaces the wide-row metric_samples write
//! path. Each Warp10 reading is a single row `(monitor_id, metric_name, ts,
//! value)`. Pruning keeps only the last `KEEP_N_PER_METRIC` rows per
//! (monitor, metric) — bounded DB growth, no NULLs, cleanly handles per-metric
//! cadence differences.

use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Maximum rows we keep per (monitor, metric_name). Sized so a 60s poller
/// covers 10 minutes of recent history per metric — enough for rule
/// evaluation, debug, and `for X minutes` style conditions on the metric
/// (currently rules use the latest only).
pub const KEEP_N_PER_METRIC: i64 = 10;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct MetricReading {
    pub monitor_id: Uuid,
    pub metric_name: String,
    pub ts: DateTime<Utc>,
    pub value: f64,
}

/// Per-metric "did we receive at least one value in the window?". Same shape
/// as the previous `metric_samples::MetricAvailability`, kept for debug
/// endpoint backwards-compatibility.
#[derive(Debug, Clone, Serialize)]
pub struct MetricAvailability {
    pub samples_count: i64,
    pub cpu: bool,
    pub mem: bool,
    pub disk: bool,
    pub net_in: bool,
    pub net_out: bool,
}

/// Insert a tick's batch of readings (one per non-null metric for a single
/// monitor) and prune each affected (monitor, metric_name) back to the last
/// `KEEP_N_PER_METRIC` rows — in two statements total instead of two per
/// metric. Idempotent on the primary key: re-inserting at the same ts
/// overwrites the value. The prune is a separate statement (not a CTE) so the
/// just-inserted rows are visible to its windowed rank.
pub async fn insert_batch_and_prune(
    pool: &PgPool,
    monitor_id: Uuid,
    ts: DateTime<Utc>,
    readings: &[(&str, f64)],
) -> Result<(), sqlx::Error> {
    if readings.is_empty() {
        return Ok(());
    }
    let names: Vec<String> = readings.iter().map(|(n, _)| (*n).to_string()).collect();
    let values: Vec<f64> = readings.iter().map(|(_, v)| *v).collect();

    // Multi-row insert from parallel arrays.
    sqlx::query(
        r#"
        INSERT INTO metric_readings (monitor_id, metric_name, ts, value)
        SELECT $1, n, $3, v
        FROM UNNEST($2::text[], $4::double precision[]) AS t(n, v)
        ON CONFLICT (monitor_id, metric_name, ts) DO UPDATE
        SET value = EXCLUDED.value
        "#,
    )
    .bind(monitor_id)
    .bind(&names)
    .bind(ts)
    .bind(&values)
    .execute(pool)
    .await?;

    // Prune all affected metrics at once: rank each metric's rows newest-first
    // and delete those beyond KEEP_N_PER_METRIC. Bounded N, so a small scan.
    sqlx::query(
        r#"
        DELETE FROM metric_readings mr
        USING (
            SELECT metric_name, ts,
                   ROW_NUMBER() OVER (PARTITION BY metric_name ORDER BY ts DESC) AS rn
            FROM metric_readings
            WHERE monitor_id = $1 AND metric_name = ANY($2)
        ) ranked
        WHERE mr.monitor_id = $1
          AND mr.metric_name = ranked.metric_name
          AND mr.ts = ranked.ts
          AND ranked.rn > $3
        "#,
    )
    .bind(monitor_id)
    .bind(&names)
    .bind(KEEP_N_PER_METRIC)
    .execute(pool)
    .await?;

    Ok(())
}

/// Latest reading per metric for a single monitor. Returns a map keyed by
/// metric_name. Powers WS broadcasts and the snapshots endpoint.
pub async fn latest_per_metric(
    pool: &PgPool,
    monitor_id: Uuid,
) -> Result<HashMap<String, MetricReading>, sqlx::Error> {
    let rows: Vec<MetricReading> = sqlx::query_as::<_, MetricReading>(
        r#"
        SELECT DISTINCT ON (metric_name) monitor_id, metric_name, ts, value
        FROM metric_readings
        WHERE monitor_id = $1
        ORDER BY metric_name, ts DESC
        "#,
    )
    .bind(monitor_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|r| (r.metric_name.clone(), r)).collect())
}

/// The most recent `limit` readings for one (monitor, metric), returned
/// oldest-first. Powers metric `for X minutes` conditions in the evaluator:
/// it needs samples from *before* the window start to anchor continuity, so a
/// bounded recent-N fetch is used rather than a time-floored one. Bounded by
/// `KEEP_N_PER_METRIC` in practice, so this is a small scan.
pub async fn recent_readings(
    pool: &PgPool,
    monitor_id: Uuid,
    metric_name: &str,
    limit: i64,
) -> Result<Vec<MetricReading>, sqlx::Error> {
    let mut rows: Vec<MetricReading> = sqlx::query_as::<_, MetricReading>(
        r#"
        SELECT monitor_id, metric_name, ts, value
        FROM metric_readings
        WHERE monitor_id = $1 AND metric_name = $2
        ORDER BY ts DESC
        LIMIT $3
        "#,
    )
    .bind(monitor_id)
    .bind(metric_name)
    .bind(limit)
    .fetch_all(pool)
    .await?;
    rows.reverse(); // oldest-first
    Ok(rows)
}

/// Latest reading per (monitor, metric) across an entire org. Multi-tenant
/// guarded by joining on monitors and filtering on user_id + cc_org_id.
pub async fn latest_per_metric_for_org(
    pool: &PgPool,
    user_id: Uuid,
    cc_org_id: &str,
) -> Result<Vec<MetricReading>, sqlx::Error> {
    sqlx::query_as::<_, MetricReading>(
        r#"
        SELECT DISTINCT ON (mr.monitor_id, mr.metric_name)
            mr.monitor_id, mr.metric_name, mr.ts, mr.value
        FROM metric_readings mr
        JOIN monitors m ON m.id = mr.monitor_id
        WHERE m.user_id = $1 AND m.cc_org_id = $2
        ORDER BY mr.monitor_id, mr.metric_name, mr.ts DESC
        "#,
    )
    .bind(user_id)
    .bind(cc_org_id)
    .fetch_all(pool)
    .await
}

/// Per-metric availability over a window. A metric is "available" if at
/// least one reading exists in `[since, now]`. Powers the debug endpoint.
pub async fn availability(
    pool: &PgPool,
    monitor_id: Uuid,
    since: DateTime<Utc>,
) -> Result<MetricAvailability, sqlx::Error> {
    let rows: Vec<(String, i64)> = sqlx::query_as(
        r#"
        SELECT metric_name, COUNT(*)::BIGINT
        FROM metric_readings
        WHERE monitor_id = $1 AND ts >= $2
        GROUP BY metric_name
        "#,
    )
    .bind(monitor_id)
    .bind(since)
    .fetch_all(pool)
    .await?;

    let mut total: i64 = 0;
    let mut counts: HashMap<&str, i64> = HashMap::new();
    for (name, count) in rows {
        total += count;
        // Keys are checked against the schema CHECK constraint so we can
        // safely use them as &str via match.
        if let Some(k) = match name.as_str() {
            "cpu" => Some("cpu"),
            "mem" => Some("mem"),
            "disk" => Some("disk"),
            "net_in" => Some("net_in"),
            "net_out" => Some("net_out"),
            _ => None,
        } {
            counts.insert(k, count);
        }
    }
    Ok(MetricAvailability {
        samples_count: total,
        cpu: counts.get("cpu").copied().unwrap_or(0) > 0,
        mem: counts.get("mem").copied().unwrap_or(0) > 0,
        disk: counts.get("disk").copied().unwrap_or(0) > 0,
        net_in: counts.get("net_in").copied().unwrap_or(0) > 0,
        net_out: counts.get("net_out").copied().unwrap_or(0) > 0,
    })
}
