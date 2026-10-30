//! Original Starsector tag, hint and numeric-template catalog.
use crate::models::CsvTableKey;
use serde::Deserialize;
use std::{collections::BTreeMap, sync::LazyLock};

#[derive(Deserialize)]
struct LabelAsset {
    #[serde(rename = "$schema")]
    schema: String,
    #[serde(rename = "gameVersion")]
    game_version: String,
    groups: Vec<LabelGroup>,
    patterns: Vec<NumericLabel>,
}

#[derive(Deserialize)]
struct LabelGroup {
    sources: Vec<String>,
    values: BTreeMap<String, WellKnownLabelEntry>,
}

#[derive(Clone, Deserialize)]
pub struct WellKnownLabelEntry {
    pub label: String,
    pub description: String,
}

#[derive(Clone, Deserialize)]
pub struct NumericLabel {
    sources: Vec<String>,
    pub prefix: String,
    pub max: u32,
    label: String,
    description: String,
}

#[derive(Default)]
pub struct WellKnownCatalog {
    pub values: BTreeMap<String, WellKnownLabelEntry>,
    pub patterns: Vec<NumericLabel>,
}

impl WellKnownCatalog {
    pub fn find(&self, value: &str) -> Option<WellKnownLabelEntry> {
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

impl NumericLabel {
    pub fn entry(&self, number: Option<u32>) -> WellKnownLabelEntry {
        WellKnownLabelEntry {
            label: number.map_or_else(
                || self.label.clone(),
                |number| format!("{} {number}", self.label),
            ),
            description: self.description.clone(),
        }
    }
}

static CATALOGS: LazyLock<BTreeMap<String, WellKnownCatalog>> = LazyLock::new(|| {
    let asset: LabelAsset =
        serde_json::from_str(include_str!("../../../schemas/well-known-labels.json"))
            .expect("embedded original label catalog must parse");
    assert_eq!(asset.schema, "pyxis-ad-astra/well-known-labels/v2");
    assert_eq!(asset.game_version, "0.98a-RC8");
    let mut catalogs: BTreeMap<String, WellKnownCatalog> = BTreeMap::new();
    for group in asset.groups {
        for source in group.sources {
            let catalog = catalogs.entry(source).or_default();
            for (value, entry) in &group.values {
                assert!(
                    catalog
                        .values
                        .insert(value.clone(), entry.clone())
                        .is_none()
                );
            }
        }
    }
    for pattern in asset.patterns {
        for source in &pattern.sources {
            catalogs
                .entry(source.clone())
                .or_default()
                .patterns
                .push(pattern.clone());
        }
    }
    catalogs
});

pub fn well_known_catalog(table: CsvTableKey, column: &str) -> Option<&'static WellKnownCatalog> {
    CATALOGS.get(&format!("{}.{column}", table.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn original_hint_domains_are_complete_and_separate() {
        let ships = well_known_catalog(CsvTableKey::Ships, "hints").unwrap();
        let weapons = well_known_catalog(CsvTableKey::Weapons, "hints").unwrap();
        let ship_values = "FREIGHTER TANKER LINER TRANSPORT CIVILIAN CARRIER COMBAT NO_AUTO_ESCORT UNBOARDABLE STATION SHIP_WITH_MODULES MODULE HIDE_IN_CODEX UNDER_PARENT INDEPENDENT_ROTATION ALWAYS_PANIC WEAPONS_FRONT_TO_BACK WEAPONS_BACK_TO_FRONT DO_NOT_SHOW_MODULES_IN_FLEET_LIST RENDER_ENGINES_BELOW_HULL NEVER_DODGE_MISSILES MISSILE_HARDPOINTS_ROTATE NO_NEURAL_LINK PHASE PLAY_FIGHTER_OVERLOAD_SOUNDS";
        let weapon_values = "PD PD_ONLY PD_ALSO USE_VS_FRIGATES STRIKE DANGEROUS BOMB GUIDED_POOR DO_NOT_AIM ANTI_FTR HEATSEEKER SYSTEM SHOW_IN_CODEX AUTOZOOM DO_NOT_CONSERVE CONSERVE_1 CONSERVE_2 CONSERVE_3 CONSERVE_4 CONSERVE_5 CONSERVE_ALL CONSERVE_FOR_ANTI_ARMOR FIRE_WHEN_INEFFICIENT EXTRA_RANGE_ON_FIGHTER IGNORES_FLARES GROUP_LINKED GROUP_ALTERNATING MISSILE_SPREAD DIRECT_AIM NO_TURN_RATE_BOOST_WHEN_IDLE RESET_BARREL_INDEX_ON_BURST USE_LESS_VS_SHIELDS RANGE_FROM_TARGETING_OVAL RANGE_FROM_SHIP_RADIUS IMPORTANT NO_MANUAL_FIRE";
        for (catalog, values) in [(ships, ship_values), (weapons, weapon_values)] {
            assert_eq!(
                catalog
                    .values
                    .keys()
                    .map(String::as_str)
                    .collect::<std::collections::BTreeSet<_>>(),
                values.split_whitespace().collect()
            );
        }
        assert!(weapons.find("NO_AUTO_FIRE").is_none());
        assert!(ships.find("PD").is_none());
    }

    #[test]
    fn scoped_labels_and_numeric_rules_keep_original_meanings() {
        let weapons = well_known_catalog(CsvTableKey::Weapons, "tags").unwrap();
        let wings = well_known_catalog(CsvTableKey::Wings, "tags").unwrap();
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
        let skills = well_known_catalog(CsvTableKey::Skills, "tags").unwrap();
        let mods = well_known_catalog(CsvTableKey::Hullmods, "tags").unwrap();
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
}
