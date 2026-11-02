use crate::errors::AppError;
use crate::models::{FileHistoryPayload, FileHistorySnapshot};
use crate::services::file_history;

#[command_macros::command(async)]
pub fn query_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    file_history::query_file_history(&payload.session_id, &payload.mod_root)
}

#[command_macros::command(async)]
pub fn clear_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    file_history::clear_file_history(&payload.session_id, &payload.mod_root)
}
