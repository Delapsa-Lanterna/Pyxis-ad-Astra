use crate::errors::ErrorDiagnostic;
use crate::models::{InvalidatedResourceScope, ReferenceSources, ResourceSource};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ProjectSyncDelivery {
    CoreChanged {
        root: String,
        sources: Vec<InvalidatedResourceScope>,
    },
    SourceStatus {
        root: String,
        source: ResourceSource,
        state: SourceSyncState,
        diagnostic: Option<ErrorDiagnostic>,
    },
    References {
        snapshot: ReferenceSources,
        event: Option<Value>,
    },
    Missing {
        #[serde(rename = "requestId")]
        request_id: String,
        paths: Vec<String>,
    },
    Saved {
        #[serde(rename = "requestId")]
        request_id: String,
        event: Value,
    },
    Waiting {
        #[serde(rename = "modRoot")]
        mod_root: String,
        waiting: bool,
    },
    Blocked {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "modRoot")]
        mod_root: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        diagnostic: ErrorDiagnostic,
    },
}

#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SourceSyncState {
    Watching,
    Scanning,
    Failed,
    Released,
}
