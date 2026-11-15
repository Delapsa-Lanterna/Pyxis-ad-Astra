//! Schema-scoped value labels, descriptions and numeric templates.
use crate::models::CsvTableKey;
#[cfg(test)]
use crate::test_support::work_counts;
use serde::Deserialize;
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::Path;
use std::sync::LazyLock;

#[derive(Deserialize)]
struct ValueCatalogAsset {
    #[serde(rename = "$schema")]
    schema: String,
    id: String,
    values: BTreeMap<String, ValueCatalogEntry>,
    #[serde(default)]
    patterns: Vec<NumericValueTemplate>,
}

#[derive(Deserialize)]
struct CsvCatalogAsset {
    columns: Vec<CsvCatalogField>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CsvCatalogField {
    key: String,
    option_catalog: Option<String>,
    options: Option<Vec<String>>,
    #[serde(default)]
    suggestions: Vec<String>,
    #[serde(default)]
    option_patterns: Vec<String>,
}

#[derive(Clone, Deserialize)]
pub struct ValueCatalogEntry {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Deserialize)]
pub struct NumericValueTemplate {
    pub prefix: String,
    pub max: u32,
    label: String,
    description: String,
}

#[derive(Default)]
pub struct ValueCatalog {
    pub values: BTreeMap<String, ValueCatalogEntry>,
    pub order: Vec<String>,
    pub patterns: Vec<NumericValueTemplate>,
}

impl ValueCatalog {
    pub fn find(&self, value: &str) -> Option<ValueCatalogEntry> {
        self.values.get(value).cloned().or_else(|| {
            self.patterns.iter().find_map(|pattern| {
                let suffix = value.strip_prefix(&pattern.prefix)?;
                if suffix.is_empty() || !suffix.bytes().all(|byte| byte.is_ascii_digit()) {
                    return None;
                }
                let number = suffix.parse::<u32>().ok()?;
                (number <= pattern.max).then(|| pattern.entry(Some(number)))
            })
        })
    }
}

impl NumericValueTemplate {
    pub fn entry(&self, number: Option<u32>) -> ValueCatalogEntry {
        ValueCatalogEntry {
            label: number.map_or_else(
                || self.label.clone(),
                |number| format!("{} {number}", self.label),
            ),
            description: self.description.clone(),
        }
    }
}

static CATALOGS: LazyLock<BTreeMap<String, ValueCatalog>> = LazyLock::new(|| {
    #[cfg(test)]
    work_counts::record("asset-parse", Path::new("value-catalogs"));
    let assets: BTreeMap<_, _> = include!(concat!(env!("OUT_DIR"), "/value_catalogs.rs"))
        .into_iter()
        .map(|(id, text)| {
            let asset: ValueCatalogAsset =
                serde_json::from_str(text).expect("embedded value catalog must parse");
            assert_eq!(asset.schema, "pyxis-ad-astra/value-catalog/v1");
            assert_eq!(asset.id, id);
            (id, asset)
        })
        .collect();
    let mut catalogs: BTreeMap<String, ValueCatalog> = BTreeMap::new();
    for (table, text) in include!(concat!(env!("OUT_DIR"), "/csv_schemas.rs")) {
        let columns: CsvCatalogAsset = serde_json::from_str(text).expect("embedded CSV schema");
        for column in columns.columns {
            let Some(id) = column.option_catalog else {
                continue;
            };
            let asset = &assets[id.as_str()];
            let order = column.options.unwrap_or(column.suggestions);
            let values = order
                .iter()
                .map(|value| (value.clone(), asset.values[value].clone()))
                .collect();
            let patterns = column
                .option_patterns
                .iter()
                .map(|prefix| {
                    asset
                        .patterns
                        .iter()
                        .find(|pattern| pattern.prefix == *prefix)
                        .expect("schema declares a catalog numeric template")
                        .clone()
                })
                .collect();
            catalogs.insert(
                format!("{table}.{}", column.key),
                ValueCatalog {
                    values,
                    order,
                    patterns,
                },
            );
        }
    }
    #[cfg(test)]
    work_counts::record("asset-build", Path::new("value-catalogs"));
    catalogs
});

