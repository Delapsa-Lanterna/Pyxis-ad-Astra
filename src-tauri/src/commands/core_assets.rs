use crate::errors::AppError;
use crate::models::{
    CoreRootPayload, CoreScanPayload, DiscoveredField, InvalidateCoreCachePayload,
};
use crate::services;
use crate::services::project;
use crate::services::project_sync;
use std::collections::BTreeMap;
use tauri::WebviewWindow;

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
    project::invalidate_core_cache(&payload.starsector_root)
}
#[command_macros::command(async)]
pub fn set_window_core_subscription(
    window: WebviewWindow,
    root: Option<String>,
) -> Result<(), AppError> {
    project_sync::set_window_core_subscription(window.label(), root.as_deref())
}
