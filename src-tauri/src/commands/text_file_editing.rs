use crate::errors::AppError;
use crate::models::{LoadTextFilePayload, TextFileData};
use crate::services::text_file_editing;

#[command_macros::command(async)]
pub fn load_text_file(payload: LoadTextFilePayload) -> Result<TextFileData, AppError> {
    text_file_editing::load_project_text_file(
        payload.session_id.as_deref(),
        &payload.mod_root,
        payload.path,
    )
}