pub fn csv_value_catalog(table: CsvTableKey, column: &str) -> Option<&'static ValueCatalog> {
    CATALOGS.get(&format!("{}.{column}", table.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use std::collections::BTreeSet;

    #[test]
    fn original_hint_domains_are_complete_and_separate() {
        let ships = csv_value_catalog(CsvTableKey::Ships, "hints").unwrap();
        let weapons = csv_value_catalog(CsvTableKey::Weapons, "hints").unwrap();
        let ship_values = "FREIGHTER TANKER LINER TRANSPORT CIVILIAN CARRIER COMBAT NO_AUTO_ESCORT UNBOARDABLE STATION SHIP_WITH_MODULES MODULE HIDE_IN_CODEX UNDER_PARENT INDEPENDENT_ROTATION ALWAYS_PANIC WEAPONS_FRONT_TO_BACK WEAPONS_BACK_TO_FRONT DO_NOT_SHOW_MODULES_IN_FLEET_LIST RENDER_ENGINES_BELOW_HULL NEVER_DODGE_MISSILES MISSILE_HARDPOINTS_ROTATE NO_NEURAL_LINK PHASE PLAY_FIGHTER_OVERLOAD_SOUNDS DO_NOT_TURN_TO_ARMOR";
        let weapon_values = "PD PD_ONLY PD_ALSO USE_VS_FRIGATES STRIKE DANGEROUS BOMB GUIDED_POOR DO_NOT_AIM ANTI_FTR HEATSEEKER SYSTEM SHOW_IN_CODEX AUTOZOOM DO_NOT_CONSERVE CONSERVE_1 CONSERVE_2 CONSERVE_3 CONSERVE_4 CONSERVE_5 CONSERVE_ALL CONSERVE_FOR_ANTI_ARMOR FIRE_WHEN_INEFFICIENT EXTRA_RANGE_ON_FIGHTER IGNORES_FLARES GROUP_LINKED GROUP_ALTERNATING MISSILE_SPREAD DIRECT_AIM NO_TURN_RATE_BOOST_WHEN_IDLE RESET_BARREL_INDEX_ON_BURST USE_LESS_VS_SHIELDS RANGE_FROM_TARGETING_OVAL RANGE_FROM_SHIP_RADIUS IMPORTANT NO_MANUAL_FIRE";
        for (catalog, values) in [(ships, ship_values), (weapons, weapon_values)] {
            assert_eq!(
                catalog
                    .values
                    .keys()
                    .map(String::as_str)
                    .collect::<BTreeSet<_>>(),
                values.split_whitespace().collect()
            );
        }
        assert!(weapons.find("NO_AUTO_FIRE").is_none());
        assert!(ships.find("PD").is_none());
    }

    #[test]
    fn scoped_labels_and_numeric_rules_keep_original_meanings() {
        let weapons = csv_value_catalog(CsvTableKey::Weapons, "tags").unwrap();
        let wings = csv_value_catalog(CsvTableKey::Wings, "tags").unwrap();
        assert_eq!(weapons.patterns.len(), 11);
        assert_eq!(wings.patterns.len(), 4);
        assert!(weapons.find("kinetic99").is_some());
        for value in [
            "kinetic100",
            "kinetic",
            "kinetic-1",
            "kinetic1.5",
            "fighter3",
            "no_bp",
        ] {
            assert!(weapons.find(value).is_none(), "{value}");
        }
        assert!(wings.find("kinetic3").is_none());
        assert!(
            weapons
                .find("substrate_3")
                .unwrap()
                .description
                .contains("所需")
        );
        let skills = csv_value_catalog(CsvTableKey::Skills, "tags").unwrap();
        let mods = csv_value_catalog(CsvTableKey::Hullmods, "tags").unwrap();
        assert_ne!(
            skills.find("phase").unwrap().description,
            mods.find("phase").unwrap().description
        );
        for catalog in CATALOGS.values() {
            for entry in catalog.values.values() {
                assert!(!entry.label.trim().is_empty());
                assert!(!entry.description.trim().is_empty());
            }
        }
    }

    #[test]
    fn csv_catalogs_use_declared_subsets_and_order() {
        let damage = csv_value_catalog(CsvTableKey::Weapons, "type").unwrap();
        assert_eq!(
            damage.order,
            [
                "KINETIC",
                "ENERGY",
                "HIGH_EXPLOSIVE",
                "FRAGMENTATION",
                "OTHER"
            ]
        );
        assert_eq!(damage.find("KINETIC").unwrap().label, "动能");
        let formation = csv_value_catalog(CsvTableKey::Wings, "formation").unwrap();
        assert_eq!(formation.order, ["CLAW", "V", "BOX", "DIAMOND"]);
        assert_eq!(formation.find("CLAW").unwrap().label, "爪形");
        assert_eq!(
            csv_value_catalog(CsvTableKey::Ships, "hints")
                .unwrap()
                .order
                .last()
                .unwrap(),
            "DO_NOT_TURN_TO_ARMOR"
        );
    }
}
