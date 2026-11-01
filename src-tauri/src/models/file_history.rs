use super::{FileChangeReplayDirection, ProjectSessionId};
use crate::models::project_identity;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryEntrySummary {
    pub id: u64,
    pub label: String,
    pub timestamp: i64,
    pub paths: Vec<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistorySnapshot {
    pub revision: u64,
    pub undo_stack: Vec<FileHistoryEntrySummary>,
    pub redo_stack: Vec<FileHistoryEntrySummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReplay {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub direction: FileChangeReplayDirection,
    pub entry_id: u64,
    pub revision: u64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileHistoryPayload {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
}

project_identity::impl_session_mod_scope_required!(FileReplay);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn history_snapshots_deliver_entry_summaries() {
        let value = json!({"revision":4,"undoStack":[{"id":2,"label":"Save","timestamp":100,"paths":["M:/mod/demo.ship"]}],"redoStack":[]});
        let snapshot: FileHistorySnapshot = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(snapshot).unwrap(), value);
    }

    #[test]
    fn apply_file_change_set_payload_requires_mod_root() {
        let result = serde_json::from_value::<FileReplay>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "direction": "undo",
            "changes": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn apply_file_change_set_payload_requires_session_id() {
        let result = serde_json::from_value::<FileReplay>(json!({
            "modRoot": "D:/mods/demo",
            "direction": "undo",
            "changes": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn replay_requests_require_entry_and_revision_instead_of_client_changes() {
        let value = json!({"sessionId":"session","modRoot":"M:/mod","direction":"undo","entryId":4,"revision":2});
        let payload: FileReplay = serde_json::from_value(value.clone()).unwrap();
        assert_eq!(payload.entry_id, 4);
        assert_eq!(payload.revision, 2);
        for field in ["entryId", "revision"] {
            let mut missing = value.clone();
            missing.as_object_mut().unwrap().remove(field);
            assert!(serde_json::from_value::<FileReplay>(missing).is_err());
        }
    }
}
