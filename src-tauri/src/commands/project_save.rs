use crate::{errors::AppError, services};

#[command_macros::command]
pub async fn save_project(
    window: tauri::WebviewWindow,
    request: crate::models::SaveRequest,
) -> Result<crate::models::WriteResult<serde_json::Value>, AppError> {
    services::project_save::submit_project_save(window.label().to_owned(), request).await
}
