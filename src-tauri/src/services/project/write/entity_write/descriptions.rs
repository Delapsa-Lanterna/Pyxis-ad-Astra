use super::super::super::model::{ProjectSession, SessionCsvRow};
use super::super::super::session::csv_writes::CsvTableDraft;
use crate::domain::csv_column_order;
use crate::errors::{AppError, AppResult};
use crate::models::{CsvTableKey, EntityKind};
use crate::services::project::model;
use crate::services::project::sources::core;
use serde_json::{Map, Value};

#[derive(Clone)]
pub(in crate::services::project) struct DescriptionRename {
    pub previous_id: String,
    pub next_id: String,
    pub description_type: &'static str,
}

pub(in crate::services::project) fn description_rename(
    kind: EntityKind,
    previous: &str,
    next: &str,
    source: &Value,
) -> Option<DescriptionRename> {
    let typ = match kind {
        EntityKind::Ship if source.get("descriptionId").is_none() => "SHIP",
        EntityKind::Weapon => "WEAPON",
        _ => return None,
    };
    (previous != next).then(|| DescriptionRename {
        previous_id: previous.into(),
        next_id: next.into(),
        description_type: typ,
    })
}

pub(in crate::services::project) fn rename_description_row(
    session: &ProjectSession,
    table: &mut CsvTableDraft,
    previous: &str,
    next: &str,
    typ: &str,
) -> AppResult<bool> {
    let CsvTableDraft {
        header,
        rows,
        next_row_seq: sequence,
        ..
    } = table;
    let matches = |data: &Map<String, Value>, is_comment: bool, id: &str| {
        !is_comment
            && data.get("id").and_then(Value::as_str) == Some(id)
            && data.get("type").and_then(Value::as_str) == Some(typ)
    };
    let source = rows
        .iter()
        .position(|row| matches(&row.data, row.is_comment, previous));
    let core = if source.is_none() {
        session
            .manifest
            .starsector_root
            .as_ref()
            .map(|root| {
                core::load_core_csv_table(
                    root,
                    model::csv_table_spec(CsvTableKey::Descriptions).rel_path,
                )
            })
            .transpose()?
            .flatten()
    } else {
        None
    };
    let inherited = core.as_ref().and_then(|table| {
        table
            .rows
            .iter()
            .find(|row| matches(&row.data, row.is_comment, previous))
    });
    if source.is_none() && inherited.is_none() {
        return Ok(false);
    }
    let core_collision = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| {
            core::load_core_csv_table(
                root,
                model::csv_table_spec(CsvTableKey::Descriptions).rel_path,
            )
        })
        .transpose()?
        .flatten()
        .is_some_and(|table| {
            table
                .rows
                .iter()
                .any(|row| matches(&row.data, row.is_comment, next))
        });
    if rows
        .iter()
        .any(|row| matches(&row.data, row.is_comment, next))
        || core_collision
    {
        return Err(AppError::message(
            if typ == "SHIP" {
                "ship.description_target_exists"
            } else {
                "weapon.description_target_exists"
            },
            format!("描述 ID 已存在: {next} / {typ}"),
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
        csv_column_order::add_ordered_csv_columns(
            header,
            &added,
            &csv_column_order::standard_csv_columns(CsvTableKey::Descriptions),
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

pub(in crate::services::project) fn prepare_description_renames(
    session: &ProjectSession,
    renames: &[DescriptionRename],
) -> AppResult<Option<CsvTableDraft>> {
    if renames.is_empty() {
        return Ok(None);
    }
    let mut table = CsvTableDraft::read(session, CsvTableKey::Descriptions)?;
    let mut changed = false;
    for rename in renames {
        changed |= rename_description_row(
            session,
            &mut table,
            &rename.previous_id,
            &rename.next_id,
            rename.description_type,
        )?;
    }
    if !changed {
        return Ok(None);
    }
    Ok(Some(table))
}
