use crate::{
    errors::{AppError, AppResult},
    io::write_utf8_no_bom,
    models::{AppLogEntry, AppLogLevel, AppLogStatus, AppSettings, LOG_FILE},
    services::app_paths,
};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};
use tauri::Emitter;

static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());
static NATIVE_DRAIN: Mutex<()> = Mutex::new(());
static NATIVE_QUEUE: LazyLock<Mutex<NativeQueue>> =
    LazyLock::new(|| Mutex::new(NativeQueue::default()));
static LOG_RUNTIME: LazyLock<Mutex<LogRuntime>> =
    LazyLock::new(|| Mutex::new(LogRuntime::default()));

#[derive(Default)]
struct LogRuntime {
    settings: Option<AppSettings>,
    last_error: Option<String>,
    losses: BTreeMap<String, u64>,
}

#[derive(Default)]
struct NativeQueue {
    entries: Vec<AppLogEntry>,
    sequence: u64,
    level: Option<AppLogLevel>,
    stopped: bool,
}

impl LogRuntime {
    fn write(
        &mut self,
        owner: &str,
        count: usize,
        write: impl FnOnce() -> AppResult<()>,
    ) -> AppResult<()> {
        let result = if self.last_error.is_some() {
            Err(AppError::message(
                "log.recording_stopped",
                "日志记录已停止，请重新启动应用",
            ))
        } else {
            write()
        };
        if let Err(cause) = &result {
            *self.losses.entry(owner.to_string()).or_default() += count as u64;
            self.last_error.get_or_insert_with(|| cause.to_string());
        }
        result
    }
}

fn runtime() -> AppResult<std::sync::MutexGuard<'static, LogRuntime>> {
    LOG_RUNTIME
        .lock()
        .map_err(|_| AppError::message("log.runtime_poisoned", "log runtime unavailable"))
}

pub fn configure_runtime(settings: &AppSettings) -> AppResult<()> {
    let mut state = runtime()?;
    crate::diagnostics::enable_debug(
        settings.log_level == AppLogLevel::Debug && state.last_error.is_none(),
    );
    state.settings = Some(settings.clone());
    NATIVE_QUEUE
        .lock()
        .expect("native queue lock is scoped to data changes")
        .level = Some(settings.log_level);
    Ok(())
}

pub fn stop_app_log(
    app: &tauri::AppHandle,
    owner: &str,
    message: String,
    dropped: u64,
) -> AppResult<()> {
    let mut state = runtime()?;
    let count = state.losses.entry(owner.to_string()).or_default();
    *count = (*count).max(dropped);
    if state.last_error.is_some() {
        return Ok(());
    }
    state.last_error = Some(message.clone());
    crate::diagnostics::enable_debug(false);
    let pending = stop_native();
    *state.losses.entry("native".to_string()).or_default() += pending;
    drop(state);
    app.emit("app-log-stopped", message).map_err(AppError::from)
}

pub fn append_app_log(mut entry: AppLogEntry) -> AppResult<()> {
    let mut state = NATIVE_QUEUE
        .lock()
        .expect("native queue lock is scoped to data changes");
    if entry.level < state.level.unwrap_or(AppLogLevel::Info) || state.stopped {
        return Ok(());
    }
    state.sequence += 1;
    let fields = entry.fields.get_or_insert_with(BTreeMap::new);
    fields.insert("window".to_string(), "native".to_string());
    fields.insert("sequence".to_string(), state.sequence.to_string());
    fields.insert(
        "timestamp".to_string(),
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    );
    state.entries.push(entry);
    Ok(())
}

pub fn start_native_writer(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(std::time::Duration::from_millis(100));
            if flush_native_logs(app.clone()).is_err() {
                break;
            }
        }
    });
}

pub fn flush_native_logs(app: tauri::AppHandle) -> AppResult<()> {
    let _drain = NATIVE_DRAIN
        .lock()
        .expect("native drain does not execute callbacks");
    let entries = std::mem::take(
        &mut NATIVE_QUEUE
            .lock()
            .expect("native queue lock is scoped to data changes")
            .entries,
    );
    if entries.is_empty() {
        return Ok(());
    }
    append_app_logs(app, "native", entries)
}

fn stop_native() -> u64 {
    let mut queue = NATIVE_QUEUE
        .lock()
        .expect("native queue lock is scoped to data changes");
    queue.stopped = true;
    let pending = queue.entries.len() as u64;
    queue.entries.clear();
    pending
}

