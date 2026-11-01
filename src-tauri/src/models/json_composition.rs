use crate::models::{EntityFileLocation, FileVersion};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

pub fn file_content_id(data: &Value, field: &str, path: &Path) -> String {
    data.get(field)
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| {
            path.file_stem()
                .expect("JSON file name")
                .to_string_lossy()
                .into()
        })
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonComposition {
    pub layers: Vec<JsonSourceLayer>,
    pub excluded: Vec<String>,
    pub replace: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceLayer {
    pub source: EntityFileLocation,
    pub version: FileVersion,
    pub data: Value,
    pub replace: bool,
}
