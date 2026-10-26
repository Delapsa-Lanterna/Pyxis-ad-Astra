use crate::{errors::AppError, services};

#[command_macros::command(async)]
pub fn open_config_dir(app_handle: tauri::AppHandle) -> Result<(), AppError> {
    services::app_config::open_config_dir(app_handle)
}
