use crate::{
    errors::AppResult,
    models::{CommittedSessionUpdate, FileChangeRecord},
};

pub(super) fn project_commit(
    root: &str,
    session_id: Option<&str>,
    changes: &[FileChangeRecord],
) -> AppResult<Vec<CommittedSessionUpdate>> {
    let affected = if changes.is_empty() {
        session_id
            .map(|id| {
                crate::services::project::current_projection(id)
                    .map(|projection| vec![(id.to_string(), projection.manifest.mod_root)])
            })
            .transpose()?
            .unwrap_or_default()
    } else {
        crate::services::project::affected_session_ids(changes)?
    };
    affected
        .into_iter()
        .map(|(session_id, mod_root)| {
            let projection = crate::io::retry_write(root, || {
                let result = if changes.is_empty() {
                    crate::services::project::current_projection(&session_id)
                } else {
                    crate::services::project::invalidate_project_session(
                        &session_id,
                        changes.to_vec(),
                    )
                };
                if result.is_err() {
                    crate::services::project::mark_projection_pending(&session_id)?;
                }
                result
            })?;
            Ok(CommittedSessionUpdate {
                session_id,
                mod_root,
                projection: std::sync::Arc::new(projection),
            })
        })
        .collect()
}
