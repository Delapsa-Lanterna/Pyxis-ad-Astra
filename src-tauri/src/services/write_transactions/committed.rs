use crate::errors::AppResult;
use crate::io;
use crate::models::{CommittedSessionUpdate, FileChangeRecord};
use crate::services::project;
use std::sync::Arc;

pub(super) fn project_commit(
    root: &str,
    session_id: Option<&str>,
    changes: &[FileChangeRecord],
) -> AppResult<Vec<CommittedSessionUpdate>> {
    let affected = if changes.is_empty() {
        session_id
            .map(|id| {
                project::current_projection(id)
                    .map(|projection| vec![(id.to_string(), projection.manifest.mod_root)])
            })
            .transpose()?
            .unwrap_or_default()
    } else {
        project::affected_session_ids(changes)?
    };
    affected
        .into_iter()
        .map(|(session_id, mod_root)| {
            let projection = io::retry_write(root, || {
                let result = if changes.is_empty() {
                    project::current_projection(&session_id)
                } else {
                    project::invalidate_project_session(&session_id, changes.to_vec())
                };
                if result.is_err() {
                    project::mark_projection_pending(&session_id)?;
                }
                result
            })?;
            Ok(CommittedSessionUpdate {
                session_id,
                mod_root,
                projection: Arc::new(projection),
            })
        })
        .collect()
}
