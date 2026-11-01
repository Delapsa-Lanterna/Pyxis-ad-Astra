use crate::app_data_dir;
use crate::errors::{AppError, AppResult};
use crate::services::system_open;
use std::fs;
use tauri::AppHandle;

pub fn open_config_dir(app_handle: AppHandle) -> AppResult<()> {
    let app_data = app_data_dir::data_directory(app_handle)?;
    fs::create_dir_all(&app_data).map_err(|error| {
        AppError::context(
            format!("创建配置目录失败 ({})", app_data.display()),
            error.into(),
        )
    })?;
    system_open::open_path(&app_data)
}
