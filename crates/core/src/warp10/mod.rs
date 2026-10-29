//! Warp10 metrics fetcher. Fetches cpu / mem / disk / net_in / net_out for a
//! batch of CC resources (apps + addons) in one org, parallelizing in small
//! chunks to stay under the Warp10 HTTP timeout. (myccmonitor base.)

pub mod client;
pub mod templates;
pub mod tokens;

pub use templates::MetricsTuple;
pub use tokens::TokenCache;

use crate::cc::CcClient;
use crate::state::AppState;
use std::collections::HashMap;
use uuid::Uuid;

/// Max ids per Warp10 request. Verified in prod: even 12-id chunks can time out
/// at 60 s (Warp10 is slow on mapper.rate over 5 m of counter data). 3 keeps
/// each script under ~10 KB; reqwest pools sockets so extra requests are cheap.
const WARP10_BATCH_SIZE: usize = 3;

/// Max chunks in flight at once. Each WarpScript is intentionally heavy, so
/// firing every chunk concurrently (unbounded) could stampede the shared CC
/// Warp10 endpoint for an org with many resources and push requests toward the
/// 60 s timeout. Bound the concurrency so chunks pipeline instead.
const WARP10_MAX_CONCURRENCY: usize = 5;

/// Fetch the latest cpu/mem/disk/net_in/net_out for a batch of CC resource
/// metrics-ids in one org. Returns `{ metrics_id -> MetricsTuple }`; resources
/// with no recent samples are absent. Chunks run in parallel; a partial result
/// is returned if some chunks succeed.
pub async fn fetch_metrics(
    state: &AppState,
    cc: &CcClient<'_>,
    user_id: Uuid,
    cc_org_id: &str,
    label_name: &str,
    metrics_ids: &[String],
) -> anyhow::Result<HashMap<String, MetricsTuple>> {
    if metrics_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let token = tokens::ensure_token(
        &state.warp10_cache,
        &state.db,
        &state.config.encryption_key,
        cc,
        user_id,
        cc_org_id,
    )
    .await?;

    let endpoint = &state.config.warp10_endpoint;
    let http = &state.http_client;

    let chunks: Vec<&[String]> = metrics_ids.chunks(WARP10_BATCH_SIZE).collect();

    let mut out: HashMap<String, MetricsTuple> = HashMap::new();
    let mut had_success = false;
    let mut last_err: Option<anyhow::Error> = None;

    // Run at most WARP10_MAX_CONCURRENCY chunks at a time (join_all per group)
    // so chunks pipeline without all firing at once — avoids stampeding the
    // shared Warp10 endpoint when an org has many resources.
    for group in chunks.chunks(WARP10_MAX_CONCURRENCY) {
        let group_futures = group.iter().map(|chunk| {
            let script = templates::metrics_last_script(&token, label_name, chunk);
            async move {
                let value = client::execute_warpscript(http, endpoint, &script).await?;
                Ok::<HashMap<String, MetricsTuple>, anyhow::Error>(templates::split_metrics(
                    &value, label_name,
                ))
            }
        });
        for r in futures::future::join_all(group_futures).await {
            match r {
                Ok(map) => {
                    had_success = true;
                    out.extend(map);
                }
                Err(e) => {
                    tracing::warn!(error = ?e, "fetch_metrics chunk failed");
                    last_err = Some(e);
                }
            }
        }
    }
    if !had_success {
        if let Some(e) = last_err {
            return Err(e);
        }
    }
    Ok(out)
}
