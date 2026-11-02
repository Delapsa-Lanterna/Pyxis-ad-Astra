use crate::errors::{AppError, AppResult};
use crate::models::JsonComposition;
use serde_json::{Map, Value};
use std::iter;

/// Mirrors LoadingUtils array and object merging. Array clearing retains the
/// sentinel because downstream game consumers receive it; supplemental scalars
/// keep their written type instead of the game's string form.
pub fn merge_game_json(target: &mut Value, incoming: &Value, excluded: &[String]) -> AppResult<()> {
    let target = target.as_object_mut().expect("game JSON root is an object");
    for (key, value) in incoming.as_object().expect("game JSON source is an object") {
        if excluded.contains(key) {
            continue;
        }
        match value {
            Value::Array(items) => {
                let current = target
                    .entry(key)
                    .or_insert_with(|| Value::Array(Vec::new()));
                let current = current
                    .as_array_mut()
                    .ok_or_else(|| merge_type_error(key, "array"))?;
                let name = key.to_ascii_lowercase();
                if items.first().and_then(Value::as_str) == Some("core_clearArray")
                    || (current.len() == 4 && (name.contains("color") || name.contains("button")))
                    || name.starts_with("music_")
                {
                    current.clear();
                }
                current.extend(items.iter().cloned());
            }
            Value::Object(_) => {
                let current = target
                    .entry(key)
                    .or_insert_with(|| Value::Object(Map::new()));
                if !current.is_object() {
                    return Err(merge_type_error(key, "object"));
                }
                merge_game_json(current, value, excluded)?;
            }
            _ => {
                target.insert(key.clone(), value.clone());
            }
        }
    }
    Ok(())
}

fn merge_type_error(key: &str, kind: &str) -> AppError {
    AppError::message(
        "json.merge_type",
        format!("Value for key {key} must be a JSON {kind}"),
    )
}

/// Frontend draft marker for a file that replaces its base layers; it never reaches disk.
pub const REPLACE_BASE_KEY: &str = "__replaceBase";

pub fn compose_game_json(composition: &JsonComposition, local: &Value) -> AppResult<Value> {
    if let Some(object) = local.as_object()
        && object.contains_key(REPLACE_BASE_KEY)
    {
        let mut object = object.clone();
        object.remove(REPLACE_BASE_KEY);
        return Ok(Value::Object(object));
    }
    if composition.replace {
        return Ok(local.clone());
    }
    if let Some(layer) = composition.layers.iter().rev().find(|layer| layer.replace) {
        return Ok(layer.data.clone());
    }
    let mut values = composition
        .layers
        .iter()
        .map(|layer| &layer.data)
        .chain(iter::once(local));
    let mut result = values.next().expect("local JSON source").clone();
    for value in values {
        merge_game_json(&mut result, value, &composition.excluded)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_game_merge_cases() {
        let cases: Vec<Value> = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/json-composition.json"
        ))
        .unwrap();
        for case in cases {
            let mut result = case["base"].clone();
            let excluded: Vec<String> = case
                .get("excluded")
                .map(|value| serde_json::from_value(value.clone()).unwrap())
                .unwrap_or_default();
            let outcome = merge_game_json(&mut result, &case["local"], &excluded);
            if case["error"] == true {
                assert_eq!(
                    outcome.unwrap_err().code(),
                    "json.merge_type",
                    "{}",
                    case["name"]
                );
            } else {
                outcome.unwrap();
                assert_eq!(result, case["expected"], "{}", case["name"]);
            }
        }
    }
}
