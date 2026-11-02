use super::file_history;
use crate::errors::{AppError, AppResult};
use crate::io::{
    FsRootBoundary, RootWriteLock, acquire_root_write_lock, verify_versions, version_after_change,
};
use crate::models::{
    EntityIdentityChange, FileChangeKind, FileChangeRecord, FileChangeReplayDirection,
    FileHistorySnapshot, FileVersion, SessionModScope, WriteResult, windows_path_key,
};
use crate::services::{app_settings, project};
use crate::{diagnostics, io, models, services};
use std::path::Path;

mod committed;

pub struct WriteTransaction {
    root: String,
    session_id: Option<String>,
    base_versions: Vec<FileVersion>,
    _lease: RootWriteLock,
}

pub fn begin(
    payload: &(impl SessionModScope + ?Sized),
    base: &[FileVersion],
) -> AppResult<WriteTransaction> {
    let mut transaction = acquire(payload.mod_root(), payload.session_id().map(String::as_str))?;
    app_settings::ensure_core_editing_allowed(&transaction.root)?;
    verify_versions(&transaction.root, base)?;
    transaction.base_versions = base.to_vec();
    Ok(transaction)
}

fn acquire(root: &str, session_id: Option<&str>) -> AppResult<WriteTransaction> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    if let Some(session_id) = session_id {
        project::ensure_project_session_mod_root(session_id, root)?;
    }
    let root = FsRootBoundary::new(Path::new(root), "write root")?
        .root()
        .to_string_lossy()
        .into_owned();
    Ok(WriteTransaction {
        root,
        session_id: session_id.map(str::to_string),
        base_versions: Vec::new(),
        _lease: lease,
    })
}

impl WriteTransaction {
    pub fn commit<T>(self, mut result: WriteResult<T>, label: &str) -> AppResult<WriteResult<T>> {
        let mut versions = self.base_versions.clone();
        for identity in &result.identity_changes {
            if identity.before.write.path != identity.after.write.path {
                versions.retain(|version| {
                    !io::same_physical_path(
                        Path::new(&version.path),
                        Path::new(&identity.before.write.path),
                    )
                });
            }
        }
        for change in &result.changes {
            if change.before_path != change.after_path {
                versions.retain(|version| {
                    !io::same_physical_path(
                        Path::new(&version.path),
                        Path::new(&change.before_path),
                    )
                });
            }
        }
        for version in versions_for_changes(&result.changes)? {
            versions.retain(|previous| {
                windows_path_key(&previous.path) != windows_path_key(&version.path)
            });
            versions.push(version);
        }
        for version in &mut versions {
            if Path::new(&version.path).is_dir()
                && result
                    .changes
                    .iter()
                    .any(|change| Path::new(&change.after_path).starts_with(&version.path))
            {
                match io::file_version(Path::new(&version.path)) {
                    Ok(current) => *version = current,
                    Err(error) => diagnostics::record(format!(
                        "committed directory version awaits refresh: {error}"
                    )),
                }
            }
        }
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        result.base_versions = versions;
        if self.session_id.is_some() {
            result.history =
                file_history::record(&self.root, &result.changes, &result.identity_changes, label)?;
        }
        result.session_updates =
            committed::project_commit(&self.root, self.session_id.as_deref(), &result.changes)?;
        if let Some(session_id) = &self.session_id
            && !result.identity_changes.is_empty()
        {
            let mut versions = Vec::new();
            for identity in &result.identity_changes {
                match services::query_entity_edit_target(
                    session_id,
                    identity.after.kind,
                    &identity.after.id,
                ) {
                    Ok(info) => models::push_unique_all(&mut versions, info.base_versions),
                    Err(error) => diagnostics::record(format!(
                        "committed target versions await refresh: {error}"
                    )),
                }
            }
            if !versions.is_empty() {
                versions.sort_by(|left, right| left.path.cmp(&right.path));
                result.base_versions = versions;
            }
        }
        Ok(result)
    }
}

