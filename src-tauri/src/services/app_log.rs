use crate::{
    errors::{AppError, AppResult},
    io::{ensure_file_appendable, write_utf8_no_bom},
    models::{AppLogEntry, AppLogStatus, AppSettings, LOG_FILE},
    services::{app_paths, app_settings, system_open},
};
use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

static LOG_WRITE_LOCK: Mutex<()> = Mutex::new(());

pub fn append_app_log(app_handle: tauri::AppHandle, entry: AppLogEntry) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let settings = app_settings::load_settings(&app_data)?;
    if entry.level < settings.log_level {
        return Ok(());
    }
    if settings.log_directory.is_none() {
        fs::create_dir_all(&app_data).map_err(|error| {
            AppError::context(
                format!("创建日志目录失败 ({})", app_data.display()),
                error.into(),
            )
            .at_path(&app_data)
        })?;
    }
    let log_directory = app_settings::log_output_directory(&app_data, &settings)?;
    append_log(&log_directory, &entry, &settings)
}

pub fn app_log_status(app_handle: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    log_status(&log_directory)
}

pub fn open_app_log_file(app_handle: tauri::AppHandle) -> AppResult<()> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    ensure_log_file(&log_directory)?;
    system_open::open_path(&log_path(&log_directory))
}

pub fn clear_app_log_file(app_handle: tauri::AppHandle) -> AppResult<AppLogStatus> {
    let app_data = app_paths::app_data_dir(app_handle)?;
    let log_directory = configured_log_directory(&app_data)?;
    clear_log_file(&log_directory)?;
    log_status(&log_directory)
}

fn configured_log_directory(app_data_dir: &Path) -> AppResult<PathBuf> {
    let settings = app_settings::load_settings(app_data_dir)?;
    if settings.log_directory.is_none() {
        fs::create_dir_all(app_data_dir).map_err(|error| {
            AppError::context(
                format!("创建日志目录失败 ({})", app_data_dir.display()),
                error.into(),
            )
            .at_path(app_data_dir)
        })?;
    }
    app_settings::log_output_directory(app_data_dir, &settings)
}

pub fn append_log(
    app_data_dir: &Path,
    entry: &AppLogEntry,
    settings: &AppSettings,
) -> AppResult<()> {
    let _guard = lock_log()?;
    ensure_log_directory_writable(app_data_dir)?;
    rotate_log_file(app_data_dir, settings)?;
    let path = log_path(app_data_dir);
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|error| {
            AppError::context(
                format!("打开日志文件失败 ({})", path.display()),
                error.into(),
            )
            .at_path(&path)
        })?;
    file.write_all(render_log_entry(entry).as_bytes())
        .map_err(|error| {
            AppError::context(
                format!("写入日志文件失败 ({})", path.display()),
                error.into(),
            )
            .at_path(&path)
        })?;
    Ok(())
}

pub fn log_status(app_data_dir: &Path) -> AppResult<AppLogStatus> {
    let path = log_path(app_data_dir);
    let size_bytes = match fs::metadata(&path) {
        Ok(metadata) => metadata.len(),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => 0,
        Err(error) => {
            return Err(AppError::context(
                format!("读取日志文件状态失败 ({})", path.display()),
                error.into(),
            )
            .at_path(&path));
        }
    };
    Ok(AppLogStatus {
        path: path.to_string_lossy().to_string(),
        size_bytes,
    })
}

pub fn clear_log_file(app_data_dir: &Path) -> AppResult<()> {
    let _guard = lock_log()?;
    ensure_log_directory_writable(app_data_dir)?;
    let path = log_path(app_data_dir);
    write_utf8_no_bom(&path, "").map_err(|error| {
        AppError::context(format!("清除日志文件失败 ({})", path.display()), error).at_path(&path)
    })?;
    Ok(())
}

pub fn log_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(LOG_FILE)
}

fn ensure_log_file(app_data_dir: &Path) -> AppResult<()> {
    ensure_log_directory_writable(app_data_dir)
}

fn ensure_log_directory_writable(app_data_dir: &Path) -> AppResult<()> {
    if !app_data_dir.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!("日志目录不可用 ({})", app_data_dir.display()),
        )
        .at_path(app_data_dir));
    }
    ensure_file_appendable(&log_path(app_data_dir))
}

fn render_log_entry(entry: &AppLogEntry) -> String {
    let mut line = format!("[{}] [{}]", local_timestamp(), entry.level.as_str());
    if let Some(code) = &entry.code {
        line.push_str(&format!(" [{code}]"));
    }
    if let Some(message) = &entry.message {
        line.push(' ');
        line.push_str(message);
    }
    if let Some(path) = &entry.path {
        line.push_str(" | path=");
        line.push_str(path);
    }
    if let Some(line_number) = entry.line {
        line.push_str(" | line=");
        line.push_str(&line_number.to_string());
    }
    if let Some(fields) = &entry.fields {
        for (key, value) in fields {
            line.push(' ');
            line.push_str(key);
            line.push('=');
            line.push_str(&sanitize_log_value(value));
        }
    }
    line.push_str("\r\n");
    line
}

fn sanitize_log_value(value: &str) -> String {
    value.replace(['\r', '\n', '\t'], " ").trim().to_string()
}

fn local_timestamp() -> String {
    chrono::Local::now()
        .format("%Y-%m-%d %H:%M:%S%.3f")
        .to_string()
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
    use crate::testutil::temp_dir;
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
    fn rotation_retains_order_and_shrinks_on_the_next_rotation() {
        let dir = temp_dir("log_retention_order");
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rotation_uses_the_saved_threshold_and_handles_gaps_in_backups() {
        let dir = temp_dir("log_retention_gaps");
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn rotation_failure_reports_the_actual_backup_path() {
        let dir = temp_dir("log_retention_io_error");
        let backup = dir.join(format!("{LOG_FILE}.1"));
        fs::create_dir(&backup).unwrap();
        write_utf8_no_bom(&log_path(&dir), &"x".repeat(1024 * 1024)).unwrap();
        let settings = AppSettings {
            log_rotation_size_mib: 1,
            ..AppSettings::default()
        };
        let error = append_log(&dir, &entry("rotation fails"), &settings).unwrap_err();
        assert_eq!(error.location().unwrap().path.as_deref(), backup.to_str());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn unavailable_directory_errors_keep_the_directory_identity() {
        let dir = temp_dir("log_directory_identity");
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn concurrent_appends_preserve_complete_lines_through_rotation() {
        let dir = temp_dir("log_retention_concurrent");
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn append_log_and_status_roundtrip() {
        let dir = temp_dir("log_roundtrip");
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
        let _ = fs::remove_dir_all(dir);
        assert!(status.size_bytes > 0);
        assert!(text.contains("[warning] [test.code] 测试 warning"));
        assert!(text.contains("path=D:/test/file.csv"));
        assert!(text.contains("line=3"));
    }

    #[test]
    fn append_log_renders_fields_in_key_order_and_sanitizes_values() {
        let dir = temp_dir("log_fields");
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
        let _ = fs::remove_dir_all(dir);
        assert!(text.contains("alpha=a  b zeta=last"));
        assert!(text.find("alpha=").unwrap() < text.find("zeta=").unwrap());
    }

    #[test]
    fn append_log_rotates_file_at_size_cap() {
        let dir = temp_dir("log_rotate");
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
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn clear_log_file_keeps_empty_file() {
        let dir = temp_dir("log_clear");
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
        let _ = fs::remove_dir_all(dir);
        assert_eq!(status.size_bytes, 0);
    }
}
