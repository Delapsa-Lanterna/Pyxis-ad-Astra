use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ModFileKind {
    Directory,
    File,
    Restricted,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFileEntry {
    pub name: String,
    pub rel_path: String,
    pub kind: ModFileKind,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDirectory {
    pub directory: Option<String>,
    pub entries: Vec<ModFileEntry>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModTextFileTarget {
    pub session_id: String,
    pub mod_root: String,
    pub path: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModDirectoryPayload {
    pub session_id: String,
    #[serde(deserialize_with = "super::serde_fields::deserialize_nullable")]
    pub directory: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModTextFilePayload {
    pub session_id: String,
    pub rel_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFileSearch {
    pub query: String,
    pub entries: Vec<ModFileEntry>,
    pub matched_paths: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModFileSearchPayload {
    pub session_id: String,
    pub query: String,
}
