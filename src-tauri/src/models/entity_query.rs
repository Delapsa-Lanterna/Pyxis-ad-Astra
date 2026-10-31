use super::{EntityKind, ProjectSessionId, ResourceRef};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EntityData {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub composition: Option<super::JsonComposition>,
    pub target: crate::models::EntityEditTarget,
    pub base_versions: Vec<crate::models::FileVersion>,
    pub kind: EntityKind,
    pub id: String,
    pub data: Value,
    pub resource_refs: BTreeMap<String, ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryEntityPayload {
    pub session_id: ProjectSessionId,
    pub kind: EntityKind,
    pub id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QueryEntityListPayload {
    pub session_id: ProjectSessionId,
    pub kind: EntityKind,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, json};

    #[test]
    fn entity_data_serializes_empty_resource_refs_explicitly() {
        let entity = EntityData {
            composition: None,
            target: crate::models::EntityEditTarget {
                kind: EntityKind::Projectile,
                id: "demo_projectile".to_string(),
                source: None,
                write: crate::models::EntityFileLocation {
                    reference: None,
                    source: crate::models::ResourceSource::Mod,
                    root: "mod".to_string(),
                    rel_path: "data/weapons/proj/demo_projectile.proj".to_string(),
                    path: "mod/data/weapons/proj/demo_projectile.proj".to_string(),
                },
                state: crate::models::EntityTargetState::Create,
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
                "resourceRefs": {}, "baseVersions": []
            })
        );
    }
}
