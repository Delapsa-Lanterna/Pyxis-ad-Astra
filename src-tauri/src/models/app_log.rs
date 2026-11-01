use super::serde_fields::deserialize_nullable;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum AppLogLevel {
    Debug,
    Info,
    Warning,
    Error,
}

impl AppLogLevel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Debug => "debug",
            Self::Info => "info",
            Self::Warning => "warning",
            Self::Error => "error",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogEntry {
    pub level: AppLogLevel,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub code: Option<String>,
    #[serde(default, deserialize_with = "deserialize_nullable")]
    pub message: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub path: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub line: Option<u32>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub fields: Option<BTreeMap<String, String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLogStatus {
    pub path: String,
    pub size_bytes: u64,
    pub recording: String,
    pub level: AppLogLevel,
    pub last_error: Option<String>,
    pub dropped: u64,
    pub pending: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppendAppLogsPayload {
    pub entries: Vec<AppLogEntry>,
}

/// Frozen on-disk log file name; every writer and validator must share it.
pub const LOG_FILE: &str = "pyxis-ad-astra.log";

#[cfg(test)]
mod tests {
    use super::{AppLogEntry, AppLogLevel};
    use serde_json::json;

    #[test]
    fn app_log_entry_requires_explicit_nullable_context_fields() {
        let result = serde_json::from_value::<AppLogEntry>(json!({
            "level": "info",
            "message": "demo",
            "path": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn app_log_levels_order_debug_lowest_error_highest() {
        assert!(AppLogLevel::Debug < AppLogLevel::Info);
        assert!(AppLogLevel::Info < AppLogLevel::Warning);
        assert!(AppLogLevel::Warning < AppLogLevel::Error);
    }
}
