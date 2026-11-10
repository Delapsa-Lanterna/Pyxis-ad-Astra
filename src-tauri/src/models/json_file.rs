use super::serde_fields::deserialize_nullable;
use super::{FileVersion, JsonWriteOptions, ProjectSessionId, project_identity};
use crate::models::file_content::{JsonFileContent, JsonWrite};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonDocumentRead {
    pub session_id: ProjectSessionId,
    pub rel_path: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonDocumentFile {
    pub document: JsonFileContent,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonFileSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub previous_id: Option<String>,
    pub next_id: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub rel_path: Option<String>,
    pub document: JsonWrite,
    pub json_write: JsonWriteOptions,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonFileDelete {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub entity_id: String,
    pub rel_path: String,
}
project_identity::impl_session_mod_scope_required!(JsonFileSave, JsonFileDelete);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VariantFile {
    pub variant_id: String,
    pub hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub document: Option<JsonFileContent>,
    pub weapon_group_count: usize,
    pub hull_mod_count: usize,
    pub perma_mod_count: usize,
    pub wing_count: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkinFile {
    pub skin_hull_id: String,
    pub base_hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub document: Option<JsonFileContent>,
    pub built_in_mod_count: usize,
    pub built_in_weapon_count: usize,
    pub built_in_wing_count: usize,
    pub weapon_slot_change_count: usize,
    pub engine_slot_change_count: usize,
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use super::*;
    use serde_json::json;

    #[test]
    fn config_file_entity_payload_requires_explicit_nullable_previous_id() {
        let result = serde_json::from_value::<JsonFileSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "nextId": "demo",
            "document": file_formats::json_write(&json!({"id":"demo"})), "jsonWrite": {}
        }));

        assert!(result.is_err());
    }

    #[test]
    fn config_file_entity_payload_requires_explicit_nullable_rel_path() {
        let result = serde_json::from_value::<JsonFileSave>(json!({
            "baseVersions": [], "sessionId":"session-1", "modRoot":"D:/mods/demo", "previousId":null,
            "nextId":"demo", "document":file_formats::json_write(&json!({"id":"demo"})),"jsonWrite":{}
        }));
        assert!(result.is_err());
        let payload = serde_json::from_value::<JsonFileSave>(json!({
                "baseVersions": [], "sessionId":"session-1", "modRoot":"D:/mods/demo", "previousId":null,
                "nextId":"demo", "relPath":null, "document":file_formats::json_write(&json!({"id":"demo"})),"jsonWrite":{}
            }))
            .unwrap();
        assert!(payload.rel_path.is_none());
    }

    #[test]
    fn json_entity_requests_keep_explicit_source_and_default_json_options() {
        let value = json!({"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","previousId":null,"nextId":"demo","relPath":null,"document":file_formats::json_write(&json!({"variantId":"demo"})),"jsonWrite":{}});
        let payload: JsonFileSave = serde_json::from_value(value.clone()).unwrap();
        assert!(payload.previous_id.is_none());
        assert!(payload.rel_path.is_none());
        assert!(!payload.json_write.preserve_structure);
        assert_eq!(
            payload.document.content.to_json().unwrap()["variantId"],
            "demo"
        );
        for field in ["previousId", "relPath"] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<JsonFileSave>(missing).is_err());
        }
    }
}
