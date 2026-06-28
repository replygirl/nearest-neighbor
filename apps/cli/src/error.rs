use thiserror::Error;

#[allow(dead_code)]
#[derive(Debug, Error)]
pub enum NbrError {
    #[error("Not logged in — run: nbr login")]
    NotLoggedIn,

    #[error("Authentication failed: {0}")]
    AuthFailed(String),

    #[error("API error ({status}): {message}")]
    ApiError { status: u16, message: String },

    #[error("Account not found: {0}")]
    AccountNotFound(String),

    #[error("No account configured. Run `nbr signup` or pass -a <name>.")]
    NoAccountConfigured,

    #[error(
        "Multiple accounts exist. Pass -a <name> or set a default with `nbr accounts use <name>`."
    )]
    MultipleAccountsNoDefault,

    #[error("Config error: {0}")]
    Config(String),

    #[error("Keyring error: {0}")]
    Keyring(String),

    #[error("Network error: {0}")]
    Network(#[from] reqwest::Error),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),

    #[error("URL error: {0}")]
    Url(#[from] url::ParseError),

    #[error("{0}")]
    Other(String),
}

impl NbrError {
    #[allow(dead_code)]
    pub fn exit_code(&self) -> i32 {
        match self {
            NbrError::NotLoggedIn | NbrError::AuthFailed(_) => 1,
            NbrError::AccountNotFound(_)
            | NbrError::NoAccountConfigured
            | NbrError::MultipleAccountsNoDefault => 2,
            NbrError::ApiError { .. } => 3,
            _ => 1,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exit_code_not_logged_in() {
        assert_eq!(NbrError::NotLoggedIn.exit_code(), 1);
    }

    #[test]
    fn exit_code_auth_failed() {
        assert_eq!(NbrError::AuthFailed("bad creds".into()).exit_code(), 1);
    }

    #[test]
    fn exit_code_account_not_found() {
        assert_eq!(NbrError::AccountNotFound("alice".into()).exit_code(), 2);
    }

    #[test]
    fn exit_code_no_account_configured() {
        assert_eq!(NbrError::NoAccountConfigured.exit_code(), 2);
    }

    #[test]
    fn exit_code_multiple_accounts_no_default() {
        assert_eq!(NbrError::MultipleAccountsNoDefault.exit_code(), 2);
    }

    #[test]
    fn exit_code_api_error() {
        assert_eq!(
            NbrError::ApiError {
                status: 404,
                message: "not found".into()
            }
            .exit_code(),
            3
        );
    }

    #[test]
    fn exit_code_config_error() {
        assert_eq!(NbrError::Config("bad path".into()).exit_code(), 1);
    }

    #[test]
    fn exit_code_keyring_error() {
        assert_eq!(NbrError::Keyring("no keyring".into()).exit_code(), 1);
    }

    #[test]
    fn exit_code_other() {
        assert_eq!(NbrError::Other("something else".into()).exit_code(), 1);
    }

    #[test]
    fn display_not_logged_in() {
        let msg = NbrError::NotLoggedIn.to_string();
        assert!(msg.contains("Not logged in") || msg.contains("login"));
    }

    #[test]
    fn display_auth_failed() {
        let msg = NbrError::AuthFailed("invalid token".into()).to_string();
        assert!(msg.contains("invalid token") || msg.contains("Authentication"));
    }

    #[test]
    fn display_api_error() {
        let msg = NbrError::ApiError {
            status: 404,
            message: "not found".into(),
        }
        .to_string();
        assert!(msg.contains("404") || msg.contains("not found"));
    }

    #[test]
    fn display_account_not_found() {
        let msg = NbrError::AccountNotFound("alice".into()).to_string();
        assert!(msg.contains("alice"));
    }

    #[test]
    fn display_no_account_configured() {
        let msg = NbrError::NoAccountConfigured.to_string();
        assert!(msg.contains("signup") || msg.contains("No account"));
    }

    #[test]
    fn display_multiple_accounts_no_default() {
        let msg = NbrError::MultipleAccountsNoDefault.to_string();
        assert!(msg.contains("Multiple") || msg.contains("-a"));
    }

    #[test]
    fn display_config_error() {
        let msg = NbrError::Config("bad path".into()).to_string();
        assert!(msg.contains("bad path") || msg.contains("Config"));
    }

    #[test]
    fn display_keyring_error() {
        let msg = NbrError::Keyring("denied".into()).to_string();
        assert!(msg.contains("denied") || msg.contains("Keyring"));
    }

    #[test]
    fn display_other() {
        let msg = NbrError::Other("weird failure".into()).to_string();
        assert!(msg.contains("weird failure"));
    }

    #[test]
    fn from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "file not found");
        let nbr_err: NbrError = io_err.into();
        assert_eq!(nbr_err.exit_code(), 1);
    }

    #[test]
    fn from_json_error() {
        let json_err = serde_json::from_str::<i32>("not-valid-json").unwrap_err();
        let nbr_err: NbrError = json_err.into();
        assert_eq!(nbr_err.exit_code(), 1);
    }

    // ── url::ParseError → NbrError::Url ──────────────────────────────────────

    /// Covers the `#[from] url::ParseError` `From` impl.
    #[test]
    fn from_url_parse_error() {
        // "not a url" contains a space → definitely not a valid URL → ParseError
        let url_err = url::Url::parse("not a url with spaces").unwrap_err();
        let nbr_err: NbrError = url_err.into();
        assert_eq!(
            nbr_err.exit_code(),
            1,
            "NbrError::Url should map to exit_code 1 (the _ => 1 arm)"
        );
    }

    #[test]
    fn display_url_error() {
        let url_err = url::Url::parse("://missing-scheme").unwrap_err();
        let nbr_err: NbrError = url_err.into();
        let msg = nbr_err.to_string();
        assert!(
            msg.starts_with("URL error:"),
            "Display should use the #[error(\"URL error: {{0}}\")] format, got: {msg}"
        );
    }

    #[test]
    fn exit_code_url_error_is_one() {
        // NbrError::Url falls through to the `_ => 1` catch-all arm
        let url_err = url::Url::parse("bad url").unwrap_err();
        let nbr_err: NbrError = url_err.into();
        assert_eq!(nbr_err.exit_code(), 1);
    }

    // ── NbrError::Other ───────────────────────────────────────────────────────

    #[test]
    fn other_variant_display_uses_inner_string() {
        let nbr_err = NbrError::Other("custom message here".into());
        let msg = nbr_err.to_string();
        assert_eq!(msg, "custom message here");
    }

    // ── exit_code catch-all: Io and Json variants ─────────────────────────────

    #[test]
    fn exit_code_io_error_is_one() {
        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied");
        let nbr_err: NbrError = io_err.into();
        assert_eq!(nbr_err.exit_code(), 1);
    }

    #[test]
    fn exit_code_json_error_is_one() {
        let json_err = serde_json::from_str::<serde_json::Value>("!!!").unwrap_err();
        let nbr_err: NbrError = json_err.into();
        assert_eq!(nbr_err.exit_code(), 1);
    }

    // ── display completeness ──────────────────────────────────────────────────

    #[test]
    fn display_io_error_not_empty() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "not found");
        let nbr_err: NbrError = io_err.into();
        let msg = nbr_err.to_string();
        assert!(
            !msg.is_empty(),
            "Display for Io variant should not be empty"
        );
        assert!(
            msg.contains("IO error") || msg.contains("not found"),
            "unexpected message: {msg}"
        );
    }

    #[test]
    fn display_json_error_not_empty() {
        let json_err = serde_json::from_str::<i32>("null").unwrap_err();
        let nbr_err: NbrError = json_err.into();
        let msg = nbr_err.to_string();
        assert!(
            !msg.is_empty(),
            "Display for Json variant should not be empty"
        );
    }
}
