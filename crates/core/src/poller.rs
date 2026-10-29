//! Phase 4: 60-second poller. On every backend instance: query monitors that
//! are due for a poll, group them by (user_id, cc_org_id), fetch CPU% + Mem%
//! from Warp10 in batches per kind, write `metric_samples`, broadcast a
//! `MetricsSnapshot` frame, update `last_poll_at`. Per-monitor advisory locks
//! make this multi-instance safe (a monitor is polled by exactly one
//! instance per tick). Phase 6 rules read `metric_samples` to evaluate
//! threshold conditions and drive state transitions.

use crate::cc::CcClient;
use crate::auth::decrypt_user_oauth;
use crate::db;
use crate::db::monitors::Monitor;
use crate::monitors::state_map;
use crate::rules::exec::{Trigger, trigger_for_monitor};
use crate::state::AppState;
use crate::realtime::{self, WsFrame};
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use std::collections::HashMap;
use std::time::Duration as StdDuration;
use tokio::time::{MissedTickBehavior, interval};
use uuid::Uuid;

const POLL_TICK: StdDuration = StdDuration::from_secs(60);
const POLL_BATCH_LIMIT: i64 = 200;
/// Max city-frame `pg_notify` round-trips in flight at once. Bounds the pool
/// connections the city pass borrows while still collapsing the previously
/// fully-serial per-building broadcast into a few concurrent batches.
const CITY_BROADCAST_CONCURRENCY: usize = 6;

