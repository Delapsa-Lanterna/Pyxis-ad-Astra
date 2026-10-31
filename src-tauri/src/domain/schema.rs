use crate::errors::{AppError, AppResult};
use serde_json::Value;

pub fn validate_document(schema: &Value, data: &Value) -> AppResult<()> {
    if let Some(root) = schema.get("root") {
        return validate_field(
            root,
            data,
            schema["id"].as_str().expect("bundled schema ID"),
            true,
        );
    }
    for section in schema["sections"].as_array().expect("bundled sections") {
        for field in section["fields"].as_array().expect("bundled fields") {
            let key = field["key"].as_str().expect("bundled field key");
            let key = key.strip_prefix("file.").unwrap_or(key);
            if let Some(value) = data.get(key) {
                validate_field(field, value, key, true)?;
            }
        }
    }
    Ok(())
}

fn matches_type(field: &Value, data: &Value) -> bool {
    match field["type"].as_str().expect("bundled field type") {
        "json" => true,
        "object" => data.is_object() || (field["format"] == "array-of-entries" && data.is_array()),
        "array" | "color-rgba" | "color-rgb" | "string-array" | "tag-select" => data.is_array(),
        "boolean" => {
            data.is_boolean()
                || data.as_str().is_some_and(|s| {
                    s.eq_ignore_ascii_case("true") || s.eq_ignore_ascii_case("false")
                })
        }
        "float" | "integer" => data.is_number() || data.is_string(),
        _ => data.is_string(),
    }
}

pub fn validate_field(field: &Value, data: &Value, path: &str, complete: bool) -> AppResult<()> {
    let invalid = || AppError::message("config.shape_invalid", format!("字段内容无效：{path}"));
    if complete
        && field["required"] == true
        && (data.is_null() || data.as_str().is_some_and(|s| s.trim().is_empty()))
    {
        return Err(invalid());
    }
    if let Some(variants) = field["variants"].as_array() {
        let variant = variants
            .iter()
            .find(|field| matches_type(field, data))
            .ok_or_else(invalid)?;
        return validate_field(variant, data, path, complete);
    }
    if !matches_type(field, data) {
        return Err(invalid());
    }
    match field["type"].as_str().expect("bundled field type") {
        "object" if data.is_array() => {
            for entry in data.as_array().expect("validated entries") {
                let object = entry.as_object().ok_or_else(invalid)?;
                if object.len() != 1 {
                    return Err(invalid());
                }
                validate_field(field, entry, path, complete)?;
            }
        }
        "object" => {
            let object = data.as_object().expect("validated dictionary");
            if field["minEntries"]
                .as_u64()
                .is_some_and(|min| object.len() < min as usize)
                || field["maxEntries"]
                    .as_u64()
                    .is_some_and(|max| object.len() > max as usize)
            {
                return Err(invalid());
            }
            if complete {
                if let Some(keys) = field["exclusiveKeys"].as_array()
                    && keys
                        .iter()
                        .filter(|key| {
                            object.contains_key(key.as_str().expect("bundled exclusive key"))
                        })
                        .count()
                        != 1
                {
                    return Err(invalid());
                }
                if let Some(fields) = field["nested"].as_array() {
                    for child in fields {
                        let key = child["key"].as_str().expect("bundled field key");
                        let required = child["required"] == true
                            || child["requiredWhen"].as_object().is_some_and(|conditions| {
                                conditions.iter().all(|(key, expected)| {
                                    let value = object.get(key).or_else(|| {
                                        fields
                                            .iter()
                                            .find(|field| field["key"] == *key)
                                            .and_then(|field| field.get("default"))
                                    });
                                    if expected.is_string() {
                                        value == Some(expected)
                                    } else if let Some(minimum) = expected["min"].as_f64() {
                                        value
                                            .and_then(Value::as_f64)
                                            .is_some_and(|value| value >= minimum)
                                    } else {
                                        value.is_none()
                                    }
                                })
                            });
                        if required && !object.contains_key(key) {
                            return Err(AppError::message(
                                "config.shape_invalid",
                                format!("缺少必填字段：{path}/{key}"),
                            ));
                        }
                    }
                }
            }
            for (key, value) in object {
                let fixed = field["nested"]
                    .as_array()
                    .and_then(|fields| fields.iter().find(|child| child["key"] == *key));
                if fixed.is_none() && field["allowExtraFields"] != true {
                    continue;
                }
                if field["reservedKeys"]
                    .as_array()
                    .is_some_and(|keys| keys.iter().any(|v| v.as_str() == Some(key)))
                {
                    return Err(invalid());
                }
                if let Some(schema) = fixed.or_else(|| field.get("valueSchema")) {
                    if fixed.is_none()
                        && let Some(keys) = field.get("keySchema")
                    {
                        if keys["type"] == "integer" && key.parse::<usize>().is_err() {
                            return Err(invalid());
                        }
                        validate_field(
                            keys,
                            &Value::String(key.clone()),
                            &format!("{path}/{key}"),
                            complete,
                        )?;
                    }
                    validate_field(schema, value, &format!("{path}/{key}"), complete)?;
                }
            }
        }
        "array" => {
            let count = data.as_array().expect("validated array").len();
            if field["minEntries"]
                .as_u64()
                .is_some_and(|min| count < min as usize)
                || field["maxEntries"]
                    .as_u64()
                    .is_some_and(|max| count > max as usize)
            {
                return Err(invalid());
            }
            if let Some(schema) = field.get("item") {
                for (index, value) in data.as_array().expect("validated array").iter().enumerate() {
                    validate_field(schema, value, &format!("{path}/{index}"), complete)?;
                }
            }
        }
        "string-array" | "tag-select"
            if data
                .as_array()
                .expect("validated string array")
                .iter()
                .any(|value| !value.is_string()) =>
        {
            return Err(invalid());
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
