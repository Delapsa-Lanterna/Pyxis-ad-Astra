use crate::{
    errors::AppError,
    models::{MiscConfigEntry, MiscConfigFile, MiscConfigRead, MiscConfigScope},
    services,
};

#[command_macros::command(async)]
pub fn query_misc_config_files(payload: MiscConfigScope) -> Result<Vec<MiscConfigEntry>, AppError> {
    crate::services::project_session::ensure_session_mod_scope(&payload)?;
    services::misc_config::query_misc_config_files(&payload.mod_root)
}
#[command_macros::command(async)]
pub fn query_misc_config_file(payload: MiscConfigRead) -> Result<Option<MiscConfigFile>, AppError> {
    crate::services::project_session::ensure_session_mod_scope(&payload)?;
    services::misc_config::query_project_misc_config(payload)
}
