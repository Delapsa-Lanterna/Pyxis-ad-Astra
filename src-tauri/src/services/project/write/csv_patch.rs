#[cfg(test)]
use super::super::definitions::entity_definitions::associated_spec_definition;
use super::super::model::SessionCsvRow;
use super::super::session::csv_tables::{
    ensure_registered_table_rows, loaded_registered_csv_rows, registered_session_table,
};
use super::super::session::csv_writes::CsvTableDraft;
use super::super::session::{lock_session, session_handle};
#[cfg(test)]
use crate::domain::entity_construction::create_associated_spec;
use crate::domain::save_edits;
use crate::errors::{AppError, AppResult};
use crate::io::{FileChangeSetBuilder, JsonWriteBatch, acquire_root_write_lock};
#[cfg(test)]
use crate::io::{csv_files, read_json_file};
#[cfg(test)]
use crate::models::{AssociatedSpecChange, AssociatedSpecMode, AssociatedSpecResolution};
use crate::models::{
    AssociatedSpecWrite, CsvRowKeyMapping, CsvRowOrderEntry, CsvRowPatch, CsvRowPatchAction,
    CsvSave, CsvSearchField, CsvTableKey, EntityLinkedRecord, JsonWriteOptions, SaveEdit,
    WriteContentTarget, WriteResult, windows_path_key,
};
use crate::services::save_csv_patch_snapshot as save_csv_patch_via_service;
use crate::services::{
    query_csv_table_index, query_csv_table_rows, require_csv_version_scope,
    require_entity_version_scope,
};

#[cfg(test)]
use crate::services::project::query::csv_associated_specs;
use crate::services::project::query::entity_targets;
use crate::services::project::write::entity_write::{associated_specs, descriptions};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use std::{mem, slice};

#[cfg(test)]
pub fn save_csv_patch(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecChange>,
) -> AppResult<WriteResult> {
    save_csv_patch_with_json_options(
        session_id,
        table,
        patches,
        associated_specs,
        JsonWriteOptions::default(),
    )
}

#[cfg(test)]
pub fn save_csv_patch_with_json_options(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecChange>,
    options: JsonWriteOptions,
) -> AppResult<WriteResult> {
    let associated = associated_specs
        .into_iter()
        .map(|change| prepared_spec_write(session_id, table, change))
        .collect::<AppResult<Vec<_>>>()?;
    save_csv_patch_snapshot(session_id, table, patches, associated, options, None)
}

#[cfg(test)]
pub(in crate::services::project) fn prepared_spec_write(
    session_id: &str,
    table: CsvTableKey,
    change: AssociatedSpecChange,
) -> AppResult<AssociatedSpecWrite> {
    let prepared = csv_associated_specs::prepare_csv_associated_specs(
        session_id,
        table,
        slice::from_ref(&change),
    )?
    .remove(0);
    let resolution = (!matches!(change, AssociatedSpecChange::Delete { .. })).then_some(
        AssociatedSpecResolution {
            mode: AssociatedSpecMode::Overwrite,
            original: prepared.original,
            destination: prepared.destination,
        },
    );
    Ok(AssociatedSpecWrite {
        change,
        target: prepared.target,
        resolution,
    })
}

