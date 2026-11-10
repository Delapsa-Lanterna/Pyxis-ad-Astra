use super::entity_write::{associated_specs, descriptions, replace_paths};
use crate::domain::csv_column_order;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::file_content::SaveLayout;
use crate::models::{
    AssociatedSpecWrite, CsvRowKeyMapping, CsvRowOrderEntry, CsvRowPatch, CsvRowPatchAction,
    CsvRowRecord, CsvSave, CsvTableKey, CsvTableRowsRead, EntityLinkedRecord, FileVersion,
    JsonWriteOptions, SaveEdit, WriteContentTarget, WriteResult, windows_path_key,
};
#[cfg(test)]
use crate::parsers;
#[cfg(test)]
use crate::parsers::game;
use crate::services::project::model::{self, SessionCsvRow};
use crate::services::project::query::entity_targets;
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_session, session_handle,
};
use serde_json::Value;
use std::collections::HashMap;
use std::mem;
use std::path::Path;
use std::sync::Arc;

fn apply_rows(
    table: CsvTableKey,
    draft: &mut CsvTableDraft,
    patches: Vec<CsvRowPatch>,
) -> AppResult<Vec<CsvRowKeyMapping>> {
    let mut mapping = Vec::new();
    let mut columns = Vec::new();
    for patch in patches {
        let position = draft
            .rows
            .iter()
            .position(|row| row.row_key == patch.row_key);
        match patch.action {
            CsvRowPatchAction::Delete => {
                let position = position.ok_or_else(|| {
                    AppError::message("table.row_key_unknown", "删除的 CSV 行已经变化")
                })?;
                draft.rows.remove(position);
            }
            CsvRowPatchAction::Upsert => {
                columns.extend(
                    patch
                        .columns
                        .iter()
                        .filter(|column| !draft.header.contains(column))
                        .cloned(),
                );
                if let Some(position) = position {
                    let row = &mut draft.rows[position];
                    for column in patch.columns {
                        if let Some(value) = patch.row.get(&column) {
                            row.data.insert(column, value.clone());
                        } else {
                            row.data.insert(column, Value::String(String::new()));
                        }
                    }
                    if patch.comment_changed {
                        row.is_comment = patch.is_comment;
                    }
                } else {
                    let prefix = format!("{}:new:", table.as_str());
                    if !patch
                        .row_key
                        .strip_prefix(&prefix)
                        .is_some_and(|suffix| !suffix.is_empty() && !suffix.contains(':'))
                    {
                        return Err(AppError::message(
                            "table.row_key_unknown",
                            "新增的 CSV 行标识无效",
                        ));
                    }
                    let index = patch.insert_at.unwrap_or(draft.rows.len());
                    if index > draft.rows.len() {
                        return Err(AppError::message(
                            "table.insert_position_invalid",
                            "CSV 插入位置超出当前表格",
                        ));
                    }
                    let row_key = format!("{}:row:{}", table.as_str(), draft.next_row_seq);
                    draft.next_row_seq += 1;
                    mapping.push(CsvRowKeyMapping {
                        previous_key: patch.row_key,
                        next_key: row_key.clone(),
                        row_index: index,
                    });
                    draft.rows.insert(
                        index,
                        SessionCsvRow {
                            row_key,
                            data: patch.row,
                            is_comment: patch.is_comment,
                            source_row: None,
                        },
                    );
                }
            }
        }
    }
    csv_column_order::add_ordered_csv_columns(
        &mut draft.header,
        &columns,
        &csv_column_order::standard_csv_columns(table),
    );
    Ok(mapping)
}
fn order_rows(
    rows: &mut Vec<SessionCsvRow>,
    mapping: &[CsvRowKeyMapping],
    order: &[CsvRowOrderEntry],
) -> AppResult<()> {
    let fail = || AppError::message("table.row_order_invalid", "CSV 行序与当前保存的记录不一致");
    if rows.len() != order.len() {
        return Err(fail());
    }
    let renamed = mapping
        .iter()
        .map(|entry| (entry.previous_key.as_str(), entry.next_key.as_str()))
        .collect::<HashMap<_, _>>();
    let mut available = mem::take(rows)
        .into_iter()
        .map(|row| (row.row_key.clone(), row))
        .collect::<HashMap<_, _>>();
    for key in order {
        rows.push(
            available
                .remove(renamed.get(key.as_str()).copied().unwrap_or(key))
                .ok_or_else(fail)?,
        );
    }
    Ok(())
}
pub fn save_csv_patch_snapshot(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated: Vec<AssociatedSpecWrite>,
    options: JsonWriteOptions,
    order: Option<Vec<CsvRowOrderEntry>>,
) -> AppResult<WriteResult> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    let _lease = io::acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_session(&handle)?;
    csv_tables::ensure_registered_table_rows(&mut session, table)?;
    let mut draft = CsvTableDraft::read(&session, table)?;
    let mut mapping = apply_rows(table, &mut draft, patches)?;
    if let Some(order) = order {
        order_rows(&mut draft.rows, &mapping, &order)?;
    }
    let positions = draft
        .rows
        .iter()
        .enumerate()
        .map(|(index, row)| (row.row_key.as_str(), index))
        .collect::<HashMap<_, _>>();
    for entry in &mut mapping {
        entry.row_index = positions[entry.next_key.as_str()];
    }
    let mut builder = FileChangeSetBuilder::new(Path::new(&root))?;
    let actual = draft.output(SaveLayout::PreserveStructure)?;
    builder.text_file(
        model::csv_table_spec(table).rel_path,
        Some(actual.document.source.to_string()),
    )?;
    let mut identities = Vec::new();
    let mut renames = Vec::new();
    let mut read = Vec::new();
    for spec in &associated {
        let current = entity_targets::describe_entity_target(
            &mut session,
            spec.target.kind,
            &spec.target.id,
        )?;
        if current.target != spec.target {
            return Err(AppError::message(
                "spec.target_changed",
                "关联规格目标已变化",
            ));
        }
        let staged = associated_specs::stage_associated_spec(
            &session,
            &mut builder,
            table,
            &spec.change,
            &spec.target,
            spec.resolution.as_ref(),
            &options,
        )?;
        if let Some(rename) = staged.description_rename {
            renames.push(rename);
        }
        if let Some(record) = staged.read_record {
            read.push((
                spec.target.kind,
                record,
                spec.resolution
                    .as_ref()
                    .expect("read resolution")
                    .destination
                    .version
                    .clone(),
            ));
        }
        identities.push(staged.identity);
    }
    let description = if renames.is_empty() {
        None
    } else {
        csv_tables::ensure_registered_table_rows(&mut session, CsvTableKey::Descriptions)?;
        descriptions::prepare_description_renames(&session, &renames)?
    };
    let description = description
        .map(|draft| {
            let actual = draft.output(SaveLayout::PreserveStructure)?;
            builder.text_file(
                model::csv_table_spec(CsvTableKey::Descriptions).rel_path,
                Some(actual.document.source.to_string()),
            )?;
            Ok::<_, AppError>((draft, actual))
        })
        .transpose()?;
    replace_paths::stage_replace_paths(&mut builder, &options)?;
    let changes = builder.apply()?;
    for (kind, record, version) in read {
        Arc::make_mut(&mut session.source_versions)
            .insert(record.location.rel_path.clone(), version);
        associated_specs::accept_read_record(&mut session, kind, record);
    }
    if let Some((draft, actual)) = description {
        draft.accept(&mut session, CsvTableKey::Descriptions, actual)?;
    }
    draft.accept(&mut session, table, actual)?;
    let mut result = WriteResult::new(changes, mapping, None);
    for mut identity in identities {
        identity.after.linked_record = csv_tables::loaded_registered_csv_rows(&session, table)?
            .iter()
            .find(|row| {
                !row.is_comment
                    && row.data.get("id").and_then(Value::as_str) == Some(&identity.after.id)
            })
            .map(|row| EntityLinkedRecord::Csv {
                table,
                row_key: row.row_key.clone(),
            });
        result.identity_changes.push(identity);
    }
    Ok(result)
}
pub fn prepare_csv_save(input: &mut CsvSave, _edits: &[SaveEdit]) -> AppResult<()> {
    let handle = session_handle(&input.session_id)?;
    let mut session = lock_session(&handle)?;
    csv_tables::ensure_registered_table_rows(&mut session, input.table)?;
    let relative = model::csv_table_spec(input.table).rel_path;
    if let Some(version) = session.source_versions.get(relative) {
        input
            .base_versions
            .retain(|old| windows_path_key(&old.path) != windows_path_key(&version.path));
        input.base_versions.push(version.clone());
    }
    Ok(())
}
pub fn write_csv_request(input: CsvSave) -> AppResult<WriteResult<Value>> {
    entity_targets::require_csv_version_scope(
        &input.session_id,
        input.table,
        &input.base_versions,
    )?;
    for spec in &input.associated_specs {
        let required = &spec.target.write.path;
        if !input
            .base_versions
            .iter()
            .any(|version| windows_path_key(&version.path) == windows_path_key(required))
        {
            return Err(AppError::message(
                "write.version_scope_missing",
                "关联规格缺少读取版本凭据",
            )
            .at_path(required));
        }
    }
    let saved = input
        .patches
        .iter()
        .filter(|patch| matches!(patch.action, CsvRowPatchAction::Upsert))
        .map(|patch| patch.row_key.clone())
        .collect::<Vec<_>>();
    let result = save_csv_patch_snapshot(
        &input.session_id,
        input.table,
        input.patches,
        input.associated_specs,
        input.json_write,
        input.row_order,
    )?;
    let handle = session_handle(&input.session_id)?;
    let session = lock_session(&handle)?;
    let table = csv_tables::registered_session_table(&session, input.table)?;
    let saved = saved
        .iter()
        .map(|key| {
            result
                .key_map
                .iter()
                .find(|entry| entry.previous_key == *key)
                .map(|entry| entry.next_key.as_str())
                .unwrap_or(key)
        })
        .collect::<Vec<_>>();
    let rows = csv_tables::loaded_csv_rows(table, input.table.as_str())?
        .iter()
        .filter(|row| saved.contains(&row.row_key.as_str()))
        .map(|row| CsvRowRecord {
            row_key: row.row_key.clone(),
            data: row.data.clone(),
            is_comment: row.is_comment,
        })
        .collect();
    let source = table.source.as_ref().expect("saved table source");
    let version = FileVersion {
        path: Path::new(&session.manifest.mod_root)
            .join(&table.path)
            .to_string_lossy()
            .into_owned(),
        fingerprint: Some(io::fingerprint(source.document.source.as_bytes())),
    };
    let output = CsvTableRowsRead {
        table: input.table,
        base_versions: vec![version],
        rows,
    };
    Ok(result.with_content(
        WriteContentTarget::Csv { table: input.table },
        serde_json::to_value(output)?,
    ))
}

