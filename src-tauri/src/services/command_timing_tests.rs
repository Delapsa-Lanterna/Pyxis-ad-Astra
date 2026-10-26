use super::*;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::Manager;

static TEST_LOCK: Mutex<()> = Mutex::new(());
#[derive(Default)]
struct Gate {
    entered: AtomicBool,
    released: AtomicBool,
    waker: Mutex<Option<std::task::Waker>>,
}
mod commands {
    use super::*;
    #[command_macros::command]
    pub fn timing_sync(value: i32) -> i32 {
        value + 1
    }
    #[command_macros::command(async)]
    pub fn timing_pool(value: i32) -> i32 {
        value * 2
    }
    #[command_macros::command(async)]
    pub fn timing_error(value: i32) -> Result<i32, String> {
        let value = (value > 0).then_some(value).ok_or("rejected")?;
        Ok(value)
    }
    #[command_macros::command(async, rename = "timing_wire", rename_all = "snake_case")]
    pub fn timing_renamed(left_value: i32, right_value: i32) -> i32 {
        left_value + right_value
    }
    #[command_macros::command]
    pub async fn timing_async(value: i32, gate: tauri::State<'_, Gate>) -> Result<i32, String> {
        std::future::poll_fn(|context| {
            *gate.waker.lock().unwrap() = Some(context.waker().clone());
            gate.entered.store(true, Ordering::SeqCst);
            if gate.released.load(Ordering::SeqCst) {
                std::task::Poll::Ready(())
            } else {
                std::task::Poll::Pending
            }
        })
        .await;
        Ok(value)
    }
    #[command_macros::command]
    pub fn performance_monitor_fixture() -> bool {
        true
    }
}
fn reset() -> std::sync::MutexGuard<'static, ()> {
    let lock = TEST_LOCK.lock().unwrap();
    initialize(true);
    state()
        .records
        .retain(|(_, sample)| !sample.name.starts_with("timing_"));
    lock
}
fn records() -> Vec<(String, PerformanceSample)> {
    state()
        .records
        .iter()
        .filter(|(_, sample)| sample.name.starts_with("timing_"))
        .cloned()
        .collect()
}
fn app() -> tauri::App<tauri::test::MockRuntime> {
    tauri::test::mock_builder()
        .manage(Gate::default())
        .invoke_handler(command_macros::generate_handler![
            commands::timing_sync,
            commands::timing_pool,
            commands::timing_error,
            commands::timing_renamed,
            commands::timing_async,
            commands::performance_monitor_fixture,
        ])
        .build(tauri::test::mock_context(tauri::test::noop_assets()))
        .unwrap()
}
fn window(
    app: &tauri::App<tauri::test::MockRuntime>,
    name: &str,
) -> tauri::WebviewWindow<tauri::test::MockRuntime> {
    tauri::WebviewWindowBuilder::new(app, name, Default::default())
        .build()
        .unwrap()
}
fn call(
    window: &tauri::WebviewWindow<tauri::test::MockRuntime>,
    command: &str,
    request: &str,
    body: Value,
) -> Result<Value, Value> {
    let mut message = tauri::webview::InvokeRequest {
        cmd: command.into(),
        callback: tauri::ipc::CallbackFn(0),
        error: tauri::ipc::CallbackFn(1),
        url: "http://tauri.localhost".parse().unwrap(),
        body: tauri::ipc::InvokeBody::Json(body),
        headers: Default::default(),
        invoke_key: tauri::test::INVOKE_KEY.into(),
    };
    message
        .headers
        .insert("x-performance-request", request.parse().unwrap());
    tauri::test::get_ipc_response(window, message).map(|body| body.deserialize().unwrap())
}
#[test]
fn synchronous_command_identity() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "main");
    assert_eq!(
        call(&window, "timing_sync", "main:1", json!({"value": 3})),
        Ok(json!(4))
    );
    let records = records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].0, "main");
    assert_eq!(records[0].1.name, "timing_sync");
    assert_eq!(records[0].1.category, "backend");
    assert_eq!(records[0].1.fields["request"], "main:1");
    assert!(records[0].1.started_at > 0.0 && records[0].1.duration >= 0.0);
}
#[test]
fn threadpool_command_completion() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "main");
    assert_eq!(
        call(&window, "timing_pool", "main:2", json!({"value": 4})),
        Ok(json!(8))
    );
    assert_eq!(records().len(), 1);
}
#[test]
fn early_error_finishes_once() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "main");
    assert_eq!(
        call(&window, "timing_error", "main:3", json!({"value": 0})),
        Err(json!("rejected"))
    );
    assert_eq!(records().len(), 1);
}
#[test]
fn renamed_command_and_arguments() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "main");
    assert_eq!(
        call(
            &window,
            "timing_wire",
            "main:4",
            json!({"left_value": 4, "right_value": 5})
        ),
        Ok(json!(9))
    );
    assert_eq!(records()[0].1.name, "timing_wire");
}
#[test]
fn async_timer_covers_waiting() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "child");
    let task =
        std::thread::spawn(move || call(&window, "timing_async", "child:5", json!({"value": 11})));
    let gate = app.state::<Gate>();
    while !gate.entered.load(Ordering::SeqCst) {
        std::thread::yield_now();
    }
    assert!(records().is_empty());
    gate.released.store(true, Ordering::SeqCst);
    gate.waker.lock().unwrap().take().unwrap().wake();
    assert_eq!(task.join().unwrap(), Ok(json!(11)));
    let records = records();
    assert_eq!(records.len(), 1);
    assert_eq!(records[0].0, "child");
    assert_eq!(records[0].1.fields["request"], "child:5");
}
#[test]
fn concurrent_windows_keep_identity() {
    let _lock = reset();
    let app = app();
    let a = window(&app, "main");
    let b = window(&app, "child");
    let left = std::thread::spawn(move || call(&a, "timing_pool", "main:6", json!({"value": 3})));
    let right = std::thread::spawn(move || call(&b, "timing_pool", "child:6", json!({"value": 7})));
    assert_eq!(left.join().unwrap(), Ok(json!(6)));
    assert_eq!(right.join().unwrap(), Ok(json!(14)));
    let records = records();
    assert_eq!(records.len(), 2);
    assert!(
        records
            .iter()
            .any(|(window, row)| window == "main" && row.fields["request"] == "main:6")
    );
    assert!(
        records
            .iter()
            .any(|(window, row)| window == "child" && row.fields["request"] == "child:6")
    );
}
#[test]
fn disabled_and_monitor_calls_are_excluded() {
    let _lock = reset();
    let app = app();
    let window = window(&app, "main");
    assert!(
        CommandTiming::start(false, "timing_disabled", "main", None)
            .0
            .is_none()
    );
    assert!(
        CommandTiming::start(true, "append_app_logs", "main", None)
            .0
            .is_none()
    );
    assert_eq!(
        call(&window, "performance_monitor_fixture", "main:7", json!({})),
        Ok(json!(true))
    );
    assert!(records().is_empty());
}
#[test]
fn direct_calls_keep_business_signatures() {
    let _lock = reset();
    assert_eq!(commands::timing_sync(5), 6);
    assert_eq!(commands::timing_renamed(2, 4), 6);
    assert_eq!(commands::timing_error(0), Err("rejected".into()));
    assert!(records().is_empty());
}
