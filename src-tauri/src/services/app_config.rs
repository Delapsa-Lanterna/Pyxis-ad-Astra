use crate::{
    errors::{AppError, AppResult},
    services::{app_paths, system_open},
};
use std::fs;

pub fn open_config_dir(app_handle: tauri::AppHandle) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    fs::create_dir_all(&app_data).map_err(|error| {
        AppError::context(
            format!("创建配置目录失败 ({})", app_data.display()),
            error.into(),
        )
    })?;
    system_open::open_path(&app_data)
}
