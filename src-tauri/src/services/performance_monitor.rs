use crate::{
    app_data_dir, errors::AppResult, io::write_utf8_no_bom, models::performance_monitor::*,
    parsers::parse_starsector_json,
};
use serde_json::{Value, json};
#[cfg(windows)]
use std::sync::LazyLock;
use std::{
    collections::{BTreeMap, VecDeque},
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
#[cfg(windows)]
use tauri::Manager;

static ENABLED: OnceLock<bool> = OnceLock::new();
static RECORDS: OnceLock<Mutex<Monitor>> = OnceLock::new();
static TRACE: LazyLock<Mutex<Trace>> = LazyLock::new(|| Mutex::new(Trace::default()));
#[cfg(windows)]
static TRACE_CHANNEL: LazyLock<Mutex<Option<std::sync::mpsc::Sender<TraceMessage>>>> =
    LazyLock::new(|| Mutex::new(None));
#[cfg(windows)]
static TRACE_WRITER: LazyLock<Mutex<Option<std::thread::JoinHandle<()>>>> =
    LazyLock::new(|| Mutex::new(None));
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
    window: tauri::WebviewWindow,
    action: PerformanceMonitorAction,
    trace_seconds: Option<u8>,
) -> AppResult<PerformanceMonitorStatus> {
    if !enabled() {
        return Ok(PerformanceMonitorStatus {
            enabled: false,
            records: 0,
            overwritten: 0,
            started_at: 0.0,
            path: String::new(),
            trace_available: false,
            trace_state: "idle".into(),
            trace_seconds: 15,
            trace_started_at: 0.0,
            trace_error: String::new(),
        });
    }
    let mut monitor = state();
    match action {
        PerformanceMonitorAction::Reset => {
            trace_reset()?;
            *monitor = Monitor {
                started_at: now(),
                ..Monitor::default()
            };
        }
        PerformanceMonitorAction::Export => {
            let trace = TRACE.lock().expect("trace state lock");
            if matches!(trace.state.as_str(), "starting" | "recording" | "finishing") {
                return Err(crate::errors::AppError::message(
                    "performance_monitor.trace_active",
                    "stop the active trace before export",
                ));
            }
            let trace_path = (!trace.path.as_os_str().is_empty()).then(|| trace.path.clone());
            drop(trace);
            let directory = app_data_dir::data_directory(app)?.join("performance-monitor");
            std::fs::create_dir_all(&directory)?;
            let timestamp = now() as u64;
            let path = directory.join(format!("{timestamp}.json"));
            write_utf8_no_bom(&path, &serde_json::to_string(&monitor.export())?)?;
            monitor.path = path.to_string_lossy().into_owned();
            if let Some(trace_path) = trace_path {
                std::fs::copy(
                    trace_path,
                    directory.join(format!("{timestamp}-webview-trace.json")),
                )?;
            }
        }
        PerformanceMonitorAction::Status => {}
        PerformanceMonitorAction::TraceStart => {
            trace_start(app, window, trace_seconds.unwrap_or(15))?;
        }
        PerformanceMonitorAction::TraceStop => trace_stop(window)?,
    }
    let trace = TRACE.lock().expect("trace state lock");
    Ok(PerformanceMonitorStatus {
        enabled: true,
        records: monitor.records.len(),
        overwritten: monitor.overwritten,
        started_at: monitor.started_at,
        path: monitor.path.clone(),
        trace_available: cfg!(windows),
        trace_state: trace.state.clone(),
        trace_seconds: trace.seconds,
        trace_started_at: trace.started_at,
        trace_error: trace.error.clone(),
    })
}

struct Trace {
    state: String,
    seconds: u8,
    started_at: f64,
    generation: u64,
    error: String,
    path: PathBuf,
    partial: PathBuf,
    tokens: Option<(i64, i64)>,
}
impl Default for Trace {
    fn default() -> Self {
        Self {
            state: "idle".into(),
            seconds: 15,
            started_at: 0.0,
            generation: 0,
            error: String::new(),
            path: PathBuf::new(),
            partial: PathBuf::new(),
            tokens: None,
        }
    }
}
#[cfg(windows)]
enum TraceMessage {
    Data(String),
    Complete,
    Failed(String),
    Abort,
}
#[cfg(windows)]
type WebView = webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
#[cfg(windows)]
type ProtocolReceiver =
    webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2DevToolsProtocolEventReceiver;
