use crate::{errors::AppError, models::performance_monitor::*, services};

#[tauri::command]
pub fn performance_monitor_batch(window: tauri::WebviewWindow, batch: PerformanceBatch) {
    services::performance_monitor::deliver(window.label(), batch);
}
#[tauri::command(async)]
pub fn performance_monitor_report(
    app: tauri::AppHandle,
    action: PerformanceMonitorAction,
) -> Result<PerformanceMonitorStatus, AppError> {
    services::performance_monitor::report(app, action)
}
