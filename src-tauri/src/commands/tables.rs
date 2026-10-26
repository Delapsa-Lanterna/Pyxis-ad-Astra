use crate::{
    errors::AppError,
    models::{
        CsvRowPreview, CsvRowPreviewPayload, CsvTableIndex, CsvTableIndexPayload,
        CsvTableRowsPayload, CsvTableRowsRead, SaveCsvPatchPayload, WriteResult,
    },
    services,
};

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

#[command_macros::command(async)]
pub fn save_csv_patch(payload: SaveCsvPatchPayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_csv_version_scope(
        &payload.session_id,
        payload.table,
        &payload.base_versions,
    )?;
    for spec in &payload.associated_specs {
        services::require_entity_version_scope(
            &payload.session_id,
            spec.target.kind,
            &spec.target.id,
            &payload.base_versions,
        )?;
    }
    let result = services::save_csv_patch_snapshot(
        &payload.session_id,
        payload.table,
        payload.patches,
        payload.associated_specs,
        payload.json_write,
        payload.row_order,
    )?;
    transaction.commit(result, "保存 CSV")
}
