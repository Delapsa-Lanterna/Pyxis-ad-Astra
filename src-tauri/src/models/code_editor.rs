use crate::models::TextFileOpen;
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEditorOpen {
    pub session_id: String,
    pub mod_root: String,
    pub files: Vec<TextFileOpen>,
}
#[derive(Clone, Debug, Serialize)]
pub struct CodeEditorDelivery {
    pub key: String,
    pub files: Vec<TextFileOpen>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEditorSource {
    pub session_id: String,
    pub mod_root: String,
    pub label: String,
    pub directory: Option<String>,
    pub read_only: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEditorSources {
    pub revision: u64,
    pub sources: Vec<CodeEditorSource>,
    pub analysis_roots: Vec<String>,
}
