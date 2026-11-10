use crate::errors::{AppError, AppResult, ErrorLocation, FieldProblem};
use crate::models::file_content::PreparedValue;
use crate::models::file_content::{ChildFormats, JsonTarget, OutputFormat};
use crate::models::file_value::{Text, Value as FileValue};
use crate::parsers::game::number;
use serde_json::{Map, Value};
use std::iter;
#[derive(Clone, Copy, Debug)]
pub enum ScalarKind {
    Text,
    Integer,
    Float,
    Boolean,
}

#[derive(Clone, Debug)]
pub struct ScalarRule {
    pub kind: ScalarKind,
    pub minimum: Option<f64>,
    pub maximum: Option<f64>,
}

impl ScalarRule {
    pub fn prepare(&self, input: &str) -> AppResult<PreparedValue> {
        let (value, output) = match self.kind {
            ScalarKind::Text => (FileValue::Text(Text::new(input)), OutputFormat::Value),
            ScalarKind::Boolean => match input.trim().to_ascii_lowercase().as_str() {
                "true" => (FileValue::Bool(true), OutputFormat::Value),
                "false" => (FileValue::Bool(false), OutputFormat::Value),
                _ => return Err(input_error("请输入 true 或 false")),
            },
            ScalarKind::Integer | ScalarKind::Float => {
                let raw = input.trim();
                let raw = raw.strip_suffix(['f', 'F', 'd', 'D']).unwrap_or(raw);
                let unsigned = raw.trim_start_matches(['+', '-']);
                let hex = unsigned.starts_with("0x") || unsigned.starts_with("0X");
                let parsed = if hex {
                    number::hex_float(raw)
                } else {
                    raw.parse::<f64>().ok()
                }
                .filter(|value| value.is_finite())
                .ok_or_else(|| input_error("请输入完整有效数字"))?;
                if self.minimum.is_some_and(|min| parsed < min)
                    || self.maximum.is_some_and(|max| parsed > max)
                {
                    return Err(input_error("数值超出字段允许范围"));
                }
                match self.kind {
                    ScalarKind::Integer => {
                        let integer = if hex {
                            (parsed.fract() == 0.0
                                && parsed >= i64::MIN as f64
                                && parsed < 9223372036854775808.0)
                                .then_some(parsed as i64)
                        } else {
                            decimal_integer(raw)
                        }
                        .ok_or_else(|| input_error("请输入整数范围内的整数"))?;
                        (FileValue::Integer(integer), OutputFormat::Integer)
                    }
                    ScalarKind::Float => (
                        FileValue::Float(if parsed == 0.0 { 0.0 } else { parsed }),
                        OutputFormat::Float,
                    ),
                    _ => unreachable!("numeric field rule"),
                }
            }
        };
        Ok(PreparedValue {
            value,
            target: JsonTarget::generated(output),
        })
    }
}

fn decimal_integer(raw: &str) -> Option<i64> {
    let negative = raw.starts_with('-');
    let raw = raw.strip_prefix(['+', '-']).unwrap_or(raw);
    let (mantissa, exponent) = raw
        .split_once(['e', 'E'])
        .map_or(Some((raw, 0)), |(a, b)| Some((a, b.parse::<i64>().ok()?)))?;
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    if whole.is_empty() && fraction.is_empty()
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let mut digits = format!("{whole}{fraction}");
    let scale = exponent.checked_sub(fraction.len() as i64)?;
    let trimmed = digits.trim_start_matches('0');
    if trimmed.is_empty() {
        return Some(0);
    }
    digits = trimmed.to_owned();
    if scale < 0 {
        let count = scale.unsigned_abs() as usize;
        if count > digits.len() || !digits[digits.len() - count..].bytes().all(|b| b == b'0') {
            return None;
        }
        digits.truncate(digits.len() - count);
    } else {
        if scale > 19 || digits.len() + scale as usize > 19 {
            return None;
        }
        digits.extend(iter::repeat_n('0', scale as usize));
    }
    if negative {
        digits.insert(0, '-');
    }
    number::integer(&digits, 10, i64::MIN, i64::MAX)
}

fn input_error(message: &str) -> AppError {
    AppError::message("config.value_invalid", message)
}