#[cfg(windows)]
type TraceTokens = std::sync::Arc<Mutex<Option<(i64, i64)>>>;
#[cfg(windows)]
type TraceCompletion = (
    WebView,
    ProtocolReceiver,
    ProtocolReceiver,
    TraceTokens,
    u64,
);

#[cfg(windows)]
fn trace_start(app: tauri::AppHandle, window: tauri::WebviewWindow, seconds: u8) -> AppResult<()> {
    use std::sync::Arc;
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
    if window.label() != "main" || !(1..=60).contains(&seconds) {
        return Err(crate::errors::AppError::message(
            "performance_monitor.trace_target",
            "trace requires the main window and a duration from 1 to 60 seconds",
        ));
    }
    let directory = app_data_dir::data_directory(app.clone())?.join("performance-monitor");
    std::fs::create_dir_all(&directory)?;
    let generation = {
        let mut trace = TRACE.lock().expect("trace state lock");
        if matches!(trace.state.as_str(), "starting" | "recording" | "finishing") {
            return Err(crate::errors::AppError::message(
                "performance_monitor.trace_active",
                "a trace is already active",
            ));
        }
        trace.generation += 1;
        trace.state = "starting".into();
        trace.seconds = seconds;
        trace.started_at = now();
        trace.error.clear();
        trace.tokens = None;
        trace.generation
    };
    let timestamp = now() as u64;
    let partial = directory.join(format!("{timestamp}.{generation}.partial"));
    let ready = directory.join(format!("{timestamp}.{generation}.webview-trace.json"));
    TRACE.lock().expect("trace state lock").partial = partial.clone();
    if let Some(writer) = TRACE_WRITER.lock().expect("trace writer lock").take() {
        let _ = writer.join();
    }
    let (sender, receiver) = std::sync::mpsc::channel();
    *TRACE_CHANNEL.lock().expect("trace channel lock") = Some(sender.clone());
    let frames = Arc::new(Mutex::new(std::collections::BTreeSet::new()));
    let writer_frames = frames.clone();
    let writer_partial = partial.clone();
    *TRACE_WRITER.lock().expect("trace writer lock") = Some(std::thread::spawn(move || {
        write_trace(generation, writer_partial, ready, writer_frames, receiver)
    }));
    let timer_app = app.clone();
    if let Err(error) = window.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                trace_failed(generation, error.to_string());
                return;
            }
        };
        let data_name = CoTaskMemPWSTR::from("Tracing.dataCollected");
        let data =
            match unsafe { core.GetDevToolsProtocolEventReceiver(*data_name.as_ref().as_pcwstr()) }
            {
                Ok(receiver) => receiver,
                Err(error) => {
                    trace_failed(generation, error.to_string());
                    return;
                }
            };
        let complete_name = CoTaskMemPWSTR::from("Tracing.tracingComplete");
        let complete = match unsafe {
            core.GetDevToolsProtocolEventReceiver(*complete_name.as_ref().as_pcwstr())
        } {
            Ok(receiver) => receiver,
            Err(error) => {
                trace_failed(generation, error.to_string());
                return;
            }
        };
        let data_token = match listen_trace(&data, sender.clone(), None) {
            Ok(token) => token,
            Err(error) => {
                trace_failed(generation, error.to_string());
                return;
            }
        };
        let tokens = Arc::new(Mutex::new(None));
        let complete_token = match listen_trace(
            &complete,
            sender.clone(),
            Some((
                core.clone(),
                data.clone(),
                complete.clone(),
                tokens.clone(),
                generation,
            )),
        ) {
            Ok(token) => token,
            Err(error) => {
                unsafe {
                    let _ = data.remove_DevToolsProtocolEventReceived(data_token);
                }
                trace_failed(generation, error.to_string());
                return;
            }
        };
        *tokens.lock().expect("trace event token lock") = Some((data_token, complete_token));
        TRACE.lock().expect("trace state lock").tokens = Some((data_token, complete_token));
        let frame_set = frames.clone();
        let query_core = core.clone();
        let started_app = timer_app.clone();
        let started =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, payload| {
                if let Err(error) = result {
                    trace_failed_with_core(generation, &query_core, error.to_string());
                    return Ok(());
                }
                let tree = match parse_starsector_json(&payload) {
                    Ok(tree) => tree,
                    Err(error) => {
                        trace_failed_with_core(generation, &query_core, error.to_string());
                        return Ok(());
                    }
                };
                let mut frames = frame_set.lock().expect("frame lock");
                collect_webview_frames(&tree["frameTree"], &mut frames);
                if frames.is_empty() {
                    trace_failed_with_core(
                        generation,
                        &query_core,
                        "main window frame tree is empty".into(),
                    );
                    return Ok(());
                }
                drop(frames);
                let start_core = query_core.clone();
                let confirmed_app = started_app.clone();
                let confirmed = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |result, _| {
                        if let Err(error) = result {
                            trace_failed_with_core(generation, &start_core, error.to_string());
                        } else {
                            let active = {
                                let mut trace = TRACE.lock().expect("trace state lock");
                                if trace.generation == generation && trace.state == "starting" {
                                    trace.state = "recording".into();
                                    trace.started_at = now();
                                    true
                                } else {
                                    false
                                }
                            };
                            if active {
                                std::thread::spawn(move || {
                                    std::thread::sleep(std::time::Duration::from_secs(
                                        seconds.into(),
                                    ));
                                    if let Some(window) = confirmed_app.get_webview_window("main") {
                                        let _ = trace_stop_generation(window, generation);
                                    }
                                });
                            }
                        }
                        Ok(())
                    },
                ));
                let method = CoTaskMemPWSTR::from("Tracing.start");
                let params = CoTaskMemPWSTR::from(
                    r#"{"categories":"*,disabled-by-default-*","transferMode":"ReportEvents"}"#,
                );
                if let Err(error) = unsafe {
                    query_core.CallDevToolsProtocolMethod(
                        *method.as_ref().as_pcwstr(),
                        *params.as_ref().as_pcwstr(),
                        &confirmed,
                    )
                } {
                    trace_failed_with_core(generation, &query_core, error.to_string());
                }
                Ok(())
            }));
        let method = CoTaskMemPWSTR::from("Page.getFrameTree");
        let params = CoTaskMemPWSTR::from("{}");
        if let Err(error) = unsafe {
            core.CallDevToolsProtocolMethod(
                *method.as_ref().as_pcwstr(),
                *params.as_ref().as_pcwstr(),
                &started,
            )
        } {
            trace_failed_with_core(generation, &core, error.to_string());
        }
    }) {
        trace_failed(generation, error.to_string());
        return Err(error.into());
    }
    Ok(())
}

