use crate::errors::AppError;
use crate::models::LoadImportedEditorSpecPayload;
use crate::models::file_content::JsonFileContent;
use crate::services::spec_editor;

#[command_macros::command(async)]
pub fn load_imported_editor_spec_file(
    payload: LoadImportedEditorSpecPayload,
) -> Result<JsonFileContent, AppError> {
    spec_editor::load_imported_editor_spec_file(payload.kind, &payload.path)
}
