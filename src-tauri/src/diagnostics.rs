//! Crate-level diagnostics sink. Infrastructure layers that cannot reach the
//! log service (no `AppHandle`, no settings access) record through here; the
//! Tauri setup in `lib.rs` installs the writer that lands records in the
//! application log. Without an installed sink, records are dropped — tests
//! run without Tauri and callers must never depend on delivery.
use crate::errors::AppError;
use crate::models::{AppLogEntry, AppLogLevel};
use serde_json::Value;
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

type Sink = Arc<dyn Fn(AppLogEntry) + Send + Sync>;

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

/// Enqueues the original diagnostic with the operation's identity metadata.
pub fn failure(code: &str, error: impl Into<AppError>, context: Value) {
    let error = error.into();
    let mut fields: BTreeMap<String, String> = context
        .as_object()
        .expect("diagnostic contexts are objects")
        .iter()
        .map(|(key, value)| {
            (
                key.clone(),
                value
                    .as_str()
                    .map_or_else(|| value.to_string(), str::to_owned),
            )
        })
        .collect();
    fields.insert("errorCode".into(), error.code().into());
    if let Some(column) = error.location().and_then(|location| location.column) {
        fields.insert("column".into(), column.to_string());
    }
    write(AppLogEntry {
        level: AppLogLevel::Warning,
        code: Some(code.into()),
        message: Some(error.to_string()),
        path: error.location().and_then(|location| location.path.clone()),
        line: error
            .location()
            .and_then(|location| location.line)
            .map(|line| line as u32),
        fields: Some(fields),
    });
}

fn send(level: AppLogLevel, code: &str, message: &str) {
    write(AppLogEntry {
        level,
        code: Some(code.into()),
        message: Some(message.into()),
        path: None,
        line: None,
        fields: None,
    });
}
fn write(entry: AppLogEntry) {
    let sink = SINK.lock().ok().and_then(|guard| guard.clone());
    if let Some(sink) = sink {
        sink(entry);
    }
}

#[cfg(test)]
mod tests {
    use super::{AppError, Arc, Mutex, SINK, failure, install};
    use serde_json::json;

    #[test]
    fn failure_preserves_structured_identity_and_location() {
        let record = Arc::new(Mutex::new(None));
        let captured = record.clone();
        let previous = SINK.lock().unwrap().take();
        install(Arc::new(move |entry| {
            if entry.code.as_deref() == Some("test.operation_failed") {
                *captured.lock().unwrap() = Some(entry);
            }
        }));
        let error = AppError::message("test.source", "raw diagnostic")
            .at_path("M:/fixture.csv")
            .at_position(7, Some(3));
        failure(
            "test.operation_failed",
            error,
            json!({"requestId":"test-request"}),
        );
        *SINK.lock().unwrap() = previous;
        let entry = record.lock().unwrap().take().unwrap();
        assert_eq!(entry.path.as_deref(), Some("M:/fixture.csv"));
        assert_eq!(entry.line, Some(7));
        let fields = entry.fields.unwrap();
        assert_eq!(fields["errorCode"], "test.source");
        assert_eq!(fields["column"], "3");
        assert_eq!(fields["requestId"], "test-request");
    }
}