#[cfg(windows)]
fn listen_trace(
    receiver: &ProtocolReceiver,
    sender: std::sync::mpsc::Sender<TraceMessage>,
    completion: Option<TraceCompletion>,
) -> webview2_com::Result<i64> {
    use webview2_com::{CoTaskMemPWSTR, DevToolsProtocolEventReceivedEventHandler};
    let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
        if let Some((core, data, complete, tokens, generation)) = &completion {
            if let Some(tokens) = tokens.lock().expect("trace event token lock").take() {
                remove_trace_listeners(core, data, complete, tokens);
                let mut trace = TRACE.lock().expect("trace state lock");
                if trace.generation == *generation {
                    trace.tokens = None;
                    TRACE_CHANNEL.lock().expect("trace channel lock").take();
                }
            }
            let _ = sender.send(TraceMessage::Complete);
        } else if let Some(args) = args {
            let mut output = std::mem::MaybeUninit::uninit();
            if unsafe { args.ParameterObjectAsJson(output.as_mut_ptr()) }.is_ok() {
                let payload = CoTaskMemPWSTR::from(unsafe { output.assume_init() });
                let _ = sender.send(TraceMessage::Data(payload.to_string()));
            }
        }
        Ok(())
    }));
    let mut token = 0;
    unsafe {
        receiver.add_DevToolsProtocolEventReceived(&handler, &mut token)?;
    }
    Ok(token)
}

