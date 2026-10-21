use crate::models::CsvTableKey;
use serde::Deserialize;
use std::collections::BTreeSet;

#[derive(Deserialize)]
struct ColumnAsset {
    columns: Vec<Column>,
}
#[derive(Deserialize)]
struct Column {
    key: String,
}

pub fn standard_csv_columns(table: CsvTableKey) -> Vec<String> {
    let asset = match table {
        CsvTableKey::Ships => include_str!("../../../schemas/csv/ships.schema.json"),
        CsvTableKey::Weapons => include_str!("../../../schemas/csv/weapons.schema.json"),
        CsvTableKey::Wings => include_str!("../../../schemas/csv/wings.schema.json"),
        CsvTableKey::Hullmods => include_str!("../../../schemas/csv/hullmods.schema.json"),
        CsvTableKey::ShipSystems => include_str!("../../../schemas/csv/shipSystems.schema.json"),
        CsvTableKey::Industries => include_str!("../../../schemas/csv/industries.schema.json"),
        CsvTableKey::Skills => include_str!("../../../schemas/csv/skills.schema.json"),
        CsvTableKey::Abilities => include_str!("../../../schemas/csv/abilities.schema.json"),
        CsvTableKey::Commodities => include_str!("../../../schemas/csv/commodities.schema.json"),
        CsvTableKey::SpecialItems => include_str!("../../../schemas/csv/specialItems.schema.json"),
        CsvTableKey::Submarkets => include_str!("../../../schemas/csv/submarkets.schema.json"),
        CsvTableKey::MarketConditions => {
            include_str!("../../../schemas/csv/marketConditions.schema.json")
        }
        CsvTableKey::SimOpponents => include_str!("../../../schemas/csv/simOpponents.schema.json"),
        CsvTableKey::Descriptions => include_str!("../../../schemas/csv/descriptions.schema.json"),
    };
    serde_json::from_str::<ColumnAsset>(asset)
        .expect("embedded CSV column asset must parse")
        .columns
        .into_iter()
        .map(|column| column.key)
        .collect()
}

pub fn add_ordered_csv_columns(header: &mut Vec<String>, added: &[String], standard: &[String]) {
    let present = header.iter().chain(added).collect::<BTreeSet<_>>();
    let known = standard.iter().collect::<BTreeSet<_>>();
    let mut ordered = standard
        .iter()
        .filter(|column| present.contains(column))
        .cloned()
        .collect::<Vec<_>>();
    for column in header
        .iter()
        .chain(added)
        .filter(|column| !known.contains(column))
    {
        if !ordered.contains(column) {
            ordered.push(column.clone());
        }
    }
    *header = ordered;
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
        assert_eq!(header, ["name", "id", "hitpoints", "custom", "custom2"]);
    }
}
