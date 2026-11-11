use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum FileKind {
    Directory,
    File,
    Restricted,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub rel_path: String,
    pub kind: FileKind,
    pub size_bytes: Option<u64>,
    pub modified_at: Option<i64>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDirectory {
    pub directory: Option<String>,
    pub entries: Vec<FileEntry>,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTextTarget {
    pub session_id: String,
    pub mod_root: String,
    pub path: String,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDirectoryPayload {
    pub session_id: String,
    #[serde(deserialize_with = "super::serde_fields::deserialize_nullable")]
    pub directory: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTextPayload {
    pub session_id: String,
    pub rel_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearch {
    pub query: String,
    pub entries: Vec<FileEntry>,
    pub matched_paths: Vec<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileSearchPayload {
    pub session_id: String,
    pub query: String,
    pub directory: Option<String>,
}
