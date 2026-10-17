use crate::{
    errors::{AppError, AppResult},
    io::{
        FsRootBoundary, ensure_file_appendable, path_belongs_to_root, read_utf8_no_bom,
        validate_safe_absolute_path, write_utf8_no_bom,
    },
    models::{AppSettings, LOG_FILE},
    services::{app_paths, workspace_persistence},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        LazyLock, Mutex,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};
use tauri::Emitter;

const SETTINGS_FILE: &str = "settings.json";
mod system_fonts;
pub use system_fonts::query_system_fonts;
static ALLOW_CORE_EDITING: AtomicBool = AtomicBool::new(false);
static SETTINGS_REVISION: AtomicU64 = AtomicU64::new(0);
static SETTINGS_WRITE_LOCK: Mutex<()> = Mutex::new(());
static SETTINGS_SNAPSHOT: LazyLock<Mutex<Option<crate::models::SettingsSnapshot>>> =
    LazyLock::new(|| Mutex::new(None));

fn snapshot_state()
-> AppResult<std::sync::MutexGuard<'static, Option<crate::models::SettingsSnapshot>>> {
    SETTINGS_SNAPSHOT.lock().map_err(|_| {
        AppError::message(
            "settings.snapshot_poisoned",
            "settings snapshot unavailable",
        )
    })
}

pub fn read_settings(
    app: &tauri::AppHandle,
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<()>,
) -> AppResult<crate::models::SettingsSnapshot> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "settings write lock poisoned"))?;
    if let Some(snapshot) = snapshot_state()?.clone() {
        return Ok(snapshot);
    }
    let value = load_settings(&app_paths::app_data_dir(app.clone())?)?;
    commit_settings(app, value, apply_runtime)
}
fn commit_settings(
    app: &tauri::AppHandle,
    value: AppSettings,
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<()>,
) -> AppResult<crate::models::SettingsSnapshot> {
    ALLOW_CORE_EDITING.store(value.allow_core_editing, Ordering::Release);
    apply_runtime(&value)?;
    let snapshot = crate::models::SettingsSnapshot {
        revision: SETTINGS_REVISION.fetch_add(1, Ordering::Relaxed) + 1,
        value,
    };
    *snapshot_state()? = Some(snapshot.clone());
    if let Err(error) = app.emit("app-settings-changed", &snapshot) {
        crate::diagnostics::record(format!("settings notification failed: {error}"));
    }
    Ok(snapshot)
}
pub fn save_settings_snapshot(
    app: &tauri::AppHandle,
    window: &str,
    mut settings: AppSettings,
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<()>,
) -> AppResult<crate::models::SettingsSnapshot> {
    if window != "main" {
        return Err(AppError::message(
            "settings.owner_mismatch",
            "设置只允许由主窗口保存",
        ));
    }
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "settings write lock poisoned"))?;
    let app_data = app_paths::app_data_dir(app.clone())?;
    prepare_log_directory(&app_data, &mut settings)?;
    save_settings(&app_data, &settings)?;
    commit_settings(app, settings, apply_runtime)
}
pub fn clear_settings(clear: impl FnOnce() -> AppResult<()>) -> AppResult<()> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "settings write lock poisoned"))?;
    clear()?;
    *snapshot_state()? = None;
    Ok(())
}
pub fn ensure_core_editing_allowed(mod_root: &str) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let is_core = boundary.root().ancestors().any(|root| {
        root.file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case("starsector-core"))
            && root
                .parent()
                .is_some_and(|parent| parent.join("mods").is_dir())
    });
    if is_core && !ALLOW_CORE_EDITING.load(Ordering::Acquire) {
        return Err(AppError::message(
            "core.editing_disabled",
            "原版内容编辑权限已关闭",
        ));
    }
    Ok(())
}

