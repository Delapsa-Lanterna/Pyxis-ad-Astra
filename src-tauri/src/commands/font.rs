use crate::errors::AppError;
use crate::models::{OriginalFontResult, QueryOriginalFontPayload};
use crate::services;

#[command_macros::command(async)]
pub fn query_original_font(
    payload: QueryOriginalFontPayload,
) -> Result<OriginalFontResult, AppError> {
    services::query_original_font(
        &payload.session_id,
        payload.font_id,
        payload.font_directory.as_deref(),
    )
}
