use serde::Serialize;
use std::time::{SystemTime, UNIX_EPOCH};

/// A single data point: [timestamp_ms, value]
#[derive(Debug, Serialize)]
pub struct DataPoint {
    pub timestamp: i64,
    pub value: f64,
}

/// A normalized metric series for the frontend
#[derive(Debug, Clone, Serialize)]
pub struct MetricSeries {
    pub name: String,
    pub data: Vec<Vec<serde_json::Value>>,
}

/// The response returned to the frontend
#[derive(Debug, Clone, Serialize)]
pub struct MetricsResponse {
    pub panel: String,
    pub series: Vec<MetricSeries>,
}

/// Execute a WarpScript against the Warp10 endpoint
pub async fn execute_warpscript(
    http_client: &reqwest::Client,
    warp10_url: &str,
    script: &str,
) -> anyhow::Result<serde_json::Value> {
    let resp = http_client
        .post(warp10_url)
        .header("Content-Type", "application/x-warp10-warpscript")
        .body(script.to_string())
        .send()
        .await?;

    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        // The error body can echo the submitted WarpScript, which embeds the
        // Warp10 token — never log or propagate it.
        tracing::error!("Warp10 exec failed (status {status})");
        anyhow::bail!("Warp10 exec failed (status {status})");
    }

    let parsed: serde_json::Value = serde_json::from_str(&body)?;
    Ok(parsed)
}

/// Parse Warp10 GTS JSON response into normalized MetricSeries.
/// GTS format: [[{"c":"class","l":{...},"a":{},"v":[[ts_us, val], ...]}]]
/// or for multiple results: [gts_list1, gts_list2, ...]
///
/// `bucket_span_us` is the WarpScript BUCKETIZE span in microseconds. It is used
/// to detect gaps (buckets with no data) and insert explicit null points so the
/// chart draws a break instead of a straight line across the missing range.
pub fn parse_gts_response(
    raw: &serde_json::Value,
    panel: &str,
    bucket_span_us: i64,
) -> MetricsResponse {
    let mut series = Vec::new();

    // The response is an array of GTS lists
    if let Some(outer) = raw.as_array() {
        for gts_list in outer {
            if let Some(gts_array) = gts_list.as_array() {
                for gts in gts_array {
                    let name = gts["c"].as_str().unwrap_or("unknown").to_string();
                    let values = parse_gts_values(gts);
                    series.push(MetricSeries { name, data: values });
                }
            } else if gts_list.is_object() {
                // Single GTS (not wrapped in array)
                let name = gts_list["c"].as_str().unwrap_or("unknown").to_string();
                let values = parse_gts_values(gts_list);
                series.push(MetricSeries { name, data: values });
            }
        }
    }

    // For network panel, filter out negative values (counter resets)
    if panel == "network" {
        for s in &mut series {
            s.data.retain(|point| {
                point.get(1)
                    .and_then(|v| v.as_f64())
                    .map(|v| v >= 0.0)
                    .unwrap_or(true)
            });
        }
    }

    // Disk usage is a slowly-varying gauge (% used): datapoints are sparse and
    // irregular even on a live app, so gap insertion would shred the series.
    // Activity metrics (cpu/memory/network) only produce data while the app is
    // up, so they benefit from explicit null gaps.
    if panel != "disk" {
        let bucket_span_ms = bucket_span_us / 1000;
        let now_ms = current_time_ms();
        for s in &mut series {
            s.data = insert_gap_nulls(&s.data, bucket_span_ms, now_ms);
        }
    }

    MetricsResponse {
        panel: panel.to_string(),
        series,
    }
}

