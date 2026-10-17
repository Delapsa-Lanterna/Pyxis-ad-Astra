use crate::{
    errors::AppError,
    models::{CsvSourceOptionsPayload, SourceOptionGroup},
    services,
};

#[tauri::command(async)]
pub fn query_csv_source_options(
    payload: CsvSourceOptionsPayload,
) -> Result<Vec<SourceOptionGroup>, AppError> {
    services::query_csv_source_options(&payload.session_id, &payload.source)
}
