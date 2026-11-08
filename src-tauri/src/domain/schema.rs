use crate::errors::{AppError, AppResult, ErrorLocation, FieldProblem};
use serde_json::{Map, Value};

pub fn validate_document(schema: &Value, data: &Value) -> AppResult<()> {
    checked(document_issues(schema, data, true))
}
pub fn validate_partial_document(schema: &Value, data: &Value) -> AppResult<()> {
    checked(document_issues(schema, data, false))
}
pub fn validate_field(field: &Value, data: &Value, path: &str, complete: bool) -> AppResult<()> {
    checked(field_issues(field, Some(data), path, complete, data))
}
fn checked(issues: Vec<FieldProblem>) -> AppResult<()> {
    if issues.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation {
            code: "config.shape_invalid",
            issues,
        })
    }
}
fn invalid(field: &Value, path: &str, message: &str) -> FieldProblem {
    FieldProblem {
        severity: "error".into(),
        code: field["issueCode"]
            .as_str()
            .unwrap_or("config.shape_invalid")
            .into(),
        path: path.into(),
        message: format!(
            "{} ({path}): {}",
            field["label"].as_str().unwrap_or(path),
            field["issueMessage"].as_str().unwrap_or(message)
        ),
        location: Some(Box::new(ErrorLocation {
            field: Some(path.into()),
            ..Default::default()
        })),
    }
}
fn read_path<'a>(data: &'a Value, path: &str) -> Option<&'a Value> {
    data.get(path).or_else(|| {
        data.pointer(&format!(
            "/{}",
            path.replace(['.', '['], "/").replace(']', "")
        ))
    })
}
fn required(field: &Value, read: impl Fn(&str) -> Option<Value>) -> bool {
    field["required"] == true
        || field["requiredWhen"].as_object().is_some_and(|conditions| {
            conditions.iter().all(|(key, expected)| {
                let value = read(key);
                if expected.is_string() {
                    value.as_ref() == Some(expected)
                } else if let Some(minimum) = expected["min"].as_f64() {
                    value
                        .as_ref()
                        .and_then(Value::as_f64)
                        .is_some_and(|value| value >= minimum)
                } else {
                    value.is_none()
                }
            })
        })
}
fn visible(condition: &Value, data: &Value) -> bool {
    let matches = |branch: &Value| {
        branch
            .as_object()
            .expect("bundled visibility")
            .iter()
            .all(|(key, expected)| {
                let value = read_path(data, key).unwrap_or(&Value::Null);
                if let Some(values) = expected.as_array() {
                    let actual = value
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| value.to_string());
                    values
                        .iter()
                        .any(|expected| expected.as_str() == Some(actual.as_str()))
                } else {
                    value
                        .as_f64()
                        .or_else(|| value.as_str()?.parse::<f64>().ok())
                        .is_some_and(|value| {
                            value > expected["gt"].as_f64().expect("visibility threshold")
                        })
                }
            })
    };
    match condition {
        Value::Null => true,
        Value::Array(branches) => branches.iter().any(matches),
        _ => matches(condition),
    }
}
fn matches_type(field: &Value, data: &Value) -> bool {
    match field["type"].as_str().expect("bundled field type") {
        "json" => true,
        "object" => data.is_object() || (field["format"] == "array-of-entries" && data.is_array()),
        "array" | "color-rgba" | "color-rgb" | "string-array" | "tag-select" => data.is_array(),
        "boolean" => {
            data.is_boolean()
                || data.as_str().is_some_and(|value| {
                    value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false")
                })
        }
        "float" | "integer" => data.is_number() || data.is_string(),
        _ => data.is_string(),
    }
}
pub fn document_issues(schema: &Value, data: &Value, complete: bool) -> Vec<FieldProblem> {
    if let Some(root) = schema.get("root") {
        return field_issues(
            root,
            Some(data),
            root["key"].as_str().expect("root key"),
            complete,
            data,
        );
    }
    let mut issues = Vec::new();
    let fields = schema["sections"]
        .as_array()
        .expect("bundled sections")
        .iter()
        .flat_map(|section| {
            section["fields"]
                .as_array()
                .expect("section fields")
                .iter()
                .map(|field| {
                    let mut field = field.clone();
                    if !visible(&section["visibleWhen"], data) {
                        field["required"] = Value::Bool(false);
                        field["requiredWhen"] = Value::Null;
                    }
                    field
                })
        })
        .collect::<Vec<_>>();
    for field in &fields {
        let key = field["key"]
            .as_str()
            .expect("field key")
            .strip_prefix("file.")
            .unwrap_or(field["key"].as_str().expect("field key"));
        let mut field = field.clone();
        field["required"] = Value::Bool(required(&field, |key| {
            read_path(data, key.strip_prefix("file.").unwrap_or(key))
                .cloned()
                .or_else(|| {
                    fields
                        .iter()
                        .find(|field| field["key"] == key)
                        .and_then(|field| field.get("default"))
                        .cloned()
                })
        }));
        issues.extend(field_issues(
            &field,
            read_path(data, key),
            key,
            complete,
            data,
        ));
    }
    issues
}
fn field_issues(
    field: &Value,
    data: Option<&Value>,
    path: &str,
    complete: bool,
    root: &Value,
) -> Vec<FieldProblem> {
    let fail = |message| vec![invalid(field, path, message)];
    if data.is_none() && !visible(&field["visibleWhen"], root) {
        return Vec::new();
    }
    let Some(data) = data else {
        return if complete && field["required"] == true {
            fail("必填字段未设置")
        } else {
            Vec::new()
        };
    };
    if complete
        && field["required"] == true
        && data.as_str().is_some_and(|value| value.trim().is_empty())
    {
        return fail("必填字段未设置");
    }
    if let Some(variants) = field["variants"].as_array() {
        let Some(variant) = variants
            .iter()
            .find(|candidate| matches_type(candidate, data))
        else {
            return fail("内容类型不符合字段定义");
        };
        let mut variant = variant.clone();
        if let Some(required) = field.get("required") {
            variant["required"] = required.clone();
        }
        return field_issues(&variant, Some(data), path, complete, root);
    }
    if field["required"] != true
        && data.as_str() == Some("")
        && ["string", "text", "enum", "path", "path-image"]
            .contains(&field["type"].as_str().expect("field type"))
    {
        return Vec::new();
    }
    if !matches_type(field, data) {
        return fail("内容类型不符合字段定义");
    }
    let mut issues = Vec::new();
    match field["type"].as_str().expect("field type") {
        "object" if data.is_array() => {
            let entries = data.as_array().expect("entry array");
            let mut object = Map::new();
            for entry in entries {
                if let Some(entry) = entry.as_object().filter(|entry| entry.len() == 1) {
                    object.extend(entry.clone());
                } else {
                    return fail("每个条目应包含一个键值");
                }
            }
            issues.extend(field_issues(
                field,
                Some(&Value::Object(object)),
                path,
                complete,
                root,
            ));
        }
        "object" => {
            let object = data.as_object().expect("object");
            let count = object.len() as u64;
            if field["minEntries"].as_u64().is_some_and(|min| count < min)
                || field["maxEntries"].as_u64().is_some_and(|max| count > max)
            {
                let mut issue = invalid(field, path, "条目数量不符合要求");
                if field["issueCode"].is_null() {
                    issue.code = "spec.entry_count".into();
                }
                issues.push(issue);
            }
            if complete
                && field["exclusiveKeys"].as_array().is_some_and(|keys| {
                    keys.iter()
                        .filter(|key| object.contains_key(key.as_str().expect("exclusive key")))
                        .count()
                        != 1
                })
            {
                let mut issue = invalid(field, path, "应设置一个互斥字段");
                if field["issueCode"].is_null() {
                    issue.code = "spec.exclusive_keys".into();
                }
                issues.push(issue);
            }
            let nested = field["nested"].as_array();
            for child in nested.into_iter().flatten() {
                let key = child["key"].as_str().expect("field key");
                let mut child = child.clone();
                child["required"] = Value::Bool(required(&child, |key| {
                    object.get(key).cloned().or_else(|| {
                        nested
                            .and_then(|fields| fields.iter().find(|field| field["key"] == key))
                            .and_then(|field| field.get("default"))
                            .cloned()
                    })
                }));
                issues.extend(field_issues(
                    &child,
                    object.get(key),
                    &format!("{path}[{}]", Value::String(key.into())),
                    complete,
                    root,
                ));
            }
            for (key, value) in object {
                if nested.is_some_and(|fields| fields.iter().any(|child| child["key"] == *key))
                    || field["allowExtraFields"] != true
                {
                    continue;
                }
                let child_path = format!("{path}[{}]", Value::String(key.clone()));
                if field["reservedKeys"]
                    .as_array()
                    .is_some_and(|keys| keys.iter().any(|value| value.as_str() == Some(key)))
                {
                    issues.push(invalid(field, &child_path, "名称为保留名称"));
                }
                if let Some(keys) = field.get("keySchema") {
                    issues.extend(field_issues(
                        keys,
                        Some(&Value::String(key.clone())),
                        &child_path,
                        true,
                        root,
                    ));
                }
                if let Some(schema) = field.get("valueSchema") {
                    issues.extend(field_issues(
                        schema,
                        Some(value),
                        &child_path,
                        complete,
                        root,
                    ));
                }
            }
        }
        "array" | "string-array" | "tag-select" | "color-rgb" | "color-rgba" => {
            let values = data.as_array().expect("array");
            let count = values.len() as u64;
            if field["minEntries"].as_u64().is_some_and(|min| count < min)
                || field["maxEntries"].as_u64().is_some_and(|max| count > max)
            {
                issues.push(invalid(field, path, "条目数量不符合要求"));
            }
            if ["string-array", "tag-select"].contains(&field["type"].as_str().expect("field type"))
                && values.iter().any(|value| {
                    !value.is_string()
                        || field["options"]
                            .as_array()
                            .is_some_and(|options| !options.contains(value))
                })
            {
                issues.push(invalid(field, path, "列表项不符合字段定义"));
            }
            if field["type"]
                .as_str()
                .expect("field type")
                .starts_with("color-")
                && (values.len() != if field["type"] == "color-rgb" { 3 } else { 4 }
                    || values
                        .iter()
                        .any(|value| value.as_u64().is_none_or(|value| value > 255)))
            {
                issues.push(invalid(field, path, "颜色通道应为 0 至 255 的整数"));
            }
            if let Some(item) = field.get("item") {
                for (index, value) in values.iter().enumerate() {
                    issues.extend(field_issues(
                        item,
                        Some(value),
                        &format!("{path}[{index}]"),
                        complete,
                        root,
                    ));
                }
            }
        }
        "float" | "integer" => {
            let number = data.as_f64().or_else(|| {
                data.as_str().and_then(|text| {
                    let text = text.trim();
                    if field["type"] == "integer"
                        && (text.trim_start_matches(['+', '-']).is_empty()
                            || !text
                                .trim_start_matches(['+', '-'])
                                .bytes()
                                .all(|value| value.is_ascii_digit()))
                    {
                        return None;
                    }
                    let text = if field["numberFormat"] == "starsector" {
                        text.strip_suffix(['f', 'F', 'd', 'D']).unwrap_or(text)
                    } else {
                        text
                    };
                    text.parse::<f64>().ok()
                })
            });
            if number.is_none_or(|value| {
                !value.is_finite()
                    || (field["type"] == "integer"
                        && (value.fract() != 0.0 || value.abs() > 9007199254740991.0))
                    || field["min"].as_f64().is_some_and(|min| value < min)
                    || field["max"].as_f64().is_some_and(|max| value > max)
            }) {
                issues.push(invalid(field, path, "数值不符合字段定义"));
            }
        }
        "enum"
            if field["options"]
                .as_array()
                .is_some_and(|options| !options.contains(data)) =>
        {
            issues.push(invalid(field, path, "值不在允许范围内"));
        }
        _ => {}
    }
    issues
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parsers;
    use serde_json::json;

    #[test]
    fn collects_every_structural_failure_and_keeps_partial_omissions() {
        let schema = json!({"sections":[{"fields":[
            {"key":"count","label":"Count","type":"integer"},
            {"key":"choice","label":"Choice","type":"object","exclusiveKeys":["a","b"]},
            {"key":"items","label":"Items","type":"array","item":{"type":"object","nested":[{"key":"name","type":"string","required":true}]}}
        ]}]});
        let data = json!({"count":null,"choice":{"a":1,"b":2},"items":[{},{}]});
        let issues = document_issues(&schema, &data, true);
        assert_eq!(
            issues
                .iter()
                .map(|issue| issue.path.as_str())
                .collect::<Vec<_>>(),
            [
                "count",
                "choice",
                "items[0][\"name\"]",
                "items[1][\"name\"]"
            ]
        );
        assert!(document_issues(&schema, &json!({"items":[{}]}), false).is_empty());
        let error = validate_document(&schema, &data)
            .unwrap_err()
            .at_path("fixture.json");
        let wire = serde_json::to_value(error).unwrap();
        assert_eq!(wire["issues"].as_array().unwrap().len(), 4);
        assert!(
            wire["issues"]
                .as_array()
                .unwrap()
                .iter()
                .all(|issue| issue["location"]["path"] == "fixture.json")
        );
    }

    #[test]
    fn document_checks_declared_required_paths_and_visibility() {
        let schema = json!({"sections":[{"fields":[
            {"key":"width","type":"float","required":true},
            {"key":"center[0]","type":"float","required":true},
            {"key":"textureType","type":"string","required":true,"visibleWhen":{"specClass":["beam"]}}
        ]}]});
        let mut data = json!({"width":2,"center":[1,2],"specClass":"projectile"});
        validate_document(&schema, &data).unwrap();
        data.as_object_mut().unwrap().remove("width");
        assert!(
            validate_document(&schema, &data)
                .unwrap_err()
                .to_string()
                .contains("width")
        );
        validate_partial_document(&schema, &json!({})).unwrap();
        assert!(validate_partial_document(&schema, &json!({"width":"invalid"})).is_err());
        data["width"] = json!(2);
        data["center"] = json!([]);
        assert!(
            validate_document(&schema, &data)
                .unwrap_err()
                .to_string()
                .contains("center[0]")
        );
        data["center"] = json!([1, 2]);
        data["specClass"] = json!("beam");
        assert!(
            validate_document(&schema, &data)
                .unwrap_err()
                .to_string()
                .contains("textureType")
        );
        data["textureType"] = json!("SMOOTH");
        validate_document(&schema, &data).unwrap();
    }

    #[test]
    fn bounds_schema_consumes_the_shared_numeric_item_rule() {
        let schema = parsers::bundled_schema("spec-ship");
        let bounds = &schema["definitions"]["bounds"];
        for value in [
            json!([]),
            json!([0, 0]),
            json!([0, 0, 2.625]),
            json!([0, 0, "7e1", -2]),
        ] {
            validate_field(bounds, &value, "bounds", true).unwrap();
        }
        for value in [
            json!("invalid"),
            json!([0, 0, "invalid", 2]),
            json!([null, 0]),
        ] {
            assert!(validate_field(bounds, &value, "bounds", true).is_err());
        }
    }
}
