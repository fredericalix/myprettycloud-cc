//! myprettycloud unified backend — binary entry point.
//!
//! Wires configuration, the database pool, migrations, sessions, security
//! middleware and routes, then serves. All reusable logic lives in
//! `myprettycloud-core`.

use axum::http::{header, HeaderName, HeaderValue, Method};
use axum::{routing::get, Json, Router};
use mpc_core::{AppState, Config};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use std::sync::Arc;
use std::time::Duration;
use tower_governor::{
    governor::GovernorConfigBuilder, key_extractor::SmartIpKeyExtractor, GovernorLayer,
};
use tower_http::cors::CorsLayer;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tower_sessions::cookie::SameSite;
use tower_sessions::session_store::ExpiredDeletion;
use tower_sessions::{Expiry, SessionManagerLayer};
use tower_sessions_sqlx_store::PostgresStore;

fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,myprettycloud_server=debug,mpc_core=debug,sqlx=warn".into()),
        )
        .init();

    let config = Config::from_env()?;

    // Init Sentry/GlitchTip on the main thread, before the async runtime, so
    // the guard outlives the runtime (recommended pattern). No-op when no DSN.
    let _sentry_guard = init_sentry(&config);

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run(config))
}

fn init_sentry(config: &Config) -> Option<sentry::ClientInitGuard> {
    let dsn = config.sentry_dsn.clone()?;
    Some(sentry::init((
        dsn,
        sentry::ClientOptions {
            release: sentry::release_name!(),
            environment: Some(config.sentry_environment.clone().into()),
            traces_sample_rate: config.sentry_traces_sample_rate,
            ..Default::default()
        },
    )))
}

