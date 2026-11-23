use super::serde_fields::deserialize_nullable;
use serde::{Deserialize, Serialize, Serializer};

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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommittedSnapshot<'a> {
    rel_path: &'a str,
    text: Option<&'a str>,
    binary: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CommittedFileChange<'a> {
    kind: FileChangeKind,
    before_path: &'a str,
    after_path: &'a str,
    before_exists: bool,
    after_exists: bool,
    before_binary: bool,
    after_binary: bool,
    after_text: Option<&'a str>,
    before_files: Vec<&'a str>,
    after_files: Vec<CommittedSnapshot<'a>>,
}

pub(super) fn serialize_committed_changes<S: Serializer>(
    changes: &[FileChangeRecord],
    serializer: S,
) -> Result<S::Ok, S::Error> {
    serializer.collect_seq(changes.iter().map(|change| {
        CommittedFileChange {
            kind: change.kind,
            before_path: &change.before_path,
            after_path: &change.after_path,
            before_exists: change.before_exists,
            after_exists: change.after_exists,
            before_binary: change.before_data_base64.is_some(),
            after_binary: change.after_data_base64.is_some(),
            after_text: change.after_text.as_deref(),
            before_files: change
                .before_files
                .iter()
                .filter(|file| !file.is_directory())
                .map(|file| file.rel_path.as_str())
                .collect(),
            after_files: change
                .after_files
                .iter()
                .filter(|file| !file.is_directory())
                .map(|file| CommittedSnapshot {
                    rel_path: &file.rel_path,
                    text: file.text.as_deref(),
                    binary: file.data_base64.is_some(),
                })
                .collect(),
        }
    }))
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

impl FileSnapshot {
    pub fn is_directory(&self) -> bool {
        self.text.is_none() && self.data_base64.is_none()
    }
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
