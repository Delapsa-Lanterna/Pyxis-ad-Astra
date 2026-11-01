use crate::errors::{AppError, ErrorDiagnostic};
use crate::models::{
    CloseProjectSessionPayload, InvalidateProjectSessionPayload, ProjectSessionInvalidationResult,
    SaveDelivery,
};
use crate::services::{project, project_sync, windows};
use tauri::ipc::Channel;
use tauri::{WebviewWindow, async_runtime};

#[command_macros::command]
pub fn register_save_window(
    window: WebviewWindow,
    channel: Channel<SaveDelivery>,
) -> Result<(), AppError> {
    let root = if window.label() == "main" {
        None
    } else {
        windows::current_window_context(window.label())?
            .identity
            .mod_root()
            .map(str::to_string)
    };
    project_sync::register(window.label(), root, channel)
}

#[command_macros::command]
pub fn unregister_save_window(window: WebviewWindow) -> Result<(), AppError> {
    project_sync::release_window(window.label())
}

#[command_macros::command(async)]
pub fn set_reference_sources(
    window: WebviewWindow,
    session_ids: Vec<String>,
    order: Vec<String>,
) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(AppError::message(
            "reference.owner_mismatch",
            "引用来源只允许由主窗口设置",
        ));
    }
    project::set_reference_order(order)?;
    project_sync::publish_references(
        project::set_reference_sources(session_ids)?,
        project::reference_updates()?,
    )
}

#[command_macros::command]
pub fn resolve_save_sources(
    window: WebviewWindow,
    request_id: String,
    paths: Vec<String>,
    accepted: bool,
) -> Result<(), AppError> {
    project_sync::resolve_sources(window.label(), &request_id, &paths, accepted)
}

#[command_macros::command]
pub fn abandon_project_saves(mod_roots: Vec<String>) -> Result<(), AppError> {
    project_sync::abandon(&mod_roots)
}

#[command_macros::command]
pub fn retry_project_save(request_id: String) -> Result<(), AppError> {
    project_sync::retry(&request_id)
}

#[command_macros::command(async)]
pub async fn wait_project_saves(mod_roots: Vec<String>) -> Result<(), ErrorDiagnostic> {
    async_runtime::spawn_blocking(move || project_sync::wait_projects(&mod_roots))
        .await
        .map_err(|error| AppError::message("write.queue_wait", error.to_string()).diagnostic())?
}

#[command_macros::command(async)]
pub fn invalidate_project_session(
    payload: InvalidateProjectSessionPayload,
) -> Result<ProjectSessionInvalidationResult, AppError> {
    project::invalidate_project_session(&payload.session_id, payload.changes)
}

#[command_macros::command(async)]
pub fn close_project_session(payload: CloseProjectSessionPayload) -> Result<(), AppError> {
    project_sync::release_project_session(payload.session_id)
}
