//! WarpScript templates + GTS response parsing. (myccmonitor base.)
//!
//! Network metrics (net.bytes_recv / net.bytes_sent) are cumulative counters.
//! The order FETCH → mapper.rate → MERGE is non-negotiable: computing the rate
//! per-instance BEFORE merging avoids the 100+ GB/s spikes produced when an
//! instance is replaced (counter reset). Negative post-rate values are dropped.

/// One sample per (id, metric class). Field order: cpu, mem, disk, net_in, net_out.
pub type MetricsTuple = (Option<f32>, Option<f32>, Option<f32>, Option<f32>, Option<f32>);

/// Build a WarpScript fetching the most recent cpu/mem/disk/net_in/net_out for
/// each id, tagged by `label_name`. CC's Warp10 stores both apps and addons
/// under the `app_id` label (addons keyed by their `realId`), so pass
/// `"app_id"` regardless of kind.
pub fn metrics_last_script(token: &str, label_name: &str, ids: &[String]) -> String {
    let mut script = String::new();
    for id in ids {
        script.push_str(&format!(
            "[ '{token}' 'cpu.usage_user' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'cpu.usage_user' RENAME\n\
             [ '{token}' 'mem.used_percent' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'mem.used_percent' RENAME\n\
             [ '{token}' 'disk.used_percent' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             MERGE 'disk.used_percent' RENAME\n\
             [ '{token}' 'net.bytes_recv' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             [ SWAP mapper.rate 1 0 0 ] MAP\n\
             MERGE 'net.bytes_recv' RENAME\n\
             [ '{token}' 'net.bytes_sent' {{ '{label}' '{id}' }} NOW 5 m ] FETCH\n\
             [ SWAP mapper.rate 1 0 0 ] MAP\n\
             MERGE 'net.bytes_sent' RENAME\n",
            token = token,
            label = label_name,
            id = id
        ));
    }
    script
}

/// Walk the GTS response tree, picking the last numeric point per (id, metric
/// class). Negative net.* values (counter-reset artefacts) are dropped.
pub fn split_metrics(
    value: &serde_json::Value,
    label_name: &str,
) -> std::collections::HashMap<String, MetricsTuple> {
    use std::collections::HashMap;
    let mut out: HashMap<String, MetricsTuple> = HashMap::new();

    fn visit_gts(gts: &serde_json::Value, label_name: &str, out: &mut HashMap<String, MetricsTuple>) {
        let class = gts.get("c").and_then(|v| v.as_str()).unwrap_or("");
        let id = match gts.get("l").and_then(|l| l.get(label_name)).and_then(|v| v.as_str()) {
            Some(id) => id.to_string(),
            None => return,
        };
        let Some(points) = gts.get("v").and_then(|v| v.as_array()) else {
            return;
        };
        let Some(last) = points.last().and_then(|p| p.as_array()) else {
            return;
        };
        let Some(raw) = last.last() else { return };
        let v: f64 = match raw {
            serde_json::Value::Number(n) => n.as_f64().unwrap_or(0.0),
            serde_json::Value::String(s) => s.parse().unwrap_or(0.0),
            _ => return,
        };

        let entry = out.entry(id).or_insert((None, None, None, None, None));
        if class.starts_with("cpu.") {
            let prev = entry.0.unwrap_or(f32::MIN);
            entry.0 = Some(prev.max(v as f32));
        } else if class.starts_with("mem.") {
            let prev = entry.1.unwrap_or(f32::MIN);
            entry.1 = Some(prev.max(v as f32));
        } else if class.starts_with("disk.") {
            let prev = entry.2.unwrap_or(f32::MIN);
            entry.2 = Some(prev.max(v as f32));
        } else if class == "net.bytes_recv" {
            if v >= 0.0 {
                let prev = entry.3.unwrap_or(f32::MIN);
                entry.3 = Some(prev.max(v as f32));
            }
        } else if class == "net.bytes_sent" && v >= 0.0 {
            let prev = entry.4.unwrap_or(f32::MIN);
            entry.4 = Some(prev.max(v as f32));
        }
    }

    fn walk(v: &serde_json::Value, label_name: &str, out: &mut HashMap<String, MetricsTuple>) {
        match v {
            serde_json::Value::Array(arr) => {
                for item in arr {
                    walk(item, label_name, out);
                }
            }
            serde_json::Value::Object(_) => visit_gts(v, label_name, out),
            _ => {}
        }
    }

    walk(value, label_name, &mut out);
    out
}
