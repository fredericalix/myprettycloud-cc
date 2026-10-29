use std::env;

/// Unified runtime configuration for myprettycloud.
///
/// Superset of the three source prototypes' configs. Environment variables are
/// standardized: `ENCRYPTION_KEY` (base64, 32 bytes) and `CC_OAUTH_CONSUMER_KEY`
/// / `CC_OAUTH_CONSUMER_SECRET` (with `CC_CONSUMER_KEY` / `CC_CONSUMER_SECRET`
/// accepted as fallbacks for the monitor naming).
#[derive(Debug, Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    /// Public URL of the frontend (used for CORS + OAuth redirect target).
    pub frontend_url: String,
    /// Public URL the backend itself is reachable at (OAuth callback, webhooks).
    pub app_url: String,
    pub cc_consumer_key: String,
    pub cc_consumer_secret: String,
    pub encryption_key: [u8; 32],
    pub cc_api_base_url: String,
    pub warp10_endpoint: String,
    pub is_production: bool,

    /// Stable identifier for this running instance. Used for multi-instance
    /// coordination (advisory locks, Pulsar subscriptions, WS hub).
    pub instance_id: String,

    // --- City realtime (from mycctown) ---
    pub ws_poll_status_secs: u64,
    pub ws_poll_metrics_secs: u64,

    // --- Webhooks (from mycctown / myccmonitor) ---
    pub webhooks_public_url: Option<String>,
    pub use_webhooks: bool,

    // --- Observability (from mycctown) ---
    pub sentry_dsn: Option<String>,
    pub sentry_environment: String,
    pub sentry_traces_sample_rate: f32,
    pub debug_cc_api: bool,

    /// Verbose rule-engine ("workflow") tracing. When set, the rule lifecycle
    /// logs the normally-silent points (zero dependents for a monitor, fields
    /// resolving to Null, per-leaf condition verdicts, save-time dependency
    /// indexing) so a non-firing workflow can be diagnosed from the backend
    /// logs. Toggle with `WORKFLOW_DEBUG=1`.
    pub workflow_debug: bool,

    // --- Pulsar event bus (from myccmonitor). Optional: alerting degrades
    // gracefully when unset so the city + metrics still boot. ---
    pub pulsar_url: Option<String>,
    pub pulsar_token: Option<String>,
    pub pulsar_namespace: Option<String>,
    pub pulsar_tenant: Option<String>,

    // --- LM Studio (OpenAI-compatible) for natural-language rule authoring.
    // Optional: NL generation is disabled (400) when the base URL is unset. ---
    pub lmstudio_base_url: Option<String>,
    pub lmstudio_model: String,
    pub lmstudio_api_key: Option<String>,

    // --- SMTP notifications (from myccmonitor). Optional. ---
    pub smtp_host: Option<String>,
    pub smtp_port: u16,
    pub smtp_username: Option<String>,
    pub smtp_password: Option<String>,
    pub smtp_from: Option<String>,
}

fn env_first(keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|k| env::var(k).ok().filter(|v| !v.is_empty()))
}

fn env_bool(key: &str, default: bool) -> bool {
    env::var(key)
        .ok()
        .map(|v| matches!(v.as_str(), "1" | "true" | "TRUE" | "yes"))
        .unwrap_or(default)
}