pub fn append_app_logs(
    app: tauri::AppHandle,
    owner: &str,
    entries: Vec<AppLogEntry>,
) -> AppResult<()> {
    let mut state = runtime()?;
    append_with_runtime(app, owner, entries, &mut state)
}

fn append_with_runtime(
    app: tauri::AppHandle,
    owner: &str,
    entries: Vec<AppLogEntry>,
    state: &mut LogRuntime,
) -> AppResult<()> {
    let settings = state.settings.clone().unwrap_or_default();
    let result = state.write(owner, entries.len(), || {
        let app_data = app_paths::app_data_dir(app.clone())?;
        let directory = configured_log_directory(&app_data, &settings);
        if settings.log_directory.is_none() {
            fs::create_dir_all(&directory).map_err(|cause| {
                AppError::context("创建日志目录失败".to_string(), cause.into()).at_path(&directory)
            })?;
        }
        append_logs(&directory, &entries, &settings)
    });
    if let Err(cause) = result {
        let message = state
            .last_error
            .clone()
            .expect("failed write retains its diagnostic");
        crate::diagnostics::enable_debug(false);
        let pending = stop_native();
        *state.losses.entry("native".to_string()).or_default() += pending;
        app.emit("app-log-stopped", message)
            .map_err(AppError::from)?;
        return Err(cause);
    }
    Ok(())
}

fn configured_log_directory(app_data: &Path, settings: &AppSettings) -> PathBuf {
    settings
        .log_directory
        .as_ref()
        .map(PathBuf::from)
        .unwrap_or_else(|| app_data.to_path_buf())
}

pub fn app_log_status(app: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let state = runtime()?;
    let settings = state.settings.clone().unwrap_or_default();
    let directory = configured_log_directory(&app_paths::app_data_dir(app)?, &settings);
    let mut status = log_status(&directory)?;
    status.recording = if state.last_error.is_some() {
        "stopped"
    } else if state.settings.is_some() {
        "active"
    } else {
        "uninitialized"
    }
    .to_string();
    status.level = settings.log_level;
    status.last_error = state.last_error.clone();
    status.dropped = state.losses.values().sum();
    status.pending = NATIVE_QUEUE
        .lock()
        .expect("native queue lock is scoped to data changes")
        .entries
        .len() as u64;
    Ok(status)
}

pub fn clear_app_log_file(app: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let _ = flush_native_logs(app.clone());
    let status = app_log_status(app.clone())?;
    clear_log_file(
        Path::new(&status.path)
            .parent()
            .expect("log path has its configured directory"),
    )?;
    app_log_status(app)
}

#[cfg(test)]
pub fn append_log(directory: &Path, entry: &AppLogEntry, settings: &AppSettings) -> AppResult<()> {
    append_logs(directory, std::slice::from_ref(entry), settings)
}

fn append_logs(directory: &Path, entries: &[AppLogEntry], settings: &AppSettings) -> AppResult<()> {
    let _guard = lock_log()?;
    if !directory.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!("日志目录不可用 ({})", directory.display()),
        )
        .at_path(directory));
    }
    rotate_log_file(directory, settings)?;
    let path = log_path(directory);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|cause| {
            AppError::context("打开日志文件失败".to_string(), cause.into()).at_path(&path)
        })?;
    let text: String = entries.iter().map(render_log_entry).collect();
    file.write_all(text.as_bytes()).map_err(|cause| {
        AppError::context("写入日志文件失败".to_string(), cause.into()).at_path(&path)
    })?;
    Ok(())
}

pub fn log_status(directory: &Path) -> AppResult<AppLogStatus> {
    let path = log_path(directory);
    let size_bytes = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(cause) if cause.kind() == std::io::ErrorKind::NotFound => 0,
        Err(cause) => {
            return Err(
                AppError::context("读取日志文件状态失败".to_string(), cause.into()).at_path(&path),
            );
        }
    };
    Ok(AppLogStatus {
        path: path.to_string_lossy().to_string(),
        size_bytes,
        recording: "uninitialized".to_string(),
        level: AppLogLevel::Info,
        last_error: None,
        dropped: 0,
        pending: 0,
    })
}

