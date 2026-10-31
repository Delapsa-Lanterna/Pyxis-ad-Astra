use serde::{Deserialize, Deserializer};

pub(super) fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub(super) fn deserialize_non_empty_string<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(normalize_non_empty_string)
}

fn normalize_non_empty_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Deserialize)]
    struct Fields {
        #[serde(deserialize_with = "deserialize_nullable")]
        required: Option<String>,
        #[serde(default, deserialize_with = "deserialize_non_empty_string")]
        optional: Option<String>,
        #[serde(deserialize_with = "deserialize_non_empty_string")]
        normalized: Option<String>,
    }

    #[test]
    fn field_attributes_control_presence_and_converters_keep_value_semantics() {
        for value in [
            json!({}),
            json!({"required":null}),
            json!({"normalized":null}),
        ] {
            assert!(serde_json::from_value::<Fields>(value).is_err());
        }
        for (value, expected) in [
            (json!(null), None),
            (json!("  "), None),
            (json!(" text "), Some("text")),
        ] {
            let fields: Fields =
                serde_json::from_value(json!({"required":"  ","normalized":value})).unwrap();
            assert_eq!(fields.required.as_deref(), Some("  "));
            assert!(fields.optional.is_none());
            assert_eq!(fields.normalized.as_deref(), expected);
            let fields: Fields =
                serde_json::from_value(json!({"required":null,"normalized":null,"optional":value}))
                    .unwrap();
            assert!(fields.required.is_none());
            assert_eq!(fields.optional.as_deref(), expected);
        }
        for field in ["required", "normalized", "optional"] {
            let mut value = json!({"required":null,"normalized":null});
            value[field] = json!(7);
            assert!(serde_json::from_value::<Fields>(value).is_err());
        }
    }
}
