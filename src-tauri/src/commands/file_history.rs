use crate::{
    errors::AppError,
    models::{FileHistoryPayload, FileHistorySnapshot},
    services,
};

#[command_macros::command(async)]
pub fn query_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    services::write_transactions::query_history(&payload.session_id, &payload.mod_root)
}

#[command_macros::command(async)]
pub fn clear_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    services::write_transactions::clear_history(&payload.session_id, &payload.mod_root)
}