pub fn query_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    project::ensure_project_session_mod_root(session_id, root)?;
    let root = FsRootBoundary::new(Path::new(root), "history root")?
        .root()
        .to_string_lossy()
        .into_owned();
    file_history::query(&root)
}

pub fn clear_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    let transaction = acquire(root, Some(session_id))?;
    file_history::clear(&transaction.root)
}

pub fn replay(
    session_id: &str,
    root: &str,
    direction: FileChangeReplayDirection,
    entry_id: u64,
    revision: u64,
) -> AppResult<WriteResult> {
    let transaction = acquire(root, Some(session_id))?;
    app_settings::ensure_core_editing_allowed(&transaction.root)?;
    let entry = file_history::prepare_replay(&transaction.root, direction, entry_id, revision)?;
    let mut changes = entry.changes.clone();
    if matches!(direction, FileChangeReplayDirection::Undo) {
        changes.reverse();
        changes = changes.iter().map(FileChangeRecord::reversed).collect();
    }
    for change in &changes {
        if change.before_path != change.after_path {
            io::require_rename_target(
                Path::new(&change.before_path),
                Path::new(&change.after_path),
            )?;
        }
        let current = match change.kind {
            FileChangeKind::File => io::build_text_change(Path::new(&change.before_path), None)?,
            FileChangeKind::Directory => {
                io::build_directory_delete_change(Path::new(&change.before_path))?
            }
        };
        if current.before_exists != change.before_exists
            || current.before_text != change.before_text
            || current.before_data_base64 != change.before_data_base64
            || current.before_files != change.before_files
        {
            return Err(AppError::message(
                "write.version_conflict",
                format!("回放目标已被修改: {}", change.after_path),
            ));
        }
    }
    let changes = io::resolve_change_paths(root, changes, FileChangeReplayDirection::Redo)?;
    transaction
        ._lease
        .apply_changes(&changes, FileChangeReplayDirection::Redo)?;
    let mut result = WriteResult::from_changes(changes);
    result.base_versions = versions_for_changes(&result.changes)?;
    result.identity_changes = entry
        .identity_changes
        .iter()
        .map(|identity| match direction {
            FileChangeReplayDirection::Redo => identity.clone(),
            FileChangeReplayDirection::Undo => EntityIdentityChange {
                before: identity.after.clone(),
                after: identity.before.clone(),
            },
        })
        .collect();
    result.history = file_history::accept_replay(&transaction.root, direction, entry)?;
    result.session_updates =
        committed::project_commit(&transaction.root, Some(session_id), &result.changes)?;
    if !result.identity_changes.is_empty() {
        let mut versions = Vec::new();
        for identity in &result.identity_changes {
            match services::query_entity_edit_target(
                session_id,
                identity.after.kind,
                &identity.after.id,
            ) {
                Ok(info) => models::push_unique_all(&mut versions, info.base_versions),
                Err(error) => diagnostics::record(format!(
                    "committed replay target versions await refresh: {error}"
                )),
            }
        }
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        if !versions.is_empty() {
            result.base_versions = versions;
        }
    }
    Ok(result)
}

