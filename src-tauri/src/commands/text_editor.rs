use crate::errors::AppError;
use crate::models::FollowTextIdentityPayload;
use crate::services::text_editor;

#[command_macros::command(async)]
pub fn follow_text_identity(payload: FollowTextIdentityPayload) -> Result<String, AppError> {
    text_editor::follow_text_identity(payload.kind, &payload.text, &payload.next_id)
}
