use crate::{
    errors::AppError,
    models::{CoreScanPayload, DiscoveredField, InvalidateCoreCachePayload},
    services,
};
use std::collections::BTreeMap;

#[tauri::command(async)]
pub fn scan_core_fields(
    payload: CoreScanPayload,
) -> Result<BTreeMap<String, Vec<DiscoveredField>>, AppError> {
    services::scan_core_fields(&payload.starsector_root)
}

#[tauri::command(async)]
pub fn scan_core_graphics(payload: CoreScanPayload) -> Result<Vec<String>, AppError> {
    services::scan_core_graphics(&payload.starsector_root)
}

#[tauri::command(async)]
pub fn invalidate_core_cache(payload: InvalidateCoreCachePayload) -> Result<(), AppError> {
    services::project::invalidate_core_cache(&payload.starsector_root)
}
