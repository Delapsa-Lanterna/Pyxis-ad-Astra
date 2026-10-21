use crate::models::{EntityKind, FileVersion, ProjectSessionId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JsonDocumentOrigin {
    ModInfo,
    Entity { target: JsonSourceIdentity },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceIdentity {
    pub kind: EntityKind,
    pub id: String,
    pub rel_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRecoveryRequest {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub origin: JsonDocumentOrigin,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRecoveryPlan {
    pub request: JsonRecoveryRequest,
    pub base_versions: Vec<FileVersion>,
    pub missing_paths: Vec<String>,
    pub current_sources: std::collections::BTreeMap<String, Value>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecreateJsonSourcesPayload {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub plan: JsonRecoveryPlan,
    pub baseline: Value,
}

super::project_identity::impl_session_mod_scope_required!(
    JsonRecoveryRequest,
    RecreateJsonSourcesPayload
);
