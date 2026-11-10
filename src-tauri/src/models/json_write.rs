use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonWriteOptions {
    #[serde(default)]
    pub keep_filename: bool,
    #[serde(default)]
    pub preserve_structure: bool,
    /// Mod-relative JSON paths that this write adds to the `mod_info.json` replace list.
    #[serde(default)]
    pub replace_paths: Vec<String>,
}

impl JsonWriteOptions {
    /// Whether this write turns `relative` into a whole-file replacement of its base layers.
    pub fn replaces(&self, relative: &str) -> bool {
        let relative = relative.replace('\\', "/");
        self.replace_paths
            .iter()
            .any(|path| path.replace('\\', "/") == relative)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn json_write_options_keep_missing_field_defaults() {
        for value in [json!({}), json!({"preserveStructure":false})] {
            let options: JsonWriteOptions = serde_json::from_value(value).unwrap();
            assert!(!options.preserve_structure);
        }
        let options: JsonWriteOptions =
            serde_json::from_value(json!({"preserveStructure":true})).unwrap();
        assert!(options.preserve_structure);
    }
}
