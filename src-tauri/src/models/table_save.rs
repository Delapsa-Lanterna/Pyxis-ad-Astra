use super::{CsvTableKey, JsonWriteOptions, ProjectSessionId};
use crate::models::WeaponSpecClass;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvRowPatch {
    #[serde(default)]
    pub insert_at: Option<usize>,
    pub row_key: String,
    pub action: CsvRowPatchAction,
    pub row: Map<String, Value>,
    pub is_comment: bool,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CsvRowPatchAction {
    Upsert,
    Delete,
}

pub type CsvRowOrderEntry = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssociatedSpecCreateParams {
    Ship {
        id: String,
        hull_name: String,
    },
    Weapon {
        id: String,
        spec_class: WeaponSpecClass,
    },
    System {
        id: String,
    },
    Skill {
        id: String,
    },
}

impl AssociatedSpecCreateParams {
    pub fn id(&self) -> &str {
        match self {
            Self::Ship { id, .. }
            | Self::Weapon { id, .. }
            | Self::System { id }
            | Self::Skill { id } => id,
        }
    }
    pub fn table(&self) -> super::CsvTableKey {
        match self {
            Self::Ship { .. } => super::CsvTableKey::Ships,
            Self::Weapon { .. } => super::CsvTableKey::Weapons,
            Self::System { .. } => super::CsvTableKey::ShipSystems,
            Self::Skill { .. } => super::CsvTableKey::Skills,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AssociatedSpecChange {
    Create {
        create: AssociatedSpecCreateParams,
    },
    Delete {
        id: String,
    },
    Rename {
        previous_id: String,
        create: AssociatedSpecCreateParams,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssociatedSpecWrite {
    pub change: AssociatedSpecChange,
    pub target: crate::models::EntityEditTarget,
}

impl AssociatedSpecChange {
    pub fn id(&self) -> &str {
        match self {
            Self::Create { create } | Self::Rename { create, .. } => create.id(),
            Self::Delete { id } => id,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CsvSave {
    #[serde(deserialize_with = "super::required_nullable")]
    pub row_order: Option<Vec<CsvRowOrderEntry>>,
    pub base_versions: Vec<crate::models::FileVersion>,
    pub session_id: ProjectSessionId,
    pub mod_root: String,
    pub table: CsvTableKey,
    pub patches: Vec<CsvRowPatch>,
    pub associated_specs: Vec<crate::models::AssociatedSpecWrite>,
    #[serde(default)]
    pub json_write: JsonWriteOptions,
}

super::project_identity::impl_session_mod_scope_required!(CsvSave);

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn csv_insert_position_accepts_missing_and_null_values() {
        let value = json!({"rowKey":"row","action":"upsert","row":{},"isComment":false});
        for value in [
            value.clone(),
            json!({"insertAt":null,"rowKey":"row","action":"upsert","row":{},"isComment":false}),
        ] {
            let patch: CsvRowPatch = serde_json::from_value(value).unwrap();
            assert!(patch.insert_at.is_none());
        }
        let patch: CsvRowPatch = serde_json::from_value(
            json!({"insertAt":0,"rowKey":"row","action":"upsert","row":{},"isComment":false}),
        )
        .unwrap();
        assert_eq!(patch.insert_at, Some(0));
    }

    #[test]
    fn associated_spec_wire_uses_action_and_format_owned_create_parameters() {
        let seeds = [
            json!({"kind":"ship","id":"ship","hullName":"Ship"}),
            json!({"kind":"weapon","id":"weapon","specClass":"beam"}),
            json!({"kind":"system","id":"system"}),
            json!({"kind":"skill","id":"skill"}),
        ];
        for create in seeds {
            for action in [
                json!({"action":"create","create":create}),
                json!({"action":"rename","previousId":"old","create":create}),
            ] {
                let decoded: AssociatedSpecChange = serde_json::from_value(action.clone()).unwrap();
                assert_eq!(serde_json::to_value(decoded).unwrap(), action);
            }
        }
        let delete = json!({"action":"delete","id":"entity"});
        let decoded: AssociatedSpecChange = serde_json::from_value(delete.clone()).unwrap();
        assert_eq!(serde_json::to_value(decoded).unwrap(), delete);
    }

    #[test]
    fn save_csv_patch_payload_requires_explicit_associated_specs() {
        let result = serde_json::from_value::<CsvSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "C:/mods/test",
            "table": "ships",
            "patches": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn save_csv_patch_payload_requires_mod_root() {
        let result = serde_json::from_value::<CsvSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "table": "ships",
            "patches": [],
            "associatedSpecs": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn save_csv_patch_payload_requires_explicit_patch_row() {
        let result = serde_json::from_value::<CsvSave>(json!({
            "baseVersions": [],
            "sessionId": "session-1",
            "modRoot": "C:/mods/test",
            "table": "ships",
            "patches": [{
                "rowKey": "ships:row:0",
                "isComment": false,
                "action": "delete"
            }],
            "associatedSpecs": []
        }));

        assert!(result.is_err());
    }

    #[test]
    fn csv_patch_wire_requires_and_preserves_the_parser_comment_flag() {
        let mut patch = json!({"rowKey":"ships:row:0", "action":"upsert", "row":{"name":"#quoted","id":"active"}, "insertAt":null});
        assert!(serde_json::from_value::<CsvRowPatch>(patch.clone()).is_err());
        patch["isComment"] = json!(false);
        let parsed = serde_json::from_value::<CsvRowPatch>(patch).unwrap();
        assert!(!parsed.is_comment);
        assert_eq!(parsed.row["name"], "#quoted");
        assert_eq!(serde_json::to_value(parsed).unwrap()["isComment"], false);
    }

    #[test]
    fn table_save_requests_keep_explicit_actions_and_default_json_options() {
        let payload: CsvSave = serde_json::from_value(json!({"rowOrder":null,"baseVersions":[],"sessionId":"session","modRoot":"M:/mod","table":"ships","patches":[],"associatedSpecs":[]})).unwrap();
        assert_eq!(payload.table, CsvTableKey::Ships);
        assert!(!payload.json_write.preserve_original_json);
        assert!(payload.json_write.confirmed_sources.is_empty());
    }
}
