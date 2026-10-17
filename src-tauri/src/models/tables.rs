use super::{CsvTableKey, ProjectSessionId, ResourceRef, required_nullable};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum CsvSearchField {
    IdName,
    Id,
    Name,
    Tags,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CsvTable {
    pub header: Vec<String>,
    pub rows: Vec<CsvRow>,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CsvRow {
    pub data: Map<String, Value>,
    pub is_comment: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableWindow {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub table: CsvTableKey,
    pub header: Vec<String>,
    pub total_rows: usize,
    pub filtered_rows: usize,
    pub start: usize,
    pub rows: Vec<CsvWindowRow>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvWindowRow {
    pub row_key: String,
    pub source_row_index: usize,
    pub data: Map<String, Value>,
    pub is_comment: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPreview {
    pub resource_ref: Option<ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvTableWindowPayload {
    pub session_id: ProjectSessionId,
    pub table: CsvTableKey,
    pub start: usize,
    pub count: usize,
    #[serde(deserialize_with = "required_nullable")]
    pub search: Option<String>,
    pub search_field: CsvSearchField,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
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
    fn csv_table_window_payload_requires_explicit_nullable_filters() {
        let result = serde_json::from_value::<CsvTableWindowPayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "table": "ships",
            "start": 0,
            "count": 50,
            "search": null
        }));

        assert!(result.is_err());
    }

    #[test]
    fn csv_table_window_payload_uses_explicit_search_field() {
        for field in ["id-name", "id", "name", "tags"] {
            let payload = serde_json::from_value::<CsvTableWindowPayload>(json!({
                "sessionId": "session-1",
                "table": "ships",
                "start": 0,
                "count": 50,
                "search": null,
                "searchField": field
            }))
            .unwrap();
            assert_eq!(serde_json::to_value(payload.search_field).unwrap(), field);
        }
    }

    #[test]
    fn csv_table_window_payload_requires_search_even_when_it_is_null() {
        let mut value = json!({"sessionId": "table-session", "table": "ships", "start": 5, "count": 20, "searchField": "id-name"});
        assert!(serde_json::from_value::<CsvTableWindowPayload>(value.clone()).is_err());
        value["search"] = Value::Null;
        let payload = serde_json::from_value::<CsvTableWindowPayload>(value.clone()).unwrap();
        assert_eq!(serde_json::to_value(payload).unwrap(), value);
    }
}
