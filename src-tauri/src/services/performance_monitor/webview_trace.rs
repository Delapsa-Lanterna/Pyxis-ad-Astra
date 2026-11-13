use super::now;
use crate::app_data_dir;
use crate::errors::{AppError, AppResult};
use crate::models::performance_monitor::{collect_webview_frames, is_main_webview_event};
use crate::parsers::tool_json::parse_persisted_json;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs::{self, File};
use std::io::Write;
use std::mem::{self, MaybeUninit};
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, LazyLock, Mutex, mpsc};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewWindow};
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, CoTaskMemPWSTR,
    DevToolsProtocolEventReceivedEventHandler, Microsoft, Result as WebviewResult,
};

static TRACE: LazyLock<Mutex<Trace>> = LazyLock::new(|| Mutex::new(Trace::default()));
static TRACE_CHANNEL: LazyLock<Mutex<Option<Sender<TraceMessage>>>> =
    LazyLock::new(|| Mutex::new(None));
static TRACE_WRITER: LazyLock<Mutex<Option<JoinHandle<()>>>> = LazyLock::new(|| Mutex::new(None));

pub(super) struct Snapshot {
    pub state: String,
    pub seconds: u8,
    pub started_at: f64,
    pub error: String,
    pub path: Option<PathBuf>,
}
pub(super) fn snapshot() -> Snapshot {
    let trace = TRACE.lock().expect("trace state lock");
    Snapshot {
        state: trace.state.clone(),
        seconds: trace.seconds,
        started_at: trace.started_at,
        error: trace.error.clone(),
        path: (!trace.path.as_os_str().is_empty()).then(|| trace.path.clone()),
    }
}
pub(super) fn require_idle() -> AppResult<()> {
    if matches!(
        TRACE.lock().expect("trace state lock").state.as_str(),
        "starting" | "recording" | "finishing"
    ) {
        return Err(AppError::message(
            "performance_monitor.trace_active",
            "stop the active trace before changing stored results",
        ));
    }
    Ok(())
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
type WebView = Microsoft::Web::WebView2::Win32::ICoreWebView2;
#[cfg(windows)]
type ProtocolReceiver = Microsoft::Web::WebView2::Win32::ICoreWebView2DevToolsProtocolEventReceiver;
#[cfg(windows)]
type TraceTokens = Arc<Mutex<Option<(i64, i64)>>>;
#[cfg(windows)]
type TraceCompletion = (
    WebView,
    ProtocolReceiver,
    ProtocolReceiver,
    TraceTokens,
    u64,
);

#[cfg(windows)]
pub(super) fn start(app: AppHandle, window: &WebviewWindow, seconds: u8) -> AppResult<()> {
    if window.label() != "main" || !(1..=60).contains(&seconds) {
        return Err(AppError::message(
            "performance_monitor.trace_target",
            "trace requires the main window and a duration from 1 to 60 seconds",
        ));
    }
    let directory = app_data_dir::data_directory(&app)?.join("performance-monitor");
    fs::create_dir_all(&directory)?;
    let generation = {
        let mut trace = TRACE.lock().expect("trace state lock");
        if matches!(trace.state.as_str(), "starting" | "recording" | "finishing") {
            return Err(AppError::message(
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
    TRACE
        .lock()
        .expect("trace state lock")
        .partial
        .clone_from(&partial);
    if let Some(writer) = TRACE_WRITER.lock().expect("trace writer lock").take() {
        let _ = writer.join();
    }
    let (sender, receiver) = mpsc::channel();
    *TRACE_CHANNEL.lock().expect("trace channel lock") = Some(sender.clone());
    let frames = Arc::new(Mutex::new(BTreeSet::new()));
    let writer_frames = frames.clone();
    let writer_partial = partial;
    *TRACE_WRITER.lock().expect("trace writer lock") = Some(thread::spawn(move || {
        write_trace(generation, writer_partial, ready, writer_frames, receiver)
    }));
    let timer_app = app;
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
                let tree = match parse_persisted_json::<Value>(&payload) {
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
                                thread::spawn(move || {
                                    thread::sleep(Duration::from_secs(seconds.into()));
                                    if let Some(window) = confirmed_app.get_webview_window("main") {
                                        let _ = trace_stop_generation(&window, generation);
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
    sender: Sender<TraceMessage>,
    completion: Option<TraceCompletion>,
) -> WebviewResult<i64> {
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
            let mut output = MaybeUninit::uninit();
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
pub(super) fn stop(window: &WebviewWindow) -> AppResult<()> {
    trace_stop_inner(window, None)
}
#[cfg(windows)]
fn trace_stop_generation(window: &WebviewWindow, generation: u64) -> AppResult<()> {
    trace_stop_inner(window, Some(generation))
}
#[cfg(windows)]
fn trace_stop_inner(window: &WebviewWindow, generation: Option<u64>) -> AppResult<()> {
    if window.label() != "main" {
        return Err(AppError::message(
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
pub(super) fn start(_app: AppHandle, _window: WebviewWindow, _seconds: u8) -> AppResult<()> {
    Err(AppError::message(
        "performance_monitor.trace_unavailable",
        "WebView trace is available only on Windows",
    ))
}
#[cfg(not(windows))]
pub(super) fn stop(_window: WebviewWindow) -> AppResult<()> {
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
#[expect(
    clippy::needless_pass_by_value,
    reason = "The trace writer owns its paths, frame registry and receiver until the thread exits."
)]
fn write_trace(
    generation: u64,
    partial: PathBuf,
    ready: PathBuf,
    frames: Arc<Mutex<BTreeSet<String>>>,
    receiver: Receiver<TraceMessage>,
) {
    let result = (|| -> AppResult<bool> {
        let mut file = File::create(&partial)?;
        file.write_all(br#"{"traceEvents":["#)?;
        let mut first = true;
        while let Ok(message) = receiver.recv() {
            match message {
                TraceMessage::Data(trace_json) => {
                    let value = parse_persisted_json::<Value>(&trace_json)?;
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
                    return Err(AppError::message("performance_monitor.trace_failed", error));
                }
                TraceMessage::Abort => {
                    drop(file);
                    let _ = fs::remove_file(&partial);
                    return Ok(false);
                }
            }
        }
        file.write_all(b"]}")?;
        file.sync_all()?;
        fs::rename(&partial, &ready)?;
        Ok(true)
    })();
    match result {
        Err(error) => {
            let _ = fs::remove_file(&partial);
            trace_failed(generation, error.to_string());
            return;
        }
        Ok(false) => return,
        Ok(true) => {}
    }
    let mut trace = TRACE.lock().expect("trace state lock");
    if trace.generation != generation {
        let _ = fs::remove_file(ready);
        return;
    }
    let old = mem::replace(&mut trace.path, ready);
    trace.partial = PathBuf::new();
    trace.state = "ready".into();
    trace.error.clear();
    if !old.as_os_str().is_empty() {
        let _ = fs::remove_file(old);
    }
}
#[cfg(windows)]
fn trace_failed(generation: u64, error: String) {
    let mut trace = TRACE.lock().expect("trace state lock");
    if trace.generation != generation {
        return;
    }
    trace.state = "failed".into();
    trace.error.clone_from(&error);
    let _ = fs::remove_file(&trace.partial);
    trace.partial = PathBuf::new();
    if let Some(sender) = TRACE_CHANNEL.lock().expect("trace channel lock").take() {
        let _ = sender.send(TraceMessage::Failed(error));
    }
}
pub(super) fn reset() -> AppResult<()> {
    let mut trace = TRACE.lock().expect("trace state lock");
    if matches!(trace.state.as_str(), "starting" | "recording" | "finishing") {
        return Err(AppError::message(
            "performance_monitor.trace_active",
            "stop the active trace before reset",
        ));
    }
    for path in [&trace.path, &trace.partial] {
        if !path.as_os_str().is_empty() {
            let _ = fs::remove_file(path);
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
pub(super) fn shutdown() {
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
            let _ = fs::remove_file(path);
        }
    }
    *trace = Trace::default();
}
