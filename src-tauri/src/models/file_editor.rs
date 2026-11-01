use super::ProjectSessionId;
use super::serde_fields::deserialize_nullable;
use crate::models::{
    EntityEditInfo, EntityEditTarget, EntityKind, FileVersion, JsonWriteOptions, project_identity,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EditableFileData {
    pub entity: Option<EntityEditInfo>,
    pub path: String,
    pub text: String,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSave {
    #[serde(default)]
    pub json_write: JsonWriteOptions,
    pub base_versions: Vec<FileVersion>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTranscode {
    pub base_versions: Vec<FileVersion>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
    pub encoding: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadEditableFilePayload {
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextIdentityIntentPayload {
    pub session_id: ProjectSessionId,
    pub source: EntityEditTarget,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowTextIdentityPayload {
    pub kind: EntityKind,
    pub text: String,
    pub next_id: String,
}

project_identity::impl_session_mod_scope_optional!(
    TextSave,
    LoadEditableFilePayload,
    TextTranscode
);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn save_text_file_payload_requires_mod_root() {
        let result = serde_json::from_value::<TextSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "path": "D:/mods/demo/mod_info.json",
            "text": "{}"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn save_text_file_payload_requires_session_id() {
        let result = serde_json::from_value::<TextSave>(json!({
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json",
            "text": "{}"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn save_text_file_payload_accepts_explicit_null_session_id() {
        let payload = serde_json::from_value::<TextSave>(json!({
            "baseVersions": [],
            "sessionId": null,
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json",
            "text": "{}"
        }))
        .unwrap();

        assert_eq!(payload.session_id, None);
    }

    #[test]
    fn load_editable_file_payload_requires_mod_root() {
        let result = serde_json::from_value::<LoadEditableFilePayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "path": "D:/mods/demo/mod_info.json"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn load_editable_file_payload_requires_session_id_field() {
        let result = serde_json::from_value::<LoadEditableFilePayload>(json!({
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn load_editable_file_payload_accepts_explicit_null_session_id() {
        let payload = serde_json::from_value::<LoadEditableFilePayload>(json!({
            "baseVersions": [],
            "sessionId": null,
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json"
        }))
        .unwrap();

        assert_eq!(payload.session_id, None);
    }
}
