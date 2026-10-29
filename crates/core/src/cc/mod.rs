//! Clever Cloud REST API client (OAuth 1.0a signed).
//!
//! Adopted from mycctown (richest coverage: apps + addons + realId +
//! last_deploy + debug request tracing).

mod client;

pub use client::{
    CcAddon, CcAddonProvider, CcApplication, CcClient, CcInstance, CcOrganisation, CcVariant,
    CcWebhook, CcWebhookUrl, SUBSCRIBED_EVENTS,
};
