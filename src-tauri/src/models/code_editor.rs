use crate::errors::ErrorDiagnostic;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEditorFile {
    pub path: String,
    pub line: Option<u64>,
    pub column: Option<u64>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodeEditorOpen {
    pub session_id: String,
    pub mod_root: String,
    pub files: Vec<CodeEditorFile>,
}
#[derive(Clone, Debug, Serialize)]
pub struct CodeEditorDelivery {
    pub key: String,
    pub files: Vec<CodeEditorFile>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct CodeEditorFileResult {
    pub path: String,
    pub diagnostic: Option<ErrorDiagnostic>,
}
