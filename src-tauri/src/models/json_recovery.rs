use crate::models::file_content::{JsonFileContent, JsonWrite};
use crate::models::{
    FileVersion, JsonDocumentOrigin, ProjectSessionId, ResourceRef, project_identity,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

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
    pub documents: BTreeMap<String, JsonFileContent>,
    pub request: JsonRecoveryRequest,
    pub base_versions: Vec<FileVersion>,
    pub missing_paths: Vec<String>,
    pub current_sources: BTreeMap<String, Value>,
    pub resource_refs: BTreeMap<String, ResourceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceRestore {
    pub originals: BTreeMap<String, JsonFileContent>,
    pub documents: BTreeMap<String, JsonWrite>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub plan: JsonRecoveryPlan,
    pub baseline: Value,
}

project_identity::impl_session_mod_scope_required!(JsonRecoveryRequest, JsonSourceRestore);
