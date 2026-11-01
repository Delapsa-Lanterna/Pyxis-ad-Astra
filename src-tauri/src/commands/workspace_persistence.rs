use crate::errors::AppError;
use crate::models::{PersistedWorkspace, SaveWorkspacePayload};
use crate::services::workspace_persistence;
use tauri::AppHandle;

#[command_macros::command(async)]
pub fn load_workspace(app_handle: AppHandle) -> Result<PersistedWorkspace, AppError> {
    workspace_persistence::load_app_workspace(app_handle)
}

#[command_macros::command(async)]
pub fn save_workspace(
    app_handle: AppHandle,
    payload: SaveWorkspacePayload,
) -> Result<(), AppError> {
    workspace_persistence::save_app_workspace(app_handle, payload.state)
}
