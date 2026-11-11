use super::CacheLimits;
use super::serde_fields::deserialize_non_empty_string;
use crate::models::AppLogLevel;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AppTheme {
    Light,
    Dark,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccentPreset {
    Blue,
    Orange,
    Green,
    Cyan,
    Pink,
    Purple,
    Gray,
    Custom,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EditMode {
    Plain,
    Smart,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ToastDurations {
    pub success: u32,
    pub info: u32,
    pub warning: u32,
    pub error: u32,
}

impl Default for ToastDurations {
    fn default() -> Self {
        Self {
            success: 5,
            info: 7,
            warning: 7,
            error: 0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase")]
pub struct ShowCoreFeedback {
    pub success: bool,
    pub info: bool,
    pub warning: bool,
    pub error: bool,
}

impl Default for ShowCoreFeedback {
    fn default() -> Self {
        Self {
            success: true,
            info: true,
            warning: true,
            error: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(default)]
    pub performance_monitor_enabled: bool,
    #[serde(default = "default_watch_file_changes")]
    pub watch_file_changes: bool,
    #[serde(default)]
    pub cache_limits: CacheLimits,
    #[serde(default)]
    pub toast_durations: ToastDurations,
    #[serde(default)]
    pub show_core_feedback: ShowCoreFeedback,
    #[serde(default)]
    pub theme: Option<AppTheme>,
    #[serde(default = "default_accent")]
    pub accent: AccentPreset,
    #[serde(default = "default_custom_accent")]
    pub custom_accent: String,
    #[serde(default)]
    pub interface_font: Option<String>,
    #[serde(default)]
    pub field_font: Option<String>,
    #[serde(default)]
    pub text_editor_font: Option<String>,
    #[serde(default)]
    pub canvas_editor_font: Option<String>,
    #[serde(default = "default_file_history_limit")]
    pub file_history_limit: u32,
    #[serde(default = "default_edit_history_limit")]
    pub edit_history_limit: u32,
    #[serde(
        rename = "logRotationSizeMiB",
        default = "default_log_rotation_size_mib"
    )]
    pub log_rotation_size_mib: u32,
    #[serde(default = "default_log_backup_count")]
    pub log_backup_count: u32,
    #[serde(default = "default_edit_mode")]
    pub edit_mode: EditMode,
    #[serde(default)]
    pub expand_field_descriptions: bool,
    #[serde(default)]
    pub ignore_editor_warnings: bool,
    #[serde(default = "default_immersive_game_font")]
    pub immersive_game_font: bool,
    #[serde(default, deserialize_with = "deserialize_non_empty_string")]
    pub immersive_font_directory: Option<String>,
    #[serde(default, deserialize_with = "deserialize_non_empty_string")]
    pub java_executable: Option<String>,
    #[serde(default = "default_preserve_structure")]
    pub preserve_structure: bool,
    #[serde(default)]
    pub allow_core_editing: bool,
    #[serde(default, deserialize_with = "deserialize_non_empty_string")]
    pub starsector_root: Option<String>,
    #[serde(default, deserialize_with = "deserialize_non_empty_string")]
    pub log_directory: Option<String>,
    #[serde(default = "default_log_level")]
    pub log_level: AppLogLevel,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            performance_monitor_enabled: false,
            watch_file_changes: default_watch_file_changes(),
            cache_limits: CacheLimits::default(),
            toast_durations: ToastDurations::default(),
            show_core_feedback: ShowCoreFeedback::default(),
            theme: None,
            accent: default_accent(),
            custom_accent: default_custom_accent(),
            interface_font: None,
            field_font: None,
            text_editor_font: None,
            canvas_editor_font: None,
            file_history_limit: default_file_history_limit(),
            edit_history_limit: default_edit_history_limit(),
            log_rotation_size_mib: default_log_rotation_size_mib(),
            log_backup_count: default_log_backup_count(),
            edit_mode: default_edit_mode(),
            expand_field_descriptions: false,
            ignore_editor_warnings: false,
            immersive_game_font: default_immersive_game_font(),
            immersive_font_directory: None,
            java_executable: None,
            preserve_structure: default_preserve_structure(),
            allow_core_editing: false,
            starsector_root: None,
            log_directory: None,
            log_level: default_log_level(),
        }
    }
}

fn default_accent() -> AccentPreset {
    AccentPreset::Blue
}

fn default_custom_accent() -> String {
    "#2563eb".to_string()
}

fn default_file_history_limit() -> u32 {
    20
}

fn default_edit_history_limit() -> u32 {
    250
}

fn default_log_rotation_size_mib() -> u32 {
    5
}

fn default_log_backup_count() -> u32 {
    1
}

fn default_edit_mode() -> EditMode {
    EditMode::Smart
}

fn default_immersive_game_font() -> bool {
    true
}

fn default_watch_file_changes() -> bool {
    true
}

fn default_preserve_structure() -> bool {
    true
}

fn default_log_level() -> AppLogLevel {
    AppLogLevel::Info
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveAppSettingsPayload {
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsSnapshot {
    pub performance_monitor_active: bool,
    pub revision: u64,
    pub value: AppSettings,
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, AppTheme};
    use serde_json::json;

    #[test]
    fn cache_limits_defaults_and_wire_budget_names() {
        let wire = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(wire["cacheLimits"]["mediaData"]["entries"], 2048);
        assert_eq!(wire["cacheLimits"]["mediaData"]["MiB"], 64);
        assert_eq!(wire["cacheLimits"]["decodedImages"]["MiB"], 96);
        assert_eq!(wire["cacheLimits"]["thumbnails"]["MiB"], 32);
        assert_eq!(
            serde_json::from_value::<AppSettings>(wire).unwrap(),
            AppSettings::default()
        );
    }

    #[test]
    fn limits_have_backend_defaults_and_exact_wire_names() {
        let settings: AppSettings = serde_json::from_value(json!({})).unwrap();
        assert_eq!(settings.file_history_limit, 20);
        assert_eq!(settings.edit_history_limit, 250);
        assert_eq!(settings.log_rotation_size_mib, 5);
        assert_eq!(settings.log_backup_count, 1);
        let wire = serde_json::to_value(&settings).unwrap();
        assert_eq!(wire["fileHistoryLimit"], 20);
        assert_eq!(wire["editHistoryLimit"], 250);
        assert_eq!(wire["logRotationSizeMiB"], 5);
        assert_eq!(wire["logBackupCount"], 1);
        assert_eq!(
            serde_json::from_value::<AppSettings>(wire).unwrap(),
            settings
        );
    }

    #[test]
    fn show_core_feedback_defaults_open_and_roundtrips_each_level() {
        let defaults = serde_json::to_value(AppSettings::default()).unwrap();
        assert_eq!(
            defaults["showCoreFeedback"],
            json!({"success":true,"info":true,"warning":true,"error":true})
        );
        for level in ["success", "info", "warning", "error"] {
            let mut wire = defaults.clone();
            wire["showCoreFeedback"][level] = json!(false);
            let settings: AppSettings = serde_json::from_value(wire).unwrap();
            assert_eq!(
                serde_json::to_value(settings).unwrap()["showCoreFeedback"][level],
                false
            );
        }
    }

    #[test]
    fn original_font_switch_defaults_true_and_roundtrips_false() {
        let defaults: AppSettings = serde_json::from_value(json!({})).unwrap();
        assert!(defaults.immersive_game_font);
        let disabled: AppSettings =
            serde_json::from_value(json!({"immersiveGameFont": false})).unwrap();
        assert!(!disabled.immersive_game_font);
        assert_eq!(
            serde_json::to_value(disabled).unwrap()["immersiveGameFont"],
            false
        );
        assert!(
            serde_json::from_value::<AppSettings>(json!({"immersiveGameFont": "false"})).is_err()
        );
    }

    #[test]
    fn field_descriptions_default_closed_and_roundtrip() {
        assert!(!AppSettings::default().expand_field_descriptions);
        let settings: AppSettings =
            serde_json::from_value(json!({"expandFieldDescriptions": true})).unwrap();
        assert!(settings.expand_field_descriptions);
        assert_eq!(
            serde_json::to_value(settings).unwrap()["expandFieldDescriptions"],
            true
        );
        assert!(
            serde_json::from_value::<AppSettings>(json!({"expandFieldDescriptions": "true"}))
                .is_err()
        );
    }

    #[test]
    fn font_settings_roundtrip() {
        for name in [
            "interfaceFont",
            "fieldFont",
            "textEditorFont",
            "canvasEditorFont",
        ] {
            let mut wire = serde_json::to_value(AppSettings::default()).unwrap();
            assert_eq!(wire[name], json!(null));
            wire[name] = json!("Microsoft YaHei");
            let settings: AppSettings = serde_json::from_value(wire.clone()).unwrap();
            assert_eq!(serde_json::to_value(settings).unwrap(), wire);
            wire[name] = json!(1);
            assert!(serde_json::from_value::<AppSettings>(wire).is_err());
        }
    }

    #[test]
    fn theme_defaults_to_system_and_preserves_explicit_choices() {
        assert_eq!(AppSettings::default().theme, None);
        for (value, expected) in [
            (json!({}), None),
            (json!({"theme": null}), None),
            (json!({"theme": "light"}), Some(AppTheme::Light)),
            (json!({"theme": "dark"}), Some(AppTheme::Dark)),
        ] {
            let settings: AppSettings = serde_json::from_value(value).unwrap();
            assert_eq!(settings.theme, expected);
            let snapshot = serde_json::to_value(&settings).unwrap();
            let restored: AppSettings = serde_json::from_value(snapshot).unwrap();
            assert_eq!(restored.theme, expected);
        }
        assert!(serde_json::from_value::<AppSettings>(json!({"theme": "invalid"})).is_err());
    }

    #[test]
    fn app_settings_uses_nullable_starsector_root() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "theme": "light",
            "accent": "blue",
            "customAccent": "#2563eb",
            "fileHistoryLimit": 20,
            "editHistoryLimit": 250,
            "logRotationSizeMiB": 5,
            "logBackupCount": 1,
            "editMode": "smart",
            "starsectorRoot": null,
            "logDirectory": null
        }))
        .unwrap();

        assert_eq!(settings.starsector_root, None);
    }

    #[test]
    fn app_settings_treats_blank_starsector_root_as_missing() {
        let settings = serde_json::from_value::<AppSettings>(json!({
            "theme": "light",
            "accent": "blue",
            "customAccent": "#2563eb",
            "fileHistoryLimit": 20,
            "editHistoryLimit": 250,
            "logRotationSizeMiB": 5,
            "logBackupCount": 1,
            "editMode": "smart",
            "starsectorRoot": "",
            "logDirectory": null
        }))
        .unwrap();

        assert_eq!(settings.starsector_root, None);
    }

    #[test]
    fn preserve_structure_defaults_true_for_existing_settings() {
        let old: AppSettings = serde_json::from_value(json!({"theme":"light"})).unwrap();
        assert!(old.preserve_structure);
        let disabled: AppSettings =
            serde_json::from_value(json!({"preserveStructure":false})).unwrap();
        assert!(!disabled.preserve_structure);
        let old: AppSettings = serde_json::from_value(json!({"theme":"light"})).unwrap();
        assert!(!old.allow_core_editing);
    }
}
