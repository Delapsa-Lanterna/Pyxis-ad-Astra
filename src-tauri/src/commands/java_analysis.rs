use crate::errors::{AppError, AppResult};
use crate::services::java_analysis;
use crate::services::java_analysis::management::{
    ComponentManagement, ManagementAction, ManagementSnapshot,
};
use std::sync::Arc;
use tauri::async_runtime;
use tauri::ipc::Channel;
use tauri::{Manager, WebviewWindow};

#[command_macros::command]
pub fn subscribe_java_analysis(
    window: WebviewWindow,
    subscription_key: String,
    channel: Channel<ManagementSnapshot>,
) -> AppResult<()> {
    window.state::<Arc<ComponentManagement>>().subscribe(
        window.label().into(),
        subscription_key,
        channel,
    )
}
#[command_macros::command]
pub fn unsubscribe_java_analysis(window: WebviewWindow, subscription_key: String) -> AppResult<()> {
    window
        .state::<Arc<ComponentManagement>>()
        .unsubscribe(window.label(), &subscription_key)
}
#[command_macros::command(async)]
pub async fn manage_java_analysis(
    window: WebviewWindow,
    action: ManagementAction,
    operation_key: String,
) -> AppResult<ManagementSnapshot> {
    if window.label() != "main" {
        return Err(AppError::message(
            "java_analysis.owner_mismatch",
            "Only the main window may manage Java components",
        ));
    }
    let submitted = window
        .state::<Arc<ComponentManagement>>()
        .begin(action, operation_key)?;
    async_runtime::spawn_blocking(move || submitted.wait())
        .await
        .map_err(|error| AppError::message("java_analysis.worker_failed", error.to_string()))?
}
#[command_macros::command]
pub fn cancel_java_analysis(
    window: WebviewWindow,
    operation_key: String,
) -> AppResult<ManagementSnapshot> {
    if window.label() != "main" {
        return Err(AppError::message(
            "java_analysis.owner_mismatch",
            "Only the main window may manage Java components",
        ));
    }
    window
        .state::<Arc<ComponentManagement>>()
        .cancel(&operation_key)
}
#[command_macros::command(async)]
pub fn open_java_analysis_directory(window: WebviewWindow, logs: bool) -> AppResult<()> {
    java_analysis::open_component_directory(window.app_handle(), logs)
}

#[command_macros::command(async)]
pub fn java_analysis_context(
    session_id: Option<String>,
    game_root: Option<String>,
) -> AppResult<Option<String>> {
    java_analysis::automatic_java_path(session_id.as_deref(), game_root.as_deref())
}
