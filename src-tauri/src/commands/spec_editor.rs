use crate::{errors::AppError, models::LoadImportedEditorSpecPayload, services};
use serde_json::Value;

#[command_macros::command(async)]
pub fn load_imported_editor_spec_file(
    payload: LoadImportedEditorSpecPayload,
) -> Result<Value, AppError> {
    services::spec_editor::load_imported_editor_spec_file(payload.kind, payload.path)
}
