use crate::{
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_csv_data,
    },
    models::{CsvRow, EntityKind, JsonDocumentOrigin, JsonRecoveryPlan, WriteResult},
    parsers::render_csv_text,
};
use serde_json::{Map, Value};
use std::path::Path;

pub fn recreate_json_sources(
    supplied_plan: JsonRecoveryPlan,
    baseline: Value,
) -> AppResult<WriteResult<JsonRecoveryPlan>> {
    let plan = super::super::query::json_recovery::prepare_json_source_recovery(
        supplied_plan.request.clone(),
    )?;
    if plan.base_versions != supplied_plan.base_versions
        || plan.missing_paths != supplied_plan.missing_paths
    {
        return Err(AppError::message(
            "write.version_conflict",
            "重建来源已变化，请重新准备",
        ));
    }
    let original = match &plan.request.origin {
        JsonDocumentOrigin::ModInfo | JsonDocumentOrigin::MiscConfig { .. } => None,
        JsonDocumentOrigin::Entity { target } => {
            Some(super::super::query::json_recovery::json_recovery_origin(
                &supplied_plan.request.session_id,
                target,
            )?)
        }
    };
    if let Some(target) = &original
        && let Some(definition) =
            crate::domain::entity_definitions::entity_spec_definition(target.kind)
    {
        let file = if matches!(target.kind, EntityKind::Variant | EntityKind::Skin) {
            &baseline
        } else {
            &baseline["file"]
        };
        if file.get(definition.id_field).and_then(Value::as_str) != Some(target.id.as_str()) {
            return Err(AppError::message(
                "spec.id_mismatch",
                "重建基线与原文档身份不一致",
            ));
        }
    }
    let boundary = FsRootBoundary::new(
        Path::new(&supplied_plan.request.mod_root),
        "JSON recovery root",
    )?;
    let lease = acquire_root_write_lock(boundary.root())?;
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    let mut json = JsonWriteBatch::new(Default::default());
    for relative in &plan.missing_paths {
        let is_index = relative.ends_with("factions.csv") || relative.ends_with("mission_list.csv");
        if is_index {
            let Some(target) = &original else {
                unreachable!("entity index recovery")
            };
            let mut table =
                read_csv_data(&boundary.resolve_relative(relative, "JSON recovery index")?)?;
            let mut row = Map::new();
            if target.kind == EntityKind::Faction {
                if table.header.is_empty() {
                    table.header.push("faction".into());
                }
                let (id_column, file_column) = crate::parsers::faction_index_columns(&table.header)
                    .expect("faction index has a header");
                row.insert(
                    id_column,
                    Value::String(if file_column.is_some() {
                        target.id.clone()
                    } else {
                        target.write.rel_path.clone()
                    }),
                );
                if let Some(column) = file_column {
                    row.insert(column, Value::String(target.write.rel_path.clone()));
                }
            } else {
                if table.header.is_empty() {
                    table.header.push("mission".into());
                }
                row = baseline
                    .get("list")
                    .and_then(Value::as_object)
                    .ok_or_else(|| {
                        AppError::message("json.recovery_baseline_invalid", "战役基线缺少索引内容")
                    })?
                    .clone();
                row.insert("mission".into(), Value::String(target.id.clone()));
                for key in row.keys() {
                    if !table.header.contains(key) {
                        table.header.push(key.clone());
                    }
                }
            }
            table.rows.push(CsvRow {
                data: row,
                is_comment: false,
            });
            builder.text_file(
                relative,
                Some(render_csv_text(
                    &table.header,
                    &table
                        .rows
                        .iter()
                        .map(|row| (&row.data, row.is_comment))
                        .collect::<Vec<_>>(),
                )?),
            )?;
        } else {
            let key = if relative.ends_with("descriptor.json") {
                "descriptor"
            } else if relative.ends_with("mission_text.txt") {
                "text"
            } else {
                "file"
            };
            let value = if key == "file"
                && matches!(plan.request.origin, JsonDocumentOrigin::Entity { ref target } if matches!(target.kind, EntityKind::Variant | EntityKind::Skin))
            {
                &baseline
            } else {
                baseline.get(key).ok_or_else(|| {
                    AppError::message("json.recovery_baseline_invalid", "重建基线缺少来源内容")
                })?
            };
            let text = if key == "text" {
                value
                    .get("content")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        AppError::message("json.recovery_baseline_invalid", "重建文本基线无效")
                    })?
                    .to_string()
            } else {
                // The cached baseline contains parsed values; the missing source has no original text to preserve.
                json.render(&boundary.root().join(relative), value, None)?
            };
            builder.text_file(relative, Some(text))?;
        }
    }
    json.finish()?;
    let result = WriteResult::from_changes(builder.apply()?);
    let refreshed = super::super::query::json_recovery::prepare_json_source_recovery(plan.request)?;
    Ok(WriteResult::from_refreshed_entity(
        result.changes,
        refreshed,
    ))
}
