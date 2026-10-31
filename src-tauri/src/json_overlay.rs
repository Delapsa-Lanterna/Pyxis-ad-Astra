use serde_json::Value;

/// Overlays objects recursively and replaces arrays and all other JSON values.
pub(crate) fn overlay_json_value(target: &mut Value, incoming: Value) {
    match (target, incoming) {
        (Value::Object(target), Value::Object(incoming)) => {
            for (key, value) in incoming {
                overlay_json_value(target.entry(key).or_insert(Value::Null), value);
            }
        }
        (target, value) => *target = value,
    }
}

#[cfg(test)]
mod tests {
    use super::overlay_json_value;
    use serde_json::json;

    #[test]
    fn overlays_objects_and_replaces_atomic_values() {
        for (mut target, incoming, expected) in [
            (
                json!({"style":{"size":1,"color":[1,2]},"keep":true}),
                json!({"style":{"color":[3],"glow":false}}),
                json!({"style":{"size":1,"color":[3],"glow":false},"keep":true}),
            ),
            (
                json!({"style":{"size":1}}),
                json!({"style":null}),
                json!({"style":null}),
            ),
            (json!([1, 2]), json!({"value":3}), json!({"value":3})),
        ] {
            overlay_json_value(&mut target, incoming);
            assert_eq!(target, expected);
        }
    }
}
