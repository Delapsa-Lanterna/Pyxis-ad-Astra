use crate::errors::AppError;
use crate::models::AppSettings;
use crate::services::app_settings;

#[command_macros::command]
pub fn read_default_settings() -> AppSettings {
    AppSettings::default()
}

#[command_macros::command(async)]
pub fn query_system_fonts() -> Result<Vec<String>, AppError> {
    app_settings::query_system_fonts()
}
