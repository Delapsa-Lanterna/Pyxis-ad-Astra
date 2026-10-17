use super::{JsonWriteOptions, ProjectSessionId};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum SpecEditorKind {
    Ship,
    Weapon,
    Projectile,
    System,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WeaponSpecClass {
    Projectile,
    Beam,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadImportedEditorSpecPayload {
    pub kind: SpecEditorKind,
    pub path: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorSpecPayload {
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub target: crate::models::EntityEditTarget,
    pub data: Value,
    #[serde(default)]
    pub json_write: JsonWriteOptions,
    #[serde(default)]
    pub ordered_json: Option<String>,
}

super::project_identity::impl_session_mod_scope_required!(SaveEditorSpecPayload);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn load_imported_editor_spec_payload_requires_kind() {
        let result = serde_json::from_value::<LoadImportedEditorSpecPayload>(json!({
            "path": "D:/mods/demo/data/weapons/demo.wpn"
        }));

        assert!(result.is_err());
    }

    #[test]
    fn spec_save_requests_keep_loaded_target_and_default_json_options() {
        let value = json!({"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","target":{"kind":"ship","id":"demo","source":null,"write":{"source":"mod","root":"M:/mod","relPath":"data/hulls/demo.ship","path":"M:/mod/data/hulls/demo.ship"},"state":"create","linkedRecord":null},"data":{"hullId":"demo"}});
        let payload: SaveEditorSpecPayload = serde_json::from_value(value).unwrap();
        assert_eq!(payload.target.kind, crate::models::EntityKind::Ship);
        assert_eq!(payload.target.id, "demo");
        assert!(!payload.json_write.preserve_original_json);
        assert!(payload.ordered_json.is_none());
    }
}