pub fn prepare_document(value: &Value, schema: &Value) -> AppResult<PreparedValue> {
    if let Some(root) = schema.get("root") {
        return prepare_field(value, root);
    }
    let mut prepared = prepare_value(value)?;
    for field in schema["sections"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|section| section["fields"].as_array().into_iter().flatten())
    {
        let key = field["key"].as_str().expect("schema field key");
        let path = key
            .strip_prefix("file.")
            .unwrap_or(key)
            .replace('[', ".")
            .replace(']', "");
        let path = path.split('.').collect::<Vec<_>>();
        prepare_path(&mut prepared.value, &mut prepared.target, &path, field)?;
    }
    Ok(prepared)
}
pub fn prepare_value(value: &Value) -> AppResult<PreparedValue> {
    let (value, children) = match value {
        Value::Null => (FileValue::Null, None),
        Value::Bool(value) => (FileValue::Bool(*value), None),
        Value::String(value) => (FileValue::Text(Text::new(value)), None),
        Value::Number(number) => {
            let value = if let Some(value) = number.as_i64() {
                FileValue::Integer(value)
            } else if number.is_u64() {
                return Err(input_error("整数超出文件支持的范围"));
            } else {
                FileValue::Float(number.as_f64().expect("JSON float"))
            };
            (value, None)
        }
        Value::Array(values) => {
            let (values, targets) = values
                .iter()
                .map(prepare_value)
                .collect::<AppResult<Vec<_>>>()?
                .into_iter()
                .map(|prepared| (prepared.value, prepared.target))
                .unzip();
            (FileValue::Array(values), Some(ChildFormats::Array(targets)))
        }
        Value::Object(fields) => {
            let (fields, targets) = fields
                .iter()
                .map(|(key, value)| prepare_value(value).map(|value| (Text::new(key), value)))
                .collect::<AppResult<Vec<_>>>()?
                .into_iter()
                .map(|(key, prepared)| ((key.clone(), prepared.value), (key, prepared.target)))
                .unzip();
            (
                FileValue::Object(fields),
                Some(ChildFormats::Object(targets)),
            )
        }
    };
    Ok(PreparedValue {
        value,
        target: JsonTarget {
            source: None,
            output: OutputFormat::Value,
            children,
        },
    })
}
fn prepare_field(value: &Value, field: &Value) -> AppResult<PreparedValue> {
    if let Some(fields) = field["variants"].as_array()
        && let Some(field) = fields.iter().find(|field| shape(field, value))
    {
        return prepare_field(value, field);
    }
    if matches!(
        field["type"].as_str(),
        Some("integer" | "float" | "boolean")
    ) {
        let kind = match field["type"].as_str().expect("scalar type") {
            "integer" => ScalarKind::Integer,
            "float" => ScalarKind::Float,
            _ => ScalarKind::Boolean,
        };
        let input = value
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| value.to_string());
        return ScalarRule {
            kind,
            minimum: field["min"].as_f64(),
            maximum: field["max"].as_f64(),
        }
        .prepare(&input);
    }
    let mut prepared = prepare_value(value)?;
    match (&mut prepared.value, &mut prepared.target.children, value) {
        (
            FileValue::Object(values),
            Some(ChildFormats::Object(targets)),
            Value::Object(original),
        ) => {
            for ((key, value), (_, target)) in values.iter_mut().zip(targets) {
                let name = key.as_str().expect("business object key");
                let rule = field["nested"]
                    .as_array()
                    .and_then(|fields| {
                        fields
                            .iter()
                            .find(|field| field["key"].as_str() == Some(name))
                    })
                    .or_else(|| field.get("valueSchema"));
                if let Some(rule) = rule {
                    let prepared = prepare_field(&original[name], rule)?;
                    *value = prepared.value;
                    *target = prepared.target;
                }
            }
        }
        (FileValue::Array(values), Some(ChildFormats::Array(targets)), Value::Array(original)) => {
            if let Some(item) = field.get("item") {
                for ((value, target), original) in values.iter_mut().zip(targets).zip(original) {
                    let prepared = prepare_field(original, item)?;
                    *value = prepared.value;
                    *target = prepared.target;
                }
            }
        }
        _ => {}
    }
    Ok(prepared)
}
fn prepare_path(
    value: &mut FileValue,
    target: &mut JsonTarget,
    path: &[&str],
    field: &Value,
) -> AppResult<()> {
    if path.is_empty() {
        let original = value.to_json()?;
        let prepared = prepare_field(&original, field)?;
        *value = prepared.value;
        *target = prepared.target;
        return Ok(());
    }
    match (value, &mut target.children) {
        (FileValue::Object(values), Some(ChildFormats::Object(targets))) => {
            if let Some(index) = values.iter().position(|(key, _)| key.equals(path[0])) {
                prepare_path(
                    &mut values[index].1,
                    &mut targets[index].1,
                    &path[1..],
                    field,
                )?;
            }
        }
        (FileValue::Array(values), Some(ChildFormats::Array(targets))) => {
            if let Ok(index) = path[0].parse::<usize>()
                && index < values.len()
            {
                prepare_path(&mut values[index], &mut targets[index], &path[1..], field)?;
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn validate_document(schema: &Value, data: &Value) -> AppResult<()> {
    checked(document_issues(schema, data, true))
}
pub fn validate_partial_document(schema: &Value, data: &Value) -> AppResult<()> {
    checked(document_issues(schema, data, false))
}
pub fn validate_field(field: &Value, data: &Value, path: &str, complete: bool) -> AppResult<()> {
    let mut issues = Vec::new();
    inspect(field, Some(data), path, complete, data, &mut issues);
    checked(issues)
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
fn problem(field: &Value, path: &str, message: &str) -> FieldProblem {
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
fn read_path<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    root.get(path).or_else(|| {
        root.pointer(&format!(
            "/{}",
            path.replace(['.', '['], "/").replace(']', "")
        ))
    })
}
fn visible(condition: &Value, root: &Value) -> bool {
    let branch = |condition: &Value| {
        condition
            .as_object()
            .expect("schema condition object")
            .iter()
            .all(|(key, expected)| {
                let value = read_path(root, key).unwrap_or(&Value::Null);
                if let Some(options) = expected.as_array() {
                    options.contains(value)
                } else {
                    value
                        .as_f64()
                        .or_else(|| value.as_str()?.parse().ok())
                        .is_some_and(|actual| {
                            actual > expected["gt"].as_f64().expect("schema threshold")
                        })
                }
            })
    };
    match condition {
        Value::Null => true,
        Value::Array(branches) => branches.iter().any(branch),
        _ => branch(condition),
    }
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
                        .is_some_and(|v| v >= minimum)
                } else {
                    value.is_none()
                }
            })
        })
}
fn shape(field: &Value, value: &Value) -> bool {
    match field["type"].as_str().expect("schema field type") {
        "json" => true,
        "object" => value.is_object() || field["format"] == "array-of-entries" && value.is_array(),
        "array" | "string-array" | "tag-select" | "color-rgb" | "color-rgba" => value.is_array(),
        "integer" | "float" => value.is_number() || value.is_string(),
        "boolean" => {
            value.is_boolean()
                || value.as_str().is_some_and(|v| {
                    v.eq_ignore_ascii_case("true") || v.eq_ignore_ascii_case("false")
                })
        }
        _ => value.is_string(),
    }
}
pub fn document_issues(schema: &Value, data: &Value, complete: bool) -> Vec<FieldProblem> {
    let mut issues = Vec::new();
    if let Some(root) = schema.get("root") {
        inspect(
            root,
            Some(data),
            root["key"].as_str().expect("root key"),
            complete,
            data,
            &mut issues,
        );
        return issues;
    }
    let fields = schema["sections"]
        .as_array()
        .expect("schema sections")
        .iter()
        .flat_map(|section| {
            section["fields"]
                .as_array()
                .expect("schema section fields")
                .iter()
                .map(move |field| (field, visible(&section["visibleWhen"], data)))
        })
        .collect::<Vec<_>>();
    for (field, section_visible) in &fields {
        let key = field["key"].as_str().expect("field key");
        let key = key.strip_prefix("file.").unwrap_or(key);
        let mut effective = (*field).clone();
        effective["required"] = Value::Bool(
            *section_visible
                && required(field, |key| {
                    read_path(data, key.strip_prefix("file.").unwrap_or(key))
                        .cloned()
                        .or_else(|| {
                            fields
                                .iter()
                                .find(|(field, _)| field["key"] == key)
                                .and_then(|(field, _)| field.get("default"))
                                .cloned()
                        })
                }),
        );
        inspect(
            &effective,
            read_path(data, key),
            key,
            complete,
            data,
            &mut issues,
        );
    }
    issues
}
fn inspect(
    field: &Value,
    value: Option<&Value>,
    path: &str,
    complete: bool,
    root: &Value,
    issues: &mut Vec<FieldProblem>,
) {
    if value.is_none() && !visible(&field["visibleWhen"], root) {
        return;
    }
    let Some(value) = value else {
        if complete && field["required"] == true {
            issues.push(problem(field, path, "必填字段未设置"));
        }
        return;
    };
    if complete && field["required"] == true && value.as_str().is_some_and(|v| v.trim().is_empty())
    {
        issues.push(problem(field, path, "必填字段未设置"));
        return;
    }
    if let Some(variants) = field["variants"].as_array() {
        if let Some(candidate) = variants.iter().find(|candidate| shape(candidate, value)) {
            let mut candidate = candidate.clone();
            candidate["required"] = field["required"].clone();
            inspect(&candidate, Some(value), path, complete, root, issues);
        } else {
            issues.push(problem(field, path, "内容类型不符合字段定义"));
        }
        return;
    }
    if !shape(field, value) {
        issues.push(problem(field, path, "内容类型不符合字段定义"));
        return;
    }
    match field["type"].as_str().expect("schema field type") {
        "object" => {
            let entries;
            let object = if let Some(object) = value.as_object() {
                object
            } else {
                let mut object = Map::new();
                for entry in value.as_array().expect("array-of-entries") {
                    let Some(entry) = entry.as_object().filter(|v| v.len() == 1) else {
                        issues.push(problem(field, path, "每个条目应包含一个键值"));
                        return;
                    };
                    object.extend(entry.clone());
                }
                entries = object;
                &entries
            };
            count(field, path, object.len(), issues);
            if complete
                && field["exclusiveKeys"].as_array().is_some_and(|keys| {
                    keys.iter()
                        .filter(|k| object.contains_key(k.as_str().expect("exclusive key")))
                        .count()
                        != 1
                })
            {
                issues.push(problem(field, path, "应设置一个互斥字段"));
            }
            let nested = field["nested"].as_array();
            for child in nested.into_iter().flatten() {
                let key = child["key"].as_str().expect("child key");
                let mut effective = child.clone();
                effective["required"] = Value::Bool(required(child, |key| {
                    object.get(key).cloned().or_else(|| {
                        nested
                            .and_then(|fields| fields.iter().find(|f| f["key"] == key))
                            .and_then(|f| f.get("default"))
                            .cloned()
                    })
                }));
                inspect(
                    &effective,
                    object.get(key),
                    &format!("{path}[{}]", Value::String(key.into())),
                    complete,
                    root,
                    issues,
                );
            }
            if field["allowExtraFields"] == true {
                for (key, value) in object.iter().filter(|(key, _)| {
                    !nested.is_some_and(|fields| fields.iter().any(|f| f["key"] == **key))
                }) {
                    let path = format!("{path}[{}]", Value::String(key.clone()));
                    if field["reservedKeys"]
                        .as_array()
                        .is_some_and(|keys| keys.iter().any(|v| v.as_str() == Some(key)))
                    {
                        issues.push(problem(field, &path, "名称为保留名称"));
                    }
                    if let Some(schema) = field.get("keySchema") {
                        inspect(
                            schema,
                            Some(&Value::String(key.clone())),
                            &path,
                            true,
                            root,
                            issues,
                        );
                    }
                    if let Some(schema) = field.get("valueSchema") {
                        inspect(schema, Some(value), &path, complete, root, issues);
                    }
                }
            }
        }
        "array" | "string-array" | "tag-select" | "color-rgb" | "color-rgba" => {
            let items = value.as_array().expect("array shape");
            count(field, path, items.len(), issues);
            let kind = field["type"].as_str().expect("array type");
            if kind.starts_with("color-")
                && (items.len() != if kind == "color-rgb" { 3 } else { 4 }
                    || items.iter().any(|v| v.as_u64().is_none_or(|v| v > 255)))
            {
                issues.push(problem(field, path, "颜色通道应为 0 至 255 的整数"));
            }
            if matches!(kind, "string-array" | "tag-select")
                && items.iter().any(|v| {
                    !v.is_string()
                        || field["options"]
                            .as_array()
                            .is_some_and(|options| !options.contains(v))
                })
            {
                issues.push(problem(field, path, "列表项不符合字段定义"));
            }
            if let Some(item) = field.get("item") {
                for (index, value) in items.iter().enumerate() {
                    inspect(
                        item,
                        Some(value),
                        &format!("{path}[{index}]"),
                        complete,
                        root,
                        issues,
                    );
                }
            }
        }
        "integer" | "float" => {
            let input = value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string());
            let rule = ScalarRule {
                kind: if field["type"] == "integer" {
                    ScalarKind::Integer
                } else {
                    ScalarKind::Float
                },
                minimum: field["min"].as_f64(),
                maximum: field["max"].as_f64(),
            };
            if rule.prepare(&input).is_err() {
                issues.push(problem(field, path, "数值不符合字段定义"));
            }
        }
        "enum"
            if field["options"]
                .as_array()
                .is_some_and(|options| !options.contains(value))
                && (field["required"] == true || value.as_str() != Some("")) =>
        {
            issues.push(problem(field, path, "值不在允许范围内"));
        }
        _ => {}
    }
}
fn count(field: &Value, path: &str, length: usize, issues: &mut Vec<FieldProblem>) {
    if field["minEntries"]
        .as_u64()
        .is_some_and(|min| (length as u64) < min)
        || field["maxEntries"]
            .as_u64()
            .is_some_and(|max| (length as u64) > max)
    {
        issues.push(problem(field, path, "条目数量不符合要求"));
    }
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
