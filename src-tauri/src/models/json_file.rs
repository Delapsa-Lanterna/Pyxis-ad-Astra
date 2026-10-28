use super::{JsonWriteOptions, ProjectSessionId, required_nullable};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonFileSave {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    #[serde(deserialize_with = "required_nullable")]
    pub previous_id: Option<String>,
    pub next_id: String,
    pub data: Value,
    #[serde(deserialize_with = "required_nullable")]
    pub rel_path: Option<String>,
    #[serde(default)]
    pub json_write: JsonWriteOptions,
    #[serde(default)]
    pub ordered_json: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonFileDelete {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub entity_id: String,
    pub rel_path: String,
}

super::project_identity::impl_session_mod_scope_required!(JsonFileSave, JsonFileDelete);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VariantFile {
    pub variant_id: String,
    pub hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub weapon_group_count: usize,
    pub hull_mod_count: usize,
    pub perma_mod_count: usize,
    pub wing_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkinFile {
    pub skin_hull_id: String,
    pub base_hull_id: String,
    pub path: String,
    pub rel_path: String,
    pub data: Value,
    pub built_in_mod_count: usize,
    pub built_in_weapon_count: usize,
    pub built_in_wing_count: usize,
    pub weapon_slot_change_count: usize,
    pub engine_slot_change_count: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn config_file_entity_payload_requires_explicit_nullable_previous_id() {
        let result = serde_json::from_value::<JsonFileSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "D:/mods/demo",
            "nextId": "demo",
            "data": {"id": "demo"}
        }));

        assert!(result.is_err());
    }

    #[test]
    fn config_file_entity_payload_requires_explicit_nullable_rel_path() {
        let result = serde_json::from_value::<JsonFileSave>(json!({
            "baseVersions": [], "sessionId":"session-1", "modRoot":"D:/mods/demo", "previousId":null,
            "nextId":"demo", "data":{"id":"demo"}
        }));
        assert!(result.is_err());
        let payload = serde_json::from_value::<JsonFileSave>(json!({
            "baseVersions": [], "sessionId":"session-1", "modRoot":"D:/mods/demo", "previousId":null,
            "nextId":"demo", "relPath":null, "data":{"id":"demo"}
        }))
        .unwrap();
        assert!(payload.rel_path.is_none());
    }

    #[test]
    fn json_entity_requests_keep_explicit_source_and_default_json_options() {
        let value = json!({"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","previousId":null,"nextId":"demo","relPath":null,"data":{"variantId":"demo"}});
        let payload: JsonFileSave = serde_json::from_value(value.clone()).unwrap();
        assert!(payload.previous_id.is_none());
        assert!(payload.rel_path.is_none());
        assert!(!payload.json_write.preserve_original_json);
        assert!(payload.ordered_json.is_none());
        for field in ["previousId", "relPath"] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<JsonFileSave>(missing).is_err());
        }
    }
}
