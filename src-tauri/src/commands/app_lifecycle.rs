use crate::{errors::AppError, models::WindowIdentity, services};

#[command_macros::command]
pub async fn request_close(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    scope: crate::models::CloseScope,
) -> Result<crate::models::CloseResult, AppError> {
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        services::app_lifecycle::request_close(&app, &owner, scope)
    })
    .await
    .map_err(|error| AppError::message("lifecycle.wait_failed", error.to_string()))?
}
#[command_macros::command]
pub fn reply_close(
    window: tauri::WebviewWindow,
    operation_id: u64,
    phase: crate::models::ClosePhase,
    accepted: bool,
    diagnostic: Option<crate::errors::ErrorDiagnostic>,
) -> Result<(), AppError> {
    services::app_lifecycle::reply(window.label(), operation_id, phase, accepted, diagnostic)
}
#[command_macros::command]
pub fn ready_close(window: tauri::WebviewWindow) -> Result<(), AppError> {
    services::app_lifecycle::ready(window.label())
}
#[command_macros::command(async)]
pub fn reserve_window_targets(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identities: Vec<WindowIdentity>,
) -> Result<(), AppError> {
    let displaced = services::windows::reserve_targets(&app, window.label(), identities)?;
    services::app_lifecycle::close_displaced(&app, window.label(), displaced)
}

#[command_macros::command(async)]
pub fn retarget_managed_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identity: WindowIdentity,
    title: String,
    input: Option<crate::models::ManagedWindowInput>,
) -> Result<crate::models::ManagedWindowContext, AppError> {
    let displaced =
        services::windows::reserve_targets(&app, window.label(), vec![identity.clone()])?;
    services::app_lifecycle::close_displaced(&app, window.label(), displaced)?;
    let result = services::windows::retarget_window(&app, window.label(), identity, &title, input);
    services::windows::release_targets(window.label())?;
    result?;
    services::windows::current_window_context(window.label())
}
#[command_macros::command]
pub fn get_window_bootstrap(
    window: tauri::WebviewWindow,
) -> Result<crate::models::WindowBootstrap, AppError> {
    services::app_lifecycle::loading(window.label())?;
    services::windows::current_window_bootstrap(window.label())
}
#[command_macros::command]
pub fn fail_window_startup(
    window: tauri::WebviewWindow,
    diagnostic: crate::errors::ErrorDiagnostic,
) -> Result<(), AppError> {
    services::app_lifecycle::startup_failed(window.label())?;
    if window.label() == "main" {
        return Ok(());
    }
    services::windows::fail_window_startup(window.label(), diagnostic)
}

#[command_macros::command(async)]
pub fn read_settings(
    app_handle: tauri::AppHandle,
) -> Result<crate::models::SettingsSnapshot, AppError> {
    services::app_settings::read_settings(
        &app_handle,
        services::app_lifecycle::apply_settings_runtime,
    )
}

#[command_macros::command(async)]
pub fn save_settings(
    app_handle: tauri::AppHandle,
    window: tauri::WebviewWindow,
    payload: crate::models::SaveAppSettingsPayload,
) -> Result<crate::models::SettingsSnapshot, AppError> {
    services::app_settings::save_settings_snapshot(
        &app_handle,
        window.label(),
        payload.settings,
        services::app_lifecycle::apply_settings_runtime,
    )
}
