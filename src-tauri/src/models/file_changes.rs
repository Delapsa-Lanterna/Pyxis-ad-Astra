use super::serde_fields::deserialize_nullable;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeRecord {
    pub kind: FileChangeKind,
    pub before_path: String,
    pub after_path: String,
    pub before_exists: bool,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub before_text: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub before_data_base64: Option<String>,
    pub before_files: Vec<FileSnapshot>,
    pub after_exists: bool,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub after_text: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub after_data_base64: Option<String>,
    pub after_files: Vec<FileSnapshot>,
}

impl FileChangeRecord {
    pub fn reversed(&self) -> Self {
        Self {
            kind: self.kind,
            before_path: self.after_path.clone(),
            after_path: self.before_path.clone(),
            before_exists: self.after_exists,
            after_exists: self.before_exists,
            before_text: self.after_text.clone(),
            after_text: self.before_text.clone(),
            before_data_base64: self.after_data_base64.clone(),
            after_data_base64: self.before_data_base64.clone(),
            before_files: self.after_files.clone(),
            after_files: self.before_files.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FileChangeKind {
    File,
    Directory,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileSnapshot {
    pub rel_path: String,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub text: Option<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub data_base64: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FileChangeReplayDirection {
    Undo,
    Redo,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn file_change_record_requires_explicit_nullable_and_collection_fields() {
        let result = serde_json::from_value::<FileChangeRecord>(json!({
            "kind": "file",
            "path": "D:/mods/demo/data/config/demo.json",
            "beforeExists": false,
            "beforeText": null,
            "afterExists": true,
            "afterText": "{}",
            "afterDataBase64": null,
            "afterFiles": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn file_snapshot_requires_explicit_nullable_content_fields() {
        let result = serde_json::from_value::<FileSnapshot>(json!({
            "relPath": "data/config/demo.json",
            "text": "{}"
        }));

        assert!(result.is_err());
    }
}