impl Config {
    pub fn from_env() -> anyhow::Result<Self> {
        let is_production = matches!(
            env::var("APP_ENV").as_deref(),
            Ok("production") | Ok("prod")
        );

        // ENCRYPTION_KEY: base64, exactly 32 bytes. Required in production;
        // a volatile random key is generated in dev (tokens become unreadable
        // after restart, which is acceptable for local development only).
        let encryption_key_b64 = match env::var("ENCRYPTION_KEY") {
            Ok(v) if !v.is_empty() => v,
            _ => {
                if is_production {
                    anyhow::bail!(
                        "ENCRYPTION_KEY is required when APP_ENV=production; refusing to boot with a volatile random key"
                    );
                }
                use base64::Engine;
                let mut key = [0u8; 32];
                rand::RngCore::fill_bytes(&mut rand::thread_rng(), &mut key);
                tracing::warn!(
                    "ENCRYPTION_KEY not set — generated a random key for this process only (dev mode)"
                );
                base64::engine::general_purpose::STANDARD.encode(key)
            }
        };
        let key_bytes = base64::Engine::decode(
            &base64::engine::general_purpose::STANDARD,
            &encryption_key_b64,
        )?;
        let encryption_key: [u8; 32] = key_bytes
            .try_into()
            .map_err(|_| anyhow::anyhow!("ENCRYPTION_KEY must decode to exactly 32 bytes"))?;

        let cc_consumer_key =
            env_first(&["CC_OAUTH_CONSUMER_KEY", "CC_CONSUMER_KEY"]).unwrap_or_default();
        let cc_consumer_secret =
            env_first(&["CC_OAUTH_CONSUMER_SECRET", "CC_CONSUMER_SECRET"]).unwrap_or_default();
        if is_production && (cc_consumer_key.is_empty() || cc_consumer_secret.is_empty()) {
            anyhow::bail!(
                "CC_OAUTH_CONSUMER_KEY and CC_OAUTH_CONSUMER_SECRET are required in production"
            );
        }

        let port: u16 = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse()?;

        let app_url = env::var("APP_URL").unwrap_or_else(|_| format!("http://localhost:{port}"));

        Ok(Config {
            database_url: env::var("DATABASE_URL").or_else(|_| env::var("POSTGRESQL_ADDON_URI"))?,
            port,
            frontend_url: env::var("FRONTEND_URL")
                .unwrap_or_else(|_| "http://localhost:3000".to_string()),
            app_url,
            cc_consumer_key,
            cc_consumer_secret,
            encryption_key,
            cc_api_base_url: env::var("CC_API_BASE_URL")
                .unwrap_or_else(|_| "https://api.clever-cloud.com".to_string()),
            warp10_endpoint: env::var("WARP10_ENDPOINT").unwrap_or_else(|_| {
                "https://c2-warp10-clevercloud-customers.services.clever-cloud.com/api/v0/exec"
                    .to_string()
            }),
            is_production,
            instance_id: env::var("INSTANCE_ID")
                .ok()
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| uuid::Uuid::new_v4().to_string()),
            ws_poll_status_secs: env::var("WS_POLL_STATUS_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(10),
            ws_poll_metrics_secs: env::var("WS_POLL_METRICS_SECS")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(15),
            webhooks_public_url: env::var("WEBHOOKS_PUBLIC_URL").ok().filter(|s| !s.is_empty()),
            use_webhooks: env_bool("USE_WEBHOOKS", false),
            sentry_dsn: env::var("SENTRY_DSN").ok().filter(|s| !s.is_empty()),
            sentry_environment: env::var("SENTRY_ENVIRONMENT")
                .unwrap_or_else(|_| "development".to_string()),
            sentry_traces_sample_rate: env::var("SENTRY_TRACES_SAMPLE_RATE")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0.1),
            debug_cc_api: env_bool("DEBUG_CC_API", false),
            workflow_debug: env_bool("WORKFLOW_DEBUG", false),
            pulsar_url: env_first(&["PULSAR_URL", "ADDON_PULSAR_BINARY_URL"]),
            pulsar_token: env_first(&["PULSAR_TOKEN", "ADDON_PULSAR_TOKEN"]),
            pulsar_namespace: env_first(&["PULSAR_NAMESPACE", "ADDON_PULSAR_NAMESPACE"]),
            pulsar_tenant: env_first(&["PULSAR_TENANT", "ADDON_PULSAR_TENANT"]),
            lmstudio_base_url: env_first(&["LMSTUDIO_BASE_URL", "OPENAI_BASE_URL"]),
            lmstudio_model: env::var("LMSTUDIO_MODEL").unwrap_or_else(|_| "local-model".to_string()),
            lmstudio_api_key: env::var("LMSTUDIO_API_KEY").ok().filter(|s| !s.is_empty()),
            smtp_host: env::var("SMTP_HOST").ok().filter(|s| !s.is_empty()),
            smtp_port: env::var("SMTP_PORT")
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(587),
            smtp_username: env::var("SMTP_USERNAME").ok().filter(|s| !s.is_empty()),
            smtp_password: env::var("SMTP_PASSWORD").ok().filter(|s| !s.is_empty()),
            smtp_from: env::var("SMTP_FROM").ok().filter(|s| !s.is_empty()),
        })
    }

    /// OAuth callback URL the backend exposes (`{app_url}/auth/callback`).
    pub fn callback_url(&self) -> String {
        format!("{}/auth/callback", self.app_url)
    }
}
