use crate::{
    errors::AppError,
    models::{ApplyFileChangeSetPayload, FileHistoryPayload, FileHistorySnapshot, WriteResult},
    services,
};

#[command_macros::command(async)]
pub fn apply_file_change_set(payload: ApplyFileChangeSetPayload) -> Result<WriteResult, AppError> {
    services::write_transactions::replay(
        &payload.session_id,
        &payload.mod_root,
        payload.direction,
        payload.entry_id,
        payload.revision,
    )
}

#[command_macros::command(async)]
pub fn query_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    services::write_transactions::query_history(&payload.session_id, &payload.mod_root)
}

#[command_macros::command(async)]
pub fn clear_file_history(payload: FileHistoryPayload) -> Result<FileHistorySnapshot, AppError> {
    services::write_transactions::clear_history(&payload.session_id, &payload.mod_root)
}
