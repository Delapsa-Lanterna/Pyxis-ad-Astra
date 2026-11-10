use super::serde_fields::deserialize_nullable;
use super::{
    CsvTableKey, EntityFileLocation, EntityKind, FileVersion, ProjectSessionId, ResourceRef,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvValidationEntity {
    pub kind: EntityKind,
    pub id: String,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvValidationPayload {
    pub session_id: ProjectSessionId,
    pub entities: Vec<CsvValidationEntity>,
    pub sources: Vec<String>,
    pub files: Vec<String>,
    pub classes: Vec<String>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvValidationContext {
    pub complete: bool,
    pub entities: BTreeMap<String, Value>,
    pub sources: BTreeMap<String, Vec<String>>,
    pub files: BTreeMap<String, bool>,
    pub classes: BTreeMap<String, bool>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CsvSearchField {
    IdName,
    Id,
    Name,
    Tags,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CsvTable {
    pub header: Vec<String>,
    pub rows: Vec<CsvRow>,
    pub path: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvRow {
    pub data: Map<String, Value>,
    pub is_comment: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowRecord {
    pub row_key: String,
    pub data: Map<String, Value>,
    pub is_comment: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableIndex {
    pub validation_rows: Vec<CsvRowRecord>,
    pub base_versions: Vec<FileVersion>,
    pub table: CsvTableKey,
    pub header: Vec<String>,
    pub total_rows: usize,
    pub row_keys: Vec<String>,
    pub rows: Vec<CsvRowRecord>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableRowsRead {
    pub base_versions: Vec<FileVersion>,
    pub table: CsvTableKey,
    pub rows: Vec<CsvRowRecord>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableIndexPayload {
    pub source: Option<EntityFileLocation>,
    pub session_id: ProjectSessionId,
    pub table: CsvTableKey,
    pub initial_count: usize,
    pub validation_columns: Vec<String>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub search: Option<String>,
    pub search_field: CsvSearchField,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableRowsPayload {
    pub session_id: ProjectSessionId,
    pub table: CsvTableKey,
    pub row_keys: Vec<String>,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowResourcesPayload {
    pub session_id: ProjectSessionId,
    pub table: CsvTableKey,
    pub row_keys: Vec<String>,
    pub drafts: Vec<CsvRowRecord>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPreview {
    pub resource_ref: Option<ResourceRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPreviewPayload {
    pub session_id: ProjectSessionId,
    pub table: CsvTableKey,
    pub row_key: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn csv_table_index_payload_requires_explicit_nullable_filters() {
        let result = serde_json::from_value::<CsvTableIndexPayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "table": "ships",
            "initialCount": 50,
            "search": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn csv_table_index_payload_uses_explicit_search_field() {
        for field in ["id-name", "id", "name", "tags"] {
            let payload = serde_json::from_value::<CsvTableIndexPayload>(json!({
                "sessionId": "session-1",
                "table": "ships",
                "initialCount": 50,
                "validationColumns": ["id"],
                "search": null,
                "searchField": field
            }))
            .unwrap();
            assert_eq!(serde_json::to_value(payload.search_field).unwrap(), field);
        }
    }

    #[test]
    fn csv_table_index_payload_requires_search_even_when_it_is_null() {
        let mut value = json!({"sessionId": "table-session", "table": "ships", "initialCount": 20, "validationColumns": ["id"], "searchField": "id-name"});
        assert!(serde_json::from_value::<CsvTableIndexPayload>(value.clone()).is_err());
        value["search"] = Value::Null;
        value["source"] = Value::Null;
        let payload = serde_json::from_value::<CsvTableIndexPayload>(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(payload).unwrap(), value);
    }
}
