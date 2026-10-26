use crate::{
    errors::AppError,
    models::{ManagedWindowRequest, ManagedWindowStatus, WindowIdentity},
    services,
};

#[command_macros::command(async)]
pub async fn request_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    payload: ManagedWindowRequest,
) -> Result<crate::models::WindowRequestReceipt, crate::errors::ErrorDiagnostic> {
    let opened = services::windows::register_window_request(&app, window.label(), payload)
        .map_err(|error| error.diagnostic())?;
    let owner = window.label().to_owned();
    tauri::async_runtime::spawn_blocking(move || {
        services::windows::await_window_request(&owner, opened.request_id)
    })
    .await
    .map_err(|error| AppError::message("window.delivery_wait", error.to_string()).diagnostic())?
}

#[command_macros::command(async)]
pub fn focus_managed_window(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    identity: WindowIdentity,
) -> Result<bool, AppError> {
    services::windows::focus_managed_window(&app, window.label(), &identity)
}
#[command_macros::command]
pub fn update_managed_window_status(
    window: tauri::WebviewWindow,
    payload: ManagedWindowStatus,
) -> Result<(), AppError> {
    services::windows::update_status(window.label(), payload)
}

#[command_macros::command(async)]
pub fn release_window_targets(window: tauri::WebviewWindow) -> Result<(), AppError> {
    services::windows::release_targets(window.label())
}
#[command_macros::command(async)]
pub fn update_edit_target_registration(
    window: tauri::WebviewWindow,
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<(), crate::errors::AppError> {
    services::windows::update_edit_targets(window.label(), targets)
}
#[command_macros::command(async)]
pub fn query_edit_target_owners(
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<Vec<String>, crate::errors::AppError> {
    services::windows::query_edit_target_owners(&targets)
}
#[command_macros::command(async)]
pub fn reserve_edit_targets(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    targets: Vec<crate::models::EditWriteTarget>,
) -> Result<(), crate::errors::AppError> {
    services::windows::reserve_edit_targets(&app, window.label(), &targets)
}
#[command_macros::command(async)]
pub fn focus_edit_target_owner(
    app: tauri::AppHandle,
    label: String,
) -> Result<bool, crate::errors::AppError> {
    services::windows::focus_edit_target_owner(&app, &label)
}

#[command_macros::command]
pub fn get_current_window_context(
    window: tauri::WebviewWindow,
) -> Result<crate::models::ManagedWindowContext, AppError> {
    services::windows::current_window_context(window.label())
}
#[command_macros::command]
pub fn get_current_window_request(
    window: tauri::WebviewWindow,
) -> Result<Option<crate::models::ManagedWindowContext>, AppError> {
    services::windows::current_window_request(window.label())
}
#[command_macros::command]
pub fn accept_window_request(
    window: tauri::WebviewWindow,
    request_id: u64,
    receiver_generation: u64,
) -> Result<bool, AppError> {
    services::windows::accept_window_request(window.label(), request_id, receiver_generation)
}
#[command_macros::command]
pub fn fail_window_request(
    window: tauri::WebviewWindow,
    request_id: u64,
    receiver_generation: u64,
    diagnostic: crate::errors::ErrorDiagnostic,
) -> Result<(), AppError> {
    services::windows::fail_window_request(
        window.label(),
        request_id,
        receiver_generation,
        diagnostic,
    )
}
