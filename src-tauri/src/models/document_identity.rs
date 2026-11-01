use super::project_identity::{EntityEditTarget, EntityKind};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MiscConfigKind {
    Strings,
    EngineStyles,
    HullStyles,
    Sounds,
    Settings,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JsonDocumentOrigin {
    ModInfo,
    MiscConfig { file: MiscConfigKind },
    Entity { target: JsonSourceIdentity },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JsonSourceIdentity {
    pub kind: EntityKind,
    pub id: String,
    pub rel_path: Option<String>,
}

impl From<&EntityEditTarget> for JsonDocumentOrigin {
    fn from(target: &EntityEditTarget) -> Self {
        Self::Entity {
            target: JsonSourceIdentity {
                kind: target.kind,
                id: target.id.clone(),
                rel_path: Some(target.write.rel_path.clone()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use serde_json::Value;
    use serde_json::json;

    #[test]
    fn json_origins_keep_kinds_nullable_paths_and_target_conversion() {
        let mut values = vec![json!({"kind":"modInfo"})];
        for file in [
            "strings",
            "engineStyles",
            "hullStyles",
            "sounds",
            "settings",
        ] {
            values.push(json!({"kind":"miscConfig","file":file}));
        }
        for path in [Value::Null, json!("data/variants/item.variant")] {
            values.push(
                json!({"kind":"entity","target":{"kind":"variant","id":"item","relPath":path}}),
            );
        }
        for value in values {
            let origin: JsonDocumentOrigin = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(serde_json::to_value(origin).unwrap(), value);
        }
        let target: EntityEditTarget = serde_json::from_value(json!({"kind":"skin","id":"item","source":null,"write":{"source":"mod","root":"M:/fixture","relPath":"data/hulls/skins/item.skin","path":"M:/fixture/data/hulls/skins/item.skin"},"state":"create","linkedRecord":null})).unwrap();
        assert_eq!(
            serde_json::to_value(JsonDocumentOrigin::from(&target)).unwrap(),
            json!({"kind":"entity","target":{"kind":"skin","id":"item","relPath":"data/hulls/skins/item.skin"}})
        );
    }
}
