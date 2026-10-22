//! Crate-level diagnostics sink. Infrastructure layers that cannot reach the
//! log service (no `AppHandle`, no settings access) record through here; the
//! Tauri setup in `lib.rs` installs the writer that lands records in the
//! application log. Without an installed sink, records are dropped — tests
//! run without Tauri and callers must never depend on delivery.

use crate::models::AppLogLevel;
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, Ordering},
};

type Sink = Arc<dyn Fn(AppLogLevel, &str, &str) + Send + Sync>;

static SINK: Mutex<Option<Sink>> = Mutex::new(None);
static DEBUG: AtomicBool = AtomicBool::new(false);

pub fn enable_debug(enabled: bool) {
    DEBUG.store(enabled, Ordering::Release);
}

pub fn debug(code: &str, message: impl FnOnce() -> String) {
    if DEBUG.load(Ordering::Acquire) {
        send(AppLogLevel::Debug, code, &message());
    }
}

pub fn info(code: &str, message: &str) {
    send(AppLogLevel::Info, code, message);
}

/// Installs the process-wide diagnostics writer; later calls replace it.
pub fn install(sink: Sink) {
    if let Ok(mut guard) = SINK.lock() {
        *guard = Some(sink);
    }
}

/// Enqueues a diagnostic while preserving the caller's result.
pub fn record(message: impl Into<String>) {
    send(AppLogLevel::Warning, "diagnostics", &message.into());
}

fn send(level: AppLogLevel, code: &str, message: &str) {
    let sink = SINK.lock().ok().and_then(|guard| guard.clone());
    if let Some(sink) = sink {
        sink(level, code, message);
    }
}
