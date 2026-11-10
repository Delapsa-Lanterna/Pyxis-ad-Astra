use super::sources::{SourceScope, core::CoreSourceRequirements, documents::LoadedSpecRecord};
use crate::models::file_content::{CsvSource, JsonSource};
use crate::models::{
    CsvTableKey, EntityEditTarget, EntityKind, EntitySummaries, FileVersion, GameScanWarning,
    ProjectManifest, ReferenceSource, SkinFile, VariantFile,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex};
use std::time::SystemTime;

pub(super) const MISSION_LIST_TABLE_KEY: &str = "missions";
pub(super) const MISSION_LIST_REL_PATH: &str = "data/missions/mission_list.csv";
pub(super) fn mission_list_default_header() -> Vec<String> {
    vec!["mission".into()]
}
pub(super) const WEAPON_SPRITE_FIELDS: [&str; 8] = [
    "turretSprite",
    "hardpointSprite",
    "turretUnderSprite",
    "hardpointUnderSprite",
    "turretGunSprite",
    "hardpointGunSprite",
    "turretGlowSprite",
    "hardpointGlowSprite",
];
pub(super) struct EntityListEntry {
    pub kind: EntityKind,
    pub id: String,
    pub data: Value,
}

#[derive(Clone, Copy)]
pub(super) struct CsvTableSpec {
    pub key: CsvTableKey,
    pub rel_path: &'static str,
    pub entity_id_field: &'static str,
    pub entity_summary: Option<fn(&EntitySummaries) -> usize>,
    pub core_source_requirements: CoreSourceRequirements,
}
const fn table(
    key: CsvTableKey,
    rel_path: &'static str,
    entity_id_field: &'static str,
    entity_summary: Option<fn(&EntitySummaries) -> usize>,
    requirements: (bool, bool, bool),
) -> CsvTableSpec {
    CsvTableSpec {
        key,
        rel_path,
        entity_id_field,
        entity_summary,
        core_source_requirements: CoreSourceRequirements {
            ships: requirements.0,
            weapons: requirements.1,
            variants: requirements.2,
        },
    }
}
const CSV_TABLES: [CsvTableSpec; 14] = [
    table(
        CsvTableKey::Ships,
        "data/hulls/ship_data.csv",
        "id",
        Some(|v| v.ships),
        (true, false, false),
    ),
    table(
        CsvTableKey::Weapons,
        "data/weapons/weapon_data.csv",
        "id",
        Some(|v| v.weapons),
        (false, true, false),
    ),
    table(
        CsvTableKey::Wings,
        "data/hulls/wing_data.csv",
        "id",
        None,
        (true, false, true),
    ),
    table(
        CsvTableKey::Hullmods,
        "data/hullmods/hull_mods.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::ShipSystems,
        "data/shipsystems/ship_systems.csv",
        "id",
        Some(|v| v.systems),
        (false, false, false),
    ),
    table(
        CsvTableKey::Industries,
        "data/campaign/industries.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::Skills,
        "data/characters/skills/skill_data.csv",
        "id",
        Some(|v| v.skills),
        (false, false, false),
    ),
    table(
        CsvTableKey::Abilities,
        "data/campaign/abilities.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::Commodities,
        "data/campaign/commodities.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::SpecialItems,
        "data/campaign/special_items.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::Submarkets,
        "data/campaign/submarkets.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::MarketConditions,
        "data/campaign/market_conditions.csv",
        "id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::SimOpponents,
        "data/campaign/sim_opponents.csv",
        "variant id",
        None,
        (false, false, false),
    ),
    table(
        CsvTableKey::Descriptions,
        "data/strings/descriptions.csv",
        "id",
        None,
        (false, false, false),
    ),
];
pub(super) fn csv_table_specs() -> &'static [CsvTableSpec] {
    &CSV_TABLES
}
pub(super) fn csv_table_spec(key: CsvTableKey) -> &'static CsvTableSpec {
    CSV_TABLES
        .iter()
        .find(|table| table.key == key)
        .expect("registered CSV table")
}

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SpecBundle {
    pub ship_files: BTreeMap<String, LoadedSpecRecord>,
    pub variant_files: Vec<VariantFile>,
    pub skin_files: Vec<SkinFile>,
    pub weapon_specs: BTreeMap<String, LoadedSpecRecord>,
    pub projectile_specs: BTreeMap<String, LoadedSpecRecord>,
    pub system_files: BTreeMap<String, LoadedSpecRecord>,
    pub skill_files: BTreeMap<String, LoadedSpecRecord>,
    pub variant_warnings: Vec<GameScanWarning>,
    pub skin_warnings: Vec<GameScanWarning>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SessionCsvTable {
    pub missing_baseline: bool,
    pub header: Vec<String>,
    pub path: String,
    pub rows: Option<Arc<Vec<SessionCsvRow>>>,
    #[serde(skip)]
    pub row_index: Option<HashMap<String, usize>>,
    pub next_row_seq: u64,
    #[serde(skip)]
    pub source: Option<Arc<CsvSource>>,
}
#[derive(Clone, Serialize, Deserialize)]
pub(super) struct SessionCsvRow {
    pub row_key: String,
    pub data: Map<String, Value>,
    pub is_comment: bool,
    pub source_row: Option<usize>,
}
#[derive(Clone)]
pub(super) struct ProjectSession {
    pub documents: Arc<BTreeMap<String, Arc<JsonSource>>>,
    pub reference_revision: u64,
    pub references: Vec<Arc<ReferenceSnapshot>>,
    pub loaded_edit_targets: Vec<EntityEditTarget>,
    pub content_pending: bool,
    pub source_versions: Arc<BTreeMap<String, FileVersion>>,
    pub source_scopes: Arc<BTreeMap<String, SourceScope>>,
    pub source_stamps: Arc<BTreeMap<String, Option<(u64, SystemTime)>>>,
    pub manifest: ProjectManifest,
    pub faction_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub faction_blueprint_tags: HashMap<String, String>,
    pub csv_tables: BTreeMap<String, Arc<SessionCsvTable>>,
    pub ship_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub variant_files: Arc<Vec<VariantFile>>,
    pub skin_files: Arc<Vec<SkinFile>>,
    pub variant_warnings: Vec<GameScanWarning>,
    pub skin_warnings: Vec<GameScanWarning>,
    pub weapon_specs: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub projectile_specs: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub system_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub skill_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
}
pub(super) struct ReferenceSnapshot {
    pub identity: ReferenceSource,
    pub session: ProjectSession,
    pub tables: Mutex<BTreeMap<String, Arc<SessionCsvTable>>>,
}
pub(super) fn string_from_row(row: &Map<String, Value>, key: &str) -> Option<String> {
    row.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
pub(super) fn string_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_owned)
}
pub(super) fn weapon_sprite_path(value: &Value) -> Option<String> {
    WEAPON_SPRITE_FIELDS
        .iter()
        .find_map(|field| string_field(value, field))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn row(entries: &[(&str, &str)]) -> Map<String, Value> {
        entries
            .iter()
            .map(|(key, value)| (key.to_string(), Value::String(value.to_string())))
            .collect()
    }

    #[test]
    fn string_from_row_reads_string_values_only() {
        let mut data = row(&[("id", "xy")]);
        data.insert("hp".to_string(), json!(12));
        assert_eq!(string_from_row(&data, "id").as_deref(), Some("xy"));
        assert_eq!(string_from_row(&data, "hp"), None);
        assert_eq!(string_from_row(&data, "missing"), None);
    }

    #[test]
    fn string_field_reads_top_level_object_keys() {
        let value = json!({ "spec": { "id": "inner" } });
        assert_eq!(string_field(&value, "spec"), None);
        assert_eq!(
            string_field(&json!({ "id": "inner" }), "id").as_deref(),
            Some("inner")
        );
        assert_eq!(string_field(&value, "missing"), None);
    }

    #[test]
    fn weapon_sprite_path_picks_the_first_declared_sprite_field() {
        let weapon = json!({ "turretGunSprite": "graphics/gun.png" });
        assert_eq!(
            weapon_sprite_path(&weapon).as_deref(),
            Some("graphics/gun.png")
        );
        assert_eq!(weapon_sprite_path(&json!({})), None);
    }

    #[test]
    fn csv_table_spec_covers_every_table_key() {
        for spec in csv_table_specs() {
            assert_eq!(csv_table_spec(spec.key).key, spec.key);
            assert_eq!(CsvTableKey::from_key(spec.key.as_str()), Some(spec.key));
            assert_eq!(
                spec.entity_id_field,
                if spec.key == CsvTableKey::SimOpponents {
                    "variant id"
                } else {
                    "id"
                }
            );
        }
    }

    #[test]
    fn mission_list_default_header_is_the_mission_column() {
        assert_eq!(mission_list_default_header(), vec!["mission".to_string()]);
    }
}
