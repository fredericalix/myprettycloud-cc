//! Natural-language rule authoring: turn a user's plain-English request into a
//! rule JSON (the same condition/actions schema the engine + editor use) via an
//! OpenAI-compatible chat-completions endpoint (LM Studio). Optional — disabled
//! (400) when `LMSTUDIO_BASE_URL` is unset.
//!
//! (The other NL path is the MCP server: an external client calls the rule
//! tools directly. This endpoint is the in-app convenience.)

use crate::db::notification_channels;
use crate::error::{AppError, AppResult};
use crate::state::AppState;
use serde_json::json;
use uuid::Uuid;

/// Generate a rule JSON object (`{name, condition, actions, cooldown_seconds}`)
/// from `text`, scoped to `monitor_id`. The caller deserializes it into the
/// rule UpsertInput and persists it through the normal save path.
pub async fn generate(
    state: &AppState,
    user_id: Uuid,
    text: &str,
    monitor_id: Uuid,
) -> AppResult<serde_json::Value> {
    let base_url = state.config.lmstudio_base_url.as_ref().ok_or_else(|| {
        AppError::BadRequest(
            "natural-language rule authoring is not configured (LMSTUDIO_BASE_URL unset)".into(),
        )
    })?;

    let channels = notification_channels::list_for_user(&state.db, user_id).await?;
    let channel_lines = if channels.is_empty() {
        "(none configured)".to_string()
    } else {
        channels
            .iter()
            .map(|c| format!("- {} (id={}, kind={})", c.name, c.id, c.kind))
            .collect::<Vec<_>>()
            .join("\n")
    };

    let system = format!(
        "You translate a user's request into a Clever Cloud monitoring rule. \
Output ONLY a JSON object (no prose, no markdown fences) of the form:\n\
{{\"name\": string, \"condition\": <cond>, \"actions\": [<action>...], \"cooldown_seconds\": number}}\n\
A <cond> is either a comparison {{\"type\":\"comparison\",\"field\":\"monitor:{mid}:<prop>\",\"operator\":\"<op>\",\"value\":<number|string>, optional \"for_duration\":{{\"seconds\":<n>}}}} \
or a group {{\"type\":\"logical\",\"op\":\"and\"|\"or\",\"children\":[<cond>...]}}. \
<prop> is one of cpu, mem, disk, net_in, net_out, state. <op> is one of gt, gte, lt, lte, eq, neq. \
Always reference monitor id {mid}. \
An <action> is either {{\"type\":\"send_notification\",\"channel_id\":\"<uuid>\",\"message\":string}} \
using one of the channels listed below, or — if none fit — \
{{\"type\":\"set_monitor_state\",\"target_monitor_id\":\"{mid}\",\"state\":\"critical\",\"message\":string}}. \
There must be at least one action. cooldown_seconds defaults to 300.\n\
Available notification channels:\n{channels}",
        mid = monitor_id,
        channels = channel_lines,
    );

    let body = json!({
        "model": state.config.lmstudio_model,
        "max_tokens": 1024,
        "temperature": 0.2,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": text },
        ],
        // Ask for strict JSON; LM Studio honours this for models that support it.
        "response_format": { "type": "json_object" },
    });

    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let mut req = state.http_client.post(&url).header("content-type", "application/json");
    // LM Studio usually needs no auth; send a Bearer only if configured.
    if let Some(key) = state.config.lmstudio_api_key.as_ref() {
        req = req.header("authorization", format!("Bearer {key}"));
    }

    let resp = req
        .json(&body)
        .send()
        .await
        .map_err(|e| AppError::Internal(e.into()))?;

    if !resp.status().is_success() {
        let status = resp.status();
        tracing::error!(%status, "LM Studio chat-completions call failed");
        return Err(AppError::Internal(anyhow::anyhow!(
            "rule generation upstream error ({status})"
        )));
    }

    let v: serde_json::Value = resp.json().await.map_err(|e| AppError::Internal(e.into()))?;
    let raw = v["choices"][0]["message"]["content"]
        .as_str()
        .ok_or_else(|| AppError::Internal(anyhow::anyhow!("unexpected chat-completions response shape")))?;

    // Strip an optional ```json fence the model might add despite instructions.
    let cleaned = raw
        .trim()
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim();

    serde_json::from_str(cleaned).map_err(|e| {
        tracing::error!(error = %e, body = %cleaned, "failed to parse generated rule JSON");
        AppError::BadRequest("the model did not return a valid rule; try rephrasing".into())
    })
}