pub async fn run(state: AppState) -> anyhow::Result<()> {
    let mut tick = interval(POLL_TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    tracing::info!(period_seconds = POLL_TICK.as_secs(), "poller started");

    loop {
        tick.tick().await;
        // No periodic purge: metric_readings retention is enforced per-row
        // at insert time (KEEP_N_PER_METRIC).
        if let Err(e) = poll_once(&state).await {
            tracing::error!(error = ?e, "poll cycle errored");
        }
        // Live-city pass: status + metrics for mapped resources of orgs that
        // currently have a WS subscriber. Independent of the monitor pass.
        if let Err(e) = city_pass(&state).await {
            tracing::warn!(error = ?e, "city pass errored");
        }
    }
}

/// For every org with a saved map AND a live WS subscriber on this instance,
/// broadcast the buildings' current status + metrics so the 3D city animates.
async fn city_pass(state: &AppState) -> anyhow::Result<()> {
    let orgs = crate::db::maps::all_mapped_orgs(&state.db).await?;
    for (user_id, cc_org_id) in orgs {
        if !state.ws_bus.has_subscribers(&cc_org_id) {
            continue;
        }
        if let Err(e) = poll_city_org(state, user_id, &cc_org_id).await {
            tracing::warn!(error = ?e, %user_id, %cc_org_id, "poll_city_org failed");
        }
    }
    Ok(())
}

pub(crate) async fn poll_city_org(
    state: &AppState,
    user_id: Uuid,
    cc_org_id: &str,
) -> anyhow::Result<()> {
    use crate::realtime::{broadcast_via_pg, WsFrame};

    let (apps_set, addons_set) =
        crate::db::maps::mapped_resource_ids(&state.db, user_id, cc_org_id).await?;
    if apps_set.is_empty() && addons_set.is_empty() {
        return Ok(());
    }

    let user = db::users::find_by_id(&state.db, user_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("user {user_id} not found"))?;
    let cc = crate::auth::authz::cc_client_for_user(state, &user)?;
    let now = Utc::now().timestamp();

    // The two CC list calls are independent, so fetch them concurrently — this
    // pass runs on the latency-sensitive scene-open path (the WS-connect kick),
    // and awaiting them serially added a whole CC round-trip to first paint.
    let want_apps = !apps_set.is_empty();
    let want_addons = !addons_set.is_empty();
    let (apps, cc_addons) = tokio::join!(
        async {
            if want_apps {
                cc.list_applications(cc_org_id).await.unwrap_or_default()
            } else {
                Vec::new()
            }
        },
        async {
            if want_addons {
                cc.list_addons(cc_org_id).await.unwrap_or_default()
            } else {
                Vec::new()
            }
        },
    );

    // Accumulate every frame, then emit them with bounded concurrency below.
    // Previously each frame was a separate awaited `pg_notify` round-trip, so a
    // city of K buildings cost ~2K serial DB round-trips per poll.
    let mut frames: Vec<WsFrame> = Vec::new();

    // App status (raw CC state; CREATED for never-deployed).
    for app in &apps {
        if !apps_set.contains(&app.id) {
            continue;
        }
        let raw = app.state.clone().unwrap_or_default();
        let state_str = if app.last_deploy.is_none()
            && (raw.is_empty()
                || raw.eq_ignore_ascii_case("SHOULD_BE_DOWN")
                || raw.eq_ignore_ascii_case("WANTS_TO_BE_DOWN"))
        {
            "CREATED".to_string()
        } else {
            raw
        };
        frames.push(WsFrame::AppStatus {
            app_id: app.id.clone(),
            state: state_str,
            last_deploy: app.last_deploy,
            ts: now,
        });
    }

    // App metrics (CC's Warp10 keys apps under the `app_id` label by id).
    let app_ids: Vec<String> = apps_set.iter().cloned().collect();
    if !app_ids.is_empty() {
        if let Ok(metrics) =
            crate::warp10::fetch_metrics(state, &cc, user_id, cc_org_id, "app_id", &app_ids).await
        {
            for (id, (cpu, mem, disk, net_in, net_out)) in metrics {
                frames.push(WsFrame::AppMetrics {
                    app_id: id,
                    cpu_pct: cpu.unwrap_or(0.0),
                    ram_pct: mem.unwrap_or(0.0),
                    disk_pct: disk,
                    net_in_bps: net_in,
                    net_out_bps: net_out,
                    ts: now,
                });
            }
        }
    }

    // Addon health (present in the org's addon list) + metrics by realId.
    if want_addons {
        let present: std::collections::HashSet<String> =
            cc_addons.iter().map(|a| a.id.clone()).collect();
        for addon_id in &addons_set {
            frames.push(WsFrame::AddonStatus {
                addon_id: addon_id.clone(),
                healthy: present.contains(addon_id),
                ts: now,
            });
        }
        // realId → addon_id, so metrics fetched under `app_id`=realId map back.
        let real_to_addon: HashMap<String, String> = cc_addons
            .into_iter()
            .filter(|a| addons_set.contains(&a.id))
            .filter_map(|a| a.real_id.map(|r| (r, a.id)))
            .collect();
        let real_ids: Vec<String> = real_to_addon.keys().cloned().collect();
        if !real_ids.is_empty() {
            if let Ok(metrics) =
                crate::warp10::fetch_metrics(state, &cc, user_id, cc_org_id, "app_id", &real_ids).await
            {
                for (real_id, (cpu, mem, disk, net_in, net_out)) in metrics {
                    if let Some(addon_id) = real_to_addon.get(&real_id) {
                        frames.push(WsFrame::AddonMetrics {
                            addon_id: addon_id.clone(),
                            cpu_pct: cpu.unwrap_or(0.0),
                            ram_pct: mem.unwrap_or(0.0),
                            disk_pct: disk,
                            net_in_bps: net_in,
                            net_out_bps: net_out,
                            ts: now,
                        });
                    }
                }
            }
        }
    }

    // Frames are independent (each keyed by its own resource id), so fan them
    // out with a bounded number of pg_notify round-trips in flight at once
    // (join_all per group) instead of awaiting each serially.
    let db = &state.db;
    for group in frames.chunks(CITY_BROADCAST_CONCURRENCY) {
        let sends = group
            .iter()
            .map(|frame| broadcast_via_pg(db, cc_org_id, frame.clone()));
        let _ = futures::future::join_all(sends).await;
    }

    Ok(())
}

async fn poll_once(state: &AppState) -> anyhow::Result<()> {
    let pool = &state.db;
    let due: Vec<Monitor> = sqlx::query_as::<_, Monitor>(
        r#"
        SELECT * FROM monitors
        WHERE enabled = TRUE
          AND kind <> 'synthetic'
          AND cc_org_id IS NOT NULL
          AND cc_resource_id IS NOT NULL
          AND cc_metrics_id IS NOT NULL
          AND (
              last_poll_at IS NULL
              OR last_poll_at < now() - (poll_interval_seconds * INTERVAL '1 second')
          )
        ORDER BY last_poll_at ASC NULLS FIRST
        LIMIT $1
        "#,
    )
    .bind(POLL_BATCH_LIMIT)
    .fetch_all(pool)
    .await?;

    if due.is_empty() {
        return Ok(());
    }
    tracing::debug!(count = due.len(), "poll cycle starting");

    let mut by_org: HashMap<(Uuid, String), Vec<Monitor>> = HashMap::new();
    for m in due {
        if let Some(ref org) = m.cc_org_id {
            by_org.entry((m.user_id, org.clone())).or_default().push(m);
        }
    }

    for ((user_id, cc_org_id), monitors) in by_org {
        if let Err(e) = poll_user_org(state, user_id, &cc_org_id, monitors).await {
            tracing::warn!(error = ?e, %user_id, cc_org_id = %cc_org_id, "poll_user_org failed");
        }
    }

    Ok(())
}

async fn poll_user_org(
    state: &AppState,
    user_id: Uuid,
    cc_org_id: &str,
    monitors: Vec<Monitor>,
) -> anyhow::Result<()> {
    let pool = &state.db;
    let cfg = state.config.as_ref();
    let http = &state.http_client;

    let user = db::users::find_by_id(pool, user_id)
        .await?
        .ok_or_else(|| anyhow::anyhow!("user {user_id} not found"))?;
    let (access_token, access_secret) = decrypt_user_oauth(&user, &cfg.encryption_key)?;
    let cc = CcClient::new(http, cfg, &access_token, &access_secret);

    let apps: Vec<&Monitor> = monitors
        .iter()
        .filter(|m| m.kind == "cc_application")
        .collect();

    // Refresh app state from CC's own view. Cheap (one list_applications call
    // per (user, org) per tick) and bulletproof against missed webhooks.
    if !apps.is_empty() {
        refresh_app_state(state, user_id, &cc, cc_org_id, &apps).await;
    }

    // Single Warp10 batch for apps + addons. CC's Warp10 indexes both kinds
    // under the `app_id` label; for addons the value is `cc_metrics_id`
    // (== addon's realId).
    if !monitors.is_empty() {
        run_metrics_batch(state, &cc, user_id, cc_org_id, &monitors).await;
    }
    Ok(())
}

/// One `list_applications` call per (user, org), then per-monitor advisory-
/// locked `set_state_if_changed` so two backends don't both write. Silent
/// no-op on stable fleets — only emits when CC's reported state actually
/// differs from what we hold.
async fn refresh_app_state(
    state: &AppState,
    user_id: Uuid,
    cc: &CcClient<'_>,
    cc_org_id: &str,
    apps: &[&Monitor],
) {
    let pool = &state.db;
    let cc_apps = match cc.list_applications(cc_org_id).await {
        Ok(v) => v,
        Err(e) => {
            tracing::warn!(error = ?e, %cc_org_id, "list_applications (poll refresh) failed");
            return;
        }
    };
    let by_id: HashMap<&str, Option<&str>> = cc_apps
        .iter()
        .map(|a| (a.id.as_str(), a.state.as_deref()))
        .collect();

    let now = Utc::now();
    for monitor in apps.iter().copied() {
        let Some(rid) = monitor.cc_resource_id.as_deref() else {
            continue;
        };
        let Some(&cc_state) = by_id.get(rid) else {
            continue;
        };
        let mapped = state_map::map_cc_app_state(cc_state);
        if monitor.current_state == mapped {
            continue;
        }

        let key = advisory_lock_key(monitor.id);
        // xact-scoped lock auto-released at commit/rollback. Holding the lock
        // on the same connection that started the transaction avoids the
        // cross-connection unlock that triggered Postgres NOTICEs.
        let mut tx = match pool.begin().await {
            Ok(tx) => tx,
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "begin tx (poll state) failed");
                continue;
            }
        };
        let acquired: bool = match sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
            .bind(key)
            .fetch_one(&mut *tx)
            .await
        {
            Ok(b) => b,
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "advisory_xact_lock (poll state) failed");
                let _ = tx.rollback().await;
                continue;
            }
        };
        if !acquired {
            let _ = tx.rollback().await;
            continue;
        }

        let mut transitioned = false;
        match db::monitors::set_state_if_changed(pool, monitor.id, mapped, None).await {
            Ok(Some((new_state, since))) => {
                transitioned = true;
                if let Err(e) = db::monitor_state_history::insert(
                    pool, monitor.id, &new_state, None, now, "poll",
                )
                .await
                {
                    tracing::warn!(error = ?e, monitor_id = %monitor.id, "history insert (poll) failed");
                }
                if let Err(e) = realtime::broadcast_via_pg(
                    pool,
                    cc_org_id,
                    WsFrame::MonitorState {
                        monitor_id: monitor.id,
                        state: new_state.clone(),
                        message: None,
                        since: Some(since),
                    },
                )
                .await
                {
                    tracing::warn!(error = ?e, monitor_id = %monitor.id, "ws broadcast (poll) failed");
                }
                tracing::info!(
                    monitor_id = %monitor.id,
                    %user_id,
                    new_state = %new_state,
                    "poll detected state transition; will trigger dependent rules"
                );
            }
            Ok(None) => {}
            Err(e) => {
                tracing::warn!(error = ?e, monitor_id = %monitor.id, "set_state_if_changed (poll) failed");
            }
        }

        if let Err(e) = tx.commit().await {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "commit (poll state lock release) failed");
        }

        // Fire dependent rules AFTER the lock is released, so rule actions that
        // re-enter set_state_if_changed don't deadlock on the same advisory key.
        if transitioned {
            match trigger_for_monitor(state, user_id, monitor.id, Trigger::Poll { monitor_id: monitor.id }).await {
                Ok(fired) => {
                    tracing::info!(monitor_id = %monitor.id, fired, "trigger_for_monitor done (poll state)");
                }
                Err(e) => {
                    tracing::error!(error = ?e, monitor_id = %monitor.id, "trigger_for_monitor failed (poll state)");
                }
            }
        }
    }
}

