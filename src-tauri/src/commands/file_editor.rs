use crate::errors::AppError;
use crate::models::{
    EditableFileData, EntityIdentityIntent, FollowTextIdentityPayload, LoadEditableFilePayload,
    TextIdentityIntentPayload,
};
use crate::services::file_editor;

#[command_macros::command(async)]
pub fn query_text_identity_intent(
    payload: TextIdentityIntentPayload,
) -> Result<EntityIdentityIntent, AppError> {
    file_editor::query_text_identity_intent(&payload.session_id, &payload.source, &payload.text)
}
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
