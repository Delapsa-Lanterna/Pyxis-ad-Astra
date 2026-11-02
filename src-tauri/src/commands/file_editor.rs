use crate::errors::AppError;
use crate::models::{EditableFileData, FollowTextIdentityPayload, LoadEditableFilePayload};
use crate::services::file_editor;

#[command_macros::command(async)]
pub fn follow_text_identity(payload: FollowTextIdentityPayload) -> Result<String, AppError> {
    file_editor::follow_text_identity(payload.kind, &payload.text, &payload.next_id)
}

#[command_macros::command(async)]
pub fn load_editable_file(payload: LoadEditableFilePayload) -> Result<EditableFileData, AppError> {
    file_editor::load_project_editable_file(
        payload.session_id.as_deref(),
        &payload.mod_root,
        payload.path,
    )
}
