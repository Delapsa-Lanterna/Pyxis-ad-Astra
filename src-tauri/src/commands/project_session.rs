use crate::errors::AppError;
use crate::models::{OpenProjectSessionPayload, ProjectManifest};
use crate::services::project_session;
use tauri::AppHandle;

#[command_macros::command(async)]
pub fn open_project_session(
    app_handle: AppHandle,
    payload: OpenProjectSessionPayload,
) -> Result<ProjectManifest, AppError> {
    project_session::open_project_session_with_root(
        app_handle,
        payload.mod_root,
        payload.starsector_root,
    )
}
