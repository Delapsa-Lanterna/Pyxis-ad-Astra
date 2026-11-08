use crate::errors::AppError;
use crate::models::{
    AssociatedSpecPreparation, CsvAssociatedSpecsPayload, CsvRowPreview, CsvRowPreviewPayload,
    CsvRowResourcesPayload, CsvTableIndex, CsvTableIndexPayload, CsvTableRowsPayload,
    CsvTableRowsRead, ResourceRef,
};
use crate::models::{CsvValidationContext, CsvValidationPayload};
use crate::services;
use std::collections::BTreeMap;

#[command_macros::command(async)]
pub fn query_csv_validation(
    payload: CsvValidationPayload,
) -> Result<CsvValidationContext, AppError> {
    services::query_csv_validation(
        &payload.session_id,
        payload.entities,
        payload.sources,
        payload.files,
        payload.classes,
        payload.station_data,
    )
}

#[command_macros::command(async)]
pub fn prepare_csv_associated_specs(
    payload: CsvAssociatedSpecsPayload,
) -> Result<Vec<AssociatedSpecPreparation>, AppError> {
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
        &payload.validation_columns,
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
pub fn query_csv_row_resources(
    payload: CsvRowResourcesPayload,
) -> Result<BTreeMap<String, Option<ResourceRef>>, AppError> {
    services::query_csv_row_resources(
        &payload.session_id,
        payload.table,
        payload.row_keys,
        payload.drafts,
    )
}
