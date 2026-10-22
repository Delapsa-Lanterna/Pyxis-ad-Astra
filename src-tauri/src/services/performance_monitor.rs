use crate::{
    errors::AppResult, io::write_utf8_no_bom, models::performance_monitor::*, services::app_paths,
};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, VecDeque},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

static ENABLED: OnceLock<bool> = OnceLock::new();
static RECORDS: OnceLock<Mutex<Monitor>> = OnceLock::new();
#[derive(Default)]
struct Monitor {
    records: VecDeque<(String, PerformanceSample)>,
    windows: BTreeMap<String, Value>,
    overwritten: u64,
    started_at: f64,
    path: String,
}
pub fn enabled() -> bool {
    ENABLED.get().copied().unwrap_or(false)
}
pub fn initialize(requested: bool) {
    ENABLED.get_or_init(|| {
        let active = requested && cfg!(feature = "performance-monitor");
        if active {
            RECORDS.get_or_init(|| {
                Mutex::new(Monitor {
                    started_at: now(),
                    ..Monitor::default()
                })
            });
            #[cfg(feature = "performance-monitor")]
            tracing::subscriber::set_global_default(
                tracing_subscriber::registry().with(layer::MonitorLayer),
            )
            .expect("performance subscriber installed once");
        }
        active
    });
}
pub fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_secs_f64()
        * 1000.0
}
fn state() -> std::sync::MutexGuard<'static, Monitor> {
    RECORDS
        .get()
        .expect("monitor initialized")
        .lock()
        .expect("monitor state lock")
}
pub fn record(window: String, sample: PerformanceSample) {
    state().push(window, sample);
}
impl Monitor {
    fn push(&mut self, window: String, mut sample: PerformanceSample) {
        if sample.started_at < self.started_at {
            return;
        }
        sample.fields.retain(|key, value| {
            value.is_number()
                || matches!(
                    key.as_str(),
                    "request" | "status" | "queryKind" | "cache" | "table"
                )
        });
        if self.records.len() == 50_000 {
            self.records.pop_front();
            self.overwritten += 1;
        }
        self.records.push_back((window, sample));
    }
}
pub fn deliver(window: &str, batch: PerformanceBatch) {
    if !enabled() {
        return;
    }
    {
        let mut monitor = state();
        monitor.overwritten += batch.overwritten;
        monitor.windows.insert(
            window.to_string(),
            json!({"environment": batch.environment, "deliveredAt": now()}),
        );
    }
    for sample in batch.samples {
        record(window.to_string(), sample);
    }
}
pub fn report(
    app: tauri::AppHandle,
    action: PerformanceMonitorAction,
) -> AppResult<PerformanceMonitorStatus> {
    if !enabled() {
        return Ok(PerformanceMonitorStatus {
            enabled: false,
            records: 0,
            overwritten: 0,
            started_at: 0.0,
            path: String::new(),
        });
    }
    let mut monitor = state();
    match action {
        PerformanceMonitorAction::Reset => {
            *monitor = Monitor {
                started_at: now(),
                ..Monitor::default()
            };
        }
        PerformanceMonitorAction::Export => {
            let directory = app_paths::app_data_dir(app)?.join("performance-monitor");
            std::fs::create_dir_all(&directory)?;
            let path = directory.join(format!("{}.json", now() as u64));
            write_utf8_no_bom(&path, &serde_json::to_string(&monitor.export())?)?;
            monitor.path = path.to_string_lossy().into_owned();
        }
        PerformanceMonitorAction::Status => {}
    }
    Ok(PerformanceMonitorStatus {
        enabled: true,
        records: monitor.records.len(),
        overwritten: monitor.overwritten,
        started_at: monitor.started_at,
        path: monitor.path.clone(),
    })
}
impl Monitor {
    fn export(&self) -> Value {
        let threads: std::collections::BTreeSet<_> = self
            .records
            .iter()
            .map(|(window, _)| window)
            .chain(self.windows.keys())
            .collect();
        let mut groups: BTreeMap<(&str, &str), Vec<f64>> = BTreeMap::new();
        let mut events: Vec<_> = threads
            .iter()
            .enumerate()
            .map(|(thread, window)| {
                json!({
                    "name": "thread_name",
                    "ph": "M",
                    "pid": 1,
                    "tid": thread,
                    "args": { "name": window }
                })
            })
            .collect();
        events.extend(self.records.iter().map(|(window, sample)| {
            groups
                .entry((&sample.category, &sample.name))
                .or_default()
                .push(sample.duration);
            let thread = threads
                .iter()
                .position(|key| *key == window)
                .expect("recorded thread");
            json!({
                "name": sample.name,
                "cat": sample.category,
                "ph": "X",
                "ts": sample.started_at * 1000.0,
                "dur": sample.duration * 1000.0,
                "pid": 1,
                "tid": thread,
                "args": sample.fields
            })
        }));
        let statistics: Vec<_> = groups
            .into_iter()
            .map(|((category, name), mut values)| {
                values.sort_by(f64::total_cmp);
                let n = values.len();
                json!({
                    "category": category,
                    "name": name,
                    "n": n,
                    "min": values[0],
                    "max": values[n-1],
                    "mean": values.iter().sum::<f64>() / n as f64,
                    "median": (values[(n-1)/2] + values[n/2]) / 2.0,
                    "p95": values[(n*95).div_ceil(100)-1]
                })
            })
            .collect();
        json!({
            "traceEvents": events,
            "displayTimeUnit": "ms",
            "statistics": statistics,
            "windows": self.windows,
            "startedAt": self.started_at,
            "overwritten": self.overwritten,
            "version": env!("CARGO_PKG_VERSION"),
            "platform": std::env::consts::OS,
            "architecture": std::env::consts::ARCH
        })
    }
}

