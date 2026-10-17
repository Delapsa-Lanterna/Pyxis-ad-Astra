use crate::{errors::AppError, services};

#[tauri::command(async)]
pub fn open_config_dir(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    services::app_config::open_config_dir(app_handle)
}
