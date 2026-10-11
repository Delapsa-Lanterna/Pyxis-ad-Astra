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
        CsvTableKey::Ships => Some(include_str!("../../../schemas/csv/ships.schema.json")),
        CsvTableKey::Weapons => Some(include_str!("../../../schemas/csv/weapons.schema.json")),
        CsvTableKey::Wings => Some(include_str!("../../../schemas/csv/wings.schema.json")),
        CsvTableKey::Descriptions => {
            return [
                "id", "type", "text1", "text2", "text3", "text4", "text5", "notes",
            ]
            .into_iter()
            .map(String::from)
            .collect();
        }
        _ => None,
    };
    asset
        .map(|text| {
            serde_json::from_str::<ColumnAsset>(text)
                .expect("embedded CSV column asset must parse")
                .columns
                .into_iter()
                .map(|column| column.key)
                .collect()
        })
        .unwrap_or_default()
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