#[cfg(test)]
mod tests {
    use crate::domain::schema;
    use crate::test_support::file_formats;
    use std::mem;

    use crate::domain::entity_construction::create_associated_spec;
    use crate::domain::entity_definitions::associated_spec_definition;
    use crate::services::project_sync::release_project_session;
    use crate::test_support::file_formats::{
        prepared_spec_write, read_json_value as read_json_file, save_csv_patch,
        save_csv_patch_with_json_options,
    };

    use super::*;
    #[cfg(test)]
    use crate::io;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::models::{
        AssociatedSpecChange, AssociatedSpecCreateParams, CsvRowPatch, CsvRowPatchAction,
        CsvSearchField, FileChangeKind, FileChangeRecord,
    };
    #[cfg(test)]
    use crate::models::{
        CsvSave, EntityKind, EntityLinkedRecord, FileChangeReplayDirection, JsonWriteOptions,
        SaveAction, WeaponSpecClass,
    };
    #[cfg(test)]
    use crate::services::project::performance::PerformanceTrace;
    use crate::services::project::query::csv_window::query_csv_table_window;
    use crate::services::project::query::source_catalog::values;
    #[cfg(test)]
    use crate::services::project::query::{csv_window, entity_targets};
    use crate::services::project::session::open_project_session_traced;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::project::{model, session};
    #[cfg(test)]
    use crate::services::{project_save, write_transactions};
    use serde_json::{Map, Value};
    #[cfg(test)]
    use std::fs;
    use std::path::Path;
    fn apply_csv_row_patches(
        table: CsvTableKey,
        rows: &mut Vec<SessionCsvRow>,
        sequence: &mut u64,
        patches: Vec<CsvRowPatch>,
    ) -> AppResult<Vec<CsvRowKeyMapping>> {
        let mut draft = CsvTableDraft {
            header: Vec::new(),
            rows: mem::take(rows),
            next_row_seq: *sequence,
            source: Arc::new(game::read_csv(b"").unwrap()),
            table: Some(table),
        };
        let mapping = apply_rows(table, &mut draft, patches)?;
        *rows = draft.rows;
        *sequence = draft.next_row_seq;
        Ok(mapping)
    }

