use super::serde_fields::deserialize_nullable;
use super::{JsonWriteOptions, ProjectSessionId};
use crate::models::{CsvRow, EntityKind, FileVersion, project_identity};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
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

/// Refreshed-entity payload of the indexed config chains (faction, mission):
/// the changed index table plus the entity content, returned as the typed
/// content value of a `WriteResult` with its JSON document owner.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedConfigEntityRefresh {
    pub entity_id: String,
    pub index_path: String,
    pub index_header: Vec<String>,
    pub index_rows: Vec<CsvRow>,
    pub entity_data: Value,
}

#[derive(Debug)]
pub struct FactionIndexRow {
    pub reference: String,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModInfoSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub data: Value,
    #[serde(default)]
    pub json_write: JsonWriteOptions,
    #[serde(default)]
    pub ordered_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexedConfigSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub kind: IndexedConfigKind,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub previous_id: Option<String>,
    pub next_id: String,
    pub index_row: Map<String, Value>,
    pub entity_data: Value,
    #[serde(default)]
    pub json_write: JsonWriteOptions,
    #[serde(default)]
    pub ordered_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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
    use super::*;
    use serde_json::json;

    #[test]
    fn indexed_config_entity_payload_uses_entity_data_wire_field() {
        let payload: IndexedConfigSave = serde_json::from_value(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "kind": "faction",
            "previousId": null,
            "nextId": "demo",
            "indexRow": {"id": "demo"},
            "entityData": {"file": {"id": "demo"}}
        }))
        .unwrap();

        assert_eq!(payload.entity_data["file"]["id"], "demo");
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
            "entityData": {"file": {"id": "demo"}}
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
    fn mod_info_requests_keep_json_defaults_and_nullable_ordered_json() {
        let value = json!({"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","data":{"id":"demo"}});
        for value in [value.clone(), {
            let mut value = value;
            value["orderedJson"] = Value::Null;
            value
        }] {
            let payload: ModInfoSave = serde_json::from_value(value).unwrap();
            assert!(!payload.json_write.preserve_original_json);
            assert!(payload.json_write.confirmed_sources.is_empty());
            assert!(payload.ordered_json.is_none());
        }
    }
}

#[derive(Debug)]
pub struct FactionIndexEntry {
    pub path: PathBuf,
    pub row_index: usize,
    pub id_column: String,
    pub file_column: Option<String>,
}
