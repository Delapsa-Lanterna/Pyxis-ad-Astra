use super::{ProjectSessionId, ResourceRef, ResourceSource};
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceOptionGroup {
    pub origin: ResourceSource,
    pub options: Vec<SourceOption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SourceOption {
    pub label: String,
    pub value: String,
    pub description: Option<String>,
    pub resource_ref: Option<ResourceRef>,
    pub origin: ResourceSource,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_value: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub template_max: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CsvSourceOptionsPayload {
    pub session_id: ProjectSessionId,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ImageSourceOptionsPayload {
    pub session_id: ProjectSessionId,
    pub directories: Vec<String>,
    #[serde(deserialize_with = "super::required_nullable_non_empty_string")]
    pub mission_id: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn csv_source_options_payload_requires_session_and_source() {
        let payload = serde_json::from_value::<CsvSourceOptionsPayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "source": "csv:ships.id"
        }))
        .unwrap();

        assert_eq!(payload.session_id, "session-1");
        assert_eq!(payload.source, "csv:ships.id");
        assert!(
            serde_json::from_value::<CsvSourceOptionsPayload>(json!({
                "sessionId": "session-1"
            }))
            .is_err()
        );
    }
}
