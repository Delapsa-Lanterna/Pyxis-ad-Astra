use crate::errors::AppError;
use crate::models::{MiscConfigEntry, MiscConfigFile, MiscConfigRead, MiscConfigScope};
use crate::services::{misc_config, project_session};

#[command_macros::command(async)]
pub fn query_misc_config_files(payload: MiscConfigScope) -> Result<Vec<MiscConfigEntry>, AppError> {
    project_session::ensure_session_mod_scope(&payload)?;
    misc_config::query_misc_config_files(&payload.mod_root)
}
#[command_macros::command(async)]
pub fn query_misc_config_file(payload: MiscConfigRead) -> Result<Option<MiscConfigFile>, AppError> {
    project_session::ensure_session_mod_scope(&payload)?;
    misc_config::query_project_misc_config(payload)
}
