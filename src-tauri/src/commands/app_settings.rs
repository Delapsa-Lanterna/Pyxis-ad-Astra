use crate::{errors::AppError, services};

#[tauri::command(async)]
pub fn query_system_fonts() -> Result<Vec<String>, AppError> {
    services::app_settings::query_system_fonts()
}