pub fn save_csv_patch_snapshot(
    session_id: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    associated_specs: Vec<AssociatedSpecWrite>,
    options: JsonWriteOptions,
    row_order: Option<Vec<CsvRowOrderEntry>>,
) -> AppResult<WriteResult> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    // Acquire the root before retaining session state throughout the write.
    let write_lock = acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let (mod_root, header, mut rows, mut next_row_seq) = {
        let table_data = registered_session_table(&session, table)?;
        (
            session.manifest.mod_root.clone(),
            table_data.header.clone(),
            loaded_registered_csv_rows(&session, table)?.to_vec(),
            table_data.next_row_seq,
        )
    };
    #[cfg(test)]
    csv_files::record_csv_row_copies(rows.len());
    let mut key_map = apply_csv_row_patches(table, &mut rows, &mut next_row_seq, patches)?;
    if let Some(order) = row_order {
        apply_csv_row_order(&mut rows, &key_map, order)?;
        let positions: HashMap<_, _> = rows
            .iter()
            .enumerate()
            .map(|(index, row)| (row.row_key.as_str(), index))
            .collect();
        for mapping in &mut key_map {
            mapping.row_index = positions[mapping.next_key.as_str()];
        }
    }
    let mut builder = FileChangeSetBuilder::new_with_lock(Path::new(&mod_root), write_lock)?;
    let mut json = JsonWriteBatch::new(options);
    let csv = CsvTableDraft {
        table,
        header,
        rows,
        next_row_seq,
    }
    .stage(&session, &mut builder)?;
    let mut description_renames = Vec::new();
    let mut staged_identities = Vec::new();
    let mut read_records = Vec::new();
    for spec in &associated_specs {
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
            &mut json,
        )?;
        if let Some(rename) = staged.description_rename {
            description_renames.push(rename);
        }
        if let Some(record) = staged.read_record {
            read_records.push((
                spec.target.kind,
                record,
                spec.resolution
                    .as_ref()
                    .expect("read owns resolution")
                    .destination
                    .version
                    .clone(),
            ));
        }
        staged_identities.push(staged.identity);
    }
    let description = descriptions::prepare_description_renames(&session, &description_renames)?
        .map(|draft| draft.stage(&session, &mut builder))
        .transpose()?;
    json.finish()?;
    let changes = builder.apply()?;
    for (kind, record, version) in read_records {
        Arc::make_mut(&mut session.source_versions)
            .insert(record.location.rel_path.clone(), version);
        associated_specs::accept_read_record(&mut session, kind, record);
    }
    if let Some(description) = description {
        description.accept(&mut session);
    }
    csv.accept(&mut session);
    let mut write_result: WriteResult<()> = WriteResult::new(changes, key_map, None);
    for mut identity in staged_identities {
        let next = &mut identity.after;
        next.linked_record = loaded_registered_csv_rows(&session, table)?
            .iter()
            .find(|row| {
                !row.is_comment && row.data.get("id").and_then(Value::as_str) == Some(&next.id)
            })
            .map(|row| EntityLinkedRecord::Csv {
                table,
                row_key: row.row_key.clone(),
            });
        write_result.identity_changes.push(identity);
    }
    debug_assert!(
        write_result
            .invalidation
            .paths
            .iter()
            .all(|path| !path.is_empty())
    );
    debug_assert!(write_result.content.is_none());
    Ok(write_result)
}

fn apply_csv_row_patches(
    table: CsvTableKey,
    rows: &mut Vec<SessionCsvRow>,
    next_row_seq: &mut u64,
    patches: Vec<CsvRowPatch>,
) -> AppResult<Vec<CsvRowKeyMapping>> {
    let table_key = table.as_str();
    let mut key_map = Vec::new();
    for patch in patches {
        match patch.action {
            CsvRowPatchAction::Delete => {
                let index = rows
                    .iter()
                    .position(|row| row.row_key == patch.row_key)
                    .ok_or_else(|| {
                        AppError::message(
                            "table.row_key_unknown",
                            format!("CSV delete row key does not exist: {}", patch.row_key),
                        )
                    })?;
                rows.remove(index);
            }
            CsvRowPatchAction::Upsert => {
                if let Some(row) = rows.iter_mut().find(|row| row.row_key == patch.row_key) {
                    row.data = patch.row;
                    row.is_comment = patch.is_comment;
                } else if is_new_csv_row_key(table_key, &patch.row_key) {
                    let next_key = format!("{table_key}:row:{next_row_seq}");
                    *next_row_seq += 1;
                    key_map.push(CsvRowKeyMapping {
                        previous_key: patch.row_key,
                        next_key: next_key.clone(),
                        row_index: patch.insert_at.unwrap_or(rows.len()),
                    });
                    let index = patch.insert_at.unwrap_or(rows.len());
                    if index > rows.len() {
                        return Err(AppError::message(
                            "table.insert_position_invalid",
                            "CSV insertion position exceeds the current table",
                        ));
                    }
                    rows.insert(
                        index,
                        SessionCsvRow {
                            row_key: next_key,
                            data: patch.row,
                            is_comment: patch.is_comment,
                        },
                    );
                } else {
                    return Err(AppError::message(
                        "table.row_key_unknown",
                        format!("CSV upsert row key does not exist: {}", patch.row_key),
                    ));
                }
            }
        }
    }
    for mapping in &mut key_map {
        mapping.row_index = rows
            .iter()
            .position(|row| row.row_key == mapping.next_key)
            .expect("inserted row survives the submitted patch");
    }
    Ok(key_map)
}

