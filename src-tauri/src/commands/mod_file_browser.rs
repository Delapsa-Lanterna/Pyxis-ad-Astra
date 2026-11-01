use crate::errors::AppError;
use crate::models::{
    ModDirectory, ModDirectoryPayload, ModFileSearch, ModFileSearchPayload, ModTextFilePayload,
    ModTextFileTarget,
};
use crate::services;

#[command_macros::command(async)]
pub fn query_mod_directory(payload: ModDirectoryPayload) -> Result<ModDirectory, AppError> {
    services::query_mod_directory(&payload.session_id, payload.directory.as_deref())
}
#[command_macros::command(async)]
pub fn query_mod_text_file_target(
    payload: ModTextFilePayload,
) -> Result<Option<ModTextFileTarget>, AppError> {
    services::query_mod_text_file_target(&payload.session_id, &payload.rel_path)
}

#[command_macros::command(async)]
pub fn query_mod_file_search(payload: ModFileSearchPayload) -> Result<ModFileSearch, AppError> {
    services::query_mod_file_search(&payload.session_id, &payload.query)
}
