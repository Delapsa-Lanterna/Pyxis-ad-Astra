use serde::{Deserialize, Serialize};

pub type ProjectSessionId = String;

pub trait SessionModScope {
    fn session_id(&self) -> Option<&crate::models::ProjectSessionId>;
    fn mod_root(&self) -> &str;
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum CsvTableKey {
    Ships,
    Weapons,
    Wings,
    Hullmods,
    ShipSystems,
    Industries,
    Skills,
    Abilities,
    Commodities,
    SpecialItems,
    Submarkets,
    MarketConditions,
    SimOpponents,
    Descriptions,
}

impl CsvTableKey {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ships => "ships",
            Self::Weapons => "weapons",
            Self::Wings => "wings",
            Self::Hullmods => "hullmods",
            Self::ShipSystems => "shipSystems",
            Self::Industries => "industries",
            Self::Skills => "skills",
            Self::Abilities => "abilities",
            Self::Commodities => "commodities",
            Self::SpecialItems => "specialItems",
            Self::Submarkets => "submarkets",
            Self::MarketConditions => "marketConditions",
            Self::SimOpponents => "simOpponents",
            Self::Descriptions => "descriptions",
        }
    }

    pub fn from_key(value: &str) -> Option<Self> {
        match value {
            "ships" => Some(Self::Ships),
            "weapons" => Some(Self::Weapons),
            "wings" => Some(Self::Wings),
            "hullmods" => Some(Self::Hullmods),
            "shipSystems" => Some(Self::ShipSystems),
            "industries" => Some(Self::Industries),
            "skills" => Some(Self::Skills),
            "abilities" => Some(Self::Abilities),
            "commodities" => Some(Self::Commodities),
            "specialItems" => Some(Self::SpecialItems),
            "submarkets" => Some(Self::Submarkets),
            "marketConditions" => Some(Self::MarketConditions),
            "simOpponents" => Some(Self::SimOpponents),
            "descriptions" => Some(Self::Descriptions),
            _ => None,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum EntityKind {
    Ship,
    Weapon,
    Projectile,
    System,
    Skill,
    Faction,
    Mission,
    Variant,
    Skin,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ResourceSource {
    Mod,
    Core,
}

impl ResourceSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mod => "mod",
            Self::Core => "core",
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum ResourceOwnerKind {
    Ship,
    Weapon,
    Variant,
    Skin,
    Faction,
    Mission,
    Hullmods,
    ShipSystems,
    Industries,
    Skills,
    Abilities,
    Commodities,
    SpecialItems,
    Submarkets,
    MarketConditions,
}

impl From<EntityKind> for ResourceOwnerKind {
    fn from(kind: EntityKind) -> Self {
        match kind {
            EntityKind::Ship => Self::Ship,
            EntityKind::Weapon => Self::Weapon,
            EntityKind::Variant => Self::Variant,
            EntityKind::Skin => Self::Skin,
            EntityKind::Faction => Self::Faction,
            EntityKind::Mission => Self::Mission,
            EntityKind::Skill => Self::Skills,
            EntityKind::System => Self::ShipSystems,
            EntityKind::Projectile => Self::Weapon,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceRef {
    pub source: ResourceSource,
    pub rel_path: String,
    pub owner_kind: ResourceOwnerKind,
    pub owner_id: String,
    pub key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileVersion {
    pub path: String,
    pub fingerprint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntityFileLocation {
    pub source: ResourceSource,
    pub root: String,
    pub rel_path: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum EntityLinkedRecord {
    Csv { table: CsvTableKey, row_key: String },
    Index { path: String, row_index: usize },
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum EntityTargetState {
    Existing,
    Create,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EntityEditTarget {
    pub kind: EntityKind,
    pub id: String,
    #[serde(deserialize_with = "super::required_nullable")]
    pub source: Option<EntityFileLocation>,
    pub write: EntityFileLocation,
    pub state: EntityTargetState,
    #[serde(deserialize_with = "super::required_nullable")]
    pub linked_record: Option<EntityLinkedRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityEditInfo {
    pub target: EntityEditTarget,
    pub base_versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentityIntent {
    pub source: EntityEditTarget,
    pub next_id: String,
    pub next_write: EntityFileLocation,
    pub destination_version: FileVersion,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentityChange {
    pub before: EntityEditTarget,
    pub after: EntityEditTarget,
}

/// Payloads carrying a project-session scope: `session_id` and `mod_root` are
/// validated together so a command can never pair one session with another
/// mod's root. `session_id` is `None` for recovery-mode payloads that
/// legitimately operate without a session.
macro_rules! impl_session_mod_scope_required {
    ($($ty:ty),* $(,)?) => {$(
        impl $crate::models::SessionModScope for $ty {
            fn session_id(&self) -> Option<&$crate::models::ProjectSessionId> {
                Some(&self.session_id)
            }
            fn mod_root(&self) -> &str {
                &self.mod_root
            }
        }
    )*};
}

macro_rules! impl_session_mod_scope_optional {
    ($($ty:ty),* $(,)?) => {$(
        impl $crate::models::SessionModScope for $ty {
            fn session_id(&self) -> Option<&$crate::models::ProjectSessionId> {
                self.session_id.as_ref()
            }
            fn mod_root(&self) -> &str {
                &self.mod_root
            }
        }
    )*};
}

pub(crate) use impl_session_mod_scope_optional;
pub(crate) use impl_session_mod_scope_required;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntityIdentityIntentPayload {
    pub session_id: ProjectSessionId,
    pub source: crate::models::EntityEditTarget,
    pub next_id: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn file_versions_keep_optional_input_and_explicit_null_output() {
        for value in [
            json!({"path":"M:/mod/new.ship"}),
            json!({"path":"M:/mod/new.ship","fingerprint":null}),
        ] {
            let version: FileVersion = serde_json::from_value(value).unwrap();
            assert_eq!(
                serde_json::to_value(version).unwrap(),
                json!({"path":"M:/mod/new.ship","fingerprint":null})
            );
        }
    }
}
