use crate::{
    errors::AppError,
    models::{PersistedWorkspace, SaveWorkspacePayload},
    services,
};

#[command_macros::command(async)]
pub fn load_workspace(app_handle: tauri::AppHandle) -> Result<PersistedWorkspace, AppError> {
    services::workspace_persistence::load_app_workspace(app_handle)
}

#[command_macros::command(async)]
pub fn save_workspace(
    app_handle: tauri::AppHandle,
    payload: SaveWorkspacePayload,
) -> Result<(), AppError> {
    services::workspace_persistence::save_app_workspace(app_handle, payload.state)
}