#[cfg(windows)]
fn trace_stop(window: tauri::WebviewWindow) -> AppResult<()> {
    trace_stop_inner(window, None)
}
#[cfg(windows)]
fn trace_stop_generation(window: tauri::WebviewWindow, generation: u64) -> AppResult<()> {
    trace_stop_inner(window, Some(generation))
}
#[cfg(windows)]
fn trace_stop_inner(window: tauri::WebviewWindow, generation: Option<u64>) -> AppResult<()> {
    use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR};
    if window.label() != "main" {
        return Err(crate::errors::AppError::message(
            "performance_monitor.trace_target",
            "trace control requires the main window",
        ));
    }
    let mut trace = TRACE.lock().expect("trace state lock");
    if trace.state != "recording"
        || generation.is_some_and(|generation| generation != trace.generation)
    {
        return Ok(());
    }
    let generation = trace.generation;
    trace.state = "finishing".into();
    drop(trace);
    if let Err(error) = window.with_webview(move |platform| {
        let core = match unsafe { platform.controller().CoreWebView2() } {
            Ok(core) => core,
            Err(error) => {
                trace_failed(generation, error.to_string());
                return;
            }
        };
        let done_core = core.clone();
        let done =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, _| {
                if let Err(error) = result {
                    trace_failed_with_core(generation, &done_core, error.to_string());
                }
                Ok(())
            }));
        let method = CoTaskMemPWSTR::from("Tracing.end");
        let params = CoTaskMemPWSTR::from("{}");
        if let Err(error) = unsafe {
            core.CallDevToolsProtocolMethod(
                *method.as_ref().as_pcwstr(),
                *params.as_ref().as_pcwstr(),
                &done,
            )
        } {
            trace_failed_with_core(generation, &core, error.to_string());
        }
    }) {
        trace_failed(generation, error.to_string());
        return Err(error.into());
    }
    Ok(())
}

#[cfg(not(windows))]
fn trace_start(
    _app: tauri::AppHandle,
    _window: tauri::WebviewWindow,
    _seconds: u8,
) -> AppResult<()> {
    Err(crate::errors::AppError::message(
        "performance_monitor.trace_unavailable",
        "WebView trace is available only on Windows",
    ))
}
#[cfg(not(windows))]
fn trace_stop(_window: tauri::WebviewWindow) -> AppResult<()> {
    Ok(())
}

