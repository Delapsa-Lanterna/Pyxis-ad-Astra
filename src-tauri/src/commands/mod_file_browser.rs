use crate::{
    errors::AppError,
    models::{ModDirectory, ModDirectoryPayload, ModTextFilePayload, ModTextFileTarget},
    services,
};
#[tauri::command(async)]
pub fn query_mod_directory(payload: ModDirectoryPayload) -> Result<ModDirectory, AppError> {
    services::project::query_mod_directory(&payload.session_id, payload.directory.as_deref())
}
#[tauri::command(async)]
pub fn query_mod_text_file_target(
    payload: ModTextFilePayload,
) -> Result<Option<ModTextFileTarget>, AppError> {
    services::project::query_mod_text_file_target(&payload.session_id, &payload.rel_path)
}

#[tauri::command(async)]
pub fn query_mod_file_search(
    payload: crate::models::ModFileSearchPayload,
) -> Result<crate::models::ModFileSearch, AppError> {
    services::project::query_mod_file_search(&payload.session_id, &payload.query)
}
