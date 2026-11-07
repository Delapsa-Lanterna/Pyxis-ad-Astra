use crate::errors::AppError;
use crate::models::{
    FileDirectory, FileDirectoryPayload, FileSearch, FileSearchPayload, FileTextPayload,
    FileTextTarget,
};
use crate::services;

#[command_macros::command(async)]
pub fn query_file_directory(payload: FileDirectoryPayload) -> Result<FileDirectory, AppError> {
    services::query_file_directory(&payload.session_id, payload.directory.as_deref())
}
#[command_macros::command(async)]
pub fn query_file_text_target(
    payload: FileTextPayload,
) -> Result<Option<FileTextTarget>, AppError> {
    services::query_file_text_target(&payload.session_id, &payload.rel_path)
}

#[command_macros::command(async)]
pub fn query_file_search(payload: FileSearchPayload) -> Result<FileSearch, AppError> {
    services::query_file_search(&payload.session_id, &payload.query)
}
