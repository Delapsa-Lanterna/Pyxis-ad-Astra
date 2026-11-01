use crate::errors::{AppError, AppResult};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub fn data_directory(app_handle: AppHandle) -> AppResult<PathBuf> {
    app_handle
        .path()
        .app_data_dir()
        .map_err(|error| AppError::message("desktop.data_directory_unavailable", error.to_string()))
}
