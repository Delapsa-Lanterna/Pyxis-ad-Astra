use crate::{
    errors::AppError,
    models::{ManagedWindowOpened, ManagedWindowRequest, ManagedWindowStatus, WindowIdentity},
    services,
};

#[tauri::command(async)]
pub fn open_managed_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    payload: ManagedWindowRequest,
) -> Result<ManagedWindowOpened, AppError> {
    services::windows::open_managed_window(&app, window.label(), payload)
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
    input: Option<crate::models::ManagedWindowInput>,
) -> Result<crate::models::ManagedWindowContext, AppError> {
    services::windows::retarget_window(&app, window.label(), identity, &title, input)?;
    services::windows::current_window_context(window.label())
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

#[tauri::command]
pub fn get_window_bootstrap(
    window: tauri::WebviewWindow,
) -> Result<crate::models::WindowBootstrap, AppError> {
    services::windows::current_window_bootstrap(window.label())
}
#[tauri::command]
pub fn get_current_window_context(
    window: tauri::WebviewWindow,
) -> Result<crate::models::ManagedWindowContext, AppError> {
    services::windows::current_window_context(window.label())
}
#[tauri::command]
pub fn get_current_window_request(
    window: tauri::WebviewWindow,
) -> Result<Option<crate::models::ManagedWindowContext>, AppError> {
    services::windows::current_window_request(window.label())
}
#[tauri::command]
pub fn accept_window_request(
    window: tauri::WebviewWindow,
    request_id: u64,
) -> Result<bool, AppError> {
    services::windows::accept_window_request(window.label(), request_id)
}
#[tauri::command]
pub fn fail_window_request(
    window: tauri::WebviewWindow,
    request_id: u64,
    diagnostic: crate::errors::ErrorDiagnostic,
) -> Result<(), AppError> {
    services::windows::fail_window_request(window.label(), request_id, diagnostic)
}
#[tauri::command]
pub fn fail_window_startup(
    window: tauri::WebviewWindow,
    diagnostic: crate::errors::ErrorDiagnostic,
) -> Result<(), AppError> {
    if window.label() == "main" {
        return Ok(());
    }
    if let Some(context) = services::windows::current_window_request(window.label())? {
        services::windows::fail_window_request(window.label(), context.request_id, diagnostic)?;
    }
    Ok(())
}
#[tauri::command]
pub async fn await_window_request(
    window: tauri::WebviewWindow,
    request_id: u64,
) -> Result<crate::models::WindowRequestReceipt, crate::errors::ErrorDiagnostic> {
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        services::windows::await_window_request(&owner, request_id)
    })
    .await
    .map_err(|error| AppError::message("window.delivery_wait", error.to_string()).diagnostic())?
}
#[tauri::command]
pub fn publish_window_settings(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    settings: crate::models::AppSettings,
) -> Result<crate::models::WindowSettingsSnapshot, AppError> {
    services::windows::publish_window_settings(&app, window.label(), settings)
}
#[tauri::command]
pub fn get_window_settings() -> Result<crate::models::WindowSettingsSnapshot, AppError> {
    services::windows::current_window_settings()
}
