use crate::errors::AppError;
use crate::models::{SaveRequest, WriteResult};
use crate::services::project_save;
use serde_json::Value;
use tauri::WebviewWindow;

#[command_macros::command]
pub async fn save_project(
    window: WebviewWindow,
    request: SaveRequest,
) -> Result<WriteResult<Value>, AppError> {
    project_save::submit_project_save(window.label().to_owned(), request).await
}
