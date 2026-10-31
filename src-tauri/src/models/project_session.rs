use super::collections::push_unique_all;
use super::serde_fields::deserialize_non_empty_string;
use super::{
    CsvTableKey, EntityKind, FileChangeRecord, GameScanWarning, ProjectSessionId, ResourceSource,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectManifest {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub starsector_root: Option<String>,
    pub core_available: bool,
    pub associated_spec_tables: Vec<CsvTableKey>,
    pub mod_info: Option<Value>,
    pub table_summaries: BTreeMap<CsvTableKey, TableSummary>,
    pub table_entity_summaries: BTreeMap<CsvTableKey, usize>,
    pub entity_summaries: EntitySummaries,
    pub warnings: Vec<GameScanWarning>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInvalidation {
    pub paths: Vec<String>,
    pub tables: Vec<CsvTableKey>,
    pub entities: Vec<InvalidatedEntityRef>,
    pub resources: Vec<InvalidatedResourceScope>,
    pub query_scopes: Vec<InvalidatedQueryScope>,
    pub session: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSessionInvalidationResult {
    pub manifest: ProjectManifest,
    pub invalidation: ProjectInvalidation,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedEntityRef {
    pub kind: EntityKind,
    pub id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedResourceScope {
    pub source: ResourceSource,
    pub rel_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct InvalidatedQueryScope {
    pub kind: InvalidatedQueryKind,
    pub table: Option<CsvTableKey>,
    pub source: Option<String>,
    pub entity: Option<InvalidatedEntityRef>,
    pub resource: Option<InvalidatedResourceScope>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum InvalidatedQueryKind {
    CsvTableWindow,
    CsvSourceOptions,
    CsvRowPreview,
    HullReferences,
    EntityDetail,
    EntityList,
    ResourceDataUrls,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TableSummary {
    pub path: String,
    pub header: Vec<String>,
    pub available: bool,
    pub total_rows: Option<usize>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EntitySummaries {
    pub factions: usize,
    pub missions: usize,
    pub ships: usize,
    pub weapons: usize,
    pub projectiles: usize,
    pub variants: usize,
    pub skins: usize,
    pub systems: usize,
    pub skills: usize,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenProjectSessionPayload {
    pub mod_root: String,
    #[serde(deserialize_with = "deserialize_non_empty_string")]
    pub starsector_root: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseProjectSessionPayload {
    pub session_id: ProjectSessionId,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateProjectSessionPayload {
    pub session_id: ProjectSessionId,
    pub changes: Vec<FileChangeRecord>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceRefresh {
    pub session_id: String,
    pub sources: Vec<crate::models::InvalidatedResourceScope>,
}

impl ProjectInvalidation {
    pub fn merge(&mut self, other: Self) {
        push_unique_all(&mut self.paths, other.paths);
        push_unique_all(&mut self.tables, other.tables);
        push_unique_all(&mut self.entities, other.entities);
        push_unique_all(&mut self.resources, other.resources);
        push_unique_all(&mut self.query_scopes, other.query_scopes);
        self.session |= other.session;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn open_project_session_payload_requires_explicit_nullable_root() {
        let result = serde_json::from_value::<OpenProjectSessionPayload>(json!({
            "modRoot": "D:/mods/demo"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn open_project_session_payload_treats_blank_root_as_missing() {
        let payload = serde_json::from_value::<OpenProjectSessionPayload>(json!({
            "modRoot": "D:/mods/demo",
            "starsectorRoot": "  "
        }))
        .unwrap();

        assert_eq!(payload.starsector_root, None);
    }

    #[test]
    fn invalidate_project_session_payload_requires_changeset_records() {
        let result = serde_json::from_value::<InvalidateProjectSessionPayload>(json!({
            "sessionId": "session-1"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn refresh_sources_payload_preserves_mod_and_core_paths() {
        let value = json!({"sessionId": "refresh-session", "sources": [{"source": "mod", "relPath": "data/hulls/demo.ship"}, {"source": "core", "relPath": "graphics/demo.png"}]});
        let payload = serde_json::from_value::<SourceRefresh>(value).unwrap();
        assert_eq!(payload.session_id, "refresh-session");
        assert_eq!(
            serde_json::to_value(payload.sources).unwrap(),
            json!([{"source": "mod", "relPath": "data/hulls/demo.ship"}, {"source": "core", "relPath": "graphics/demo.png"}])
        );
    }
}
