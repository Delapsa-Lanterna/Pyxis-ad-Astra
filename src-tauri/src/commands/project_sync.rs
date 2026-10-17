use crate::{
    errors::AppError,
    models::{
        CommittedSessionUpdate, InvalidateProjectSessionPayload, ProjectSessionInvalidationResult,
        RefreshProjectSourcesPayload, SynchronizeCommittedWritePayload,
    },
    services,
};

#[tauri::command(async)]
pub fn synchronize_committed_write(
    payload: SynchronizeCommittedWritePayload,
) -> Result<CommittedSessionUpdate, AppError> {
    services::write_transactions::synchronize_committed_write(
        &payload.session_id,
        &payload.mod_root,
        payload.commit_id,
    )
}

#[tauri::command(async)]
pub fn invalidate_project_session(
    payload: InvalidateProjectSessionPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    services::project::invalidate_project_session(&payload.session_id, payload.changes)
}

#[tauri::command(async)]
pub fn refresh_project_sources(
    payload: RefreshProjectSourcesPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    services::project::refresh_project_sources(&payload.session_id, payload.sources)
}
