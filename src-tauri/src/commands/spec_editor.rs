use crate::errors::AppError;
use crate::models::LoadImportedEditorSpecPayload;
use crate::services::spec_editor;
use serde_json::Value;

#[command_macros::command(async)]
pub fn load_imported_editor_spec_file(
    payload: LoadImportedEditorSpecPayload,
) -> Result<Value, AppError> {
    spec_editor::load_imported_editor_spec_file(payload.kind, payload.path)
}