pub fn clear_log_file(directory: &Path) -> AppResult<()> {
    let _guard = lock_log()?;
    if !directory.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!("日志目录不可用 ({})", directory.display()),
        )
        .at_path(directory));
    }
    let path = log_path(directory);
    write_utf8_no_bom(&path, "")
        .map_err(|cause| AppError::context("清除日志文件失败".to_string(), cause).at_path(&path))
}

pub fn log_path(directory: &Path) -> PathBuf {
    directory.join(LOG_FILE)
}

fn render_log_entry(entry: &AppLogEntry) -> String {
    let timestamp = entry
        .fields
        .as_ref()
        .and_then(|fields| fields.get("timestamp"))
        .cloned()
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true));
    let mut line = format!(
        "[{}] [{}]",
        sanitize_log_value(&timestamp),
        entry.level.as_str()
    );
    if let Some(code) = &entry.code {
        line.push_str(&format!(" [{}]", sanitize_log_value(code)));
    }
    if let Some(message) = &entry.message {
        line.push_str(&format!(" {}", sanitize_log_value(message)));
    }
    if let Some(path) = &entry.path {
        line.push_str(&format!(" | path={}", sanitize_log_value(path)));
    }
    if let Some(number) = entry.line {
        line.push_str(&format!(" | line={number}"));
    }
    if let Some(fields) = &entry.fields {
        for (key, value) in fields {
            if key != "timestamp" {
                line.push_str(&format!(
                    " {}={}",
                    sanitize_log_value(key),
                    sanitize_log_value(value)
                ));
            }
        }
    }
    line.push_str("\r\n");
    line
}

fn sanitize_log_value(value: &str) -> String {
    value.replace(['\r', '\n', '\t'], " ").trim().to_string()
}

fn lock_log() -> AppResult<std::sync::MutexGuard<'static, ()>> {
    LOG_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("log.lock_poisoned", "log write lock poisoned"))
}