fn apply_csv_row_order(
    rows: &mut Vec<SessionCsvRow>,
    key_map: &[CsvRowKeyMapping],
    order: Vec<CsvRowOrderEntry>,
) -> AppResult<()> {
    let invalid = || AppError::message("table.row_order_invalid", "CSV 行序与当前保存的记录不一致");
    if order.len() != rows.len() {
        return Err(invalid());
    }
    let added: HashMap<_, _> = key_map
        .iter()
        .map(|mapping| (mapping.previous_key.as_str(), mapping.next_key.as_str()))
        .collect();
    let mut available: HashMap<_, _> = mem::take(rows)
        .into_iter()
        .map(|row| (row.row_key.clone(), row))
        .collect();
    for entry in order {
        let key = added.get(entry.as_str()).copied().unwrap_or(entry.as_str());
        rows.push(available.remove(key).ok_or_else(invalid)?);
    }
    Ok(())
}

fn is_new_csv_row_key(table_key: &str, row_key: &str) -> bool {
    let Some(rest) = row_key.strip_prefix(&format!("{table_key}:new:")) else {
        return false;
    };
    !rest.is_empty() && !rest.contains(':')
}

pub fn prepare_csv_save(input: &mut CsvSave, edits: &[SaveEdit]) -> Result<(), AppError> {
    let CsvSave {
        session_id,
        table,
        patches,
        base_versions,
        ..
    } = input;
    let index = query_csv_table_index(session_id, *table, 0, None, CsvSearchField::IdName)?;
    let keys = patches
        .iter()
        .filter(|patch| index.row_keys.contains(&patch.row_key))
        .map(|patch| patch.row_key.clone())
        .collect();
    let current = query_csv_table_rows(session_id, *table, keys)?;
    for patch in patches.iter_mut() {
        if let Some(row) = current.rows.iter().find(|row| row.row_key == patch.row_key) {
            let mut value = serde_json::json!({"data":row.data,"isComment":row.is_comment,"rowKey":row.row_key});
            save_edits::apply_save_edits_at(&mut value, edits, slice::from_ref(&patch.row_key));
            if matches!(patch.action, CsvRowPatchAction::Upsert) {
                patch.row = serde_json::from_value(value["data"].take())?;
                patch.is_comment = serde_json::from_value(value["isComment"].take())?;
            }
        }
    }
    for version in current.base_versions {
        base_versions.retain(|old| windows_path_key(&old.path) != windows_path_key(&version.path));
        base_versions.push(version);
    }
    Ok(())
}

pub fn write_csv_request(payload: CsvSave) -> Result<WriteResult<Value>, AppError> {
    require_csv_version_scope(&payload.session_id, payload.table, &payload.base_versions)?;
    for spec in &payload.associated_specs {
        require_entity_version_scope(
            &payload.session_id,
            spec.target.kind,
            &spec.target.id,
            &payload.base_versions,
        )?;
    }
    let saved_keys = payload
        .patches
        .iter()
        .filter(|patch| matches!(patch.action, CsvRowPatchAction::Upsert))
        .map(|patch| patch.row_key.clone())
        .collect::<Vec<_>>();
    let result = save_csv_patch_via_service(
        &payload.session_id,
        payload.table,
        payload.patches,
        payload.associated_specs,
        payload.json_write,
        payload.row_order,
    )?;
    let saved_keys = saved_keys
        .into_iter()
        .map(|key| {
            result
                .key_map
                .iter()
                .find(|mapping| mapping.previous_key == key)
                .map(|mapping| mapping.next_key.clone())
                .unwrap_or(key)
        })
        .collect();
    let saved_rows = query_csv_table_rows(&payload.session_id, payload.table, saved_keys)?;
    let result = result.with_content(
        WriteContentTarget::Csv {
            table: payload.table,
        },
        serde_json::to_value(saved_rows)?,
    );
    Ok(result)
}

