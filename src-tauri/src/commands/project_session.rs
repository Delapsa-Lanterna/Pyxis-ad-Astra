use crate::{
    errors::AppError,
    models::{CloseProjectSessionPayload, OpenProjectSessionPayload, ProjectManifest},
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

#[command_macros::command(async)]
pub fn close_project_session(payload: CloseProjectSessionPayload) -> Result<(), AppError> {
    services::project_session::release_project_session(payload.session_id)
}
