use crate::{
    errors::AppError,
    models::{
        CsvRowPreview, CsvRowPreviewPayload, CsvTableIndex, CsvTableIndexPayload,
        CsvTableRowsPayload, CsvTableRowsRead,
    },
    services,
};

#[command_macros::command(async)]
pub fn prepare_csv_associated_specs(
    payload: crate::models::CsvAssociatedSpecsPayload,
) -> Result<Vec<crate::models::AssociatedSpecPreparation>, AppError> {
    services::prepare_csv_associated_specs(&payload.session_id, payload.table, &payload.changes)
}

#[command_macros::command(async)]
pub fn query_csv_table_index(payload: CsvTableIndexPayload) -> Result<CsvTableIndex, AppError> {
    services::query_csv_table_index(
        &payload.session_id,
        payload.table,
        payload.initial_count,
        payload.search,
        payload.search_field,
    )
}

#[command_macros::command(async)]
pub fn query_csv_table_rows(payload: CsvTableRowsPayload) -> Result<CsvTableRowsRead, AppError> {
    if payload.row_keys.len() > 160 {
        return Err(AppError::message(
            "table.row_batch_too_large",
            "CSV 单批读取超过 160 行",
        ));
    }
    services::query_csv_table_rows(&payload.session_id, payload.table, payload.row_keys)
}

#[command_macros::command(async)]
pub fn query_csv_row_preview(payload: CsvRowPreviewPayload) -> Result<CsvRowPreview, AppError> {
    services::query_csv_row_preview(&payload.session_id, payload.table, &payload.row_key)
}
