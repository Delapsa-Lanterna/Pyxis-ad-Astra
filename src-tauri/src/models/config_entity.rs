use super::serde_fields::deserialize_nullable;
use super::{
    CsvRow, EntityKind, FileVersion, JsonWriteOptions, ProjectSessionId, project_identity,
};
use crate::models::file_content::{JsonFileContent, JsonWrite};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum IndexedConfigKind {
    Faction,
    Mission,
}
impl From<IndexedConfigKind> for EntityKind {
    fn from(kind: IndexedConfigKind) -> Self {
        match kind {
            IndexedConfigKind::Faction => Self::Faction,
            IndexedConfigKind::Mission => Self::Mission,
        }
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedConfigEntityRefresh {
    pub entity_id: String,
    pub index_path: String,
    pub index_header: Vec<String>,
    pub index_rows: Vec<CsvRow>,
    pub entity_data: Value,
    pub document: Option<JsonFileContent>,
}
#[derive(Debug)]
pub struct FactionIndexRow {
    pub reference: String,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}
#[derive(Debug)]
pub struct FactionIndexEntry {
    pub path: PathBuf,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfoSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub document: JsonWrite,
    pub json_write: JsonWriteOptions,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedConfigSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub previous_id: Option<String>,
    pub next_id: String,
    pub index_row: Map<String, Value>,
    #[serde(flatten)]
    pub content: IndexedConfigContent,
    pub json_write: JsonWriteOptions,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IndexedConfigContent {
    Faction { document: JsonWrite },
    Mission { document: JsonWrite, text: String },
}
impl IndexedConfigContent {
    pub fn kind(&self) -> IndexedConfigKind {
        match self {
            Self::Faction { .. } => IndexedConfigKind::Faction,
            Self::Mission { .. } => IndexedConfigKind::Mission,
        }
    }
    pub fn document(&self) -> &JsonWrite {
        match self {
            Self::Faction { document } | Self::Mission { document, .. } => document,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedConfigDelete {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub kind: IndexedConfigKind,
    pub id: String,
    pub delete_target: bool,
}
project_identity::impl_session_mod_scope_required!(
    ModInfoSave,
    IndexedConfigSave,
    IndexedConfigDelete
);

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use super::*;
    use serde_json::json;

    #[test]
    fn indexed_config_entity_payload_carries_complete_typed_document() {
        let payload: IndexedConfigSave = serde_json::from_value(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "kind": "faction",
            "previousId": null,
            "nextId": "demo",
            "indexRow": {"id": "demo"},
            "document": file_formats::json_write(&json!({"id":"demo"})), "jsonWrite": {}
        }))
        .unwrap();

        assert_eq!(
            payload.content.document().content.to_json().unwrap()["id"],
            "demo"
        );
    }

    #[test]
    fn indexed_config_entity_payload_requires_explicit_nullable_source_identity() {
        let result = serde_json::from_value::<IndexedConfigSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "kind": "faction",
            "nextId": "demo",
            "indexRow": {"id": "demo"},
            "document": file_formats::json_write(&json!({"id":"demo"})), "jsonWrite": {}
        }));

        assert!(result.is_err());
    }

    #[test]
    fn delete_indexed_config_entity_payload_requires_explicit_delete_flag() {
        let result = serde_json::from_value::<IndexedConfigDelete>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "kind": "faction",
            "id": "demo"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn mod_info_requests_keep_explicit_content_and_format() {
        let value = json!({"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","document":file_formats::json_write(&json!({"id":"demo"})),"jsonWrite":{}});
        let expected = value["document"].clone();
        let payload: ModInfoSave = serde_json::from_value(value).unwrap();
        assert!(!payload.json_write.preserve_structure);
        assert_eq!(
            payload.document.content.to_json().unwrap(),
            json!({"id":"demo"})
        );
        assert_eq!(serde_json::to_value(payload).unwrap()["document"], expected);
    }
}
