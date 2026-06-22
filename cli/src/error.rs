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
