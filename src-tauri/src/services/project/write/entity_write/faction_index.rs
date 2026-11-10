use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::file_content::{CsvSource, SaveLayout};
use crate::models::{EntityEditTarget, EntityLinkedRecord};
use crate::parsers;
use crate::services::project::model::{ProjectSession, SessionCsvRow};
use crate::services::project::session::{csv_tables, csv_writes::CsvTableDraft};
use crate::services::project::sources::project_csv;
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::Arc;

const INDEX: &str = "data/world/factions/factions.csv";
pub(in crate::services::project) struct FactionIndexDraft {
    pub table: CsvTableDraft,
    pub row_index: Option<usize>,
}
pub(in crate::services::project) fn prepare(
    session: &mut ProjectSession,
    target: &EntityEditTarget,
    id: &str,
    relative: &str,
    supplied: &Map<String, Value>,
) -> AppResult<FactionIndexDraft> {
    csv_tables::ensure_session_table_rows(session, "faction-index")?;
    let mut table = CsvTableDraft::read_named(session, "faction-index")?;
    let root = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "faction index root")?;
    if target.linked_record.is_none()
        && target.source.is_some()
        && target.write.rel_path == relative
    {
        return Ok(FactionIndexDraft {
            table,
            row_index: None,
        });
    }
    let row_index = if let Some(EntityLinkedRecord::Index { row_index, .. }) = target.linked_record
    {
        let csv = project_csv(&table.source, &root.root().join(INDEX));
        let entry = io::faction_index_entries(&root, &csv)?
            .into_iter()
            .find(|entry| entry.row_index == row_index)
            .ok_or_else(|| AppError::message("config.index_missing", "势力索引已变化"))?;
        table.rows[row_index].data.extend(supplied.clone());
        parsers::update_faction_index_row(&mut table.rows[row_index].data, &entry, id, relative);
        row_index
    } else {
        if table.header.is_empty() {
            table.header.push("faction".into());
        }
        let (id_column, file_column) =
            parsers::faction_index_columns(&table.header).expect("faction index has a column");
        let mut data = supplied.clone();
        let id_value = if file_column.is_none() && !id_column.eq_ignore_ascii_case("id") {
            relative
        } else {
            id
        };
        data.insert(id_column.clone(), Value::String(id_value.into()));
        if let Some(column) = &file_column {
            data.insert(column.clone(), Value::String(relative.into()));
        }
        let row_index = table.rows.len();
        table.rows.push(SessionCsvRow {
            row_key: format!("faction-index:row:{}", table.next_row_seq),
            data,
            is_comment: false,
            source_row: None,
        });
        table.next_row_seq += 1;
        row_index
    };
    for key in table.rows[row_index].data.keys() {
        if !table.header.contains(key) {
            table.header.push(key.clone());
        }
    }
    Ok(FactionIndexDraft {
        table,
        row_index: Some(row_index),
    })
}
pub(in crate::services::project) fn stage(
    table: &CsvTableDraft,
    builder: &mut FileChangeSetBuilder,
) -> AppResult<Arc<CsvSource>> {
    let actual = table.output(SaveLayout::PreserveStructure)?;
    builder.text_file(INDEX, Some(actual.document.source.to_string()))?;
    Ok(actual)
}