async fn run_metrics_batch(
    state: &AppState,
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
    monitors: &[Monitor],
) {
    let pool = &state.db;

    let ids: Vec<String> = monitors
        .iter()
        .filter_map(|m| m.cc_metrics_id.clone())
        .collect();
    // Hard-coded `app_id` label — CC's Warp10 keys both apps and addons under
    // it; addons just use their realId instead of their addon_id.
    let map = match crate::warp10::fetch_metrics(state, cc, user_id, cc_org_id, "app_id", &ids).await
    {
        Ok(m) => m,
        Err(e) => {
            tracing::warn!(error = ?e, %cc_org_id, "fetch_metrics failed");
            // Still bump last_poll_at so we don't hammer a broken upstream.
            for m in monitors {
                let _ = bump_last_poll(pool, m.id).await;
            }
            return;
        }
    };

    let now = Utc::now();
    for monitor in monitors {
        let Some(mid) = monitor.cc_metrics_id.as_deref() else {
            continue;
        };
        let (cpu, mem, disk, net_in, net_out) =
            map.get(mid).copied().unwrap_or((None, None, None, None, None));
        write_sample(
            state, user_id, monitor, cpu, mem, disk, net_in, net_out, cc_org_id, now,
        )
        .await;
    }
}

#[allow(clippy::too_many_arguments)]
async fn write_sample(
    state: &AppState,
    user_id: Uuid,
    monitor: &Monitor,
    cpu: Option<f32>,
    mem: Option<f32>,
    disk: Option<f32>,
    net_in: Option<f32>,
    net_out: Option<f32>,
    cc_org_id: &str,
    ts: DateTime<Utc>,
) {
    let pool = &state.db;
    let key = advisory_lock_key(monitor.id);
    // xact-scoped advisory lock — auto-released at commit/rollback. Avoids the
    // session-vs-pool-connection mismatch that caused "you don't own a lock"
    // NOTICEs from Postgres.
    let mut tx = match pool.begin().await {
        Ok(tx) => tx,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "begin tx (write_sample) failed");
            return;
        }
    };
    let acquired: bool = match sqlx::query_scalar("SELECT pg_try_advisory_xact_lock($1)")
        .bind(key)
        .fetch_one(&mut *tx)
        .await
    {
        Ok(b) => b,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "advisory_xact_lock (write_sample) failed");
            let _ = tx.rollback().await;
            return;
        }
    };
    if !acquired {
        // Another instance is on it; nothing to do.
        let _ = tx.rollback().await;
        return;
    }

    let cpu_d = cpu.map(|v| v as f64);
    let mem_d = mem.map(|v| v as f64);
    let disk_d = disk.map(|v| v as f64);
    let net_in_d = net_in.map(|v| v as f64);
    let net_out_d = net_out.map(|v| v as f64);
    let fresh_metric =
        cpu_d.is_some() || mem_d.is_some() || disk_d.is_some() || net_in_d.is_some() || net_out_d.is_some();

    // Write the non-null readings to metric_readings in one batched insert +
    // one prune (keeping the 10 most recent per (monitor, metric_name)) rather
    // than two statements per metric.
    let to_write: [(&str, Option<f64>); 5] = [
        ("cpu", cpu_d),
        ("mem", mem_d),
        ("disk", disk_d),
        ("net_in", net_in_d),
        ("net_out", net_out_d),
    ];
    let readings: Vec<(&str, f64)> = to_write
        .into_iter()
        .filter_map(|(name, opt)| opt.map(|v| (name, v)))
        .collect();
    if !readings.is_empty() {
        if let Err(e) =
            db::metric_readings::insert_batch_and_prune(pool, monitor.id, ts, &readings).await
        {
            tracing::warn!(
                error = ?e, monitor_id = %monitor.id,
                "insert metric_readings batch failed"
            );
        }
    }
    if let Err(e) = bump_last_poll(pool, monitor.id).await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "bump last_poll_at failed");
    }

    // For the WS frame, read back the latest per metric (= what we just wrote
    // for the fresh ones + the previous values for those CC didn't emit this
    // tick). The dashboard always shows the last known reading; disk stays
    // visible between its slow-cadence samples.
    let latest = match db::metric_readings::latest_per_metric(pool, monitor.id).await {
        Ok(map) => map,
        Err(e) => {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "latest_per_metric failed");
            std::collections::HashMap::new()
        }
    };
    let b_cpu = latest.get("cpu").map(|r| r.value);
    let b_mem = latest.get("mem").map(|r| r.value);
    let b_disk = latest.get("disk").map(|r| r.value);
    let b_net_in = latest.get("net_in").map(|r| r.value);
    let b_net_out = latest.get("net_out").map(|r| r.value);
    let any_to_broadcast = b_cpu.is_some()
        || b_mem.is_some()
        || b_disk.is_some()
        || b_net_in.is_some()
        || b_net_out.is_some();
    if any_to_broadcast {
        if let Err(e) = realtime::broadcast_via_pg(
            pool,
            cc_org_id,
            WsFrame::MetricsSnapshot {
                monitor_id: monitor.id,
                ts,
                cpu: b_cpu,
                mem: b_mem,
                disk: b_disk,
                net_in: b_net_in,
                net_out: b_net_out,
            },
        )
        .await
        {
            tracing::warn!(error = ?e, monitor_id = %monitor.id, "broadcast metrics frame failed");
        }
    }

    if let Err(e) = tx.commit().await {
        tracing::warn!(error = ?e, monitor_id = %monitor.id, "commit (write_sample lock release) failed");
    }

    // Fire dependent rules so threshold conditions on cpu/mem are evaluated
    // every poll cycle. Best-effort outside the lock. Trigger only when the
    // current poll actually produced new data (not on carry-forward only) —
    // rules read live monitor state, not historical values.
    if fresh_metric {
        if let Err(e) = trigger_for_monitor(
            state,
            user_id,
            monitor.id,
            Trigger::Poll { monitor_id: monitor.id },
        )
        .await
        {
            tracing::error!(error = ?e, monitor_id = %monitor.id, "trigger_for_monitor failed (write_sample)");
        }
    }
}

async fn bump_last_poll(pool: &PgPool, monitor_id: Uuid) -> Result<(), sqlx::Error> {
    sqlx::query("UPDATE monitors SET last_poll_at = now() WHERE id = $1")
        .bind(monitor_id)
        .execute(pool)
        .await?;
    Ok(())
}

/// Hash a UUID v4 to an i64 advisory-lock key. We XOR the two 64-bit halves
/// of the UUID, which preserves enough entropy to make collisions astronomically
/// unlikely at our scale.
fn advisory_lock_key(id: Uuid) -> i64 {
    let (hi, lo) = id.as_u64_pair();
    (hi ^ lo) as i64
}
