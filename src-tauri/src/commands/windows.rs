use crate::{
    errors::AppError,
    models::{ManagedWindowOpened, ManagedWindowRequest, ManagedWindowStatus, WindowIdentity},
    services,
};

#[tauri::command(async)]
pub fn open_managed_window(
    app: tauri::AppHandle,
    payload: ManagedWindowRequest,
) -> Result<ManagedWindowOpened, AppError> {
    services::windows::open_managed_window(&app, payload)
}

#[tauri::command(async)]
pub fn focus_managed_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identity: WindowIdentity,
) -> Result<bool, AppError> {
    services::windows::focus_managed_window(&app, window.label(), &identity)
}
#[tauri::command]
pub fn update_managed_window_status(
    window: tauri::WebviewWindow,
    payload: ManagedWindowStatus,
) -> Result<(), AppError> {
    services::windows::update_status(window.label(), payload)
}

#[tauri::command]
pub async fn request_session_window_close(
    app: tauri::AppHandle,
    session_id: String,
) -> Result<bool, AppError> {
    let waiting = services::windows::request_session_close(&app, &session_id)?;
    tauri::async_runtime::spawn_blocking(move || waiting.recv())
        .await
        .map_err(|error| AppError::message("window.lifecycle_wait", error.to_string()))?
        .map_err(|error| AppError::message("window.lifecycle_wait", error.to_string()))
}
#[tauri::command]
pub fn cancel_window_close_request(
    window: tauri::WebviewWindow,
    request_id: u64,
) -> Result<(), AppError> {
    services::windows::cancel_close_request(window.label(), request_id)
}
#[tauri::command(async)]
pub fn reserve_window_targets(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identities: Vec<WindowIdentity>,
) -> Result<(), AppError> {
    services::windows::reserve_targets(&app, window.label(), identities)
}
#[tauri::command(async)]
pub fn release_window_targets(window: tauri::WebviewWindow) -> Result<(), AppError> {
    services::windows::release_targets(window.label())
}
#[tauri::command(async)]
pub fn retarget_managed_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identity: WindowIdentity,
    title: String,
) -> Result<(), AppError> {
    services::windows::retarget_window(&app, window.label(), identity, &title)
}
#[tauri::command(async)]
pub fn update_edit_target_registration(
    window: tauri::WebviewWindow,
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<(), crate::errors::AppError> {
    crate::services::windows::update_edit_targets(window.label(), targets)
}
#[tauri::command(async)]
pub fn query_edit_target_owners(
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<Vec<String>, crate::errors::AppError> {
    crate::services::windows::query_edit_target_owners(&targets)
}
#[tauri::command(async)]
pub fn reserve_edit_targets(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<(), crate::errors::AppError> {
    crate::services::windows::reserve_edit_targets(&app, window.label(), &targets)
}
#[tauri::command(async)]
pub fn focus_edit_target_owner(
    app: tauri::AppHandle,
    label: String,
) -> Result<bool, crate::errors::AppError> {
    crate::services::windows::focus_edit_target_owner(&app, &label)
}
