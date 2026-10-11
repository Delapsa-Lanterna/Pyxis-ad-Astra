use super::super::{
    cache,
    model::{ProjectSession, SessionCsvRow},
};
use crate::{
    errors::{AppError, AppResult},
    models::{CsvTableKey, EntityKind},
};
use serde_json::Value;

pub(super) type DescriptionTable = (Vec<String>, Vec<SessionCsvRow>, u64);

pub(super) fn default_description_rename(
    kind: EntityKind,
    previous: &str,
    next: &str,
    source: &Value,
) -> Option<(String, String)> {
    (kind == EntityKind::Ship && previous != next && source.get("descriptionId").is_none())
        .then(|| (previous.into(), next.into()))
}

pub(super) fn rename_description_row(
    session: &ProjectSession,
    table: &mut DescriptionTable,
    previous: &str,
    next: &str,
) -> AppResult<bool> {
    let (header, rows, sequence) = table;
    let matches = |row: &SessionCsvRow, id: &str| {
        !row.is_comment
            && row.data.get("id").and_then(Value::as_str) == Some(id)
            && row.data.get("type").and_then(Value::as_str) == Some("SHIP")
    };
    let source = rows.iter().position(|row| matches(row, previous));
    let core = if source.is_none() {
        session
            .manifest
            .starsector_root
            .as_ref()
            .map(|root| cache::load_core_csv_table(root, CsvTableKey::Descriptions))
            .transpose()?
            .flatten()
    } else {
        None
    };
    let inherited = core
        .as_ref()
        .and_then(|table| table.rows.as_ref())
        .and_then(|rows| rows.iter().find(|row| matches(row, previous)));
    if source.is_none() && inherited.is_none() {
        return Ok(false);
    }
    let core_collision = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| cache::load_core_csv_table(root, CsvTableKey::Descriptions))
        .transpose()?
        .flatten()
        .is_some_and(|table| {
            table
                .rows
                .as_ref()
                .is_some_and(|rows| rows.iter().any(|row| matches(row, next)))
        });
    if rows.iter().any(|row| matches(row, next)) || core_collision {
        return Err(AppError::message(
            "ship.description_target_exists",
            format!("舰船描述 ID 已存在: {next} / SHIP"),
        ));
    }
    if let Some(index) = source {
        rows[index]
            .data
            .insert("id".into(), Value::String(next.into()));
    } else {
        let mut data = inherited
            .expect("inherited description exists")
            .data
            .clone();
        data.insert("id".into(), Value::String(next.into()));
        let added = data
            .keys()
            .filter(|key| !header.contains(key))
            .cloned()
            .collect::<Vec<_>>();
        crate::domain::csv_column_order::add_ordered_csv_columns(
            header,
            &added,
            &crate::domain::csv_column_order::standard_csv_columns(CsvTableKey::Descriptions),
        );
        rows.push(SessionCsvRow {
            row_key: format!("descriptions:row:{sequence}"),
            data,
            is_comment: false,
        });
        *sequence += 1;
    }
    Ok(true)
}

pub(super) fn stage_description_renames(
    session: &ProjectSession,
    renames: &[(String, String)],
) -> AppResult<Option<super::entity_identity::StagedIdentityCsv>> {
    if renames.is_empty() {
        return Ok(None);
    }
    let mut table = cache::csv::read_table_snapshot(session, CsvTableKey::Descriptions)?;
    let mut changed = false;
    for (previous, next) in renames {
        changed |= rename_description_row(session, &mut table, previous, next)?;
    }
    if !changed {
        return Ok(None);
    }
    let (header, rows, next_seq) = table;
    let text = crate::parsers::render_csv_text(
        &header,
        &rows
            .iter()
            .map(|row| (&row.data, row.is_comment))
            .collect::<Vec<_>>(),
    )?;
    Ok(Some(super::entity_identity::StagedIdentityCsv {
        table: CsvTableKey::Descriptions,
        header,
        rows,
        text,
        next_seq,
    }))
}
