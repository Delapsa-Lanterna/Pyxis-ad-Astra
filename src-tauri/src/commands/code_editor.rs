use crate::errors::{AppError, AppResult};
use crate::models::code_editor::{CodeEditorDelivery, CodeEditorFileResult, CodeEditorOpen};
use crate::services::{code_editor, windows};
use tauri::ipc::Channel;
use tauri::{AppHandle, WebviewWindow, async_runtime};

#[command_macros::command(async)]
pub async fn open_code_editor(
    app: AppHandle,
    window: WebviewWindow,
    key: String,
    input: CodeEditorOpen,
) -> AppResult<Vec<CodeEditorFileResult>> {
    let (opened, task) = code_editor::open_window(&app, window.label(), key, input)?;
    let owner = window.label().to_string();
    async_runtime::spawn_blocking(move || {
        if let Err(error) = windows::await_window_request(&owner, opened.request_id) {
            code_editor::release_window(&opened.label)?;
            return Err(AppError::message("code_editor.window_open", error.message));
        }
        task.wait()
    })
    .await
    .map_err(|error| AppError::message("code_editor.queue_wait", error.to_string()))?
}
#[command_macros::command]
pub fn subscribe_code_editor(
    window: WebviewWindow,
    channel: Channel<CodeEditorDelivery>,
) -> AppResult<()> {
    code_editor::subscribe(window.label(), channel)
}
#[command_macros::command]
pub fn finish_code_editor_open(
    window: WebviewWindow,
    key: String,
    results: Vec<CodeEditorFileResult>,
) -> AppResult<()> {
    code_editor::finish(window.label(), &key, results)
}