    #[test]
    fn all_associated_formats_save_and_replay_with_business_columns_preserved() {
        let cases = [
            AssociatedSpecCreateParams::Ship {
                id: "ship".into(),
                hull_name: "Ship".into(),
            },
            AssociatedSpecCreateParams::Weapon {
                id: "projectile".into(),
                spec_class: WeaponSpecClass::Projectile,
            },
            AssociatedSpecCreateParams::Weapon {
                id: "beam".into(),
                spec_class: WeaponSpecClass::Beam,
            },
            AssociatedSpecCreateParams::System {
                id: "system".into(),
            },
            AssociatedSpecCreateParams::Skill { id: "skill".into() },
        ];
        for create in cases {
            let root = project_workspace("associated_format_business_replay");
            let table = create.table();
            let definition = associated_spec_definition(table).unwrap();
            let csv_rel = model::csv_table_spec(table).rel_path;
            let csv_path = root.join(csv_rel);
            fs::create_dir_all(csv_path.parent().unwrap()).unwrap();
            let before = "id,name,_rowKey,_faction,_insertAt,_sourceRowIndex\n";
            write_utf8_no_bom(&csv_path, before).unwrap();
            let mut trace = PerformanceTrace::new("project.openSession");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            let content = serde_json::json!({"id":create.id(),"name":"Name","_rowKey":"business-key","_faction":"business-faction","_insertAt":"001","_sourceRowIndex":"02"});
            let expected = create_associated_spec(&create);
            let spec_path = root.join(definition.default_rel_path(create.id()));
            let saved = save_csv_patch(
                &manifest.session_id,
                table,
                vec![CsvRowPatch {
                    columns: (content.as_object().unwrap().clone())
                        .keys()
                        .cloned()
                        .collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: format!("{}:new:1", table.as_str()),
                    action: CsvRowPatchAction::Upsert,
                    row: content.as_object().unwrap().clone(),
                }],
                vec![AssociatedSpecChange::Create { create }],
            )
            .unwrap();
            assert_eq!(saved.changes.len(), 2);
            let schema = (table != CsvTableKey::Skills).then(|| {
                parsers::bundled_schema(match table {
                    CsvTableKey::Ships => "spec-ship",
                    CsvTableKey::Weapons => "spec-weapon",
                    CsvTableKey::ShipSystems => "spec-system",
                    _ => unreachable!(),
                })
            });
            let expected = schema
                .map(|schema| {
                    schema::prepare_document(&expected, schema)
                        .unwrap()
                        .value
                        .to_json()
                        .unwrap()
                })
                .unwrap_or(expected);
            assert_eq!(read_json_file(&spec_path).unwrap(), expected);
            let window = query_csv_table_window(
                &manifest.session_id,
                table,
                0,
                10,
                None,
                CsvSearchField::IdName,
            )
            .unwrap();
            assert_eq!(window.rows[0].data, *content.as_object().unwrap());
            assert_ne!(window.rows[0].row_key, "business-key");
            let csv = read_utf8_no_bom(&csv_path).unwrap();
            let replay = io::acquire_root_write_lock(&root).unwrap();
            replay
                .apply_changes(&saved.changes, FileChangeReplayDirection::Undo)
                .unwrap();
            assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), before);
            assert!(!spec_path.exists());
            replay
                .apply_changes(&saved.changes, FileChangeReplayDirection::Redo)
                .unwrap();
            assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv);
            assert_eq!(read_json_file(&spec_path).unwrap(), expected);
            release_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn command_renames_nested_associated_targets_and_replays_case_only_names() {
        for next_id in ["Next", "demo"] {
            let root = project_workspace("csv_nested_identity_command");
            let directory = root.join("data/weapons/nested");
            fs::create_dir_all(&directory).unwrap();
            let csv_path = root.join("data/weapons/weapon_data.csv");
            write_utf8_no_bom(&csv_path, "id,custom\nDemo,keep\n").unwrap();
            write_utf8_no_bom(
                &directory.join("Demo.wpn"),
                "{id:'Demo',specClass:'projectile',custom:{'_key':1}}\n",
            )
            .unwrap();
            let mut trace = PerformanceTrace::new("project.openSession");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            let info = entity_targets::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Weapon,
                "Demo",
            )
            .unwrap();
            let intent = entity_targets::query_entity_identity_intent(
                &manifest.session_id,
                &info.target,
                next_id,
            )
            .unwrap();
            let window = query_csv_table_window(
                &manifest.session_id,
                CsvTableKey::Weapons,
                0,
                10,
                None,
                CsvSearchField::IdName,
            )
            .unwrap();
            let mut row = window.rows[0].data.clone();
            row.insert("id".into(), Value::String(next_id.to_string()));
            let mut base_versions = info.base_versions;
            if !base_versions.iter().any(|version| {
                io::same_physical_path(
                    Path::new(&version.path),
                    Path::new(&intent.destination_version.path),
                )
            }) {
                base_versions.push(intent.destination_version);
            }
            let saved = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
                row_order: None,
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions,
                table: CsvTableKey::Weapons,
                patches: vec![CsvRowPatch {
                    columns: (row).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    row_key: window.rows[0].row_key.clone(),
                    insert_at: None,
                    action: CsvRowPatchAction::Upsert,
                    row,
                }],
                associated_specs: vec![
                    prepared_spec_write(
                        &manifest.session_id,
                        CsvTableKey::Weapons,
                        AssociatedSpecChange::Rename {
                            previous_id: "Demo".into(),
                            create: AssociatedSpecCreateParams::Weapon {
                                id: next_id.into(),
                                spec_class: WeaponSpecClass::Projectile,
                            },
                        },
                    )
                    .unwrap(),
                ],
                json_write: Default::default(),
            }))
            .unwrap();
            let actual_name = || {
                fs::read_dir(&directory)
                    .unwrap()
                    .next()
                    .unwrap()
                    .unwrap()
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            };
            assert_eq!(actual_name(), format!("{next_id}.wpn"));
            assert_eq!(
                read_json_file(&directory.join(format!("{next_id}.wpn"))).unwrap()["custom"]["_key"],
                1
            );
            assert_eq!(
                file_formats::read_csv_table(&csv_path).unwrap().rows[0].data["custom"],
                "keep"
            );
            let next = entity_targets::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Weapon,
                next_id,
            )
            .unwrap();
            assert_eq!(saved.base_versions, next.base_versions);
            assert_eq!(saved.identity_changes[0].after, next.target);
            let undone = write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack[0].id,
                saved.history.revision,
            )
            .unwrap();
            assert_eq!(actual_name(), "Demo.wpn");
            assert_eq!(
                file_formats::read_csv_table(&csv_path).unwrap().rows[0].data["id"],
                "Demo"
            );
            write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undone.history.redo_stack[0].id,
                undone.history.revision,
            )
            .unwrap();
            assert_eq!(actual_name(), format!("{next_id}.wpn"));
            release_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn pulse_associated_rename_rejects_the_whole_csv_changeset() {
        let root = project_workspace("pulse_associated_rename");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let csv_path = root.join("data/weapons/weapon_data.csv");
        let spec_path = root.join("data/weapons/old.wpn");
        let csv = "id,name\nold,Old\n";
        let spec = r#"{"id":"old","specClass":"pulse","nested":{"_field":1}}"#;
        write_utf8_no_bom(&csv_path, csv).unwrap();
        write_utf8_no_bom(&spec_path, spec).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let error = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (row_with_id("id", "new")).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row: row_with_id("id", "new"),
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old".into(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new".into(),
                    spec_class: WeaponSpecClass::Beam,
                },
            }],
        )
        .unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv);
        assert_eq!(read_utf8_no_bom(&spec_path).unwrap(), spec);
        assert!(!root.join("data/weapons/new.wpn").exists());
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn ordered_csv_command_preserves_keys_comments_and_file_history() {
        let root = project_workspace("csv_order_command");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        let before = "id,name,custom\na,Alpha,001\n#note,Comment,002\n,,\nb,Beta,003\n";
        write_utf8_no_bom(&path, before).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let keys: Vec<_> = window.rows.iter().map(|row| row.row_key.clone()).collect();
        for order in [vec![0, 0, 2, 3], vec![0, 1, 2], vec![0, 1, 2, 9]] {
            let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
                row_order: Some(
                    order
                        .into_iter()
                        .map(|index| {
                            keys.get(index)
                                .cloned()
                                .unwrap_or_else(|| "ships:row:unknown".into())
                        })
                        .collect(),
                ),
                base_versions: window.base_versions.clone(),
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                table: CsvTableKey::Ships,
                patches: vec![],
                associated_specs: vec![],
                json_write: Default::default(),
            }));
            assert!(result.is_err());
            assert_eq!(read_utf8_no_bom(&path).unwrap(), before);
        }
        let saved = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
            row_order: Some(vec![
                keys[3].clone(),
                "ships:new:1".into(),
                keys[1].clone(),
                keys[2].clone(),
                keys[0].clone(),
            ]),
            base_versions: window.base_versions.clone(),
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            table: CsvTableKey::Ships,
            patches: vec![CsvRowPatch {
                columns: (serde_json::json!({"id":"new","name":"New","custom":"004"})
                    .as_object()
                    .unwrap()
                    .clone())
                .keys()
                .cloned()
                .collect(),
                comment_changed: true,

                row_key: "ships:new:1".into(),
                insert_at: None,
                action: CsvRowPatchAction::Upsert,
                row: serde_json::json!({"id":"new","name":"New","custom":"004"})
                    .as_object()
                    .unwrap()
                    .clone(),
                is_comment: false,
            }],
            associated_specs: vec![],
            json_write: Default::default(),
        }))
        .unwrap();
        let text = read_utf8_no_bom(&path).unwrap();
        assert_eq!(
            text,
            "id,name,custom\nb,Beta,003\nnew,New,004\n#note,Comment,002\n,,\na,Alpha,001\n"
        );
        assert_eq!(saved.key_map[0].row_index, 1);
        let reordered = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(reordered.rows[0].row_key, keys[3]);
        assert_eq!(reordered.rows[4].row_key, keys[0]);
        assert!(reordered.rows[2].is_comment);
        let entry = saved.history.undo_stack.last().unwrap().id;
        let undone = write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            entry,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(read_utf8_no_bom(&path).unwrap(), before);
        write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            entry,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(read_utf8_no_bom(&path).unwrap(), text);
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn command_preserves_comment_identity_through_queries_save_and_replay() {
        let root = project_workspace("csv_comment_command");
        let hulls = root.join("data/hulls");
        fs::create_dir_all(&hulls).unwrap();
        let path = hulls.join("ship_data.csv");
        write_utf8_no_bom(&path, "name,id,notes\n#disabled,same,note\n\"#quoted\",same,note\n #space,space,note\n\t#tab,tab,note\nactive,later,#later\n,empty,#later\n").unwrap();
        for id in ["same", "space", "tab", "later", "empty"] {
            write_utf8_no_bom(
                &hulls.join(format!("{id}.ship")),
                &format!("{{hullId:'{id}',spriteName:'graphics/{id}.png'}}"),
            )
            .unwrap();
        }
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        assert_eq!(manifest.table_entity_summaries[&CsvTableKey::Ships], 5);
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(
            window
                .rows
                .iter()
                .map(|row| row.is_comment)
                .collect::<Vec<_>>(),
            [true, false, false, false, false, false]
        );
        let info = entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "same",
        )
        .unwrap();
        assert!(
            matches!(info.target.linked_record, Some(EntityLinkedRecord::Csv { row_key, .. }) if row_key == window.rows[1].row_key)
        );
        assert!(
            csv_window::query_csv_row_preview(
                &manifest.session_id,
                CsvTableKey::Ships,
                &window.rows[0].row_key
            )
            .unwrap()
            .resource_ref
            .is_none()
        );
        assert!(
            csv_window::query_csv_row_preview(
                &manifest.session_id,
                CsvTableKey::Ships,
                &window.rows[1].row_key
            )
            .unwrap()
            .resource_ref
            .is_some()
        );
        let catalog =
            values::query_source_option_catalog(&manifest.session_id, "csv:ships.id").unwrap();
        assert_eq!(
            catalog[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["same", "space", "tab", "later", "empty"]
        );
        let mut data = window.rows[1].data.clone();
        data.insert("name".into(), Value::String("#edited".into()));
        let saved = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
            row_order: None,
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            base_versions: window.base_versions,
            table: CsvTableKey::Ships,
            patches: vec![CsvRowPatch {
                columns: (data).keys().cloned().collect(),
                comment_changed: true,

                row_key: window.rows[1].row_key.clone(),
                is_comment: false,
                action: CsvRowPatchAction::Upsert,
                row: data,
                insert_at: None,
            }],
            associated_specs: Vec::new(),
            json_write: Default::default(),
        }))
        .unwrap();
        assert!(
            read_utf8_no_bom(&path)
                .unwrap()
                .contains("\"#edited\",same,note")
        );
        let rows = file_formats::read_csv_table(&path).unwrap().rows;
        assert!(rows[0].is_comment);
        assert!(!rows[1].is_comment);
        assert_eq!(rows[0].data["name"], "#disabled");
        let entry = saved.history.undo_stack.last().unwrap().id;
        let undone = write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            entry,
            saved.history.revision,
        )
        .unwrap();
        let rows = file_formats::read_csv_table(&path).unwrap().rows;
        assert_eq!(rows[1].data["name"], "#quoted");
        assert!(!rows[1].is_comment);
        write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            entry,
            undone.history.revision,
        )
        .unwrap();
        let replayed = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(replayed.rows[1].data["name"], "#edited");
        assert!(!replayed.rows[1].is_comment);
        release_project_session(manifest.session_id).unwrap();
        let mut reopened_trace = PerformanceTrace::new("project.openSession");
        let reopened = open_project_session_traced(&root, None, &mut reopened_trace).unwrap();
        assert_eq!(reopened.table_entity_summaries[&CsvTableKey::Ships], 5);
        release_project_session(reopened.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn save_csv_patch_creates_associated_spec_in_one_changeset() {
        let root = project_workspace("save_csv_patch_create_assoc");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("new_ship".to_string()));
        row.insert("name".to_string(), Value::String("New Ship".to_string()));
        let session_id = manifest.session_id.clone();
        let result = save_csv_patch(
            &session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                columns: (row.clone()).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: "ships:new:1".to_string(),
                action: CsvRowPatchAction::Upsert,
                row: row.clone(),
            }],
            vec![AssociatedSpecChange::Create {
                create: AssociatedSpecCreateParams::Ship {
                    id: "new_ship".to_string(),
                    hull_name: "New Ship".to_string(),
                },
            }],
        )
        .unwrap();

        let csv = read_utf8_no_bom(&root.join("data/hulls/ship_data.csv")).unwrap();
        let spec = read_utf8_no_bom(&root.join("data/hulls/new_ship.ship")).unwrap();
        let expected_paths = [
            path_string(root.join("data/hulls/ship_data.csv")),
            path_string(root.join("data/hulls/new_ship.ship")),
        ];

        let _ = release_project_session(session_id);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(matches!(result.changes[0].kind, FileChangeKind::File));
        assert!(matches!(result.changes[1].kind, FileChangeKind::File));
        assert_eq!(result.key_map[0].previous_key, "ships:new:1");
        assert!(csv.contains("new_ship,New Ship"));
        assert!(spec.contains("\"hullId\": \"new_ship\""));
        root.close().unwrap();
    }

    #[test]
    fn save_refresh_preserves_surviving_and_new_row_keys_across_followup_saves() {
        let root = project_workspace("csv_save_refresh_row_keys");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\na,A\nb,B\nc,C\n#note,Keep\n,No ID\nb,Duplicate\n",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let survivor_key = window.rows[1].row_key.clone();
        let comment_key = window.rows[3].row_key.clone();
        let empty_id_key = window.rows[4].row_key.clone();
        let duplicate_key = window.rows[5].row_key.clone();
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: window.rows[0].row_key.clone(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "d")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:0".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
            Vec::new(),
        )
        .unwrap();
        let new_key = result.key_map[0].next_key.clone();
        session::invalidate_project_session(&manifest.session_id, result.changes).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(window.rows[0].row_key, survivor_key);
        assert_eq!(window.rows[2].row_key, comment_key);
        assert_eq!(window.rows[3].row_key, empty_id_key);
        assert_eq!(window.rows[4].row_key, duplicate_key);
        assert_eq!(window.rows[5].row_key, new_key);
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                columns: (row_with_id("id", "b2")).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: survivor_key,
                action: CsvRowPatchAction::Upsert,
                row: row_with_id("id", "b2"),
            }],
            Vec::new(),
        )
        .unwrap();
        session::invalidate_project_session(&manifest.session_id, result.changes).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(window.rows[0].data["id"], "b2");
        assert_eq!(window.rows[1].data["id"], "c");
        assert_eq!(window.rows[4].data["id"], "b");
        assert_eq!(window.rows[4].row_key, duplicate_key);
        assert_eq!(window.rows[5].row_key, new_key);
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn save_csv_patch_deletes_associated_spec_in_one_changeset() {
        let root = project_workspace("save_csv_patch_delete_assoc");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\r\n  \"id\": \"old_weapon\"\r\n}",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (Map::new()).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Delete,
                row: Map::new(),
            }],
            vec![AssociatedSpecChange::Delete {
                id: "old_weapon".to_string(),
            }],
        )
        .unwrap();

        let csv = read_utf8_no_bom(&root.join("data/weapons/weapon_data.csv")).unwrap();
        let spec_exists = root.join("data/weapons/old_weapon.wpn").exists();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/old_weapon.wpn")),
        ];

        let _ = release_project_session(manifest.session_id);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(!result.changes[1].after_exists);
        assert!(!csv.contains("old_weapon,Old Weapon"));
        assert!(!spec_exists);
        root.close().unwrap();
    }

    #[test]
    fn save_csv_patch_renames_associated_spec_through_json_parser() {
        let root = project_workspace("save_csv_patch_rename_assoc_parser");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\r\n  specClass: projectile, id: 'old_weapon',\r\n  weaponType: BALLISTIC,\r\n}\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (row).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: WeaponSpecClass::Projectile,
                },
            }],
        )
        .unwrap();

        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/old_weapon.wpn")),
            path_string(root.join("data/weapons/new_weapon.wpn")),
        ];

        let _ = release_project_session(manifest.session_id);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(result.changes[1].before_exists);
        assert!(result.changes[1].after_exists);
        assert!(!renamed.contains("old_weapon"));
        assert!(renamed.contains("\"id\": \"new_weapon\""));
        assert_eq!(
            read_json_file(&root.join("data/weapons/new_weapon.wpn")).unwrap()["weaponType"],
            "BALLISTIC"
        );
        root.close().unwrap();
    }

    #[test]
    fn csv_associated_rename_preserves_spec_comments() {
        let root = project_workspace("csv_associated_rename_preserves_json");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\nold_weapon,Old Weapon\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/old_weapon.wpn"),
            "{\n  # note\n  weaponType: BALLISTIC,\n  specClass: projectile, id: 'old_weapon'\n}\n",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (row).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: WeaponSpecClass::Projectile,
                },
            }],
            JsonWriteOptions {
                replace_paths: Vec::new(),
                keep_filename: false,
                preserve_structure: true,
            },
        )
        .unwrap();
        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(renamed.contains("# note"));
        assert!(renamed.find("weaponType").unwrap() < renamed.find("id:").unwrap());
        assert!(!root.join("data/weapons/old_weapon.wpn").exists());
        let _ = release_project_session(manifest.session_id);
        root.close().unwrap();
    }

    #[test]
    fn csv_and_spec_preserve_null_slots_during_associated_rename() {
        let root = project_workspace("csv_spec_rewrite_confirmation");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let csv_path = root.join("data/weapons/weapon_data.csv");
        let spec_path = root.join("data/weapons/old_weapon.wpn");
        let csv_before = "id,name\nold_weapon,Old Weapon\n";
        let spec_before = "{id:'old_weapon', specClass:projectile, turretOffsets:[0,0], hardpointOffsets:[0,0], arr:[1,,2]}\n";
        write_utf8_no_bom(&csv_path, csv_before).unwrap();
        write_utf8_no_bom(&spec_path, spec_before).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch_with_json_options(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (row).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "old_weapon".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: WeaponSpecClass::Projectile,
                },
            }],
            JsonWriteOptions {
                replace_paths: Vec::new(),
                keep_filename: false,
                preserve_structure: true,
            },
        );
        result.unwrap();
        assert!(read_utf8_no_bom(&csv_path).unwrap().contains("new_weapon"));
        assert!(!spec_path.exists());
        let rewritten = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        assert!(rewritten.contains("arr:[1,,2]"));
        let _ = release_project_session(manifest.session_id);
        root.close().unwrap();
    }

    #[test]
    fn save_csv_patch_rename_missing_source_uses_registered_default_spec() {
        let root = project_workspace("save_csv_patch_rename_missing_content");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name\r\nold_weapon,Old Weapon\r\n",
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let window = query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Weapons,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let mut row = window.rows[0].data.clone();
        row.insert("id".to_string(), Value::String("new_weapon".to_string()));
        let result = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Weapons,
            vec![CsvRowPatch {
                columns: (row).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: window.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            vec![AssociatedSpecChange::Rename {
                previous_id: "missing".to_string(),
                create: AssociatedSpecCreateParams::Weapon {
                    id: "new_weapon".to_string(),
                    spec_class: WeaponSpecClass::Projectile,
                },
            }],
        )
        .unwrap();
        let created = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        let expected_paths = [
            path_string(root.join("data/weapons/weapon_data.csv")),
            path_string(root.join("data/weapons/new_weapon.wpn")),
        ];

        let _ = release_project_session(manifest.session_id);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(!result.changes[1].before_exists);
        assert!(result.changes[1].after_exists);
        assert!(created.contains("\"id\": \"new_weapon\""));
        root.close().unwrap();
    }

    #[test]
    fn save_csv_patch_rejects_unknown_non_new_row_key() {
        let root = project_workspace("save_csv_patch_unknown_row_key");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let mut row = Map::new();
        row.insert("id".to_string(), Value::String("new_ship".to_string()));
        let error = save_csv_patch(
            &manifest.session_id,
            CsvTableKey::Ships,
            vec![CsvRowPatch {
                columns: (row).keys().cloned().collect(),
                comment_changed: true,

                is_comment: false,
                insert_at: None,
                row_key: "ships:row:missing:new:1".to_string(),
                action: CsvRowPatchAction::Upsert,
                row,
            }],
            Vec::new(),
        )
        .unwrap_err()
        .to_string();

        let _ = release_project_session(manifest.session_id);
        assert!(error.contains("新增的 CSV 行标识无效"));
        root.close().unwrap();
    }

    #[test]
    fn apply_csv_row_patches_allocates_uncolliding_key_after_delete() {
        let mut rows = vec![
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "c")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
            ],
        )
        .unwrap();

        assert_eq!(key_map.len(), 1);
        assert_eq!(key_map[0].previous_key, "ships:new:1");
        assert_eq!(key_map[0].next_key, "ships:row:2");
        assert_eq!(row_keys(&rows), vec!["ships:row:1", "ships:row:2"]);
        assert_eq!(next_row_seq, 3);
    }

    #[test]
    fn apply_csv_row_patches_updates_surviving_row_after_delete_without_new_keys() {
        let mut rows = vec![
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "b2")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "b2"),
                },
            ],
        )
        .unwrap();

        assert!(key_map.is_empty());
        assert_eq!(next_row_seq, 2);
        assert_eq!(row_keys(&rows), vec!["ships:row:1"]);
        assert_eq!(rows[0].data["id"], "b2");
    }

    #[test]
    fn apply_csv_row_patches_keeps_keys_unique_across_interleaved_patches() {
        let mut rows = vec![
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    columns: (row_with_id("id", "c")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "d")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:2".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
        )
        .unwrap();

        let allocated: Vec<&str> = key_map
            .iter()
            .map(|mapping| mapping.next_key.as_str())
            .collect();
        assert_eq!(allocated, vec!["ships:row:2", "ships:row:3"]);
        let mut all_keys = row_keys(&rows);
        all_keys.sort_unstable();
        assert_eq!(all_keys, vec!["ships:row:0", "ships:row:2", "ships:row:3"]);
    }

    #[test]
    fn apply_csv_row_patches_does_not_reset_keys_after_full_table_delete() {
        let mut rows = vec![
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
                source_row: None,
                is_comment: false,
                row_key: "ships:row:1".to_string(),
                data: row_with_id("id", "b"),
            },
        ];
        let mut next_row_seq = 2;

        let key_map = apply_csv_row_patches(
            CsvTableKey::Ships,
            &mut rows,
            &mut next_row_seq,
            vec![
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (Map::new()).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "c")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    columns: (row_with_id("id", "d")).keys().cloned().collect(),
                    comment_changed: true,

                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:2".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "d"),
                },
            ],
        )
        .unwrap();

        let allocated: Vec<&str> = key_map
            .iter()
            .map(|mapping| mapping.next_key.as_str())
            .collect();
        assert_eq!(allocated, vec!["ships:row:2", "ships:row:3"]);
        assert_eq!(row_keys(&rows), vec!["ships:row:2", "ships:row:3"]);
        assert_eq!(next_row_seq, 4);
    }

    fn row_keys(rows: &[SessionCsvRow]) -> Vec<&str> {
        rows.iter().map(|row| row.row_key.as_str()).collect()
    }

    fn row_with_id(field: &str, id: &str) -> Map<String, Value> {
        let mut row = Map::new();
        row.insert(field.to_string(), Value::String(id.to_string()));
        row
    }

    fn change_paths(changes: &[FileChangeRecord]) -> Vec<String> {
        let mut paths = Vec::new();
        for change in changes {
            for path in [&change.before_path, &change.after_path] {
                if !paths.contains(path) {
                    paths.push(path.clone());
                }
            }
        }
        paths
    }

    fn path_string(path: impl AsRef<Path>) -> String {
        let path = path.as_ref();
        if let Ok(canonical) = path.canonicalize() {
            return canonical.to_string_lossy().to_string();
        }
        if let (Some(parent), Some(name)) = (path.parent(), path.file_name())
            && let Ok(canonical_parent) = parent.canonicalize()
        {
            return canonical_parent.join(name).to_string_lossy().to_string();
        }
        path.to_string_lossy().to_string()
    }
}
