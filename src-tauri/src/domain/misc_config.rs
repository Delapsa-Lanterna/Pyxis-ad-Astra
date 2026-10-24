use crate::errors::{AppError, AppResult};
use crate::models::MiscConfigKind;
use serde_json::Value;

pub const MISC_CONFIG_FILES: &[MiscConfigKind] = &[
    MiscConfigKind::Strings,
    MiscConfigKind::EngineStyles,
    MiscConfigKind::HullStyles,
    MiscConfigKind::Sounds,
    MiscConfigKind::Settings,
];
pub fn misc_config_path(kind: MiscConfigKind) -> &'static str {
    match kind {
        MiscConfigKind::Strings => "data/strings/strings.json",
        MiscConfigKind::EngineStyles => "data/config/engine_styles.json",
        MiscConfigKind::HullStyles => "data/config/hull_styles.json",
        MiscConfigKind::Sounds => "data/config/sounds.json",
        MiscConfigKind::Settings => "data/config/settings.json",
    }
}

pub fn validate_misc_config(kind: MiscConfigKind, data: &Value, schema: &Value) -> AppResult<()> {
    crate::domain::schema::validate_field(schema, data, misc_config_path(kind), false)
        .map_err(|error| AppError::message("misc_config.shape_invalid", error.to_string()))
}
