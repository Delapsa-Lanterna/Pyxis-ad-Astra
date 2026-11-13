use crate::errors::AppResult;
use crate::io;
use crate::models::{
    CommittedSessionUpdate, FileChangeRecord, ProjectInvalidation, SessionContentUpdate,
};
use crate::services::project;
use std::sync::Arc;

pub(super) fn refresh_committed_sessions(
    root: &str,
    session_id: Option<&str>,
    changes: &[FileChangeRecord],
) -> AppResult<Vec<CommittedSessionUpdate>> {
    let affected = if changes.is_empty() {
        session_id
            .map(|id| {
                project::current_project_manifest(id)
                    .map(|manifest| vec![(id.to_string(), manifest.mod_root)])
            })
            .transpose()?
            .unwrap_or_default()
    } else {
        project::affected_session_ids(changes)?
    };
    affected
        .into_iter()
        .map(|(session_id, mod_root)| {
            let update = io::retry_write(root, || {
                let result = if changes.is_empty() {
                    project::current_project_manifest(&session_id).map(|manifest| {
                        SessionContentUpdate {
                            manifest,
                            invalidation: ProjectInvalidation::default(),
                        }
                    })
                } else {
                    project::invalidate_project_session(&session_id, changes)
                };
                if result.is_err() {
                    project::mark_session_pending(&session_id)?;
                }
                result
            })?;
            Ok(CommittedSessionUpdate {
                session_id,
                mod_root,
                content: Arc::new(update),
            })
        })
        .collect()
}
