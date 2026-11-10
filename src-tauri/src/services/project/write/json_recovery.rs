use crate::domain::entity_definitions;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::file_content::{JsonSource, SaveLayout};
use crate::models::file_value::Value as FileValue;
use crate::models::{
    EntityKind, JsonDocumentOrigin, JsonRecoveryPlan, JsonSourceRestore, WriteContentTarget,
    WriteResult,
};
use crate::parsers;
use crate::services::project::model::SessionCsvRow;
use crate::services::project::query::json_recovery;
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_session, session_handle,
};
use crate::services::project::sources::project_csv;
use serde_json::{Map, Value};
use std::path::Path;
use std::sync::Arc;

pub fn restore_source_request(
    input: JsonSourceRestore,
) -> AppResult<WriteResult<JsonRecoveryPlan>> {
    if input.session_id != input.plan.request.session_id
        || input.mod_root != input.plan.request.mod_root
    {
        return Err(AppError::message(
            "json.recovery_scope_mismatch",
            "重建计划与项目不匹配",
        ));
    }
    let plan = json_recovery::prepare_json_source_recovery(input.plan.request.clone())?;
    if plan.base_versions != input.plan.base_versions
        || plan.missing_paths != input.plan.missing_paths
    {
        return Err(AppError::message(
            "write.version_conflict",
            "重建来源已变化，请重新准备",
        ));
    }
    let owner = match &plan.request.origin {
        JsonDocumentOrigin::Entity { target } => Some(json_recovery::json_recovery_origin(
            &input.session_id,
            target,
        )?),
        _ => None,
    };
    let boundary = FsRootBoundary::new(Path::new(&input.mod_root), "JSON recovery root")?;
    let mut builder = FileChangeSetBuilder::new(boundary.root())?;
    let handle = session_handle(&input.session_id)?;
    let mut tables = Vec::new();
    for relative in &plan.missing_paths {
        if relative.ends_with("factions.csv") || relative.ends_with("mission_list.csv") {
            let owner = owner.as_ref().expect("index recovery belongs to an entity");
            let key = if owner.kind == EntityKind::Faction {
                "faction-index"
            } else {
                "missions"
            };
            let mut session = lock_session(&handle)?;
            csv_tables::ensure_session_table_rows(&mut session, key)?;
            let mut table = CsvTableDraft::read_named(&session, key)?;
            drop(session);
            let mut data = Map::new();
            let linked = if owner.kind == EntityKind::Faction {
                if table.header.is_empty() {
                    table.header.push("faction".into());
                }
                let (id_column, file_column) =
                    parsers::faction_index_columns(&table.header).expect("faction header");
                data.insert(
                    id_column,
                    Value::String(if file_column.is_some() {
                        owner.id.clone()
                    } else {
                        owner.write.rel_path.clone()
                    }),
                );
                if let Some(column) = file_column {
                    data.insert(column, Value::String(owner.write.rel_path.clone()));
                }
                let current = project_csv(&table.source, &boundary.root().join(relative));
                io::faction_index_entries(&boundary, &current)?
                    .iter()
                    .any(|entry| io::same_physical_path(&entry.path, Path::new(&owner.write.path)))
            } else {
                if table.header.is_empty() {
                    table.header.push("mission".into());
                }
                data = input
                    .baseline
                    .get("list")
                    .and_then(Value::as_object)
                    .cloned()
                    .ok_or_else(|| {
                        AppError::message("json.recovery_baseline_invalid", "战役基线缺少索引内容")
                    })?;
                data.insert("mission".into(), Value::String(owner.id.clone()));
                table.rows.iter().any(|row| {
                    !row.is_comment
                        && row.data.get("mission").and_then(Value::as_str) == Some(&owner.id)
                })
            };
            if !linked {
                for column in data.keys() {
                    if !table.header.contains(column) {
                        table.header.push(column.clone());
                    }
                }
                table.rows.push(SessionCsvRow {
                    row_key: format!("{key}:row:{}", table.next_row_seq),
                    data,
                    is_comment: false,
                    source_row: None,
                });
                table.next_row_seq += 1;
            }
            let actual = table.output(SaveLayout::PreserveStructure)?;
            builder.text_file(relative, Some(actual.document.source.to_string()))?;
            tables.push((key, table, actual));
        } else if relative.ends_with("mission_text.txt") {
            let text = input
                .baseline
                .get("text")
                .and_then(|value| {
                    value
                        .as_str()
                        .or_else(|| value.get("content").and_then(Value::as_str))
                })
                .ok_or_else(|| {
                    AppError::message("json.recovery_baseline_invalid", "重建文本基线无效")
                })?;
            builder.text_file(relative, Some(text.into()))?;
        } else {
            let key = if relative.ends_with("descriptor.json") {
                "descriptor"
            } else {
                "file"
            };
            let request = input.documents.get(key).ok_or_else(|| {
                AppError::message(
                    "json.recovery_baseline_invalid",
                    format!("重建请求缺少完整文档：{key}"),
                )
            })?;
            if let Some(owner) = &owner
                && let Some(definition) = entity_definitions::entity_spec_definition(owner.kind)
                && let Some(FileValue::Text(value)) = request.content.get(definition.id_field)
                && value
                    .as_str()
                    .is_some_and(|value| !value.is_empty() && value != owner.id)
            {
                return Err(AppError::message(
                    "spec.id_mismatch",
                    "文件内容 ID 与重建目标不一致",
                ));
            }
            let source = input.originals.get(key).map(|source| JsonSource {
                text: Arc::from(source.source.as_str()),
                content: source.content.clone(),
            });
            let actual = match source {
                Some(source) => source.write(request)?,
                None => JsonSource::create(request)?,
            };
            builder.text_file(relative, Some(actual.text.to_string()))?;
        }
    }
    let changes = builder.apply()?;
    for (key, table, actual) in tables {
        let mut session = lock_session(&handle)?;
        table.accept_named(&mut session, key, actual)?;
    }
    let actual = json_recovery::prepare_json_source_recovery(plan.request)?;
    let target = WriteContentTarget::Recovery {
        origin: actual.request.origin.clone(),
    };
    Ok(WriteResult::from_content(changes, target, actual))
}