#[cfg(windows)]
fn remove_trace_listeners(
    core: &WebView,
    data: &ProtocolReceiver,
    complete: &ProtocolReceiver,
    tokens: (i64, i64),
) {
    unsafe {
        let _ = data.remove_DevToolsProtocolEventReceived(tokens.0);
        let _ = complete.remove_DevToolsProtocolEventReceived(tokens.1);
    }
    let _ = core;
}
#[cfg(windows)]
fn trace_failed_with_core(generation: u64, core: &WebView, error: String) {
    let tokens = {
        let mut trace = TRACE.lock().expect("trace state lock");
        if trace.generation != generation {
            return;
        }
        trace.tokens.take()
    };
    if let Some(tokens) = tokens {
        use webview2_com::CoTaskMemPWSTR;
        for (name, token) in [
            ("Tracing.dataCollected", tokens.0),
            ("Tracing.tracingComplete", tokens.1),
        ] {
            let name = CoTaskMemPWSTR::from(name);
            if let Ok(receiver) =
                unsafe { core.GetDevToolsProtocolEventReceiver(*name.as_ref().as_pcwstr()) }
            {
                unsafe {
                    let _ = receiver.remove_DevToolsProtocolEventReceived(token);
                }
            }
        }
    }
    trace_failed(generation, error);
}
#[cfg(windows)]
#[cfg(windows)]
fn write_trace(
    generation: u64,
    partial: PathBuf,
    ready: PathBuf,
    frames: std::sync::Arc<Mutex<std::collections::BTreeSet<String>>>,
    receiver: std::sync::mpsc::Receiver<TraceMessage>,
) {
    use std::io::Write;
    let result = (|| -> AppResult<bool> {
        let mut file = std::fs::File::create(&partial)?;
        file.write_all(br#"{"traceEvents":["#)?;
        let mut first = true;
        while let Ok(message) = receiver.recv() {
            match message {
                TraceMessage::Data(raw) => {
                    let value = parse_starsector_json(&raw)?;
                    let frames = frames.lock().expect("frame lock");
                    for event in value["value"].as_array().into_iter().flatten() {
                        if is_main_webview_event(event, &frames) {
                            if !first {
                                file.write_all(b",")?;
                            }
                            serde_json::to_writer(&mut file, event)?;
                            first = false;
                        }
                    }
                }
                TraceMessage::Complete => break,
                TraceMessage::Failed(error) => {
                    return Err(crate::errors::AppError::message(
                        "performance_monitor.trace_failed",
                        error,
                    ));
                }
                TraceMessage::Abort => {
                    drop(file);
                    let _ = std::fs::remove_file(&partial);
                    return Ok(false);
                }
            }
        }
        file.write_all(b"]}")?;
        file.sync_all()?;
        std::fs::rename(&partial, &ready)?;
        Ok(true)
    })();
    match result {
        Err(error) => {
            let _ = std::fs::remove_file(&partial);
            trace_failed(generation, error.to_string());
            return;
        }
        Ok(false) => return,
        Ok(true) => {}
    }
    let mut trace = TRACE.lock().expect("trace state lock");
    if trace.generation != generation {
        let _ = std::fs::remove_file(ready);
        return;
    }
    let old = std::mem::replace(&mut trace.path, ready);
    trace.partial = PathBuf::new();
    trace.state = "ready".into();
    trace.error.clear();
    if !old.as_os_str().is_empty() {
        let _ = std::fs::remove_file(old);
    }
}
#[cfg(windows)]
fn trace_failed(generation: u64, error: String) {
    let mut trace = TRACE.lock().expect("trace state lock");
    if trace.generation != generation {
        return;
    }
    trace.state = "failed".into();
    trace.error = error.clone();
    let _ = std::fs::remove_file(&trace.partial);
    trace.partial = PathBuf::new();
    if let Some(sender) = TRACE_CHANNEL.lock().expect("trace channel lock").take() {
        let _ = sender.send(TraceMessage::Failed(error));
    }
}
fn trace_reset() -> AppResult<()> {
    let mut trace = TRACE.lock().expect("trace state lock");
    if matches!(trace.state.as_str(), "starting" | "recording" | "finishing") {
        return Err(crate::errors::AppError::message(
            "performance_monitor.trace_active",
            "stop the active trace before reset",
        ));
    }
    for path in [&trace.path, &trace.partial] {
        if !path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(path);
        }
    }
    let generation = trace.generation + 1;
    *trace = Trace {
        generation,
        ..Trace::default()
    };
    drop(trace);
    #[cfg(windows)]
    if let Some(writer) = TRACE_WRITER.lock().expect("trace writer lock").take() {
        let _ = writer.join();
    }
    Ok(())
}
pub fn shutdown() {
    #[cfg(windows)]
    {
        if let Some(sender) = TRACE_CHANNEL.lock().expect("trace channel lock").take() {
            let _ = sender.send(TraceMessage::Abort);
        }
        if let Some(writer) = TRACE_WRITER.lock().expect("trace writer lock").take() {
            let _ = writer.join();
        }
    }
    let mut trace = TRACE.lock().expect("trace state lock");
    for path in [&trace.path, &trace.partial] {
        if !path.as_os_str().is_empty() {
            let _ = std::fs::remove_file(path);
        }
    }
    *trace = Trace::default();
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

#[cfg(all(test, feature = "performance-monitor"))]
#[path = "command_timing_tests.rs"]
mod command_tests;

pub struct CommandTiming(Option<(std::time::Instant, String, PerformanceSample)>);
impl CommandTiming {
    fn start(active: bool, command: &str, window: &str, request: Option<&str>) -> Self {
        if !active || command.starts_with("performance_monitor_") || command.contains("app_log") {
            return Self(None);
        }
        Self(Some((
            std::time::Instant::now(),
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
impl<'de, R: tauri::Runtime> tauri::ipc::CommandArg<'de, R> for CommandTiming {
    fn from_command(
        command: tauri::ipc::CommandItem<'de, R>,
    ) -> Result<Self, tauri::ipc::InvokeError> {
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
