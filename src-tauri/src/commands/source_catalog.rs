use crate::errors::AppError;
use crate::models::{ImageSourceOptionsPayload, SourceCatalogPayload, SourceOptionGroup};
use crate::services;

#[command_macros::command(async)]
pub fn query_csv_source_options(
    payload: SourceCatalogPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::query_source_option_catalog(&payload.session_id, &payload.source)
}

#[command_macros::command(async)]
pub fn query_image_source_options(
    payload: ImageSourceOptionsPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::query_image_source_options(
        &payload.session_id,
        &payload.directories,
        payload.mission_id.as_deref(),
    )
}
