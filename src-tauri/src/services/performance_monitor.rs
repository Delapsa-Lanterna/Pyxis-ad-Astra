use crate::app_data_dir;
use crate::errors::AppResult;
use crate::io::write_utf8_no_bom;
use crate::models::performance_monitor::{
    PerformanceBatch, PerformanceMonitorAction, PerformanceMonitorStatus, PerformanceSample,
};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::collections::{BTreeMap, VecDeque};
use std::env::consts::{ARCH, OS};
use std::fs;
use std::sync::{Mutex, MutexGuard, OnceLock};
use std::time::{Instant, SystemTime, UNIX_EPOCH};
use tauri::ipc::{CommandArg, CommandItem, InvokeError};
use tauri::{AppHandle, Runtime, WebviewWindow};

#[cfg(all(test, feature = "performance-monitor"))]
#[path = "command_timing_tests.rs"]
mod command_tests;
#[cfg(test)]
#[path = "performance_monitor_tests.rs"]
mod tests;
#[cfg(windows)]
mod webview_trace;

const RECORD_LIMIT: usize = 50_000;
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
pub fn now() -> f64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after epoch")
        .as_secs_f64()
        * 1000.0
}
pub fn enabled() -> bool {
    ENABLED.get().copied().unwrap_or(false)
}
pub fn initialize(requested: bool) {
    ENABLED.get_or_init(|| {
        let enabled = requested && cfg!(feature = "performance-monitor");
        if enabled {
            RECORDS.get_or_init(|| {
                Mutex::new(Monitor {
                    started_at: now(),
                    ..Default::default()
                })
            });
        }
        enabled
    });
}
fn state() -> MutexGuard<'static, Monitor> {
    RECORDS
        .get()
        .expect("monitor initialized")
        .lock()
        .expect("monitor state lock")
}
pub fn record(window: String, sample: PerformanceSample) {
    state().push(window, sample);
}
pub fn deliver(window: &str, batch: PerformanceBatch) {
    if !enabled() {
        return;
    }
    let mut monitor = state();
    monitor.overwritten += batch.overwritten;
    monitor.windows.insert(
        window.into(),
        json!({"environment":batch.environment,"deliveredAt":now()}),
    );
    for sample in batch.samples {
        monitor.push(window.into(), sample);
    }
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
        if self.records.len() == RECORD_LIMIT {
            self.records.pop_front();
            self.overwritten += 1;
        }
        self.records.push_back((window, sample));
    }
    fn export(&self) -> Value {
        let threads = self
            .records
            .iter()
            .map(|(window, _)| window)
            .chain(self.windows.keys())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .enumerate()
            .map(|(index, name)| (name, index))
            .collect::<BTreeMap<_, _>>();
        let mut groups = BTreeMap::<(&str, &str), Vec<f64>>::new();
        let mut events = threads.iter().map(|(name,index)| json!({"name":"thread_name","ph":"M","pid":1,"tid":index,"args":{"name":name}})).collect::<Vec<_>>();
        for (window, sample) in &self.records {
            groups
                .entry((&sample.category, &sample.name))
                .or_default()
                .push(sample.duration);
            events.push(json!({"name":sample.name,"cat":sample.category,"ph":"X","ts":sample.started_at*1000.0,"dur":sample.duration*1000.0,
                "pid":1,"tid":threads[window],"args":sample.fields}));
        }
        let statistics = groups.into_iter().map(|((category,name),mut values)| {
            values.sort_by(f64::total_cmp);let n=values.len();
            json!({"category":category,"name":name,"n":n,"min":values[0],"max":values[n-1],"mean":values.iter().sum::<f64>()/n as f64,
                "median":(values[(n-1)/2]+values[n/2])/2.0,"p95":values[(n*95).div_ceil(100)-1]})
        }).collect::<Vec<_>>();
        json!({"traceEvents":events,"displayTimeUnit":"ms","statistics":statistics,"windows":self.windows,"startedAt":self.started_at,
            "overwritten":self.overwritten,"version":env!("CARGO_PKG_VERSION"),"platform":OS,"architecture":ARCH})
    }
}
pub fn report(
    app: AppHandle,
    window: WebviewWindow,
    action: PerformanceMonitorAction,
    seconds: Option<u8>,
) -> AppResult<PerformanceMonitorStatus> {
    let mut result = PerformanceMonitorStatus {
        enabled: enabled(),
        records: 0,
        overwritten: 0,
        started_at: 0.0,
        path: String::new(),
        trace_available: cfg!(windows),
        trace_state: "idle".into(),
        trace_seconds: 15,
        trace_started_at: 0.0,
        trace_error: String::new(),
    };
    if !enabled() {
        result.trace_available = false;
        return Ok(result);
    }
    let mut monitor = state();
    match action {
        PerformanceMonitorAction::Status => {}
        PerformanceMonitorAction::Reset => {
            #[cfg(windows)]
            webview_trace::reset()?;
            *monitor = Monitor {
                started_at: now(),
                ..Default::default()
            };
        }
        PerformanceMonitorAction::Export => {
            #[cfg(windows)]
            webview_trace::require_idle()?;
            let folder = app_data_dir::data_directory(app)?.join("performance-monitor");
            fs::create_dir_all(&folder)?;
            let timestamp = now() as u64;
            let path = folder.join(format!("{timestamp}.json"));
            write_utf8_no_bom(&path, &serde_json::to_string(&monitor.export())?)?;
            monitor.path = path.to_string_lossy().into_owned();
            #[cfg(windows)]
            if let Some(source) = webview_trace::snapshot().path {
                fs::copy(
                    source,
                    folder.join(format!("{timestamp}-webview-trace.json")),
                )?;
            }
        }
        PerformanceMonitorAction::TraceStart => {
            #[cfg(windows)]
            webview_trace::start(app, window, seconds.unwrap_or(15))?;
        }
        PerformanceMonitorAction::TraceStop => {
            #[cfg(windows)]
            webview_trace::stop(window)?;
        }
    }
    result.records = monitor.records.len();
    result.overwritten = monitor.overwritten;
    result.started_at = monitor.started_at;
    result.path = monitor.path.clone();
    #[cfg(windows)]
    {
        let trace = webview_trace::snapshot();
        result.trace_state = trace.state;
        result.trace_seconds = trace.seconds;
        result.trace_started_at = trace.started_at;
        result.trace_error = trace.error;
    }
    Ok(result)
}
pub fn shutdown() {
    #[cfg(windows)]
    webview_trace::shutdown();
}
pub struct CommandTiming(Option<(Instant, String, PerformanceSample)>);
impl CommandTiming {
    fn start(active: bool, command: &str, window: &str, request: Option<&str>) -> Self {
        if !active || command.starts_with("performance_monitor_") || command.contains("app_log") {
            return Self(None);
        }
        Self(Some((
            Instant::now(),
            window.into(),
            PerformanceSample {
                name: command.into(),
                category: "backend".into(),
                started_at: now(),
                duration: 0.0,
                fields: BTreeMap::from([(
                    "request".into(),
                    request.map(Value::from).unwrap_or(Value::Null),
                )]),
            },
        )))
    }
}
impl<'de, R: Runtime> CommandArg<'de, R> for CommandTiming {
    fn from_command(command: CommandItem<'de, R>) -> Result<Self, InvokeError> {
        Ok(Self::start(
            enabled(),
            command.message.command(),
            command.message.webview_ref().label(),
            command
                .message
                .headers()
                .get("x-performance-request")
                .and_then(|value| value.to_str().ok()),
        ))
    }
}
impl Drop for CommandTiming {
    fn drop(&mut self) {
        if let Some((started, window, mut sample)) = self.0.take() {
            sample.duration = started.elapsed().as_secs_f64() * 1000.0;
            record(window, sample);
        }
    }
}
