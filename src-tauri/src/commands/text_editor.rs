use crate::errors::AppError;
use crate::models::{FollowTextIdentityPayload, LoadTextFilePayload, TextFileData};
use crate::services::text_editor;

#[command_macros::command(async)]
pub fn follow_text_identity(payload: FollowTextIdentityPayload) -> Result<String, AppError> {
    text_editor::follow_text_identity(payload.kind, &payload.text, &payload.next_id)
}

#[command_macros::command(async)]
pub fn load_text_file(payload: LoadTextFilePayload) -> Result<TextFileData, AppError> {
    text_editor::load_project_text_file(
        payload.session_id.as_deref(),
        &payload.mod_root,
        payload.path,
    )
}
