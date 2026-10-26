use crate::{
    errors::AppError,
    models::{LoadImportedEditorSpecPayload, SaveEditorSpecPayload, WriteResult},
    services,
};
use serde_json::Value;

#[command_macros::command(async)]
pub fn load_imported_editor_spec_file(
    payload: LoadImportedEditorSpecPayload,
) -> Result<Value, AppError> {
    services::spec_editor::load_imported_editor_spec_file(payload.kind, payload.path)
}

#[command_macros::command(async)]
pub fn save_editor_spec(payload: SaveEditorSpecPayload) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        payload.target.kind,
        &payload.target.id,
        &payload.base_versions,
    )?;
    let result = services::save_entity_spec(
        &payload.session_id,
        &payload.target,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    transaction.commit(result, "保存编辑器规格")
}