fn rotate_log_file(log_directory: &Path, settings: &AppSettings) -> AppResult<()> {
    let path = log_path(log_directory);
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => {
            return Err(
                AppError::context("读取日志大小失败".to_string(), error.into()).at_path(&path),
            );
        }
    };
    if metadata.len() < u64::from(settings.log_rotation_size_mib) * 1024 * 1024 {
        return Ok(());
    }
    let mut backups = Vec::new();
    for entry in fs::read_dir(log_directory).map_err(|error| {
        AppError::context("读取日志目录失败".to_string(), error.into()).at_path(log_directory)
    })? {
        let entry = entry.map_err(|error| {
            AppError::context("读取日志备份失败".to_string(), error.into()).at_path(log_directory)
        })?;
        let name = entry.file_name();
        let Some(suffix) = name
            .to_str()
            .and_then(|name| name.strip_prefix(&format!("{LOG_FILE}.")))
        else {
            continue;
        };
        let Ok(index) = suffix.parse::<u32>() else {
            continue;
        };
        if index > 0 && suffix == index.to_string() {
            backups.push((index, entry.path()));
        }
    }
    // Descending moves preserve every retained generation before its source is replaced.
    backups.sort_by_key(|(index, _)| std::cmp::Reverse(*index));
    for (index, source) in backups {
        if index >= settings.log_backup_count {
            fs::remove_file(&source).map_err(|error| {
                AppError::context("删除日志备份失败".to_string(), error.into()).at_path(&source)
            })?;
        } else {
            let destination = log_directory.join(format!("{LOG_FILE}.{}", index + 1));
            fs::rename(&source, &destination).map_err(|error| {
                AppError::context(
                    format!("移动日志备份失败，目标 {}", destination.display()),
                    error.into(),
                )
                .at_path(&source)
            })?;
        }
    }
    let destination = log_directory.join(format!("{LOG_FILE}.1"));
    fs::rename(&path, &destination).map_err(|error| {
        AppError::context(
            format!("轮转日志失败，目标 {}", destination.display()),
            error.into(),
        )
        .at_path(&path)
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::read_utf8_no_bom;
    use crate::testutil::TestWorkspace;
    use std::collections::BTreeMap;

    fn entry(message: &str) -> AppLogEntry {
        AppLogEntry {
            level: crate::models::AppLogLevel::Info,
            code: None,
            message: Some(message.to_string()),
            path: None,
            line: None,
            fields: None,
        }
    }

    #[test]
    #[ignore = "explicit log file writing measurement"]
    fn measure_log_batch_writes() {
        fn single(directory: &Path, item: &AppLogEntry, settings: &AppSettings) {
            let _guard = lock_log().unwrap();
            crate::io::ensure_file_appendable(&log_path(directory)).unwrap();
            rotate_log_file(directory, settings).unwrap();
            OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path(directory))
                .unwrap()
                .write_all(render_log_entry(item).as_bytes())
                .unwrap();
        }
        fn summary(mut values: Vec<f64>) -> serde_json::Value {
            values.sort_by(f64::total_cmp);
            let n = values.len();
            serde_json::json!({ "n": n, "min": values[0], "max": values[n-1], "mean": values.iter().sum::<f64>() / n as f64,
                "median": (values[(n-1)/2] + values[n/2]) / 2.0, "p95": values[(n as f64 * 0.95).ceil() as usize - 1] })
        }
        let dir = TestWorkspace::new("log_writer_measurement");
        let entries = vec![entry("fixture event"); 1000];
        let settings = AppSettings::default();
        let mut original = Vec::new();
        let mut batch = Vec::new();
        for round in 0..30 {
            for mode in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                clear_log_file(&dir).unwrap();
                let start = std::time::Instant::now();
                if mode == 0 {
                    for item in &entries {
                        single(&dir, item, &settings);
                    }
                } else {
                    for items in entries.chunks(64) {
                        append_logs(&dir, items, &settings).unwrap();
                    }
                }
                let ms = start.elapsed().as_secs_f64() * 1000.0;
                if mode == 0 {
                    original.push(ms);
                } else {
                    batch.push(ms);
                }
                assert_eq!(
                    read_utf8_no_bom(&log_path(&dir)).unwrap().lines().count(),
                    1000
                );
            }
        }
        println!(
            "LOG_WRITE_MEASUREMENT {}",
            serde_json::json!({ "records": 1000, "single": summary(original), "batch64": summary(batch) })
        );
        dir.close().unwrap();
    }

    #[test]
    fn a_failed_writer_stops_subsequent_windows_until_a_new_runtime() {
        let dir = TestWorkspace::new("log_runtime_stop");
        let mut state = LogRuntime::default();
        let records = vec![entry("first"), entry("second")];
        state
            .write("window-a", records.len(), || {
                append_logs(&dir.join("unavailable"), &records, &AppSettings::default())
            })
            .unwrap_err();
        assert!(state.last_error.as_ref().unwrap().contains("不可用"));
        state.settings = Some(AppSettings {
            log_level: AppLogLevel::Debug,
            ..AppSettings::default()
        });
        let mut executed = false;
        state
            .write("window-b", 3, || {
                executed = true;
                Ok(())
            })
            .unwrap_err();
        assert!(!executed);
        assert_eq!(state.losses.values().sum::<u64>(), 5);
        let mut fresh = LogRuntime::default();
        fresh
            .write("window-a", records.len(), || {
                append_logs(&dir, &records, &AppSettings::default())
            })
            .unwrap();
        assert!(fresh.last_error.is_none());
        assert_eq!(
            read_utf8_no_bom(&log_path(&dir)).unwrap().lines().count(),
            2
        );
        dir.close().unwrap();
    }

    #[test]
    fn batch_output_preserves_event_time_order_and_single_line_records() {
        let dir = TestWorkspace::new("log_batch_events");
        let mut first = entry("first\nmessage");
        first.code = Some("fixture\r\ncode".to_string());
        first.path = Some("fixture\tpath".to_string());
        first.fields = Some(BTreeMap::from([
            (
                "timestamp".to_string(),
                "2024-01-01T00:00:00.000Z".to_string(),
            ),
            ("sequence".to_string(), "1".to_string()),
            ("window".to_string(), "fixture".to_string()),
        ]));
        append_logs(&dir, &[first, entry("second")], &AppSettings::default()).unwrap();
        let text = read_utf8_no_bom(&log_path(&dir)).unwrap();
        assert_eq!(text.lines().count(), 2);
        assert!(text.starts_with("[2024-01-01T00:00:00.000Z] [info] [fixture  code] first message | path=fixture path sequence=1 window=fixture"));
        assert!(text.lines().nth(1).unwrap().contains("second"));
        dir.close().unwrap();
    }

    #[test]
    fn rotation_retains_order_and_shrinks_on_the_next_rotation() {
        let dir = TestWorkspace::new("log_retention_order");
        let mut settings = AppSettings {
            log_rotation_size_mib: 1,
            log_backup_count: 3,
            ..AppSettings::default()
        };
        for generation in 1..=4 {
            let text = generation.to_string().repeat(1024 * 1024);
            write_utf8_no_bom(&log_path(&dir), &text).unwrap();
            append_log(&dir, &entry("next"), &settings).unwrap();
        }
        for (index, generation) in [(1, 4), (2, 3), (3, 2)] {
            assert!(
                fs::read_to_string(dir.join(format!("{LOG_FILE}.{index}")))
                    .unwrap()
                    .starts_with(&generation.to_string())
            );
        }
        settings.log_backup_count = 1;
        append_log(&dir, &entry("below threshold"), &settings).unwrap();
        assert!(dir.join(format!("{LOG_FILE}.3")).exists());
        write_utf8_no_bom(&log_path(&dir), &"5".repeat(1024 * 1024)).unwrap();
        append_log(&dir, &entry("after shrink"), &settings).unwrap();
        assert!(
            fs::read_to_string(dir.join(format!("{LOG_FILE}.1")))
                .unwrap()
                .starts_with('5')
        );
        assert!(!dir.join(format!("{LOG_FILE}.2")).exists());
        assert!(!dir.join(format!("{LOG_FILE}.3")).exists());
        dir.close().unwrap();
    }

    #[test]
    fn rotation_uses_the_saved_threshold_and_handles_gaps_in_backups() {
        let dir = TestWorkspace::new("log_retention_gaps");
        let settings = AppSettings {
            log_rotation_size_mib: 2,
            log_backup_count: 4,
            ..AppSettings::default()
        };
        write_utf8_no_bom(&log_path(&dir), &"x".repeat(1024 * 1024)).unwrap();
        append_log(&dir, &entry("below threshold"), &settings).unwrap();
        assert!(!dir.join(format!("{LOG_FILE}.1")).exists());
        write_utf8_no_bom(&dir.join(format!("{LOG_FILE}.1")), "newest").unwrap();
        write_utf8_no_bom(&dir.join(format!("{LOG_FILE}.3")), "oldest").unwrap();
        for suffix in ["01", "0", "notes"] {
            write_utf8_no_bom(&dir.join(format!("{LOG_FILE}.{suffix}")), "other file").unwrap();
        }
        write_utf8_no_bom(&log_path(&dir), &"x".repeat(2 * 1024 * 1024)).unwrap();
        append_log(&dir, &entry("rotated"), &settings).unwrap();
        assert_eq!(
            fs::read_to_string(dir.join(format!("{LOG_FILE}.2"))).unwrap(),
            "newest"
        );
        assert_eq!(
            fs::read_to_string(dir.join(format!("{LOG_FILE}.4"))).unwrap(),
            "oldest"
        );
        for suffix in ["01", "0", "notes"] {
            assert_eq!(
                fs::read_to_string(dir.join(format!("{LOG_FILE}.{suffix}"))).unwrap(),
                "other file"
            );
        }
        dir.close().unwrap();
    }

    #[test]
    fn rotation_failure_reports_the_actual_backup_path() {
        let dir = TestWorkspace::new("log_retention_io_error");
        let backup = dir.join(format!("{LOG_FILE}.1"));
        fs::create_dir(&backup).unwrap();
        write_utf8_no_bom(&log_path(&dir), &"x".repeat(1024 * 1024)).unwrap();
        let settings = AppSettings {
            log_rotation_size_mib: 1,
            ..AppSettings::default()
        };
        let error = append_log(&dir, &entry("rotation fails"), &settings).unwrap_err();
        assert_eq!(error.location().unwrap().path.as_deref(), backup.to_str());
        dir.close().unwrap();
    }

    #[test]
    fn unavailable_directory_errors_keep_the_directory_identity() {
        let dir = TestWorkspace::new("log_directory_identity");
        let missing = dir.join("missing");
        let error = append_log(
            &missing,
            &entry("missing directory"),
            &AppSettings::default(),
        )
        .unwrap_err();
        assert_eq!(error.code(), "log.dir_unavailable");
        assert_eq!(error.location().unwrap().path.as_deref(), missing.to_str());
        let error = clear_log_file(&missing).unwrap_err();
        assert_eq!(error.location().unwrap().path.as_deref(), missing.to_str());
        dir.close().unwrap();
    }

    #[test]
    fn concurrent_appends_preserve_complete_lines_through_rotation() {
        let dir = TestWorkspace::new("log_retention_concurrent");
        let settings = AppSettings {
            log_rotation_size_mib: 1,
            ..AppSettings::default()
        };
        write_utf8_no_bom(&log_path(&dir), &"x".repeat(1024 * 1024)).unwrap();
        std::thread::scope(|scope| {
            for index in 0..8 {
                let dir = &dir;
                let settings = &settings;
                scope.spawn(move || {
                    append_log(dir, &entry(&format!("worker {index}")), settings).unwrap()
                });
            }
        });
        let current = fs::read_to_string(log_path(&dir)).unwrap();
        assert_eq!(current.lines().count(), 8);
        for index in 0..8 {
            assert_eq!(current.matches(&format!("worker {index}")).count(), 1);
        }
        assert_eq!(
            fs::metadata(dir.join(format!("{LOG_FILE}.1")))
                .unwrap()
                .len(),
            1024 * 1024
        );
        clear_log_file(&dir).unwrap();
        append_log(&dir, &entry("after clear"), &settings).unwrap();
        assert_eq!(
            fs::read_to_string(log_path(&dir)).unwrap().lines().count(),
            1
        );
        dir.close().unwrap();
    }

    #[test]
    fn append_log_and_status_roundtrip() {
        let dir = TestWorkspace::new("log_roundtrip");
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Warning,
                code: Some("test.code".to_string()),
                message: Some("测试 warning".to_string()),
                path: Some("D:/test/file.csv".to_string()),
                line: Some(3),
                fields: None,
            },
            &AppSettings::default(),
        )
        .unwrap();
        let status = log_status(&dir).unwrap();
        let text = read_utf8_no_bom(&dir.join(LOG_FILE)).unwrap();
        assert!(status.size_bytes > 0);
        assert!(text.contains("[warning] [test.code] 测试 warning"));
        assert!(text.contains("path=D:/test/file.csv"));
        assert!(text.contains("line=3"));
        dir.close().unwrap();
    }

    #[test]
    fn append_log_renders_fields_in_key_order_and_sanitizes_values() {
        let dir = TestWorkspace::new("log_fields");
        let fields = BTreeMap::from([
            ("zeta".to_string(), " last ".to_string()),
            ("alpha".to_string(), "a\r\nb".to_string()),
        ]);
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: Some("test.fields".to_string()),
                message: Some("with fields".to_string()),
                path: None,
                line: None,
                fields: Some(fields),
            },
            &AppSettings::default(),
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join(LOG_FILE)).unwrap();
        assert!(text.contains("alpha=a  b zeta=last"));
        assert!(text.find("alpha=").unwrap() < text.find("zeta=").unwrap());
        dir.close().unwrap();
    }

    #[test]
    fn append_log_rotates_file_at_size_cap() {
        let dir = TestWorkspace::new("log_rotate");
        let filler = "x".repeat(5 * 1024 * 1024);
        crate::io::write_utf8_no_bom(&log_path(&dir), &filler).unwrap();
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: None,
                message: Some("after rotation".to_string()),
                path: None,
                line: None,
                fields: None,
            },
            &AppSettings::default(),
        )
        .unwrap();

        let rotated = fs::read_to_string(dir.join(format!("{LOG_FILE}.1"))).unwrap();
        let current = fs::read_to_string(log_path(&dir)).unwrap();
        assert_eq!(rotated.len(), 5 * 1024 * 1024);
        assert!(current.contains("after rotation"));
        assert!(!current.contains("xxxx"));
        dir.close().unwrap();
    }

    #[test]
    fn clear_log_file_keeps_empty_file() {
        let dir = TestWorkspace::new("log_clear");
        append_log(
            &dir,
            &AppLogEntry {
                level: crate::models::AppLogLevel::Info,
                code: None,
                message: Some("hello".to_string()),
                path: None,
                line: None,
                fields: None,
            },
            &AppSettings::default(),
        )
        .unwrap();
        clear_log_file(&dir).unwrap();
        let status = log_status(&dir).unwrap();
        assert_eq!(status.size_bytes, 0);
        dir.close().unwrap();
    }
}
