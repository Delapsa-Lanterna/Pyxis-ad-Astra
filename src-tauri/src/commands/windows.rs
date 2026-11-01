use crate::errors::{AppError, ErrorDiagnostic};
use crate::models::{
    EditWriteTarget, ManagedWindowContext, ManagedWindowRequest, ManagedWindowStatus,
    WindowIdentity, WindowRequestReceipt,
};
use crate::services::windows;
use tauri::{AppHandle, WebviewWindow, async_runtime};

#[command_macros::command(async)]
pub async fn request_window(
    app: AppHandle,
    window: WebviewWindow,
    payload: ManagedWindowRequest,
) -> Result<WindowRequestReceipt, ErrorDiagnostic> {
    let opened = windows::register_window_request(&app, window.label(), payload)
        .map_err(|error| error.diagnostic())?;
    let owner = window.label().to_owned();
    async_runtime::spawn_blocking(move || windows::await_window_request(&owner, opened.request_id))
        .await
        .map_err(|error| {
            AppError::message("window.delivery_wait", error.to_string()).diagnostic()
        })?
}

#[command_macros::command(async)]
pub fn focus_managed_window(
    app: AppHandle,
    window: WebviewWindow,
    identity: WindowIdentity,
) -> Result<bool, AppError> {
    windows::focus_managed_window(&app, window.label(), &identity)
}
#[command_macros::command]
pub fn update_managed_window_status(
    window: WebviewWindow,
    payload: ManagedWindowStatus,
) -> Result<(), AppError> {
    windows::update_status(window.label(), payload)
}

#[command_macros::command(async)]
pub fn release_window_targets(window: WebviewWindow) -> Result<(), AppError> {
    windows::release_targets(window.label())
}
#[command_macros::command(async)]
pub fn update_edit_target_registration(
    window: WebviewWindow,
    targets: Vec<EditWriteTarget>,
) -> Result<(), AppError> {
    windows::update_edit_targets(window.label(), targets)
}
#[command_macros::command(async)]
pub fn query_edit_target_owners(targets: Vec<EditWriteTarget>) -> Result<Vec<String>, AppError> {
    windows::query_edit_target_owners(&targets)
}
#[command_macros::command(async)]
pub fn reserve_edit_targets(
    app: AppHandle,
    window: WebviewWindow,
    targets: Vec<EditWriteTarget>,
) -> Result<(), AppError> {
    windows::reserve_edit_targets(&app, window.label(), &targets)
}
#[command_macros::command(async)]
pub fn focus_edit_target_owner(app: AppHandle, label: String) -> Result<bool, AppError> {
    windows::focus_edit_target_owner(&app, &label)
}

#[command_macros::command]
pub fn get_current_window_context(window: WebviewWindow) -> Result<ManagedWindowContext, AppError> {
    windows::current_window_context(window.label())
}
#[command_macros::command]
pub fn get_current_window_request(
    window: WebviewWindow,
) -> Result<Option<ManagedWindowContext>, AppError> {
    windows::current_window_request(window.label())
}
#[command_macros::command]
pub fn accept_window_request(
    window: WebviewWindow,
    request_id: u64,
    receiver_generation: u64,
) -> Result<bool, AppError> {
    windows::accept_window_request(window.label(), request_id, receiver_generation)
}
#[command_macros::command]
pub fn fail_window_request(
    window: WebviewWindow,
    request_id: u64,
    receiver_generation: u64,
    diagnostic: ErrorDiagnostic,
) -> Result<(), AppError> {
    windows::fail_window_request(window.label(), request_id, receiver_generation, diagnostic)
}
