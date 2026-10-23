use crate::{
    errors::AppError,
    models::{AppLogStatus, AppendAppLogsPayload},
    services,
};

#[tauri::command(async)]
pub fn append_app_logs(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    payload: AppendAppLogsPayload,
) -> Result<(), AppError> {
    services::app_log::append_app_logs(app_handle, window.label(), payload.entries)
}

#[tauri::command(async)]
pub fn stop_app_log(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    message: String,
    dropped: u64,
) -> Result<(), AppError> {
    services::app_log::stop_app_log(&app_handle, window.label(), message, dropped)
}

#[tauri::command(async)]
pub fn get_app_log_status(app_handle: tauri::AppHandle) -> Result<AppLogStatus, AppError> {
    services::app_log::app_log_status(app_handle)
}

#[tauri::command(async)]
pub fn clear_app_log_file(app_handle: tauri::AppHandle) -> Result<AppLogStatus, AppError> {
    services::app_log::clear_app_log_file(app_handle)
}
