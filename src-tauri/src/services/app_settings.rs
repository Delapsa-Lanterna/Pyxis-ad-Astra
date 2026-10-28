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
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<bool>,
) -> AppResult<crate::models::SettingsSnapshot> {
    let _guard = SETTINGS_WRITE_LOCK
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "settings write lock poisoned"))?;
    if let Some(snapshot) = snapshot_state()?.clone() {
        return Ok(snapshot);
    }
    let (value, diagnostics) = load_settings_report(&app_paths::app_data_dir(app.clone())?);
    let snapshot = commit_settings(app, value, apply_runtime)?;
    drop(_guard);
    diagnostics.into_iter().for_each(crate::diagnostics::record);
    Ok(snapshot)
}
fn commit_settings(
    app: &tauri::AppHandle,
    value: AppSettings,
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<bool>,
) -> AppResult<crate::models::SettingsSnapshot> {
    ALLOW_CORE_EDITING.store(value.allow_core_editing, Ordering::Release);
    let performance_monitor_active = apply_runtime(&value)?;
    let snapshot = crate::models::SettingsSnapshot {
        performance_monitor_active,
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
    apply_runtime: impl FnOnce(&AppSettings) -> AppResult<bool>,
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

#[cfg(test)]
pub fn load_settings(app_data_dir: &Path) -> AppResult<AppSettings> {
    Ok(load_settings_report(app_data_dir).0)
}

fn load_settings_report(app_data_dir: &Path) -> (AppSettings, Vec<String>) {
    let path = settings_path(app_data_dir);
    if !path.exists() {
        return (AppSettings::default(), Vec::new());
    }
    let mut diagnostics = Vec::new();
    let source = read_utf8_no_bom(&path)
        .and_then(|text| crate::parsers::parse_persisted_json::<serde_json::Value>(&text));
    let mut settings = match source {
        Ok(source) => decode_settings(source.clone()).unwrap_or_else(|_| {
            let defaults =
                serde_json::to_value(AppSettings::default()).expect("settings defaults serialize");
            let mut accepted = defaults.clone();
            recover_settings_fields(&source, &defaults, "", &mut accepted, &mut diagnostics);
            decode_settings(accepted).expect("recovered settings contain validated fields")
        }),
        Err(error) => {
            diagnostics.push(error.to_string());
            AppSettings::default()
        }
    };
    if let Some(directory) = &settings.log_directory
        && let Err(error) = resolve_saved_log_directory(app_data_dir, directory)
    {
        diagnostics.push(format!("/logDirectory: {error}"));
        settings.log_directory = None;
    }
    let diagnostics = diagnostics
        .into_iter()
        .map(|message| format!("settings recovery ({}): {message}", path.display()))
        .collect();
    (settings, diagnostics)
}

fn recover_settings_fields(
    source: &serde_json::Value,
    defaults: &serde_json::Value,
    pointer: &str,
    accepted: &mut serde_json::Value,
    diagnostics: &mut Vec<String>,
) {
    if let Some(fields) = defaults.as_object()
        && source.is_object()
    {
        for (name, default) in fields {
            recover_settings_fields(
                &source[name],
                default,
                &format!("{pointer}/{name}"),
                accepted,
                diagnostics,
            );
        }
        return;
    }
    let mut candidate = accepted.clone();
    *candidate
        .pointer_mut(pointer)
        .expect("default setting path exists") = source.clone();
    match decode_settings(candidate.clone()) {
        Ok(_) => *accepted = candidate,
        Err(error) => diagnostics.push(format!("{pointer}: {error}")),
    }
}

fn decode_settings(value: serde_json::Value) -> AppResult<AppSettings> {
    if !value.is_object() {
        return Err(AppError::message(
            "settings.object_required",
            "Settings must be an object",
        ));
    }
    let settings = serde_json::from_value(value)?;
    validate_settings(&settings)?;
    Ok(settings)
}

pub fn save_settings(app_data_dir: &Path, settings: &AppSettings) -> AppResult<()> {
    validate_settings(settings)?;
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

fn validate_settings(settings: &AppSettings) -> AppResult<()> {
    let color = settings.custom_accent.trim();
    if color.len() != 7
        || !color.starts_with('#')
        || !color.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
    {
        return Err(AppError::message(
            "settings.color_invalid",
            "Invalid custom accent",
        ));
    }
    for directory in [
        &settings.starsector_root,
        &settings.log_directory,
        &settings.immersive_font_directory,
    ]
    .into_iter()
    .flatten()
    {
        validate_safe_absolute_path(Path::new(directory), "settings directory")?;
        if directory.chars().any(char::is_control) {
            return Err(AppError::message(
                "settings.path_invalid",
                "Invalid settings directory",
            ));
        }
    }
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

#[cfg(test)]
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
    #[test]
    fn all_log_levels_roundtrip_through_saved_settings() {
        use crate::models::AppLogLevel;
        let dir = TestWorkspace::new("log_level_settings");
        for level in [
            AppLogLevel::Debug,
            AppLogLevel::Info,
            AppLogLevel::Warning,
            AppLogLevel::Error,
        ] {
            let settings = crate::models::AppSettings {
                log_level: level,
                ..Default::default()
            };
            super::save_settings(&dir, &settings).unwrap();
            assert_eq!(super::load_settings(&dir).unwrap().log_level, level);
        }
        dir.close().unwrap();
    }
    use super::*;

    use crate::testutil::TestWorkspace;

    #[test]
    fn settings_limits_validate_read_and_write_boundaries() {
        let dir = TestWorkspace::new("settings_limit_boundaries");
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
                assert_eq!(load_settings(&dir).unwrap(), AppSettings::default());
                if let Ok(settings) = serde_json::from_value::<AppSettings>(wire) {
                    assert!(save_settings(&dir, &settings).is_err());
                }
            }
        }
        dir.close().unwrap();
    }

    #[test]
    fn cache_limits_validate_zero_boundaries_and_exact_query_set() {
        let mut settings = AppSettings::default();
        settings.cache_limits.decoded_images.entries = 0;
        settings.cache_limits.thumbnails.mib = 0;
        assert!(validate_settings(&settings).is_ok());
        settings.cache_limits.decoded_images.entries = 65536;
        settings.cache_limits.thumbnails.mib = 4096;
        assert!(validate_settings(&settings).is_ok());
        settings.cache_limits.decoded_images.entries = 65537;
        assert!(validate_settings(&settings).is_err());
        settings.cache_limits.decoded_images.entries = 1024;
        settings.cache_limits.queries.remove("entity-list");
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn settings_values_roundtrip() {
        let dir = TestWorkspace::new("settings_fonts");
        let settings = AppSettings {
            general_font: Some("Microsoft YaHei".into()),
            immersive_game_font: false,
            immersive_font_directory: Some(
                dir.join("font_directory").to_string_lossy().into_owned(),
            ),
            theme: Some(crate::models::AppTheme::Dark),
            accent: crate::models::AccentPreset::Custom,
            custom_accent: "#16a34a".into(),
            file_history_limit: 42,
            edit_history_limit: 350,
            log_rotation_size_mib: 12,
            log_backup_count: 4,
            edit_mode: crate::models::EditMode::Plain,
            expand_field_descriptions: true,
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
            assert_eq!(load_settings(&dir).unwrap().general_font, None);
        }
        dir.close().unwrap();
    }

    #[test]
    fn custom_log_directory_is_created_and_canonicalized() {
        let app_data = TestWorkspace::new("settings_log_app_data");
        let log_directory = app_data.outer().join("custom_logs");
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        let configured = Path::new(settings.log_directory.as_deref().unwrap());
        assert!(configured.is_absolute());
        app_data.close().unwrap();
    }

    #[test]
    fn custom_log_directory_rejects_mod_and_app_data_locations() {
        let app_data = TestWorkspace::new("settings_log_reject_app_data");
        let mod_root = app_data.outer().join("mod");
        fs::create_dir_all(&mod_root).unwrap();
        write_utf8_no_bom(&mod_root.join("mod_info.json"), "{}").unwrap();

        let mod_error =
            prepare_log_directory_for_save(&app_data, &mod_root.join("logs").to_string_lossy())
                .unwrap_err();
        let app_data_error =
            prepare_log_directory_for_save(&app_data, &app_data.join("logs").to_string_lossy())
                .unwrap_err();

        assert!(!mod_root.join("logs").exists());
        assert!(mod_error.to_string().contains("inside a Mod"));
        assert!(app_data_error.to_string().contains("inside app data"));
        app_data.close().unwrap();
    }

    #[test]
    fn configured_custom_log_directory_does_not_recreate_a_missing_directory() {
        let app_data = TestWorkspace::new("settings_log_missing_app_data");
        let log_directory = app_data.outer().join("missing_logs");
        let mut settings = AppSettings {
            log_directory: Some(log_directory.to_string_lossy().to_string()),
            ..AppSettings::default()
        };

        prepare_log_directory(&app_data, &mut settings).unwrap();
        fs::remove_dir_all(&log_directory).unwrap();
        let result = log_output_directory(&app_data, &settings);

        assert!(result.is_err());
        assert!(!log_directory.exists());
        app_data.close().unwrap();
    }

    #[test]
    fn custom_log_directory_rejects_a_complete_log_file_path() {
        let app_data = TestWorkspace::new("settings_log_file_path_app_data");
        let file_path = app_data.outer().join(LOG_FILE);
        let result = prepare_log_directory_for_save(&app_data, &file_path.to_string_lossy());

        assert!(result.is_err());
        assert!(!file_path.exists());
        app_data.close().unwrap();
    }

    fn setting_paths(value: &serde_json::Value, pointer: &str) -> Vec<String> {
        let mut paths = vec![pointer.to_string()];
        if let Some(fields) = value.as_object() {
            for (name, child) in fields {
                paths.extend(setting_paths(child, &format!("{pointer}/{name}")));
            }
        }
        paths
    }

    #[test]
    fn every_disk_field_recovers_independently_and_preserves_the_file() {
        let dir = TestWorkspace::new("settings_field_recovery");
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        let mut valid = defaults.clone();
        valid["theme"] = serde_json::json!("dark");
        valid["performanceMonitorEnabled"] = serde_json::json!(true);
        valid["editHistoryLimit"] = serde_json::json!(321);
        valid["cacheLimits"]["mediaData"]["entries"] = serde_json::json!(17);
        let paths = setting_paths(&defaults, "");
        assert_eq!(paths.len(), 43);
        for pointer in paths.into_iter().skip(1) {
            for missing in [false, true] {
                let mut source = valid.clone();
                if missing {
                    let (parent, name) = pointer.rsplit_once('/').unwrap();
                    source
                        .pointer_mut(parent)
                        .unwrap()
                        .as_object_mut()
                        .unwrap()
                        .remove(name);
                } else {
                    *source.pointer_mut(&pointer).unwrap() = serde_json::json!([]);
                }
                let mut expected = valid.clone();
                *expected.pointer_mut(&pointer).unwrap() =
                    defaults.pointer(&pointer).unwrap().clone();
                let text = source.to_string();
                write_utf8_no_bom(&settings_path(&dir), &text).unwrap();
                let loaded = load_settings(&dir).unwrap();
                assert_eq!(
                    serde_json::to_value(loaded).unwrap(),
                    expected,
                    "{pointer}: {missing}"
                );
                assert_eq!(read_utf8_no_bom(&settings_path(&dir)).unwrap(), text);
            }
        }
        dir.close().unwrap();
    }

    #[test]
    fn invalid_values_recover_together_and_saving_stays_strict() {
        let dir = TestWorkspace::new("settings_invalid_values");
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        let mut source = defaults.clone();
        for pointer in setting_paths(&defaults["cacheLimits"], "/cacheLimits") {
            if defaults.pointer(&pointer).unwrap().is_number() {
                *source.pointer_mut(&pointer).unwrap() = serde_json::json!(65537);
            }
        }
        for (key, value) in [
            ("theme", serde_json::json!("unknown")),
            ("accent", serde_json::json!("unknown")),
            ("editMode", serde_json::json!("unknown")),
            ("customAccent", serde_json::json!("#xyzxyz")),
            ("logLevel", serde_json::json!("invalid")),
            ("generalFont", serde_json::json!("A\nB")),
            ("starsectorRoot", serde_json::json!("relative")),
            ("immersiveFontDirectory", serde_json::json!("relative")),
            ("logDirectory", serde_json::json!("relative")),
            ("allowCoreEditing", serde_json::json!("true")),
            ("immersiveGameFont", serde_json::json!(0)),
            ("preserveOriginalJson", serde_json::json!(null)),
        ] {
            source[key] = value;
        }
        source["fileHistoryLimit"] = serde_json::json!(42);
        write_utf8_no_bom(&settings_path(&dir), &source.to_string()).unwrap();
        let (loaded, diagnostics) = load_settings_report(&dir);
        let expected = AppSettings {
            file_history_limit: 42,
            ..AppSettings::default()
        };
        assert_eq!(loaded, expected);
        assert!(
            diagnostics
                .iter()
                .any(|issue| issue.contains("/cacheLimits/mediaData/entries"))
        );
        for (key, value) in [("customAccent", "invalid"), ("starsectorRoot", "relative")] {
            let mut wire = defaults.clone();
            wire[key] = serde_json::json!(value);
            assert!(save_settings(&dir, &serde_json::from_value(wire).unwrap()).is_err());
        }
        let mut wire = defaults;
        wire["logLevel"] = serde_json::json!("invalid");
        assert!(serde_json::from_value::<AppSettings>(wire).is_err());
        dir.close().unwrap();
    }

    #[test]
    fn broken_files_and_unavailable_log_directories_allow_loading() {
        let dir = TestWorkspace::new("settings_file_recovery");
        assert_eq!(load_settings(&dir).unwrap(), AppSettings::default());
        for text in ["{", "", "null", "[]", "42", "{\"cacheLimits\":null}"] {
            write_utf8_no_bom(&settings_path(&dir), text).unwrap();
            let (settings, diagnostics) = load_settings_report(&dir);
            assert_eq!(settings, AppSettings::default());
            assert!(!diagnostics.is_empty());
        }
        fs::write(settings_path(&dir), [0x81]).unwrap();
        assert_eq!(load_settings(&dir).unwrap(), AppSettings::default());
        let wire = serde_json::json!({"logDirectory": dir.join("unavailable").to_string_lossy(), "theme": "dark"});
        write_utf8_no_bom(&settings_path(&dir), &wire.to_string()).unwrap();
        let (settings, diagnostics) = load_settings_report(&dir);
        assert_eq!(settings.theme, Some(crate::models::AppTheme::Dark));
        assert_eq!(settings.log_directory, None);
        assert!(
            diagnostics
                .iter()
                .any(|issue| issue.contains("/logDirectory"))
        );
        fs::remove_file(settings_path(&dir)).unwrap();
        fs::create_dir(settings_path(&dir)).unwrap();
        assert_eq!(load_settings(&dir).unwrap(), AppSettings::default());
        dir.close().unwrap();
    }
}
