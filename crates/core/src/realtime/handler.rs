use crate::auth::authz;
use crate::auth::session::AuthUser;
use crate::db;
use crate::error::AppError;
use crate::poller;
use crate::realtime::{WsFrame, SYSTEM_CHANNEL};
use crate::state::AppState;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Query, State};
use axum::response::Response;
use axum::routing::get;
use axum::Router;
use futures::{SinkExt, StreamExt};
use serde::Deserialize;
use std::time::Duration;
use tokio::sync::broadcast;

/// How often, at most, an on-connect city poll fires per org (per instance).
/// Comfortably exceeds the WS reconnect-backoff and StrictMode double-connect
/// bursts so a single scene-open kicks one poll, not a storm.
const ONCONNECT_POLL_THROTTLE: Duration = Duration::from_secs(15);

pub fn router() -> Router<AppState> {
    Router::new().route("/ws", get(ws_handler))
}

#[derive(Deserialize)]
struct WsParams {
    org: String,
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    user: AuthUser,
    Query(params): Query<WsParams>,
) -> Result<Response, AppError> {
    // The system channel (rule firings) needs only authentication; org channels
    // require membership.
    if params.org != SYSTEM_CHANNEL {
        authz::require_org_member(&state, &user.0, &params.org).await?;
    }

    let rx = state.ws_bus.subscribe(&params.org);
    let cc_org_id = params.org.clone();

    // Kick a one-shot live-city poll so the buildings colour within ~1-3s
    // instead of waiting for the next 60s poller tick. Best-effort and strictly
    // fire-and-forget: it must never block or fail the WS upgrade. Throttled
    // per-org to coalesce the connect burst (StrictMode, reconnect, multi-tab),
    // and skipped for the org-agnostic system channel. The poll is keyed on the
    // MAP OWNER, not the connecting member, so it works for any org viewer.
    if params.org != SYSTEM_CHANNEL
        && state
            .ws_bus
            .try_mark_polled(&params.org, ONCONNECT_POLL_THROTTLE)
    {
        let st = state.clone();
        let org = cc_org_id.clone();
        tokio::spawn(async move {
            match db::maps::map_owners_for_org(&st.db, &org).await {
                Ok(owners) => {
                    for owner in owners {
                        if let Err(e) = poller::poll_city_org(&st, owner, &org).await {
                            tracing::warn!(error = ?e, %org, %owner, "on-connect city poll failed");
                        }
                    }
                }
                Err(e) => {
                    tracing::warn!(error = ?e, %org, "on-connect: map_owners_for_org failed")
                }
            }
        });
    }

    Ok(ws.on_upgrade(move |socket| handle_socket(socket, rx, cc_org_id)))
}

async fn handle_socket(socket: WebSocket, mut rx: broadcast::Receiver<WsFrame>, cc_org_id: String) {
    let (mut sender, mut receiver) = socket.split();

    // Broadcast → client.
    let send = tokio::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(frame) => {
                    let json = match serde_json::to_string(&frame) {
                        Ok(s) => s,
                        Err(e) => {
                            tracing::error!(error = ?e, "frame serialize failed");
                            continue;
                        }
                    };
                    if sender.send(Message::Text(json.into())).await.is_err() {
                        break;
                    }
                }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    tracing::warn!(lagged = n, "WS client lagged; some frames dropped");
                }
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    // Client → backend: we accept no commands yet; keep alive, handle close.
    let recv = tokio::spawn(async move {
        while let Some(msg) = receiver.next().await {
            match msg {
                Ok(Message::Close(_)) | Err(_) => break,
                _ => continue,
            }
        }
    });

    tokio::select! {
        _ = send => {}
        _ = recv => {}
    }
    tracing::debug!(%cc_org_id, "WS client disconnected");
}
