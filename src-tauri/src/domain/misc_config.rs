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
    validate_field(schema, data, misc_config_path(kind))
}

fn matches_type(field: &Value, data: &Value) -> bool {
    match field["type"].as_str().expect("bundled field type") {
        "json" => true,
        "object" => data.is_object(),
        "array" | "color-rgba" | "color-rgb" => data.is_array(),
        "boolean" => data.is_boolean(),
        "float" | "integer" => data.is_number() || data.is_string(),
        _ => data.is_string(),
    }
}

fn validate_field(field: &Value, data: &Value, path: &str) -> AppResult<()> {
    let invalid = || {
        AppError::message(
            "misc_config.shape_invalid",
            format!("Invalid value at {path}"),
        )
    };
    if let Some(variants) = field["variants"].as_array() {
        let variant = variants
            .iter()
            .find(|field| matches_type(field, data))
            .ok_or_else(invalid)?;
        return validate_field(variant, data, path);
    }
    if !matches_type(field, data) {
        return Err(invalid());
    }
    match field["type"].as_str().expect("bundled field type") {
        "object" => {
            for (key, value) in data.as_object().expect("validated dictionary") {
                let fixed = field["nested"]
                    .as_array()
                    .and_then(|fields| fields.iter().find(|child| child["key"] == *key));
                if field["reservedKeys"]
                    .as_array()
                    .is_some_and(|keys| keys.iter().any(|v| v.as_str() == Some(key)))
                {
                    return Err(AppError::message(
                        "misc_config.shape_invalid",
                        format!("Reserved key at {path}/{key}"),
                    ));
                }
                if let Some(schema) = fixed.or_else(|| field.get("valueSchema")) {
                    validate_field(schema, value, &format!("{path}/{key}"))?;
                }
            }
        }
        "array" => {
            if let Some(schema) = field.get("item") {
                for (index, value) in data.as_array().expect("validated array").iter().enumerate() {
                    validate_field(schema, value, &format!("{path}/{index}"))?;
                }
            }
        }
        "color-rgb" | "color-rgba" => {
            let values = data.as_array().expect("validated color");
            let size = if field["type"] == "color-rgb" { 3 } else { 4 };
            if values.len() != size || values.iter().any(|v| v.as_u64().is_none_or(|n| n > 255)) {
                return Err(invalid());
            }
        }
        "float" | "integer" => {
            let number = data
                .as_f64()
                .or_else(|| {
                    data.as_str().and_then(|text| {
                        let text = text.trim();
                        let text = if field["numberFormat"] == "starsector" {
                            text.strip_suffix(['f', 'F', 'd', 'D']).unwrap_or(text)
                        } else {
                            text
                        };
                        text.parse::<f64>().ok()
                    })
                })
                .ok_or_else(invalid)?;
            if !number.is_finite()
                || (field["type"] == "integer" && number.fract() != 0.0)
                || field["min"].as_f64().is_some_and(|min| number < min)
                || field["max"].as_f64().is_some_and(|max| number > max)
            {
                return Err(invalid());
            }
        }
        "enum"
            if field["options"]
                .as_array()
                .is_some_and(|options| !options.contains(data)) =>
        {
            return Err(invalid());
        }
        _ => {}
    }
    Ok(())
}
