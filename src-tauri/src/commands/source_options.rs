use crate::{
    errors::AppError,
    models::{CsvSourceOptionsPayload, ImageSourceOptionsPayload, SourceOptionGroup},
    services,
};

#[command_macros::command(async)]
pub fn query_csv_source_options(
    payload: CsvSourceOptionsPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::query_csv_source_options(&payload.session_id, &payload.source)
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
