use crate::models::SaveEdit;
use serde_json::{Map, Value};

pub fn apply_save_edits(current: &mut Value, edits: &[SaveEdit]) {
    apply_save_edits_at(current, edits, &[]);
}

pub fn apply_save_edits_at(current: &mut Value, edits: &[SaveEdit], prefix: &[String]) {
    for edit in edits {
        let (path, value) = match edit {
            SaveEdit::Set { path, value } => (path, Some(value)),
            SaveEdit::Remove { path } => (path, None),
        };
        let Some(path) = path.strip_prefix(prefix) else {
            continue;
        };
        let Some((key, parents)) = path.split_last() else {
            *current = value.cloned().unwrap_or(Value::Null);
            continue;
        };
        let mut target = &mut *current;
        for parent in parents {
            if !target.is_object() {
                *target = Value::Object(Map::new());
            }
            target = target
                .as_object_mut()
                .expect("assignment parent is an object")
                .entry(parent)
                .or_insert_with(|| Value::Object(Map::new()));
        }
        if !target.is_object() {
            *target = Value::Object(Map::new());
        }
        let object = target
            .as_object_mut()
            .expect("field assignment targets an object");
        if let Some(value) = value {
            object.insert(key.clone(), value.clone());
        } else {
            object.remove(key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn queued_field_changes_apply_to_current_content_in_order() {
        let mut current = json!({"speed":80,"name":"before","unknown":42});
        apply_save_edits(
            &mut current,
            &[SaveEdit::Set {
                path: vec!["speed".into()],
                value: json!(100),
            }],
        );
        apply_save_edits(
            &mut current,
            &[SaveEdit::Set {
                path: vec!["name".into()],
                value: json!("after"),
            }],
        );
        assert_eq!(current, json!({"speed":100,"name":"after","unknown":42}));
        apply_save_edits(
            &mut current,
            &[SaveEdit::Set {
                path: vec!["speed".into()],
                value: json!(120),
            }],
        );
        assert_eq!(current["speed"], 120);
    }
}
