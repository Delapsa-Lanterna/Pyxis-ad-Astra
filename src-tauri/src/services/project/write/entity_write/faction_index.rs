use super::super::super::session::{lock_session, session_handle};

use crate::services::project::query::entity_targets::query_entity_edit_target;
use crate::{
    errors::AppResult,
    io::{FileChangeSetBuilder, FsRootBoundary, acquire_root_write_lock, read_csv_data},
    models::{EntityKind, EntityLinkedRecord, EntityTargetState, WriteResult},
    parsers::render_csv_text,
};
use serde_json::Value;
use std::path::Path;

pub fn delete_faction_entity(
    session_id: &str,
    id: &str,
    delete_target: bool,
) -> AppResult<WriteResult<Value>> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    let lease = acquire_root_write_lock(Path::new(&root))?;
    let info = query_entity_edit_target(session_id, EntityKind::Faction, id)?;
    let boundary = FsRootBoundary::new(Path::new(&root), "faction delete root")?;
    if info.target.linked_record.is_none() {
        let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
        builder.text_file(&info.target.write.rel_path, None)?;
        return Ok(WriteResult::new(builder.apply()?, Vec::new(), None));
    }
    let Some(EntityLinkedRecord::Index { path, row_index }) = &info.target.linked_record else {
        unreachable!("faction index record");
    };
    let mut index = read_csv_data(&boundary.resolve_relative(path, "faction index")?)?;
    index.rows.remove(*row_index);
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        path,
        Some(render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?),
    )?;
    if delete_target {
        builder.text_file(&info.target.write.rel_path, None)?;
    }
    let changes = builder.apply()?;
    Ok(WriteResult::new(changes, Vec::new(), None))
}

pub(super) fn stage_faction_index(
    session: &crate::services::project::model::ProjectSession,
    boundary: &FsRootBoundary,
    builder: &mut FileChangeSetBuilder,
    target: &crate::models::EntityEditTarget,
    next_id: &str,
    next_rel: &str,
) -> AppResult<()> {
    if target.kind == EntityKind::Faction
        && (target.linked_record.is_some() || target.state == EntityTargetState::Create)
    {
        let index_rel = "data/world/factions/factions.csv";
        let mut index =
            super::super::super::session::csv_tables::read_retained_csv(session, index_rel)?;
        if let Some(EntityLinkedRecord::Index { row_index, .. }) = &target.linked_record {
            let entries = crate::io::faction_index_entries(boundary, &index)?;
            let entry = entries
                .iter()
                .find(|entry| entry.row_index == *row_index)
                .expect("loaded faction index entry");
            crate::parsers::update_faction_index_row(
                &mut index.rows[*row_index].data,
                entry,
                next_id,
                next_rel,
            );
        } else {
            if index.header.is_empty() {
                index.header = vec!["faction".into()];
            }
            let field = index
                .header
                .iter()
                .find(|field| field.eq_ignore_ascii_case("faction"))
                .or_else(|| {
                    index
                        .header
                        .iter()
                        .find(|field| field.eq_ignore_ascii_case("id"))
                })
                .unwrap_or(&index.header[0]);
            let mut row = serde_json::Map::new();
            if field.eq_ignore_ascii_case("id") {
                row.insert(field.clone(), Value::String(next_id.to_string()));
                if let Some(file) = index
                    .header
                    .iter()
                    .find(|field| field.eq_ignore_ascii_case("file"))
                {
                    row.insert(file.clone(), Value::String(next_rel.to_string()));
                }
            } else {
                row.insert(field.clone(), Value::String(next_rel.to_string()));
            }
            index.rows.push(crate::models::CsvRow {
                data: row,
                is_comment: false,
            });
        }
        let text = render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?;
        builder.text_file(index_rel, Some(text))?;
    }
    Ok(())
}