pub fn load_settings(app_data_dir: &Path) -> AppResult<AppSettings> {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let text = read_utf8_no_bom(&path)?;
    let settings = crate::parsers::parse_persisted_json::<AppSettings>(&text).map_err(|error| {
        AppError::context(format!("解析配置文件失败 ({})", path.display()), error).at_path(&path)
    })?;
    validate_settings_limits(&settings).map_err(|error| error.at_path(&path))?;
    Ok(settings)
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> AppResult<()> {
    validate_settings_limits(settings)?;
    fs::create_dir_all(app_data_dir).map_err(|error| {
        AppError::context(
            format!("创建配置目录失败 ({})", app_data_dir.display()),
            error.into(),
        )
    })?;
    let path = settings_path(app_data_dir);
    let text = serde_json::to_string_pretty(settings)
        .map_err(|error| AppError::context("序列化配置文件失败".to_string(), error.into()))?;
    write_utf8_no_bom(&path, &text)?;
    Ok(())
}

fn validate_settings_limits(settings: &AppSettings) -> AppResult<()> {
    if settings
        .cache_limits
        .queries
        .keys()
        .ne(crate::models::CacheLimits::default().queries.keys())
    {
        return Err(AppError::message(
            "settings.limit_invalid",
            "Invalid query cache keys",
        ));
    }
    for (name, value, maximum) in settings.cache_limits.values() {
        if value > maximum {
            return Err(AppError::message(
                "settings.limit_invalid",
                format!("Invalid cache limit {name}: {value}; expected 0..={maximum}"),
            ));
        }
    }
    if let Some(font) = &settings.general_font
        && (font.trim().is_empty() || font.chars().any(char::is_control))
    {
        return Err(AppError::message(
            "settings.font_invalid",
            "Invalid general font family",
        ));
    }
    for (name, value, maximum) in [
        ("fileHistoryLimit", settings.file_history_limit, 1000),
        ("editHistoryLimit", settings.edit_history_limit, 1000),
        ("logRotationSizeMiB", settings.log_rotation_size_mib, 1024),
        ("logBackupCount", settings.log_backup_count, 20),
    ] {
        if !(1..=maximum).contains(&value) {
            return Err(AppError::message(
                "settings.limit_invalid",
                format!("Invalid {name}: {value}; expected 1..={maximum}"),
            ));
        }
    }
    Ok(())
}

pub fn log_output_directory(app_data_dir: &Path, settings: &AppSettings) -> AppResult<PathBuf> {
    match &settings.log_directory {
        Some(directory) => resolve_saved_log_directory(app_data_dir, directory),
        None => Ok(app_data_dir.to_path_buf()),
    }
}

fn prepare_log_directory(app_data_dir: &Path, settings: &mut AppSettings) -> AppResult<()> {
    let Some(directory) = settings.log_directory.as_deref() else {
        return Ok(());
    };
    let canonical = prepare_log_directory_for_save(app_data_dir, directory)?;
    settings.log_directory = Some(canonical.to_string_lossy().to_string());
    Ok(())
}

fn prepare_log_directory_for_save(app_data_dir: &Path, directory: &str) -> AppResult<PathBuf> {
    let (requested, _) = check_log_directory_boundary(app_data_dir, directory)?;
    fs::create_dir_all(&requested).map_err(|error| {
        AppError::context(
            format!("创建日志目录失败 ({})", requested.display()),
            error.into(),
        )
    })?;
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    ensure_file_appendable(&canonical.join(LOG_FILE))?;
    Ok(canonical)
}

fn resolve_saved_log_directory(app_data_dir: &Path, directory: &str) -> AppResult<PathBuf> {
    let (requested, _) = check_log_directory_boundary(app_data_dir, directory)?;
    if !requested.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!(
                "configured log directory is unavailable: {}",
                requested.display()
            ),
        ));
    }
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    Ok(canonical)
}

