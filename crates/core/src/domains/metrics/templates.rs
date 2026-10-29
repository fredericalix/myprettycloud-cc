/// WarpScript template parameters
pub struct WarpScriptParams {
    pub token: String,
    pub app_id: String,
    /// Duration expression for Warp10 (e.g., "1 h", "6 h", "1 d", "7 d")
    pub duration: String,
    /// Bucket span in microseconds (e.g., 60000000 for 1 minute)
    pub bucket_span: String,
}

const CPU_TEMPLATE: &str = r#"
[ '{TOKEN}' 'cpu.usage_user' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
MERGE 'cpu.usage_user' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE

[ '{TOKEN}' 'cpu.usage_system' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
MERGE 'cpu.usage_system' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE

[ '{TOKEN}' 'cpu.usage_iowait' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
MERGE 'cpu.usage_iowait' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE
"#;

const MEMORY_TEMPLATE: &str = r#"
[ '{TOKEN}' 'mem.used_percent' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
MERGE 'mem.used_percent' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE
"#;

const NETWORK_TEMPLATE: &str = r#"
[ '{TOKEN}' 'net.bytes_recv' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
[ SWAP mapper.rate 1 0 0 ] MAP
MERGE 'net.bytes_recv' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE
'net_recv' STORE

[ '{TOKEN}' 'net.bytes_sent' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
[ SWAP mapper.rate 1 0 0 ] MAP
MERGE 'net.bytes_sent' RENAME
[ SWAP bucketizer.mean 0 {BUCKET_SPAN} 0 ] BUCKETIZE
'net_sent' STORE

$net_recv $net_sent
"#;

const DISK_TEMPLATE: &str = r#"
[ '{TOKEN}' 'disk.used_percent' { 'app_id' '{APP_ID}' } NOW {DURATION} ] FETCH
MERGE 'disk.used_percent' RENAME
[ SWAP bucketizer.last 0 {BUCKET_SPAN} 0 ] BUCKETIZE
"#;

pub fn get_template(panel: &str) -> Option<&'static str> {
    match panel {
        "cpu" => Some(CPU_TEMPLATE),
        "memory" => Some(MEMORY_TEMPLATE),
        "network" => Some(NETWORK_TEMPLATE),
        "disk" => Some(DISK_TEMPLATE),
        _ => None,
    }
}

/// Strip characters that could break out of a single-quoted WarpScript string
/// literal. `app_id`/`org_id` are already constrained by `validate_cc_id` and
/// the token comes from the trusted CC metrics API, so this is defense in depth
/// against any future caller that forgets to validate its inputs.
fn escape_ws_literal(value: &str) -> String {
    value.replace(['\'', '\\', '\n', '\r'], "")
}

pub fn render(template: &str, params: &WarpScriptParams) -> String {
    template
        .replace("{TOKEN}", &escape_ws_literal(&params.token))
        .replace("{APP_ID}", &escape_ws_literal(&params.app_id))
        .replace("{DURATION}", &params.duration)
        .replace("{BUCKET_SPAN}", &params.bucket_span)
}

/// Convert a human-friendly duration to a WarpScript duration expression
pub fn parse_duration(input: &str) -> Option<String> {
    let input = input.trim().to_lowercase();
    if let Some(hours) = input.strip_suffix('h') {
        hours.parse::<u64>().ok().map(|h| format!("{} h", h))
    } else if let Some(days) = input.strip_suffix('d') {
        days.parse::<u64>().ok().map(|d| format!("{} d", d))
    } else if let Some(minutes) = input.strip_suffix('m') {
        minutes.parse::<u64>().ok().map(|m| format!("{} m", m))
    } else {
        None
    }
}

/// Convert a human-friendly bucket span to microseconds string
pub fn parse_bucket_span(input: &str) -> Option<String> {
    let input = input.trim().to_lowercase();
    if let Some(seconds) = input.strip_suffix('s') {
        seconds
            .parse::<u64>()
            .ok()
            .map(|s| (s * 1_000_000).to_string())
    } else if let Some(minutes) = input.strip_suffix('m') {
        minutes
            .parse::<u64>()
            .ok()
            .map(|m| (m * 60 * 1_000_000).to_string())
    } else if let Some(hours) = input.strip_suffix('h') {
        hours
            .parse::<u64>()
            .ok()
            .map(|h| (h * 3600 * 1_000_000).to_string())
    } else {
        None
    }
}

/// Return a sensible default bucket span for a given duration
pub fn default_bucket_for_duration(duration: &str) -> &str {
    match duration {
        "5m" => "10s",
        "15m" => "10s",
        "1h" => "1m",
        "6h" => "5m",
        "24h" => "15m",
        "7d" => "1h",
        "30d" => "4h",
        _ => "5m",
    }
}
