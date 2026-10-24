use crate::{
    errors::AppError,
    models::{
        MiscConfigDelete, MiscConfigEntry, MiscConfigFile, MiscConfigRead, MiscConfigScope,
        MiscConfigWrite, WriteResult,
    },
    services,
};
use serde_json::Value;

#[tauri::command(async)]
pub fn query_misc_config_files(payload: MiscConfigScope) -> Result<Vec<MiscConfigEntry>, AppError> {
    super::ensure_session_mod_scope(&payload)?;
    services::misc_config::query_misc_config_files(&payload.mod_root)
}
#[tauri::command(async)]
pub fn query_misc_config_file(payload: MiscConfigRead) -> Result<Option<MiscConfigFile>, AppError> {
    super::ensure_session_mod_scope(&payload)?;
    services::misc_config::query_misc_config_file(&payload.mod_root, payload.kind)
}
#[tauri::command(async)]
pub fn save_misc_config(payload: MiscConfigWrite) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let root = services::project::current_projection(&payload.session_id)?
        .manifest
        .starsector_root;
    let root = root
        .as_deref()
        .map(services::project::core_dir)
        .transpose()?;
    let result = services::misc_config::save_misc_config(payload, root.as_deref())?;
    transaction.commit(result, "保存杂项配置")
}
#[tauri::command(async)]
pub fn delete_misc_config(payload: MiscConfigDelete) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::misc_config::delete_misc_config(
        &payload.mod_root,
        payload.kind,
        &payload.base_versions,
    )?;
    transaction.commit(result, "删除杂项配置")
}