#[cfg(test)]
mod tests {
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
    #[cfg(test)]
    use crate::services::project::query::{csv_window, entity_targets, source_options};
    use crate::services::project::session::{close_project_session, open_project_session_traced};
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::project::{PerformanceTrace as ProjectPerformanceTrace, model, session};
    #[cfg(test)]
    use crate::services::{project_save, write_transactions};
    use serde_json::{Map, Value};
    #[cfg(test)]
    use std::fs;
    use std::path::Path;

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
            close_project_session(manifest.session_id).unwrap();
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
            let mut trace = ProjectPerformanceTrace::new("project.openSession");
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
                io::read_csv_data(&csv_path).unwrap().rows[0].data["custom"],
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
                io::read_csv_data(&csv_path).unwrap().rows[0].data["id"],
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
            close_project_session(manifest.session_id).unwrap();
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
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn ordered_csv_command_preserves_keys_comments_and_file_history() {
        let root = project_workspace("csv_order_command");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        let before = "id,name,custom\na,Alpha,001\n#note,Comment,002\n,,\nb,Beta,003\n";
        write_utf8_no_bom(&path, before).unwrap();
        let mut trace = ProjectPerformanceTrace::new("project.openSession");
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
        close_project_session(manifest.session_id).unwrap();
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
        let mut trace = ProjectPerformanceTrace::new("project.openSession");
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
            source_options::query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();
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
        let rows = io::read_csv_data(&path).unwrap().rows;
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
        let rows = io::read_csv_data(&path).unwrap().rows;
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
        close_project_session(manifest.session_id).unwrap();
        let mut reopened_trace = ProjectPerformanceTrace::new("project.openSession");
        let reopened = open_project_session_traced(&root, None, &mut reopened_trace).unwrap();
        assert_eq!(reopened.table_entity_summaries[&CsvTableKey::Ships], 5);
        close_project_session(reopened.session_id).unwrap();
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

        let _ = close_project_session(session_id);
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
                    is_comment: false,
                    insert_at: None,
                    row_key: window.rows[0].row_key.clone(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
        close_project_session(manifest.session_id).unwrap();
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

        let _ = close_project_session(manifest.session_id);
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

        let _ = close_project_session(manifest.session_id);
        assert_eq!(change_paths(&result.changes), expected_paths);
        assert_eq!(result.invalidation.paths, change_paths(&result.changes));
        assert!(result.changes[1].before_exists);
        assert!(result.changes[1].after_exists);
        assert!(!renamed.contains("old_weapon"));
        assert!(renamed.contains("\"id\": \"new_weapon\""));
        assert!(renamed.contains("\"weaponType\": \"BALLISTIC\""));
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
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
        )
        .unwrap();
        let renamed = read_utf8_no_bom(&root.join("data/weapons/new_weapon.wpn")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(renamed.contains("# note"));
        assert!(renamed.find("weaponType").unwrap() < renamed.find("id:").unwrap());
        assert!(!root.join("data/weapons/old_weapon.wpn").exists());
        let _ = close_project_session(manifest.session_id);
        root.close().unwrap();
    }

    #[test]
    fn csv_and_spec_remain_unchanged_before_rewrite_confirmation() {
        let root = project_workspace("csv_spec_rewrite_confirmation");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let csv_path = root.join("data/weapons/weapon_data.csv");
        let spec_path = root.join("data/weapons/old_weapon.wpn");
        let csv_before = "id,name\nold_weapon,Old Weapon\n";
        let spec_before = "{id:'old_weapon', specClass:projectile, arr:[1,,2]}\n";
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
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
        );
        assert!(matches!(result, Err(AppError::JsonRewriteRequired { .. })));
        assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv_before);
        assert_eq!(read_utf8_no_bom(&spec_path).unwrap(), spec_before);
        assert!(!root.join("data/weapons/new_weapon.wpn").exists());
        let _ = close_project_session(manifest.session_id);
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

        let _ = close_project_session(manifest.session_id);
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

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("CSV upsert row key does not exist"));
        root.close().unwrap();
    }

    #[test]
    fn apply_csv_row_patches_allocates_uncolliding_key_after_delete() {
        let mut rows = vec![
            SessionCsvRow {
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
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
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
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
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
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
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
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
                is_comment: false,
                row_key: "ships:row:0".to_string(),
                data: row_with_id("id", "a"),
            },
            SessionCsvRow {
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
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:0".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:row:1".to_string(),
                    action: CsvRowPatchAction::Delete,
                    row: Map::new(),
                },
                CsvRowPatch {
                    is_comment: false,
                    insert_at: None,
                    row_key: "ships:new:1".to_string(),
                    action: CsvRowPatchAction::Upsert,
                    row: row_with_id("id", "c"),
                },
                CsvRowPatch {
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