async fn run(config: Config) -> anyhow::Result<()> {
    let port = config.port;
    let is_production = config.is_production;
    let frontend_url = config.frontend_url.clone();
    tracing::info!(
        instance_id = %config.instance_id,
        production = is_production,
        "starting myprettycloud backend"
    );

    // Connect + run the consolidated migrations before serving.
    let db = PgPoolOptions::new()
        .max_connections(20)
        .min_connections(2)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&config.database_url)
        .await?;
    sqlx::migrate!("../../migrations").run(&db).await?;
    tracing::info!("database migrations applied");

    // Session store (Postgres-backed). The frontend reverse-proxies the API,
    // so the cookie is first-party to the frontend origin → SameSite=Lax.
    let session_store = PostgresStore::new(db.clone());
    session_store.migrate().await?;
    let deletion_task = tokio::task::spawn(
        session_store
            .clone()
            .continuously_delete_expired(Duration::from_secs(3600)),
    );
    let session_layer = SessionManagerLayer::new(session_store)
        .with_name("mpc.sid")
        .with_http_only(true)
        .with_secure(is_production)
        .with_same_site(SameSite::Lax)
        .with_expiry(Expiry::OnInactivity(time::Duration::days(30)));

    let mut state = AppState::new(db, config);

    // Pulsar event bus (optional). On success: attach live producers + spawn the
    // webhook-inbox and escalation consumers. On absence/failure: log and carry
    // on with disabled producers (alerting escalations + durable inbox degraded).
    match mpc_core::bus::connect(&state.config).await {
        Ok(Some(pulsar)) => {
            let cfg = state.config.clone();
            let webhooks_topic = mpc_core::bus::topic_name(&cfg, "cc-webhooks");
            let escalations_topic = mpc_core::bus::topic_name(&cfg, "rule-escalations");
            let wp = mpc_core::bus::WebhookProducer::build(&pulsar, &webhooks_topic, &cfg.instance_id).await;
            let ep = mpc_core::bus::EscalationProducer::build(&pulsar, &escalations_topic, &cfg.instance_id).await;
            match (wp, ep) {
                (Ok(wp), Ok(ep)) => {
                    state = state.with_producers(wp, ep);
                    let cstate = state.clone();
                    let p = pulsar.clone();
                    let t = webhooks_topic.clone();
                    tokio::spawn(async move {
                        if let Err(e) = mpc_core::bus::consumer::run(p, t, "myprettycloud-processor".to_string(), cstate).await {
                            tracing::error!(error = ?e, "webhook consumer exited");
                        }
                    });
                    let cstate = state.clone();
                    tokio::spawn(async move {
                        if let Err(e) = mpc_core::bus::escalations::run_consumer(pulsar, escalations_topic, "myprettycloud-escalations".to_string(), cstate).await {
                            tracing::error!(error = ?e, "escalation consumer exited");
                        }
                    });
                    tracing::info!("Pulsar connected: producers + consumers active");
                }
                _ => tracing::error!("failed to build Pulsar producers; alerting degraded"),
            }
        }
        Ok(None) => {}
        Err(e) => tracing::error!(error = ?e, "Pulsar connect failed; alerting degraded (continuing)"),
    }

    // Realtime: one LISTEN ws_broadcast task per instance, routing NOTIFY
    // payloads onto the local OrgBus. Restarts on error without taking the
    // process down.
    {
        let pool = state.db.clone();
        let bus = state.ws_bus.clone();
        tokio::spawn(async move {
            loop {
                if let Err(e) = mpc_core::realtime::run_listen_notify(pool.clone(), bus.clone()).await
                {
                    tracing::error!(error = ?e, "LISTEN ws_broadcast task exited; retrying in 5s");
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        });
    }

    // Unified poller: one global task per instance. Advisory-locked per monitor
    // so exactly one instance polls each resource per tick; writes metric_readings,
    // detects state transitions, triggers dependent rules, and broadcasts monitor
    // frames via pg_notify.
    {
        let poller_state = state.clone();
        tokio::spawn(async move {
            if let Err(e) = mpc_core::poller::run(poller_state).await {
                tracing::error!(error = ?e, "poller task exited");
            }
        });
    }

    // CORS: the frontend origin, credentialed (cookies).
    let cors = CorsLayer::new()
        .allow_origin(frontend_url.parse::<HeaderValue>()?)
        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::DELETE, Method::OPTIONS])
        .allow_headers([header::CONTENT_TYPE, header::AUTHORIZATION, header::COOKIE])
        .allow_credentials(true);

    // Security response headers.
    let security_headers = tower::ServiceBuilder::new()
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-content-type-options"),
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("x-frame-options"),
            HeaderValue::from_static("DENY"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("referrer-policy"),
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            HeaderName::from_static("strict-transport-security"),
            HeaderValue::from_static("max-age=63072000; includeSubDomains"),
        ));

    // Rate limiting: 1 req/s, burst 60, keyed on the client IP from
    // X-Forwarded-For / Forwarded (required behind the Clever Cloud edge proxy).
    let governor_conf = Arc::new(
        GovernorConfigBuilder::default()
            .per_second(1)
            .burst_size(60)
            .key_extractor(SmartIpKeyExtractor)
            .finish()
            .expect("valid governor config"),
    );
    let governor_limiter = GovernorLayer { config: governor_conf };

    // REST routes are rate-limited. The WebSocket (/ws) and MCP (/mcp)
    // endpoints — added in later milestones — are long-lived / token-authed
    // and must NOT pass through the governor, so they merge in unwrapped.
    let rest = Router::new()
        .merge(mpc_core::auth::routes::router())
        .merge(mpc_core::domains::town::router())
        .merge(mpc_core::domains::metrics::router())
        .merge(mpc_core::handlers::api_router())
        .merge(mpc_core::handlers::rules_router())
        .merge(mpc_core::handlers::groups_router())
        .merge(mpc_core::handlers::channels_router())
        .merge(mpc_core::handlers::templates_router())
        .merge(mpc_core::handlers::mcp_admin_router())
        .layer(governor_limiter);

    let app = Router::new()
        .route("/health", get(health))
        .merge(rest)
        // /ws is long-lived and must NOT pass through the rate limiter.
        .merge(mpc_core::realtime::router())
        // /webhooks/cc/:token is token-authed (CC posts from many IPs) — no governor.
        .merge(mpc_core::webhooks::router())
        // /mcp has its own Bearer auth + OAuth-discovery stubs — no governor.
        .merge(mpc_core::mcp::build_router(state.clone()))
        .layer(session_layer)
        .layer(cors)
        .layer(security_headers)
        .layer(sentry_tower::NewSentryLayer::new_from_top())
        .layer(sentry_tower::SentryHttpLayer::new().enable_transaction())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("listening on http://{addr}");
    // ConnectInfo so the rate limiter's SmartIpKeyExtractor can fall back to
    // the peer IP when no X-Forwarded-For / Forwarded header is present.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;

    deletion_task.abort();
    Ok(())
}

/// Liveness probe. Returns 200 without touching the database.
async fn health() -> Json<serde_json::Value> {
    Json(json!({ "status": "ok", "service": "myprettycloud" }))
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    tracing::info!("shutdown signal received");
}
