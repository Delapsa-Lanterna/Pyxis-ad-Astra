use super::ProjectSessionId;
use super::serde_fields::deserialize_nullable;
use crate::errors::ErrorDiagnostic;
use crate::models::{EntityTargetSnapshot, FileVersion, project_identity};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileOpen {
    pub path: String,
    pub line: Option<u64>,
    pub column: Option<u64>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TextFileOpenResult {
    pub path: String,
    pub diagnostic: Option<ErrorDiagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextFileData {
    pub entity: Option<EntityTargetSnapshot>,
    pub path: String,
    pub text: String,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextSave {
    pub base_versions: Vec<FileVersion>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
    pub text: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBatchSave {
    pub base_versions: Vec<FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub files: Vec<TextFileWrite>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct TextFileWrite {
    pub path: String,
    pub target: Option<String>,
    pub text: String,
}
project_identity::impl_session_mod_scope_required!(TextBatchSave);

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadTextFilePayload {
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
}

project_identity::impl_session_mod_scope_optional!(TextSave, LoadTextFilePayload);

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
    fn load_text_file_payload_requires_mod_root() {
        let result = serde_json::from_value::<LoadTextFilePayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "path": "D:/mods/demo/mod_info.json"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn load_text_file_payload_requires_session_id_field() {
        let result = serde_json::from_value::<LoadTextFilePayload>(json!({
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn load_text_file_payload_accepts_explicit_null_session_id() {
        let payload = serde_json::from_value::<LoadTextFilePayload>(json!({
            "baseVersions": [],
            "sessionId": null,
            "modRoot": "D:/mods/demo",
            "path": "D:/mods/demo/mod_info.json"
        }))
        .unwrap();

        assert_eq!(payload.session_id, None);
    }
}