fn versions_for_changes(changes: &[FileChangeRecord]) -> AppResult<Vec<FileVersion>> {
    changes.iter().map(version_after_change).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::commands;
    #[cfg(test)]
    use crate::io::FileChangeSetBuilder;
    use crate::io::file_version;
    #[cfg(test)]
    use crate::models::{
        CloseProjectSessionPayload, CsvRowPatch, CsvRowPatchAction, CsvSave, CsvSearchField,
        CsvTableKey, JsonFileSave,
    };
    use crate::models::{EntityKind, IndexedConfigKind, IndexedConfigSave, SaveAction, TextSave};
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::{app_settings, file_editor};
    use crate::services::{project, project_save};
    use crate::{io, services};
    use std::fs;

    #[test]
    fn committed_projection_is_built_once_per_affected_session_and_reused() {
        let root = project_workspace("commit_projection_once");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let path = root.join("data/variants/demo.variant");
        fs::write(&path, r#"{"variantId":"demo","hullId":"hull"}"#).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let first = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let second = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let loaded =
            services::query_entity_edit_target(&first.session_id, EntityKind::Variant, "demo")
                .unwrap();
        let saved =
            project_save::execute_save_action(SaveAction::SaveVariantEntity(JsonFileSave {
                session_id: first.session_id.clone(),
                mod_root: first.mod_root.clone(),
                base_versions: loaded.base_versions,
                previous_id: Some("demo".into()),
                next_id: "next".into(),
                rel_path: Some(loaded.target.write.rel_path),
                data: serde_json::json!({"variantId":"next","hullId":"hull"}),
                json_write: Default::default(),
                ordered_json: None,
            }))
            .unwrap();
        assert_eq!(saved.session_updates.len(), 2);
        for update in &saved.session_updates {
            assert_eq!(update.projection.manifest.session_id, update.session_id);
            assert_eq!(update.projection.manifest.mod_root, update.mod_root);
            assert!(
                services::query_entity(&update.session_id, EntityKind::Variant, "next")
                    .unwrap()
                    .is_some()
            );
        }
        commands::close_project_session(CloseProjectSessionPayload {
            session_id: first.session_id,
        })
        .unwrap();
        commands::close_project_session(CloseProjectSessionPayload {
            session_id: second.session_id,
        })
        .unwrap();
        root.close().unwrap();
    }

    #[test]
    fn projection_failure_retains_disk_history_and_recovers_exact_commit() {
        let root = project_workspace("commit_projection_pending");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let path = root.join("data/variants/demo.variant");
        fs::write(&path, r#"{"variantId":"demo","hullId":"hull"}"#).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let loaded =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Variant, "demo")
                .unwrap();
        let bad = root.join("data/variants/broken.variant");
        fs::write(&bad, "{").unwrap();
        let check_root = root.clone();
        let check_session = manifest.session_id.clone();
        let saved = io::with_write_retry(
            &root,
            move |error| {
                assert_eq!(error.code(), "parse.json_syntax");
                assert_eq!(
                    io::read_json_file(&check_root.join("data/variants/next.variant"))?
                        .get("variantId"),
                    Some(&serde_json::json!("next"))
                );
                assert_eq!(
                    query_history(&check_session, &check_root.to_string_lossy())?
                        .undo_stack
                        .len(),
                    1
                );
                assert_eq!(
                    services::query_entity(&check_session, EntityKind::Variant, "next")
                        .unwrap_err()
                        .code(),
                    "session.projection_pending"
                );
                fs::remove_file(&bad)?;
                Ok(())
            },
            || {
                project_save::execute_save_action(SaveAction::SaveVariantEntity(JsonFileSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: loaded.base_versions,
                    previous_id: Some("demo".into()),
                    next_id: "next".into(),
                    rel_path: Some(loaded.target.write.rel_path),
                    data: serde_json::json!({"variantId":"next","hullId":"hull"}),
                    json_write: Default::default(),
                    ordered_json: None,
                }))
            },
        )
        .unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        assert_eq!(
            saved.session_updates[0].projection.manifest.session_id,
            manifest.session_id
        );
        assert!(
            services::query_entity(&manifest.session_id, EntityKind::Variant, "next")
                .unwrap()
                .is_some()
        );
        assert_eq!(
            query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .len(),
            1
        );
        commands::close_project_session(CloseProjectSessionPayload {
            session_id: manifest.session_id,
        })
        .unwrap();
        root.close().unwrap();
    }

    #[test]
    fn committed_projection_recovery_uses_read_authorization_for_core_roots() {
        let fixture = project_workspace("core_projection_read_authority");
        fs::create_dir_all(fixture.join("mods")).unwrap();
        let root = fixture.join("starsector-core");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let path = root.join("data/variants/demo.variant");
        fs::write(&path, r#"{"variantId":"demo","hullId":"hull"}"#).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        assert!(app_settings::ensure_core_editing_allowed(&manifest.mod_root).is_err());
        let repair = root.join("data/variants/broken.variant");
        let read_root = manifest.mod_root.clone();
        let receipt = io::with_write_retry(
            &root,
            move |_| {
                assert!(app_settings::ensure_core_editing_allowed(&read_root).is_err());
                fs::remove_file(&repair)?;
                Ok(())
            },
            || {
                let transaction = acquire(&manifest.mod_root, Some(&manifest.session_id)).unwrap();
                let mut builder = FileChangeSetBuilder::new(&root).unwrap();
                builder
                    .text_file(
                        "data/variants/demo.variant",
                        Some(
                            r#"{"variantId":"demo","hullId":"hull","displayName":"Written"}"#
                                .to_string(),
                        ),
                    )
                    .unwrap();
                let changes = builder.apply().unwrap();
                let broken = root.join("data/variants/broken.variant");
                fs::write(&broken, "{").unwrap();

                transaction.commit(
                    WriteResult::<()>::new(changes, Vec::new(), None),
                    "已写盘 fixture",
                )
            },
        )
        .unwrap();
        assert_eq!(
            receipt.session_updates[0].projection.manifest.session_id,
            manifest.session_id
        );
        assert_eq!(
            services::query_entity(&manifest.session_id, EntityKind::Variant, "demo")
                .unwrap()
                .unwrap()
                .data["displayName"],
            "Written"
        );
        commands::close_project_session(CloseProjectSessionPayload {
            session_id: manifest.session_id,
        })
        .unwrap();
        fixture.close().unwrap();
    }

    #[test]
    fn mission_rename_history_combines_directory_and_nested_writes() {
        assert_mission_rename_replay("new");
    }

    #[test]
    fn mission_case_only_rename_replays_actual_directory_names() {
        assert_mission_rename_replay("Old");
    }

    fn assert_mission_rename_replay(next_id: &str) {
        let root = project_workspace("transaction_mission_rename");
        fs::create_dir_all(root.join("data/missions/old")).unwrap();
        fs::write(
            root.join("data/missions/mission_list.csv"),
            "mission,custom\nold,keep\n",
        )
        .unwrap();
        fs::write(
            root.join("data/missions/old/descriptor.json"),
            r#"{"title":"Old"}"#,
        )
        .unwrap();
        fs::write(root.join("data/missions/old/mission_text.txt"), "old text").unwrap();
        fs::write(root.join("data/missions/old/extra.bin"), [0, 255, 128]).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let base =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, "old")
                .unwrap()
                .base_versions;
        let saved = project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
            IndexedConfigSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: base,
                kind: IndexedConfigKind::Mission,
                previous_id: Some("old".to_string()),
                next_id: next_id.to_string(),
                index_row: serde_json::from_value(serde_json::json!({"mission":next_id})).unwrap(),
                entity_data: serde_json::json!({"descriptor":{"title":"New"},"text":"new text"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        ))
        .unwrap();
        let directory_name = || {
            fs::read_dir(root.join("data/missions"))
                .unwrap()
                .map(|entry| entry.unwrap())
                .find(|entry| entry.file_type().unwrap().is_dir())
                .unwrap()
                .file_name()
                .to_string_lossy()
                .to_string()
        };
        assert_eq!(directory_name(), next_id);
        let info =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, next_id)
                .unwrap();
        assert_eq!(saved.base_versions, info.base_versions);
        assert_eq!(saved.identity_changes[0].after.id, next_id);
        assert_eq!(
            io::read_csv_data(&root.join("data/missions/mission_list.csv"))
                .unwrap()
                .rows[0]
                .data["custom"],
            "keep"
        );
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("data/missions/old/mission_text.txt")).unwrap(),
            "old text"
        );
        assert_eq!(directory_name(), "old");
        assert_eq!(
            fs::read(root.join("data/missions/old/extra.bin")).unwrap(),
            [0, 255, 128]
        );
        replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undone.history.redo_stack[0].id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(
            fs::read_to_string(root.join(format!("data/missions/{next_id}/mission_text.txt")))
                .unwrap(),
            "new text"
        );
        assert_eq!(directory_name(), next_id);
        assert_eq!(
            fs::read(root.join(format!("data/missions/{next_id}/extra.bin"))).unwrap(),
            [0, 255, 128]
        );
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn committed_history_and_replay_follow_disk_direction() {
        let root = project_workspace("transaction_history_direction");
        let path = root.join("notes.txt");
        fs::write(&path, "A").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let payload = TextSave {
            session_id: Some(manifest.session_id.clone()),
            mod_root: manifest.mod_root.clone(),
            path: path.to_string_lossy().to_string(),
            text: "B".to_string(),
            base_versions: vec![file_version(&path).unwrap()],
        };
        let transaction = begin(&payload, &payload.base_versions).unwrap();
        let result =
            file_editor::save_text_file(&payload.mod_root, &payload.path, payload.text.clone())
                .unwrap();
        let saved = transaction.commit(result, "save notes").unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        assert!(begin(&payload, &payload.base_versions).is_err());
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "A");
        assert_eq!(undone.changes[0].before_text.as_deref(), Some("B"));
        assert_eq!(undone.changes[0].after_text.as_deref(), Some("A"));
        assert!(undone.history.undo_stack.is_empty());
        let redone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undone.history.redo_stack[0].id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "B");
        assert_eq!(redone.changes[0].after_text.as_deref(), Some("B"));
        assert!(
            replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack[0].id,
                saved.history.revision
            )
            .is_err()
        );
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn failed_operation_releases_queue_without_advancing_history() {
        let root = project_workspace("transaction_failure");
        let path = root.join("notes.txt");
        fs::write(&path, "A").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let payload = TextSave {
            session_id: Some(manifest.session_id.clone()),
            mod_root: manifest.mod_root.clone(),
            path: path.to_string_lossy().to_string(),
            text: "B".to_string(),
            base_versions: vec![file_version(&path).unwrap()],
        };
        {
            let _transaction = begin(&payload, &payload.base_versions).unwrap();
        }
        assert!(
            query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        let transaction = begin(&payload, &payload.base_versions).unwrap();
        let result =
            file_editor::save_text_file(&payload.mod_root, &payload.path, payload.text.clone())
                .unwrap();
        assert_eq!(
            transaction
                .commit(result, "saved")
                .unwrap()
                .history
                .undo_stack
                .len(),
            1
        );
        project::close_project_session(manifest.session_id).unwrap();
        assert!(begin(&payload, &payload.base_versions).is_err());
        root.close().unwrap();
    }

    #[test]
    fn csv_undo_queries_actual_disk_state() {
        let root = project_workspace("csv_history_actual_direction");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        fs::write(&path, "id,name\na,A\nb,B\n").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let query = || {
            services::query_csv_table_window(
                &manifest.session_id,
                CsvTableKey::Ships,
                0,
                20,
                None,
                CsvSearchField::IdName,
            )
            .unwrap()
        };
        let original = query();
        let payload = CsvSave {
            row_order: None,
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            table: CsvTableKey::Ships,
            patches: vec![CsvRowPatch {
                is_comment: false,
                insert_at: None,
                row_key: original.rows[0].row_key.clone(),
                action: CsvRowPatchAction::Upsert,
                row: serde_json::from_value(serde_json::json!({"id":"a","name":"Saved"})).unwrap(),
            }],
            associated_specs: Vec::new(),
            json_write: Default::default(),
            base_versions: original.base_versions,
        };
        let saved = project_save::execute_save_action(SaveAction::SaveCsvPatch(payload)).unwrap();
        assert_eq!(query().rows[0].data["name"], "Saved");
        let undone = replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        assert_eq!(query().rows[0].data["name"], "A");
        assert_eq!(fs::read_to_string(&path).unwrap(), "id,name\na,A\nb,B\n");
        assert_eq!(
            undone.changes[0].after_text.as_deref(),
            Some("id,name\na,A\nb,B\n")
        );
        fs::write(&path, "id,name\na,External\nb,B\n").unwrap();
        assert!(
            replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undone.history.redo_stack[0].id,
                undone.history.revision
            )
            .is_err()
        );
        assert_eq!(
            query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .revision,
            undone.history.revision
        );
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
