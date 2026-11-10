use crate::models::CsvTableKey;
use serde::Deserialize;
use std::collections::BTreeMap;
use std::sync::LazyLock;
#[derive(Deserialize)]
struct ColumnAsset {
    columns: Vec<Column>,
}
#[derive(Deserialize)]
struct Column {
    key: String,
}
pub fn standard_csv_columns(table: CsvTableKey) -> Vec<String> {
    static COLUMNS: LazyLock<BTreeMap<CsvTableKey, Vec<String>>> = LazyLock::new(|| {
        [
            (
                CsvTableKey::Ships,
                include_str!("../../../schemas/csv/ships.schema.json"),
            ),
            (
                CsvTableKey::Weapons,
                include_str!("../../../schemas/csv/weapons.schema.json"),
            ),
            (
                CsvTableKey::Wings,
                include_str!("../../../schemas/csv/wings.schema.json"),
            ),
            (
                CsvTableKey::Hullmods,
                include_str!("../../../schemas/csv/hullmods.schema.json"),
            ),
            (
                CsvTableKey::ShipSystems,
                include_str!("../../../schemas/csv/shipSystems.schema.json"),
            ),
            (
                CsvTableKey::Industries,
                include_str!("../../../schemas/csv/industries.schema.json"),
            ),
            (
                CsvTableKey::Skills,
                include_str!("../../../schemas/csv/skills.schema.json"),
            ),
            (
                CsvTableKey::Abilities,
                include_str!("../../../schemas/csv/abilities.schema.json"),
            ),
            (
                CsvTableKey::Commodities,
                include_str!("../../../schemas/csv/commodities.schema.json"),
            ),
            (
                CsvTableKey::SpecialItems,
                include_str!("../../../schemas/csv/specialItems.schema.json"),
            ),
            (
                CsvTableKey::Submarkets,
                include_str!("../../../schemas/csv/submarkets.schema.json"),
            ),
            (
                CsvTableKey::MarketConditions,
                include_str!("../../../schemas/csv/marketConditions.schema.json"),
            ),
            (
                CsvTableKey::SimOpponents,
                include_str!("../../../schemas/csv/simOpponents.schema.json"),
            ),
            (
                CsvTableKey::Descriptions,
                include_str!("../../../schemas/csv/descriptions.schema.json"),
            ),
        ]
        .into_iter()
        .map(|(key, text)| {
            (
                key,
                serde_json::from_str::<ColumnAsset>(text)
                    .expect("bundled CSV schema")
                    .columns
                    .into_iter()
                    .map(|column| column.key)
                    .collect(),
            )
        })
        .collect()
    });
    COLUMNS[&table].clone()
}
/// Existing columns keep their order; only added columns receive a standard insertion position.
pub fn add_ordered_csv_columns(header: &mut Vec<String>, added: &[String], standard: &[String]) {
    for column in added {
        if header.contains(column) {
            continue;
        }
        let position = standard
            .iter()
            .position(|known| known == column)
            .and_then(|index| {
                standard[index + 1..]
                    .iter()
                    .find_map(|next| header.iter().position(|known| known == next))
            })
            .unwrap_or(header.len());
        header.insert(position, column.clone());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn standard_order_keeps_custom_data() {
        let mut header = vec![
            "custom".into(),
            "id".into(),
            "name".into(),
            "custom2".into(),
        ];
        add_ordered_csv_columns(
            &mut header,
            &["hitpoints".into()],
            &standard_csv_columns(CsvTableKey::Ships),
        );
        assert_eq!(header, ["custom", "id", "name", "custom2", "hitpoints"]);
    }
}
