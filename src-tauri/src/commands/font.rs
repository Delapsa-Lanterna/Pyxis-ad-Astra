use crate::{
    errors::AppError,
    models::{OriginalFontResult, QueryOriginalFontPayload},
    services,
};

#[tauri::command(async)]
pub fn query_original_font(
    payload: QueryOriginalFontPayload,
) -> Result<OriginalFontResult, AppError> {
    services::query_original_font(
        &payload.session_id,
        payload.starsector_root.as_deref(),
        payload.font_id,
    )
}
