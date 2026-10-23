use crate::{errors::AppError, services};

#[tauri::command]
pub fn read_default_settings() -> crate::models::AppSettings {
    crate::models::AppSettings::default()
}

#[tauri::command(async)]
pub fn query_system_fonts() -> Result<Vec<String>, AppError> {
    services::app_settings::query_system_fonts()
}
