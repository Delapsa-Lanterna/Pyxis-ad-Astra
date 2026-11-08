use crate::parsers::parse_persisted_json;
#[cfg(test)]
use crate::test_support::work_counts;
use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::Path;
use std::sync::LazyLock;

pub fn bundled_schema(id: &str) -> &'static Value {
    static SCHEMAS: LazyLock<BTreeMap<&str, Value>> = LazyLock::new(|| {
        let raw: BTreeMap<_, _> = include!(concat!(env!("OUT_DIR"), "/config_schemas.rs"))
            .into_iter()
            .map(|(id, text)| {
                #[cfg(test)]
                work_counts::record("schema-parse", Path::new(id));
                (
                    id,
                    parse_persisted_json(text).expect("bundled field schema is valid JSON"),
                )
            })
            .collect();
        raw.iter()
            .map(|(&id, schema)| (id, resolve(schema, &raw)))
            .collect()
    });
    &SCHEMAS[id]
}

fn resolve(value: &Value, schemas: &BTreeMap<&str, Value>) -> Value {
    match value {
        Value::Array(items) => {
            Value::Array(items.iter().map(|item| resolve(item, schemas)).collect())
        }
        Value::Object(fields) => {
            let mut result = if let Some(reference) = fields.get("ref").and_then(Value::as_str) {
                let (id, pointer) = reference.split_once('#').expect("bundled schema reference");
                resolve(
                    schemas[id]
                        .pointer(pointer)
                        .expect("bundled schema reference target"),
                    schemas,
                )
                .as_object()
                .expect("referenced field")
                .clone()
            } else {
                Default::default()
            };
            result.extend(
                fields
                    .iter()
                    .filter(|(key, _)| key.as_str() != "ref")
                    .map(|(key, value)| (key.clone(), resolve(value, schemas))),
            );
            Value::Object(result)
        }
        _ => value.clone(),
    }
}