fn current_time_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Insert `[ts, null]` between consecutive points more than 1.5 × bucket_span
/// apart, and append `[now, null]` if the last point is older than that same
/// threshold. The 1.5× slack absorbs BUCKETIZE jitter without false gaps.
fn insert_gap_nulls(
    data: &[Vec<serde_json::Value>],
    bucket_span_ms: i64,
    now_ms: i64,
) -> Vec<Vec<serde_json::Value>> {
    if data.is_empty() || bucket_span_ms <= 0 {
        return data.to_vec();
    }

    let mut sorted: Vec<Vec<serde_json::Value>> = data.to_vec();
    sorted.sort_by_key(|p| p.first().and_then(|v| v.as_i64()).unwrap_or(0));

    let threshold_ms = bucket_span_ms * 3 / 2;
    let mut out: Vec<Vec<serde_json::Value>> = Vec::with_capacity(sorted.len() + 4);

    for point in sorted.into_iter() {
        if let Some(prev) = out.last() {
            let prev_ts = prev.first().and_then(|v| v.as_i64()).unwrap_or(0);
            let cur_ts = point.first().and_then(|v| v.as_i64()).unwrap_or(0);
            if cur_ts - prev_ts > threshold_ms {
                let gap_ts = prev_ts + (cur_ts - prev_ts) / 2;
                out.push(vec![
                    serde_json::Value::Number(serde_json::Number::from(gap_ts)),
                    serde_json::Value::Null,
                ]);
            }
        }
        out.push(point);
    }

    if let Some(last) = out.last() {
        let last_ts = last.first().and_then(|v| v.as_i64()).unwrap_or(0);
        if now_ms - last_ts > threshold_ms {
            out.push(vec![
                serde_json::Value::Number(serde_json::Number::from(now_ms)),
                serde_json::Value::Null,
            ]);
        }
    }

    out
}

fn parse_gts_values(gts: &serde_json::Value) -> Vec<Vec<serde_json::Value>> {
    let mut data = Vec::new();

    if let Some(values) = gts["v"].as_array() {
        for point in values {
            if let Some(arr) = point.as_array() {
                // Format: [timestamp_us, value] or [timestamp_us, lat, lon, alt, value]
                if arr.is_empty() {
                    continue;
                }

                let timestamp_us = arr[0].as_i64().unwrap_or(0);
                // Convert microseconds to milliseconds for JavaScript
                let timestamp_ms = timestamp_us / 1000;

                // Value is the last element (handles both [ts, val] and [ts, lat, lon, alt, val])
                let raw_value = &arr[arr.len() - 1];
                let Some(value) = parse_mixed_value(raw_value) else {
                    // Drop non-numeric points instead of coercing them to 0.0,
                    // which would be indistinguishable from a real zero.
                    tracing::warn!("skipping non-numeric Warp10 value");
                    continue;
                };

                data.push(vec![
                    serde_json::Value::Number(serde_json::Number::from(timestamp_ms)),
                    serde_json::json!(value),
                ]);
            }
        }
    }

    data
}

