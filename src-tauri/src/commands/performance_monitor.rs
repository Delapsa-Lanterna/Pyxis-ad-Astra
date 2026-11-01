use crate::errors::AppError;
use crate::models::performance_monitor::*;
use crate::services::performance_monitor;
use tauri::{AppHandle, WebviewWindow};

#[command_macros::command]
pub fn performance_monitor_batch(window: WebviewWindow, batch: PerformanceBatch) {
    performance_monitor::deliver(window.label(), batch);
}
#[command_macros::command(async)]
pub fn performance_monitor_report(
    app: AppHandle,
    window: WebviewWindow,
    action: PerformanceMonitorAction,
    trace_seconds: Option<u8>,
) -> Result<PerformanceMonitorStatus, AppError> {
    performance_monitor::report(app, window, action, trace_seconds)
}
