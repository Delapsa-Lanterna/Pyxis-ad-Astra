use super::ensure_session_mod_scope;
use crate::{
    errors::AppError,
    models::{
        DraftResourcesPayload, ResolveModRelativePathPayload, ResourceDataUrlBatchPayload,
        ResourceDataUrlBatchResult, ResourceRef,
    },
    services,
};
use std::collections::BTreeMap;

#[tauri::command(async)]
pub fn query_engine_render_assets(
    session_id: String,
    inline_styles: Vec<serde_json::Value>,
) -> Result<crate::models::EngineRenderAssets, AppError> {
    services::query_engine_render_assets(&session_id, &inline_styles)
}

#[tauri::command(async)]
pub fn query_resource_data_urls(
    payload: ResourceDataUrlBatchPayload,
) -> Result<ResourceDataUrlBatchResult, AppError> {
    services::query_resource_data_urls(&payload.session_id, payload.resources)
}

#[tauri::command(async)]
pub fn resolve_mod_relative_path(
    payload: ResolveModRelativePathPayload,
) -> Result<String, AppError> {
    ensure_session_mod_scope(&payload)?;
    services::resolve_mod_relative_path(&payload.mod_root, &payload.absolute_path)
}

#[tauri::command(async)]
pub fn query_draft_resources(
    payload: DraftResourcesPayload,
) -> Result<BTreeMap<String, ResourceRef>, AppError> {
    services::query_draft_resources(
        &payload.session_id,
        payload.kind,
        &payload.id,
        &payload.draft,
    )
}
