use serde_json::{Map, Value};

pub fn module_entries(value: Option<&Value>) -> Vec<(String, String)> {
    match value {
        Some(Value::Object(items)) => items
            .iter()
            .filter_map(|(slot, id)| id.as_str().map(|id| (slot.clone(), id.into())))
            .collect(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_object)
            .flat_map(|item| item.iter())
            .filter_map(|(slot, id)| id.as_str().map(|id| (slot.clone(), id.into())))
            .collect(),
        _ => Vec::new(),
    }
}
pub fn rename_module_reference(data: &mut Value, previous: &str, next: &str) -> bool {
    fn replace(items: &mut Map<String, Value>, previous: &str, next: &str) -> bool {
        let mut changed = false;
        for value in items.values_mut() {
            if value.as_str() == Some(previous) {
                *value = Value::String(next.into());
                changed = true;
            }
        }
        changed
    }
    match data.get_mut("modules") {
        Some(Value::Object(items)) => replace(items, previous, next),
        Some(Value::Array(items)) => {
            let mut changed = false;
            for item in items.iter_mut().filter_map(Value::as_object_mut) {
                changed |= replace(item, previous, next);
            }
            changed
        }
        _ => false,
    }
}
