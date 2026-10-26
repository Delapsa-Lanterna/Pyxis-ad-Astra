use crate::{errors::AppError, services};

#[command_macros::command]
pub fn read_default_settings() -> crate::models::AppSettings {
    crate::models::AppSettings::default()
}

#[command_macros::command(async)]
pub fn query_system_fonts() -> Result<Vec<String>, AppError> {
    services::app_settings::query_system_fonts()
}
