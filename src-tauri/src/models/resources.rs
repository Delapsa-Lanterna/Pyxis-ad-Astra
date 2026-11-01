use super::{ProjectSessionId, ResourceOwnerKind, ResourceRef, ResourceSource};
use crate::errors::ErrorDiagnostic;
use crate::models::{
    DraftResourceEntityKind as ModelsDraftResourceEntityKind, FileVersion, ReferenceSource,
    project_identity,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EngineRenderAssets {
    pub styles: BTreeMap<String, Value>,
    pub versions: Vec<FileVersion>,
    pub resources: BTreeMap<String, ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDataUrlBatchEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<ReferenceSource>,
    pub key: String,
    pub source: ResourceSource,
    pub rel_path: String,
    pub owner_kind: ResourceOwnerKind,
    pub owner_id: String,
    pub data_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ErrorDiagnostic>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDataUrlBatchResult {
    pub entries: Vec<ResourceDataUrlBatchEntry>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferenceOption {
    pub label: String,
    pub value: String,
    pub origin: ResourceSource,
    pub kind: HullReferenceKind,
    pub resource_ref: Option<ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum HullReferenceKind {
    Ship,
    Skin,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferenceGroup {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reference: Option<ReferenceSource>,
    pub origin: ResourceSource,
    pub kind: HullReferenceKind,
    pub options: Vec<HullReferenceOption>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferencesResult {
    pub groups: Vec<HullReferenceGroup>,
    pub hull_names: BTreeMap<String, String>,
    pub sprites: BTreeMap<String, ResourceRef>,
    pub built_in_weapon_slots: BTreeMap<String, Vec<HullWeaponSlot>>,
    pub weapon_slots: BTreeMap<String, Vec<HullWeaponSlot>>,
    pub module_slots: BTreeMap<String, Vec<HullWeaponSlot>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HullWeaponSlot {
    pub id: String,
    pub origin: ResourceSource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub r#type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mount: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DraftResourcesPayload {
    pub kind: ModelsDraftResourceEntityKind,
    pub session_id: ProjectSessionId,
    pub id: String,
    pub draft: Value,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceDataUrlBatchPayload {
    pub session_id: ProjectSessionId,
    pub resources: Vec<ResourceRef>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolveModRelativePathPayload {
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub absolute_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HullReferencesPayload {
    pub session_id: ProjectSessionId,
    pub reference_ids: Vec<String>,
}

project_identity::impl_session_mod_scope_required!(ResolveModRelativePathPayload);

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum DraftResourceEntityKind {
    Ship,
    Weapon,
    Projectile,
    System,
    Faction,
    Mission,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn hull_references_payload_uses_reference_ids() {
        let payload = serde_json::from_value::<HullReferencesPayload>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "referenceIds": ["ship_or_skin"]
        }))
        .unwrap();

        assert_eq!(payload.reference_ids, vec!["ship_or_skin".to_string()]);
    }

    #[test]
    fn resolve_mod_relative_path_payload_requires_session_id() {
        let result = serde_json::from_value::<ResolveModRelativePathPayload>(json!({
            "modRoot": "D:/mods/demo",
            "absolutePath": "D:/mods/demo/graphics/ships/demo.png"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn draft_resource_payload_preserves_all_kinds_and_current_content() {
        for kind in [
            "ship",
            "weapon",
            "projectile",
            "system",
            "faction",
            "mission",
        ] {
            let value = json!({"sessionId": "resource-session", "kind": kind, "id": "demo", "draft": {"sprite": "graphics/current.png", "unknown": [1, null]}});
            let payload = serde_json::from_value::<DraftResourcesPayload>(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(payload).unwrap(), value);
        }
    }
}
