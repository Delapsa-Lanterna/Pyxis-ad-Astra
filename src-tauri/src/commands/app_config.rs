use crate::errors::AppError;
use crate::services::app_config;
use tauri::AppHandle;

#[command_macros::command(async)]
pub fn open_config_dir(app_handle: AppHandle) -> Result<(), AppError> {
    app_config::open_config_dir(app_handle)
}
