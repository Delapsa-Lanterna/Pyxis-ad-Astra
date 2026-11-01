use crate::errors::AppError;
use crate::models::{AppLogStatus, AppendAppLogsPayload};
use crate::services::app_log;
use tauri::{AppHandle, WebviewWindow};

#[command_macros::command(async)]
pub fn append_app_logs(
    app_handle: AppHandle,
    window: WebviewWindow,
    payload: AppendAppLogsPayload,
) -> Result<(), AppError> {
    app_log::append_app_logs(app_handle, window.label(), payload.entries)
}

#[command_macros::command(async)]
pub fn stop_app_log(
    app_handle: AppHandle,
    window: WebviewWindow,
    message: String,
    dropped: u64,
) -> Result<(), AppError> {
    app_log::stop_app_log(&app_handle, window.label(), message, dropped)
}

#[command_macros::command(async)]
pub fn get_app_log_status(app_handle: AppHandle) -> Result<AppLogStatus, AppError> {
    app_log::app_log_status(app_handle)
}

#[command_macros::command(async)]
pub fn clear_app_log_file(app_handle: AppHandle) -> Result<AppLogStatus, AppError> {
    app_log::clear_app_log_file(app_handle)
}
