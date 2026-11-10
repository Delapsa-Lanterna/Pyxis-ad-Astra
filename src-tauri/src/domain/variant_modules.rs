use serde_json::Value;

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