/// Handle mixed value types from Warp10: String, Double, Int.
/// Returns `None` for values that are not numeric so callers can drop them
/// rather than silently treating a parse failure as a real `0.0`.
fn parse_mixed_value(v: &serde_json::Value) -> Option<f64> {
    match v {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => s.parse::<f64>().ok(),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn pt(ts_ms: i64, v: f64) -> Vec<serde_json::Value> {
        vec![json!(ts_ms), json!(v)]
    }

    fn ts_of(p: &[serde_json::Value]) -> i64 {
        p.first().and_then(|v| v.as_i64()).unwrap_or(0)
    }

    fn is_null(p: &[serde_json::Value]) -> bool {
        p.get(1).map(|v| v.is_null()).unwrap_or(false)
    }

    #[test]
    fn no_gaps_dense_series() {
        let bucket_ms = 60_000;
        let now_ms = 600_000;
        let data = vec![
            pt(300_000, 1.0),
            pt(360_000, 2.0),
            pt(420_000, 3.0),
            pt(480_000, 4.0),
            pt(540_000, 5.0),
            pt(600_000, 6.0),
        ];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        assert_eq!(out.len(), 6, "no gaps should be inserted in a dense series");
        assert!(out.iter().all(|p| !is_null(p)));
    }

    #[test]
    fn inserts_midpoint_null_on_interior_gap() {
        let bucket_ms = 60_000;
        let now_ms = 600_000;
        let data = vec![
            pt(120_000, 1.0),
            pt(180_000, 2.0),
            // 5-minute gap here (5 × bucket_span)
            pt(480_000, 3.0),
            pt(540_000, 4.0),
        ];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        assert_eq!(out.len(), 5, "exactly one null should be inserted");
        assert!(is_null(&out[2]), "null should be at index 2, between the two clusters");
        let gap_ts = ts_of(&out[2]);
        assert_eq!(gap_ts, (180_000 + 480_000) / 2, "null ts is midpoint of the gap");
    }

    #[test]
    fn appends_tail_null_when_last_point_is_stale() {
        let bucket_ms = 60_000;
        // Last point at 100s, now at 700s → 10-min stale tail
        let now_ms = 700_000;
        let data = vec![pt(40_000, 1.0), pt(100_000, 2.0)];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        assert_eq!(out.len(), 3, "tail null should be appended");
        assert!(is_null(out.last().unwrap()));
        assert_eq!(ts_of(out.last().unwrap()), now_ms);
    }

    #[test]
    fn no_tail_null_when_last_point_is_fresh() {
        let bucket_ms = 60_000;
        let now_ms = 600_000;
        // Last point only one bucket behind now → not a gap
        let data = vec![pt(540_000, 1.0), pt(600_000, 2.0)];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        assert_eq!(out.len(), 2);
        assert!(out.iter().all(|p| !is_null(p)));
    }

    #[test]
    fn empty_input_stays_empty() {
        let out = insert_gap_nulls(&[], 60_000, 600_000);
        assert!(out.is_empty());
    }

    #[test]
    fn unsorted_input_is_sorted_before_gap_detection() {
        let bucket_ms = 60_000;
        let now_ms = 600_000;
        let data = vec![pt(540_000, 3.0), pt(120_000, 1.0), pt(180_000, 2.0)];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        // After sort: 120, 180, 540 → gap between 180 and 540
        assert_eq!(out.len(), 4);
        assert!(!is_null(&out[0]));
        assert!(!is_null(&out[1]));
        assert!(is_null(&out[2]));
        assert!(!is_null(&out[3]));
    }

    #[test]
    fn small_jitter_does_not_trigger_gap() {
        let bucket_ms = 60_000;
        // Keep `now` close to the last point so only the interior jitter is tested.
        let now_ms = 420_000;
        // Gap of 80s between points — under the 90s (1.5×) threshold
        let data = vec![pt(300_000, 1.0), pt(380_000, 2.0)];
        let out = insert_gap_nulls(&data, bucket_ms, now_ms);
        assert_eq!(out.len(), 2, "sub-threshold gap stays a straight line");
    }

    #[test]
    fn network_panel_filter_and_gaps_coexist() {
        // Simulate a GTS with a big gap and a negative spike (counter reset).
        // After negative filter, the gap widens; we should still get a null in the middle.
        let raw = json!([
            [{
                "c": "net.bytes_recv",
                "v": [
                    [120_000_000i64, 100.0],
                    [180_000_000i64, 200.0],
                    [240_000_000i64, -5.0],  // will be filtered
                    [540_000_000i64, 300.0],
                ]
            }]
        ]);
        let resp = parse_gts_response(&raw, "network", 60_000_000);
        assert_eq!(resp.series.len(), 1);
        let s = &resp.series[0];
        // Points remaining after negative filter: ts 120, 180, 540 → gap between 180 and 540
        let non_null_points: Vec<_> = s.data.iter().filter(|p| !is_null(p)).collect();
        assert_eq!(non_null_points.len(), 3, "the -5 point must be filtered out");
        let nulls: Vec<_> = s.data.iter().filter(|p| is_null(p)).collect();
        assert!(!nulls.is_empty(), "at least one null should mark the gap");
    }
}
