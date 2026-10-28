use crate::{
    errors::AppError,
    models::{CoreRootPayload, CoreScanPayload, DiscoveredField, InvalidateCoreCachePayload},
    services,
};
use std::collections::BTreeMap;

#[command_macros::command(async)]
pub fn query_core_root(payload: CoreRootPayload) -> Result<Option<String>, AppError> {
    services::query_core_root(
        payload.session_id.as_deref(),
        payload.starsector_root.as_deref(),
    )
}

#[command_macros::command(async)]
pub fn scan_core_fields(
    payload: CoreScanPayload,
) -> Result<BTreeMap<String, Vec<DiscoveredField>>, AppError> {
    services::scan_core_fields(&payload.starsector_root)
}

#[command_macros::command(async)]
pub fn scan_core_graphics(payload: CoreScanPayload) -> Result<Vec<String>, AppError> {
    services::scan_core_graphics(&payload.starsector_root)
}

#[command_macros::command(async)]
pub fn invalidate_core_cache(payload: InvalidateCoreCachePayload) -> Result<(), AppError> {
    services::project::invalidate_core_cache(&payload.starsector_root)
}
