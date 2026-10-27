use crate::errors::ErrorDiagnostic;
use crate::models::{
    FileChangeRecord, FileHistorySnapshot, FileVersion, ProjectInvalidation, push_unique_all,
};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowKeyMapping {
    pub previous_key: String,
    pub next_key: String,
    pub row_index: usize,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWriteOptions {
    #[serde(default)]
    pub preserve_original_json: bool,
    #[serde(default)]
    pub confirmed_sources: Vec<JsonSourceConfirmation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceConfirmation {
    pub path: String,
    pub source_fingerprint: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteContentTarget {
    Spec {
        target: Box<super::EntityEditTarget>,
    },
    Text {
        path: String,
    },
    Json {
        origin: super::JsonDocumentOrigin,
    },
    Joint {
        root: super::JointEditRoot,
    },
    Recovery {
        origin: super::JsonDocumentOrigin,
    },
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteContent<T> {
    pub target: WriteContentTarget,
    pub value: T,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult<T = ()> {
    pub session_updates: Vec<CommittedSessionUpdate>,
    pub identity_changes: Vec<crate::models::EntityIdentityChange>,
    pub changes: Vec<FileChangeRecord>,
    pub invalidation: ProjectInvalidation,
    pub key_map: Vec<CsvRowKeyMapping>,
    pub content: Option<WriteContent<T>>,
    pub commit_id: u64,
    pub base_versions: Vec<FileVersion>,
    pub history: FileHistorySnapshot,
}

impl<T> WriteResult<T> {
    pub fn with_content<U>(self, target: WriteContentTarget, value: U) -> WriteResult<U> {
        WriteResult {
            session_updates: self.session_updates,
            identity_changes: self.identity_changes,
            changes: self.changes,
            invalidation: self.invalidation,
            key_map: self.key_map,
            content: Some(WriteContent { target, value }),
            commit_id: self.commit_id,
            base_versions: self.base_versions,
            history: self.history,
        }
    }
    pub fn new(
        changes: Vec<FileChangeRecord>,
        key_map: Vec<CsvRowKeyMapping>,
        content: Option<WriteContent<T>>,
    ) -> Self {
        let invalidation = ProjectInvalidation {
            paths: changed_paths_for_changes(&changes),
            ..ProjectInvalidation::default()
        };
        Self {
            session_updates: Vec::new(),
            identity_changes: Vec::new(),
            changes,
            invalidation,
            key_map,
            content,
            commit_id: 0,
            base_versions: Vec::new(),
            history: FileHistorySnapshot::default(),
        }
    }
}

impl WriteResult<()> {
    pub fn from_changes(changes: Vec<FileChangeRecord>) -> Self {
        Self::new(changes, Vec::new(), None)
    }
}

impl<T> WriteResult<T> {
    pub fn from_content(
        changes: Vec<FileChangeRecord>,
        target: WriteContentTarget,
        value: T,
    ) -> Self {
        Self::new(changes, Vec::new(), Some(WriteContent { target, value }))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum CommittedProjection {
    Ready {
        projection: std::sync::Arc<super::ProjectSessionInvalidationResult>,
    },
    Pending {
        error: ErrorDiagnostic,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommittedSessionUpdate {
    pub session_id: String,
    pub mod_root: String,
    pub commit_id: u64,
    #[serde(flatten)]
    pub projection: CommittedProjection,
}

fn changed_paths_for_changes(changes: &[FileChangeRecord]) -> Vec<String> {
    let mut paths = Vec::new();
    for change in changes {
        push_unique_all(
            &mut paths,
            vec![change.before_path.clone(), change.after_path.clone()],
        );
        for (path, files) in [
            (&change.before_path, &change.before_files),
            (&change.after_path, &change.after_files),
        ] {
            for file in files {
                push_unique_all(
                    &mut paths,
                    vec![
                        Path::new(path)
                            .join(&file.rel_path)
                            .to_string_lossy()
                            .to_string(),
                    ],
                );
            }
        }
    }
    paths
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SynchronizeCommittedWritePayload {
    pub session_id: String,
    pub mod_root: String,
    pub commit_id: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::fs;

    #[test]
    fn json_write_options_keep_missing_field_defaults() {
        for value in [
            json!({}),
            json!({"preserveOriginalJson":false}),
            json!({"confirmedSources":[]}),
        ] {
            let options: JsonWriteOptions = serde_json::from_value(value).unwrap();
            assert!(!options.preserve_original_json);
            assert!(options.confirmed_sources.is_empty());
        }
        let options: JsonWriteOptions =
            serde_json::from_value(json!({"preserveOriginalJson":true})).unwrap();
        assert!(options.preserve_original_json);
        assert!(options.confirmed_sources.is_empty());
    }

    #[test]
    fn committed_projection_states_keep_the_flat_wire_shape() {
        let manifest = json!({
            "baseVersions":[], "sessionId":"s", "modRoot":"M:/mod", "starsectorRoot":null,
            "coreAvailable":false, "associatedSpecTables":[], "modInfo":null,
            "tableSummaries":{}, "tableEntitySummaries":{}, "warnings":[],
            "entitySummaries":{"factions":0,"missions":0,"ships":0,"weapons":0,"projectiles":0,"variants":0,"skins":0,"systems":0,"skills":0}
        });
        let invalidation = json!({"paths":[],"tables":[],"entities":[],"resources":[],"queryScopes":[],"session":false});
        for value in [
            json!({"sessionId":"s","modRoot":"M:/mod","commitId":3,"status":"ready","projection":{"projectionRevision":3,"manifest":manifest,"invalidation":invalidation}}),
            json!({"sessionId":"s","modRoot":"M:/mod","commitId":3,"status":"pending","error":{"code":"project.scan_failed","message":"Source unavailable","location":null}}),
        ] {
            let update: CommittedSessionUpdate = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(update).unwrap(), value);
        }
    }

    #[test]
    fn write_result_serializes_current_model_shape() {
        let result: WriteResult<()> = WriteResult::new(Vec::new(), Vec::new(), None);
        let serialized = serde_json::to_value(&result).unwrap();
        let object = serialized.as_object().unwrap();
        let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "baseVersions",
                "changes",
                "commitId",
                "content",
                "history",
                "identityChanges",
                "invalidation",
                "keyMap",
                "sessionUpdates"
            ]
        );
        assert!(serialized.get("invalidation").is_some());
        assert_eq!(result.invalidation.paths, [] as [&str; 0]);
        assert!(result.content.is_none());
    }

    #[test]
    fn write_result_expands_directory_change_invalidation_paths() {
        let root = crate::testutil::temp_dir("directory_invalidation_paths");
        let dir = root.join("data/variants/nested");
        std::fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("demo.variant"), "{}").unwrap();

        let change = crate::io::build_directory_delete_change(&dir).unwrap();
        let result = WriteResult::from_changes(vec![change]);

        assert!(
            result
                .invalidation
                .paths
                .iter()
                .any(|path| path_string(path) == path_string(&dir))
        );
        assert!(
            result
                .invalidation
                .paths
                .iter()
                .any(|path| { path_string(path) == path_string(dir.join("demo.variant")) })
        );
        let _ = fs::remove_dir_all(root);
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        path.as_ref()
            .canonicalize()
            .unwrap_or_else(|_| path.as_ref().to_path_buf())
            .to_string_lossy()
            .to_string()
    }

    #[test]
    fn synchronization_requests_keep_the_original_commit_identity() {
        let payload: SynchronizeCommittedWritePayload =
            serde_json::from_value(json!({"sessionId":"session","modRoot":"M:/mod","commitId":7}))
                .unwrap();
        assert_eq!(payload.session_id, "session");
        assert_eq!(payload.mod_root, "M:/mod");
        assert_eq!(payload.commit_id, 7);
    }

    #[test]
    fn content_owner_survives_value_projection() {
        let target = WriteContentTarget::Text {
            path: "M:/mod/notes.txt".into(),
        };
        let receipt = WriteResult::from_content(Vec::new(), target.clone(), "text");
        let receipt = receipt.with_content(target, json!({"text":"text"}));
        assert_eq!(
            serde_json::to_value(receipt).unwrap()["content"],
            json!({"target":{"kind":"text","path":"M:/mod/notes.txt"},"value":{"text":"text"}})
        );
    }
}