#[cfg(test)]
#[path = "performance_monitor_tests.rs"]
mod tests;

#[cfg(feature = "performance-monitor")]
use tracing_subscriber::prelude::*;
#[cfg(feature = "performance-monitor")]
mod layer {
    use super::*;
    use std::time::Instant;
    use tracing::{
        Subscriber,
        span::{Attributes, Id},
    };
    use tracing_subscriber::{Layer, layer::Context, registry::LookupSpan};
    pub(super) struct MonitorLayer;
    struct SpanData {
        started: Instant,
        sample: PerformanceSample,
        window: String,
    }
    impl<S: Subscriber + for<'a> LookupSpan<'a>> Layer<S> for MonitorLayer {
        fn enabled(&self, metadata: &tracing::Metadata<'_>, _: Context<'_, S>) -> bool {
            matches!(metadata.name(), "monitor.command" | "ipc::request::run")
        }
        fn on_new_span(&self, attributes: &Attributes<'_>, id: &Id, context: Context<'_, S>) {
            let span = context.span(id).expect("registered span");
            let mut fields = BTreeMap::new();
            attributes.record(
                &mut |field: &tracing::field::Field, value: &dyn std::fmt::Debug| {
                    fields.insert(
                        field.name().to_string(),
                        format!("{value:?}").trim_matches('"').to_string(),
                    );
                },
            );
            let (window, command, request) = if let Some(parent) = span.parent() {
                let extensions = parent.extensions();
                if let Some(data) = extensions.get::<SpanData>() {
                    (
                        data.window.clone(),
                        data.sample.name.clone(),
                        data.sample
                            .fields
                            .get("request")
                            .cloned()
                            .unwrap_or(Value::Null),
                    )
                } else {
                    return;
                }
            } else {
                (
                    fields.remove("window").unwrap_or_default(),
                    fields.remove("command").unwrap_or_default(),
                    fields
                        .remove("request")
                        .map(Value::String)
                        .unwrap_or(Value::Null),
                )
            };
            if command.is_empty() {
                return;
            }
            span.extensions_mut().insert(SpanData {
                started: Instant::now(),
                window,
                sample: PerformanceSample {
                    name: command,
                    category: "backend".into(),
                    started_at: now(),
                    duration: 0.0,
                    fields: BTreeMap::from([("request".into(), request)]),
                },
            });
        }
        fn on_close(&self, id: Id, context: Context<'_, S>) {
            let span = context.span(&id).expect("closing span");
            if span.name() != "ipc::request::run" {
                return;
            }
            if let Some(data) = span.extensions_mut().remove::<SpanData>() {
                let mut sample = data.sample;
                sample.duration = data.started.elapsed().as_secs_f64() * 1000.0;
                record(data.window, sample);
            }
        }
    }
}
