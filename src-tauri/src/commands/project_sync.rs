use crate::{
    errors::AppError,
    models::{InvalidateProjectSessionPayload, ProjectSessionInvalidationResult},
    services,
};

#[command_macros::command]
pub fn register_save_window(
    window: tauri::WebviewWindow,
    channel: tauri::ipc::Channel<crate::models::SaveDelivery>,
) -> Result<(), AppError> {
    let root = if window.label() == "main" {
        None
    } else {
        services::windows::current_window_context(window.label())?
            .identity
            .mod_root()
            .map(str::to_string)
    };
    services::project_sync::register(window.label(), root, channel)
}

#[command_macros::command]
pub fn unregister_save_window(window: tauri::WebviewWindow) -> Result<(), AppError> {
    services::project_sync::release_window(window.label())
}

#[command_macros::command(async)]
pub fn set_reference_sources(
    window: tauri::WebviewWindow,
    session_ids: Vec<String>,
    order: Vec<String>,
) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(AppError::message(
            "reference.owner_mismatch",
            "引用来源只允许由主窗口设置",
        ));
    }
    services::project::set_reference_order(order)?;
    services::project_sync::publish_references(
        services::project::set_reference_sources(session_ids)?,
        services::project::reference_updates()?,
    )
}

#[command_macros::command]
pub fn resolve_save_sources(
    window: tauri::WebviewWindow,
    request_id: String,
    paths: Vec<String>,
    accepted: bool,
) -> Result<(), AppError> {
    services::project_sync::resolve_sources(window.label(), &request_id, &paths, accepted)
}

#[command_macros::command]
pub fn abandon_project_saves(mod_roots: Vec<String>) -> Result<(), AppError> {
    services::project_sync::abandon(&mod_roots)
}

#[command_macros::command]
pub fn retry_project_save(request_id: String) -> Result<(), AppError> {
    services::project_sync::retry(&request_id)
}

#[command_macros::command(async)]
pub async fn wait_project_saves(
    mod_roots: Vec<String>,
) -> Result<(), crate::errors::ErrorDiagnostic> {
    tauri::async_runtime::spawn_blocking(move || services::project_sync::wait_projects(&mod_roots))
        .await
        .map_err(|error| AppError::message("write.queue_wait", error.to_string()).diagnostic())?
}

#[command_macros::command(async)]
pub fn invalidate_project_session(
    payload: InvalidateProjectSessionPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    services::project::invalidate_project_session(&payload.session_id, payload.changes)
}
