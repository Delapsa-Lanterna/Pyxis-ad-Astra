use crate::{
    errors::AppError,
    models::{OpenProjectSessionPayload, ProjectManifest},
    services,
};

#[command_macros::command(async)]
pub fn open_project_session(
    app_handle: tauri::AppHandle,
    payload: OpenProjectSessionPayload,
) -> Result<ProjectManifest, AppError> {
    services::project_session::open_project_session_with_root(
        app_handle,
        payload.mod_root,
        payload.starsector_root,
    )
}
