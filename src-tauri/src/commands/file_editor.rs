use crate::{
    errors::AppError,
    models::{EditableFileData, LoadEditableFilePayload},
    services,
};

#[command_macros::command(async)]
pub fn query_text_identity_intent(
    payload: crate::models::TextIdentityIntentPayload,
) -> Result<crate::models::EntityIdentityIntent, AppError> {
    services::file_editor::query_text_identity_intent(
        &payload.session_id,
        &payload.source,
        &payload.text,
    )
}
#[command_macros::command(async)]
pub fn follow_text_identity(
    payload: crate::models::FollowTextIdentityPayload,
) -> Result<String, AppError> {
    services::file_editor::follow_text_identity(payload.kind, &payload.text, &payload.next_id)
}

#[command_macros::command(async)]
pub fn load_editable_file(payload: LoadEditableFilePayload) -> Result<EditableFileData, AppError> {
    services::file_editor::load_project_editable_file(
        payload.session_id.as_deref(),
        &payload.mod_root,
        payload.path,
    )
}