fn check_log_directory_boundary(
    app_data_dir: &Path,
    directory: &str,
) -> AppResult<(PathBuf, PathBuf)> {
    let requested = Path::new(directory);
    validate_safe_absolute_path(requested, "log directory")?;
    if requested
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(LOG_FILE))
    {
        return Err(AppError::message(
            "log.dir_is_log_file",
            format!("log directory must not include the log file name: {directory}"),
        ));
    }
    let existing_parent = requested
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            AppError::message(
                "log.dir_no_existing_parent",
                format!("log directory has no existing parent: {directory}"),
            )
        })?;
    let parent_boundary = FsRootBoundary::new(existing_parent, "log directory")?;
    let suffix = requested.strip_prefix(existing_parent).map_err(|error| {
        AppError::message(
            "path.relative_failed",
            format!(
                "log directory cannot be related to existing parent ({}): {error}",
                requested.display()
            ),
        )
    })?;
    let canonical = parent_boundary.root().join(suffix);
    reject_log_directory_boundary(app_data_dir, &canonical)?;
    Ok((requested.to_path_buf(), canonical))
}

fn reject_log_directory_boundary(app_data_dir: &Path, canonical: &Path) -> AppResult<()> {
    let app_data = FsRootBoundary::new(app_data_dir, "app data directory")?
        .root()
        .to_path_buf();
    if path_belongs_to_root(canonical, &app_data) {
        return Err(AppError::message(
            "log.dir_inside_app_data",
            format!(
                "custom log directory must not be inside app data: {}",
                canonical.display()
            ),
        ));
    }
    workspace_persistence::reject_mod_or_workspace_directory(app_data_dir, canonical)
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join(SETTINGS_FILE)
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::testutil::temp_dir;

    #[test]
    fn settings_limits_validate_read_and_write_boundaries() {
        let dir = temp_dir("settings_limit_boundaries");
        for (field, maximum) in [
            ("fileHistoryLimit", 1000),
            ("editHistoryLimit", 1000),
            ("logRotationSizeMiB", 1024),
            ("logBackupCount", 20),
        ] {
            for value in [1, maximum] {
                let mut wire = serde_json::to_value(AppSettings::default()).unwrap();
                wire[field] = serde_json::json!(value);
                let settings: AppSettings = serde_json::from_value(wire).unwrap();
                save_settings(&dir, &settings).unwrap();
                assert_eq!(load_settings(&dir).unwrap(), settings);
            }
            for value in [
                serde_json::json!(0),
                serde_json::json!(maximum + 1),
                serde_json::json!(-1),
                serde_json::json!(1.5),
            ] {
                let mut wire = serde_json::to_value(AppSettings::default()).unwrap();
                wire[field] = value;
                write_utf8_no_bom(&settings_path(&dir), &wire.to_string()).unwrap();
                let error = load_settings(&dir).unwrap_err();
                assert_eq!(
                    error.location().unwrap().path.as_deref(),
                    Some(settings_path(&dir).to_str().unwrap())
                );
                if let Ok(settings) = serde_json::from_value::<AppSettings>(wire) {
                    assert_eq!(error.code(), "settings.limit_invalid");
                    assert!(error.to_string().contains(field));
                    assert!(save_settings(&dir, &settings).is_err());
                }
            }
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn load_settings_returns_default_when_missing() {
        let dir = temp_dir("settings_missing");
        let settings = load_settings(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(settings, AppSettings::default());
    }
    #[test]
    fn cache_limits_validate_zero_boundaries_and_exact_query_set() {
        let mut settings = AppSettings::default();
        settings.cache_limits.decoded_images.entries = 0;
        settings.cache_limits.thumbnails.mib = 0;
        assert!(validate_settings_limits(&settings).is_ok());
        settings.cache_limits.decoded_images.entries = 65536;
        settings.cache_limits.thumbnails.mib = 4096;
        assert!(validate_settings_limits(&settings).is_ok());
        settings.cache_limits.decoded_images.entries = 65537;
        assert!(validate_settings_limits(&settings).is_err());
        settings.cache_limits.decoded_images.entries = 1024;
        settings.cache_limits.queries.remove("entity-list");
        assert!(validate_settings_limits(&settings).is_err());
    }

    #[test]
    fn font_settings_roundtrip() {
        let dir = temp_dir("settings_fonts");
        let settings = AppSettings {
            general_font: Some("Microsoft YaHei".into()),
            immersive_game_font: false,
            ..AppSettings::default()
        };
        save_settings(&dir, &settings).unwrap();
        assert_eq!(load_settings(&dir).unwrap(), settings);
        for family in ["", " ", "Arial\n"] {
            let invalid = AppSettings {
                general_font: Some(family.into()),
                ..AppSettings::default()
            };
            assert_eq!(
                save_settings(&dir, &invalid).unwrap_err().code(),
                "settings.font_invalid"
            );
            let text = serde_json::to_string(&invalid).unwrap();
            write_utf8_no_bom(&settings_path(&dir), &text).unwrap();
            let error = load_settings(&dir).unwrap_err();
            assert_eq!(error.code(), "settings.font_invalid");
            assert_eq!(
                error.location().unwrap().path.as_deref(),
                settings_path(&dir).to_str()
            );
        }
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn save_and_load_settings_roundtrip() {
        let dir = temp_dir("settings_roundtrip");
        let settings: AppSettings = serde_json::from_str(
            r##"{
  "theme": "dark",
  "accent": "custom",
  "customAccent": "#16a34a",
  "fileHistoryLimit": 42,
  "editHistoryLimit": 350,
  "logRotationSizeMiB": 12,
  "logBackupCount": 4,
            "editMode": "plain",
  "starsectorRoot": null,
  "logDirectory": null
}"##,
        )
        .unwrap();
        save_settings(&dir, &settings).unwrap();
        let loaded = load_settings(&dir).unwrap();
        let _ = fs::remove_dir_all(dir);
        assert_eq!(loaded, settings);
    }

    #[test]
    fn custom_log_directory_is_created_and_canonicalized() {
        let app_data = temp_dir("settings_log_app_data");
        let app_data_name = app_data.file_name().unwrap().to_string_lossy();
        let log_directory = app_data
            .parent()
            .unwrap()
            .join(format!("{app_data_name}_custom_logs"));
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        let configured = Path::new(settings.log_directory.as_deref().unwrap());
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&log_directory);
        assert!(configured.is_absolute());
    }

    #[test]
    fn custom_log_directory_rejects_mod_and_app_data_locations() {
        let app_data = temp_dir("settings_log_reject_app_data");
        let mod_root = app_data.parent().unwrap().join("settings_log_reject_mod");
        fs::create_dir_all(&mod_root).unwrap();
        write_utf8_no_bom(&mod_root.join("mod_info.json"), "{}").unwrap();

        let mod_error =
            prepare_log_directory_for_save(&app_data, &mod_root.join("logs").to_string_lossy())
                .unwrap_err();
        let app_data_error =
            prepare_log_directory_for_save(&app_data, &app_data.join("logs").to_string_lossy())
                .unwrap_err();

        assert!(!mod_root.join("logs").exists());
        let _ = fs::remove_dir_all(&app_data);
        let _ = fs::remove_dir_all(&mod_root);
        assert!(mod_error.to_string().contains("inside a Mod"));
        assert!(app_data_error.to_string().contains("inside app data"));
    }

    #[test]
    fn configured_custom_log_directory_does_not_recreate_a_missing_directory() {
        let app_data = temp_dir("settings_log_missing_app_data");
        let app_data_name = app_data.file_name().unwrap().to_string_lossy();
        let log_directory = app_data
            .parent()
            .unwrap()
            .join(format!("{app_data_name}_missing_logs"));
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        fs::remove_dir_all(&log_directory).unwrap();
        let result = log_output_directory(&app_data, &settings);

        let _ = fs::remove_dir_all(&app_data);
        assert!(result.is_err());
        assert!(!log_directory.exists());
    }

    #[test]
    fn custom_log_directory_rejects_a_complete_log_file_path() {
        let app_data = temp_dir("settings_log_file_path_app_data");
        let file_path = app_data.parent().unwrap().join(LOG_FILE);
        let result = prepare_log_directory_for_save(&app_data, &file_path.to_string_lossy());

        let _ = fs::remove_dir_all(&app_data);
        assert!(result.is_err());
        assert!(!file_path.exists());
    }
}
