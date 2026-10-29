//! Authentication & authorization: OAuth 1.0a (Clever Cloud), AES-256-GCM
//! token encryption, session-backed request extractor, the login routes, and
//! tenant isolation (`authz`).

pub mod authz;
pub mod encryption;
pub mod oauth;
pub mod routes;
pub mod session;

pub use session::{decrypt_user_oauth, AuthUser, AuthenticatedUser};
