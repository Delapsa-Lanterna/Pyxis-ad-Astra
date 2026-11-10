use super::{
    FileVersion, JsonComposition, JsonWriteOptions, MiscConfigKind, ProjectSessionId,
    project_identity,
};
use crate::errors::ErrorDiagnostic;
use crate::models::file_content::{JsonFileContent, JsonWrite};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigScope {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigRead {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub kind: MiscConfigKind,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MiscConfigState {
    Present,
    Missing,
    Error,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigEntry {
    pub kind: MiscConfigKind,
    pub path: String,
    pub rel_path: String,
    pub state: MiscConfigState,
    pub error: Option<ErrorDiagnostic>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigFile {
    pub composition: JsonComposition,
    pub kind: MiscConfigKind,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub document: JsonFileContent,
    pub base_versions: Vec<FileVersion>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigWrite {
    pub kind: MiscConfigKind,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub base_versions: Vec<FileVersion>,
    pub document: JsonWrite,
    pub json_write: JsonWriteOptions,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MiscConfigDelete {
    pub kind: MiscConfigKind,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub base_versions: Vec<FileVersion>,
}
project_identity::impl_session_mod_scope_required!(
    MiscConfigScope,
    MiscConfigRead,
    MiscConfigWrite,
    MiscConfigDelete
);
