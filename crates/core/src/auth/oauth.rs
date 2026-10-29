//! OAuth 1.0a signing for the Clever Cloud API (HMAC-SHA1).
//!
//! Adopted from myccmetrics (the safest base: redacts token secrets from
//! errors and uses `unwrap_or_default` for the timestamp).

use crate::config::Config;
use hmac::{Hmac, Mac};
use percent_encoding::{utf8_percent_encode, AsciiSet, NON_ALPHANUMERIC};
use sha1::Sha1;
use std::collections::BTreeMap;
use std::time::{SystemTime, UNIX_EPOCH};

// RFC 3986 unreserved characters
const ENCODE_SET: &AsciiSet = &NON_ALPHANUMERIC
    .remove(b'-')
    .remove(b'.')
    .remove(b'_')
    .remove(b'~');

fn percent_encode(s: &str) -> String {
    utf8_percent_encode(s, ENCODE_SET).to_string()
}

fn generate_nonce() -> String {
    uuid::Uuid::new_v4().to_string().replace('-', "")
}

fn generate_timestamp() -> String {
    // A clock set before the UNIX epoch would otherwise panic; fall back to 0.
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string()
}

fn sign_request(
    method: &str,
    base_url: &str,
    params: &BTreeMap<String, String>,
    consumer_secret: &str,
    token_secret: &str,
) -> String {
    let param_string: String = params
        .iter()
        .filter(|(k, _)| k.as_str() != "oauth_signature")
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&");

    let base_string = format!(
        "{}&{}&{}",
        percent_encode(method),
        percent_encode(base_url),
        percent_encode(&param_string)
    );

    let signing_key = format!(
        "{}&{}",
        percent_encode(consumer_secret),
        percent_encode(token_secret)
    );

    let mut mac = Hmac::<Sha1>::new_from_slice(signing_key.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(base_string.as_bytes());
    let result = mac.finalize();
    base64::Engine::encode(
        &base64::engine::general_purpose::STANDARD,
        result.into_bytes(),
    )
}

fn build_query_string(params: &BTreeMap<String, String>) -> String {
    params
        .iter()
        .map(|(k, v)| format!("{}={}", percent_encode(k), percent_encode(v)))
        .collect::<Vec<_>>()
        .join("&")
}

fn build_authorization_header(params: &BTreeMap<String, String>) -> String {
    let entries: Vec<String> = params
        .iter()
        .filter(|(k, _)| k.starts_with("oauth_"))
        .map(|(k, v)| format!("{}=\"{}\"", percent_encode(k), percent_encode(v)))
        .collect();
    format!("OAuth {}", entries.join(", "))
}

/// Step 1: get a request token from Clever Cloud (`request_token_query`).
pub async fn request_temporary_token(
    config: &Config,
    http_client: &reqwest::Client,
) -> anyhow::Result<(String, String)> {
    let base_url = format!("{}/v2/oauth/request_token_query", config.cc_api_base_url);
    let callback_url = config.callback_url();

    let mut params = BTreeMap::new();
    params.insert("oauth_callback".to_string(), callback_url);
    params.insert(
        "oauth_consumer_key".to_string(),
        config.cc_consumer_key.clone(),
    );
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_version".to_string(), "1.0".to_string());

    let signature = sign_request("POST", &base_url, &params, &config.cc_consumer_secret, "");
    params.insert("oauth_signature".to_string(), signature);

    let full_url = format!("{}?{}", base_url, build_query_string(&params));
    let resp = http_client.post(&full_url).send().await?;
    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!("request_token failed: status={}", status);
        anyhow::bail!("request_token failed: status={}", status);
    }

    let parsed: BTreeMap<String, String> = url::form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    // Do not include `body` in errors: OAuth responses carry token secrets.
    let token = parsed
        .get("oauth_token")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token in request_token response"))?
        .clone();
    let secret = parsed
        .get("oauth_token_secret")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret in request_token response"))?
        .clone();

    Ok((token, secret))
}

/// Step 3: exchange request token + verifier for an access token.
pub async fn exchange_access_token(
    config: &Config,
    http_client: &reqwest::Client,
    oauth_token: &str,
    oauth_token_secret: &str,
    oauth_verifier: &str,
) -> anyhow::Result<(String, String)> {
    let base_url = format!("{}/v2/oauth/access_token_query", config.cc_api_base_url);

    let mut params = BTreeMap::new();
    params.insert(
        "oauth_consumer_key".to_string(),
        config.cc_consumer_key.clone(),
    );
    params.insert("oauth_token".to_string(), oauth_token.to_string());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_version".to_string(), "1.0".to_string());
    params.insert("oauth_verifier".to_string(), oauth_verifier.to_string());

    let signature = sign_request(
        "POST",
        &base_url,
        &params,
        &config.cc_consumer_secret,
        oauth_token_secret,
    );
    params.insert("oauth_signature".to_string(), signature);

    let full_url = format!("{}?{}", base_url, build_query_string(&params));
    let resp = http_client.post(&full_url).send().await?;
    let status = resp.status();
    let body = resp.text().await?;

    if !status.is_success() {
        tracing::error!("access_token failed: status={}", status);
        anyhow::bail!("access_token failed: status={}", status);
    }

    let parsed: BTreeMap<String, String> = url::form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.to_string(), v.to_string()))
        .collect();

    let token = parsed
        .get("oauth_token")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token in access_token response"))?
        .clone();
    let secret = parsed
        .get("oauth_token_secret")
        .ok_or_else(|| anyhow::anyhow!("missing oauth_token_secret in access_token response"))?
        .clone();

    Ok((token, secret))
}

/// Sign an API request with consumer + user tokens; returns the `Authorization`
/// header value.
pub fn sign_api_request(
    method: &str,
    url: &str,
    consumer_key: &str,
    consumer_secret: &str,
    access_token: &str,
    access_secret: &str,
) -> String {
    let mut params = BTreeMap::new();
    params.insert("oauth_consumer_key".to_string(), consumer_key.to_string());
    params.insert("oauth_token".to_string(), access_token.to_string());
    params.insert("oauth_signature_method".to_string(), "HMAC-SHA1".to_string());
    params.insert("oauth_timestamp".to_string(), generate_timestamp());
    params.insert("oauth_nonce".to_string(), generate_nonce());
    params.insert("oauth_version".to_string(), "1.0".to_string());

    let signature = sign_request(method, url, &params, consumer_secret, access_secret);
    params.insert("oauth_signature".to_string(), signature);

    build_authorization_header(&params)
}
