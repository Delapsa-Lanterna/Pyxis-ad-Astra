use crate::errors::{AppError, ErrorDiagnostic};
use crate::models::{
    ClosePhase, CloseResult, CloseScope, ManagedWindowContext, ManagedWindowInput,
    SaveAppSettingsPayload, SettingsSnapshot, WindowBootstrap, WindowIdentity,
};
use crate::services::{app_lifecycle, app_settings, windows};
use tauri::{AppHandle, WebviewWindow, async_runtime};

#[command_macros::command]
pub async fn request_close(
    app: AppHandle,
    window: WebviewWindow,
    scope: CloseScope,
) -> Result<CloseResult, AppError> {
    let owner = window.label().to_owned();
    async_runtime::spawn_blocking(move || app_lifecycle::request_close(&app, &owner, scope))
        .await
        .map_err(|error| AppError::message("lifecycle.wait_failed", error.to_string()))?
}
#[command_macros::command]
pub fn reply_close(
    window: WebviewWindow,
    operation_id: u64,
    phase: ClosePhase,
    accepted: bool,
    diagnostic: Option<ErrorDiagnostic>,
) -> Result<(), AppError> {
    app_lifecycle::reply(window.label(), operation_id, phase, accepted, diagnostic)
}
#[command_macros::command]
pub fn ready_close(window: WebviewWindow) -> Result<(), AppError> {
    app_lifecycle::ready(window.label())
}
#[command_macros::command(async)]
pub fn reserve_window_targets(
    app: AppHandle,
    window: WebviewWindow,
    identities: Vec<WindowIdentity>,
) -> Result<(), AppError> {
    let displaced = windows::reserve_targets(&app, window.label(), identities)?;
    app_lifecycle::close_displaced(&app, window.label(), displaced)
}

#[command_macros::command(async)]
pub fn retarget_managed_window(
    app: AppHandle,
    window: WebviewWindow,
    identity: WindowIdentity,
    title: String,
    input: Option<ManagedWindowInput>,
) -> Result<ManagedWindowContext, AppError> {
    let displaced = windows::reserve_targets(&app, window.label(), vec![identity.clone()])?;
    app_lifecycle::close_displaced(&app, window.label(), displaced)?;
    let result = windows::retarget_window(&app, window.label(), identity, &title, input);
    windows::release_targets(window.label())?;
    result?;
    windows::current_window_context(window.label())
}
#[command_macros::command]
pub fn get_window_bootstrap(window: WebviewWindow) -> Result<WindowBootstrap, AppError> {
    app_lifecycle::loading(window.label())?;
    windows::current_window_bootstrap(window.label())
}
#[command_macros::command]
pub fn fail_window_startup(
    window: WebviewWindow,
    diagnostic: ErrorDiagnostic,
) -> Result<(), AppError> {
    app_lifecycle::startup_failed(window.label())?;
    if window.label() == "main" {
        return Ok(());
    }
    windows::fail_window_startup(window.label(), diagnostic)
}

#[command_macros::command(async)]
pub fn read_settings(app_handle: AppHandle) -> Result<SettingsSnapshot, AppError> {
    app_settings::read_settings(&app_handle, app_lifecycle::apply_settings_runtime)
}

#[command_macros::command(async)]
pub fn save_settings(
    app_handle: AppHandle,
    window: WebviewWindow,
    payload: SaveAppSettingsPayload,
) -> Result<SettingsSnapshot, AppError> {
    app_settings::save_settings_snapshot(
        &app_handle,
        window.label(),
        payload.settings,
        app_lifecycle::apply_settings_runtime,
    )
}
