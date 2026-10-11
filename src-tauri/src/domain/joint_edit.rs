use crate::models::{JointEditConflict, JointValue};
use serde_json::{Map, Value};
use std::collections::BTreeSet;

pub fn merge_joint_value(
    record_key: &str,
    path: &[String],
    base: &JointValue,
    disk: &JointValue,
    draft: &JointValue,
    conflicts: &mut Vec<JointEditConflict>,
) -> JointValue {
    if draft == base || disk == draft {
        return disk.clone();
    }
    if disk == base {
        return draft.clone();
    }
    if let (
        JointValue::Present(Value::Object(base)),
        JointValue::Present(Value::Object(disk)),
        JointValue::Present(Value::Object(draft)),
    ) = (base, disk, draft)
    {
        let keys = base
            .keys()
            .chain(disk.keys())
            .chain(draft.keys())
            .collect::<BTreeSet<_>>();
        let mut merged = Map::new();
        for key in keys {
            let mut nested = path.to_vec();
            nested.push(key.clone());
            let slot = |object: &Map<String, Value>| {
                object
                    .get(key)
                    .cloned()
                    .map(JointValue::Present)
                    .unwrap_or(JointValue::Missing)
            };
            if let JointValue::Present(value) = merge_joint_value(
                record_key,
                &nested,
                &slot(base),
                &slot(disk),
                &slot(draft),
                conflicts,
            ) {
                merged.insert(key.clone(), value);
            }
        }
        return JointValue::Present(Value::Object(merged));
    }
    conflicts.push(JointEditConflict {
        record_key: record_key.to_string(),
        path: path.to_vec(),
        baseline: base.clone(),
        disk: disk.clone(),
        draft: draft.clone(),
    });
    disk.clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn present(value: Value) -> JointValue {
        JointValue::Present(value)
    }

    #[test]
    fn merges_independent_fields_and_preserves_prototype_named_business_keys() {
        let mut conflicts = Vec::new();
        let result = merge_joint_value(
            "record",
            &[],
            &present(json!({"nested":{"a":1,"b":2},"__proto__":"base"})),
            &present(json!({"nested":{"a":3,"b":2},"__proto__":"disk"})),
            &present(json!({"nested":{"a":1,"b":4},"__proto__":"base"})),
            &mut conflicts,
        );
        assert_eq!(
            result,
            present(json!({"nested":{"a":3,"b":4},"__proto__":"disk"}))
        );
        assert!(conflicts.is_empty());
    }

    #[test]
    fn conflicts_distinguish_absence_null_arrays_and_raw_text() {
        let mut conflicts = Vec::new();
        merge_joint_value(
            "record",
            &[],
            &present(json!({"remove":1,"array":[1],"text":"before"})),
            &present(json!({"remove":null,"array":[2],"text":"disk"})),
            &present(json!({"array":[3],"text":"{unfinished"})),
            &mut conflicts,
        );
        assert_eq!(conflicts.len(), 3);
        assert_eq!(conflicts[0].path, vec!["array"]);
        assert_eq!(conflicts[1].disk, present(Value::Null));
        assert_eq!(conflicts[1].draft, JointValue::Missing);
        assert_eq!(conflicts[2].path, vec!["text"]);
    }

    #[test]
    fn identical_edits_and_unilateral_deletions_are_not_conflicts() {
        let mut conflicts = Vec::new();
        assert_eq!(
            merge_joint_value(
                "record",
                &[],
                &present(json!({"a":1})),
                &present(json!({"a":2})),
                &present(json!({"a":2})),
                &mut conflicts
            ),
            present(json!({"a":2}))
        );
        assert_eq!(
            merge_joint_value(
                "record",
                &[],
                &present(Value::Null),
                &present(Value::Null),
                &JointValue::Missing,
                &mut conflicts
            ),
            JointValue::Missing
        );
        assert!(conflicts.is_empty());
    }
}
