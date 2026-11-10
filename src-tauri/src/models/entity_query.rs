use super::{
    EntityEditTarget, EntityKind, FileVersion, JsonComposition, ProjectSessionId, ResourceRef,
};
use crate::models::file_content::JsonFileContent;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityData {
    pub composition: Option<JsonComposition>,
    pub target: EntityEditTarget,
    pub base_versions: Vec<FileVersion>,
    pub kind: EntityKind,
    pub id: String,
    pub data: Value,
    pub document: Option<JsonFileContent>,
    pub resource_refs: BTreeMap<String, ResourceRef>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEntityPayload {
    pub session_id: ProjectSessionId,
    pub kind: EntityKind,
    pub id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryEntityListPayload {
    pub session_id: ProjectSessionId,
    pub kind: EntityKind,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::models::{EntityEditTarget, EntityFileLocation, EntityTargetState, ResourceSource};
    use serde_json::{Map, json};

    #[test]
    fn entity_data_serializes_empty_resource_refs_explicitly() {
        let entity = EntityData {
            document: None,
            composition: None,
            target: EntityEditTarget {
                kind: EntityKind::Projectile,
                id: "demo_projectile".to_string(),
                source: None,
                write: EntityFileLocation {
                    reference: None,
                    source: ResourceSource::Mod,
                    root: "mod".to_string(),
                    rel_path: "data/weapons/proj/demo_projectile.proj".to_string(),
                    path: "mod/data/weapons/proj/demo_projectile.proj".to_string(),
                },
                state: EntityTargetState::Create,
                linked_record: None,
            },
            base_versions: Vec::new(),
            kind: EntityKind::Projectile,
            id: "demo_projectile".to_string(),
            data: Value::Object(Map::new()),
            resource_refs: BTreeMap::new(),
        };

        let target = serde_json::to_value(&entity.target).unwrap();
        let value = serde_json::to_value(entity).unwrap();

        assert_eq!(
            value,
            json!({
                "target": target,
                "kind": "projectile",
                "id": "demo_projectile",
                "data": {},
            "resourceRefs": {}, "baseVersions": [], "document":null, "composition":null
            })
        );
    }
}
