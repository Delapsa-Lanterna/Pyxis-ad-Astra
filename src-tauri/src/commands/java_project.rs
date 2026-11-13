use crate::errors::{AppError, AppResult};
use crate::models::WindowIdentity;
use crate::models::java_project::{JavaDeployPreview, JavaProjectAction, JavaProjectSnapshot};
use crate::services::java_project::deployment;
use crate::services::{java_project, project, windows};
use tauri::WebviewWindow;

#[command_macros::command(async)]
pub fn java_project(
    window: WebviewWindow,
    action: JavaProjectAction,
) -> AppResult<JavaProjectSnapshot> {
    let identity = windows::current_window_context(window.label())?.identity;
    let WindowIdentity::CodeEditor {
        session_id,
        mod_root,
    } = identity
    else {
        return Err(AppError::message(
            "java_project.window",
            "Code editor window required",
        ));
    };
    project::ensure_project_session_mod_root(&session_id, &mod_root)?;
    java_project::execute(&session_id, window.label(), action)
}
#[command_macros::command(async)]
pub fn preview_java_deployment(
    window: WebviewWindow,
    artifact: String,
    target: String,
) -> AppResult<JavaDeployPreview> {
    deployment::preview(
        windows::current_window_context(window.label())?.identity,
        &artifact,
        &target,
    )
}
