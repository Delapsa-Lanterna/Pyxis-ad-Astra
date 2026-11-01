use super::collections::push_unique_all;
use crate::errors::ErrorDiagnostic;
use crate::models::{
    CsvTableKey, EntityEditTarget, EntityIdentityChange, FileChangeRecord, FileHistorySnapshot,
    FileVersion, JointEditRoot, JsonDocumentOrigin, ProjectInvalidation,
    ProjectSessionInvalidationResult, ReferenceSources,
};
#[cfg(test)]
use crate::test_support::TestWorkspace;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveDelivery {
    References {
        snapshot: ReferenceSources,
        event: Option<Value>,
    },
    Missing {
        #[serde(rename = "requestId")]
        request_id: String,
        paths: Vec<String>,
    },
    Saved {
        #[serde(rename = "requestId")]
        request_id: String,
        event: Value,
    },
    Waiting {
        #[serde(rename = "modRoot")]
        mod_root: String,
        waiting: bool,
    },
    Blocked {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "modRoot")]
        mod_root: String,
        #[serde(rename = "sessionId")]
        session_id: Option<String>,
        diagnostic: ErrorDiagnostic,
    },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SaveEdit {
    Set { path: Vec<String>, value: Value },
    Remove { path: Vec<String> },
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowKeyMapping {
    pub previous_key: String,
    pub next_key: String,
    pub row_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WriteContentTarget {
    Csv { table: CsvTableKey },
    Spec { target: Box<EntityEditTarget> },
    Text { path: String },
    Json { origin: JsonDocumentOrigin },
    Joint { root: JointEditRoot },
    Recovery { origin: JsonDocumentOrigin },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteContent<T> {
    pub target: WriteContentTarget,
    pub value: T,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteResult<T = ()> {
    pub session_updates: Vec<CommittedSessionUpdate>,
    pub identity_changes: Vec<EntityIdentityChange>,
    pub changes: Vec<FileChangeRecord>,
    pub invalidation: ProjectInvalidation,
    pub key_map: Vec<CsvRowKeyMapping>,
    pub content: Option<WriteContent<T>>,
    pub base_versions: Vec<FileVersion>,
    pub history: FileHistorySnapshot,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommittedWriteEvent<'a, T> {
    pub origin_window_label: &'a str,
    pub mod_root: &'a str,
    pub session_id: Option<&'a str>,
    pub reason: &'a str,
    pub result: &'a WriteResult<T>,
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
#[serde(rename_all = "camelCase")]
pub struct CommittedSessionUpdate {
    pub session_id: String,
    pub mod_root: String,
    pub projection: Arc<ProjectSessionInvalidationResult>,
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

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::errors::AppError;
    #[cfg(test)]
    use crate::io;
    use serde_json::json;
    use std::fs;

    #[test]
    fn committed_projection_states_keep_the_flat_wire_shape() {
        let manifest = json!({
            "baseVersions":[], "sessionId":"s", "modRoot":"M:/mod", "starsectorRoot":null,
            "coreAvailable":false, "associatedSpecTables":[], "modInfo":null,
            "tableSummaries":{}, "tableEntitySummaries":{}, "warnings":[],
            "entitySummaries":{"factions":0,"missions":0,"ships":0,"weapons":0,"projectiles":0,"variants":0,"skins":0,"systems":0,"skills":0}
        });
        let invalidation = json!({"paths":[],"tables":[],"entities":[],"resources":[],"queryScopes":[],"session":false});
        let value = json!({"sessionId":"s","modRoot":"M:/mod","projection":{"manifest":manifest,"invalidation":invalidation}});
        let update: CommittedSessionUpdate = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(update).unwrap(), value);
        let blocked = SaveDelivery::Blocked {
            request_id: "request".into(),
            mod_root: "M:/mod".into(),
            session_id: Some("s".into()),
            diagnostic: AppError::message("project.scan_failed", "Source unavailable").diagnostic(),
        };
        assert_eq!(
            serde_json::to_value(blocked).unwrap()["diagnostic"],
            json!({"code":"project.scan_failed","message":"Source unavailable","location":null})
        );
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
        let root = TestWorkspace::new("directory_invalidation_paths");
        let dir = root.join("data/variants/nested");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("demo.variant"), "{}").unwrap();

        let change = io::build_directory_delete_change(&dir).unwrap();
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
        root.close().unwrap();
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        path.as_ref()
            .canonicalize()
            .unwrap_or_else(|_| path.as_ref().to_path_buf())
            .to_string_lossy()
            .to_string()
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
