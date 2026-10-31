use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWriteOptions {
    #[serde(default)]
    pub preserve_original_json: bool,
    #[serde(default)]
    pub confirmed_sources: Vec<JsonSourceConfirmation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceConfirmation {
    pub path: String,
    pub source_fingerprint: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn json_write_options_keep_missing_field_defaults() {
        for value in [
            json!({}),
            json!({"preserveOriginalJson":false}),
            json!({"confirmedSources":[]}),
        ] {
            let options: JsonWriteOptions = serde_json::from_value(value).unwrap();
            assert!(!options.preserve_original_json);
            assert!(options.confirmed_sources.is_empty());
        }
        let options: JsonWriteOptions =
            serde_json::from_value(json!({"preserveOriginalJson":true})).unwrap();
        assert!(options.preserve_original_json);
        assert!(options.confirmed_sources.is_empty());
    }
}
