use super::{app_settings, file_history, project};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary, RootWriteLock};
use crate::models::windows_path_key;
use crate::models::{
    EntityIdentityChange, FileChangeKind, FileChangeRecord, FileChangeReplayDirection, FileVersion,
    SessionModScope, WriteResult,
};
use crate::services;
use crate::services::project::PerformanceTrace;
#[cfg(test)]
use crate::services::text_file_editing;
use std::collections::BTreeMap;
use std::path::Path;

mod session_updates;

pub struct WriteTransaction {
    root: String,
    session_id: Option<String>,
    base: Vec<FileVersion>,
    lease: RootWriteLock,
}
fn acquire(root: &str, session: Option<&str>) -> AppResult<WriteTransaction> {
    let lease = io::acquire_root_write_lock(Path::new(root))?;
    if let Some(session) = session {
        project::ensure_project_session_mod_root(session, root)?;
    }
    let boundary = FsRootBoundary::new(Path::new(root), "write root")?;
    Ok(WriteTransaction {
        root: boundary.root().to_string_lossy().into_owned(),
        session_id: session.map(str::to_owned),
        base: Vec::new(),
        lease,
    })
}
pub fn begin(
    scope: &(impl SessionModScope + ?Sized),
    versions: &[FileVersion],
) -> AppResult<WriteTransaction> {
    let mut transaction = acquire(scope.mod_root(), scope.session_id().map(String::as_str))?;
    io::reset_write_reads(&transaction.root);
    app_settings::ensure_core_editing_allowed(&transaction.root)?;
    io::verify_versions(&transaction.root, versions)?;
    transaction.base = versions.to_vec();
    Ok(transaction)
}
impl WriteTransaction {
    pub fn commit<T>(self, mut result: WriteResult<T>, label: &str) -> AppResult<WriteResult<T>> {
        let mut trace = PerformanceTrace::new("project.commit");
        let timer = trace.timer();
        let moved = result
            .changes
            .iter()
            .filter(|change| change.before_path != change.after_path)
            .map(|change| windows_path_key(&change.before_path))
            .collect::<Vec<_>>();
        let mut versions = self
            .base
            .into_iter()
            .filter(|version| {
                let path = windows_path_key(&version.path);
                !moved
                    .iter()
                    .any(|moved| io::relative_path_contains(moved, &path))
            })
            .map(|version| (windows_path_key(&version.path), version))
            .collect::<BTreeMap<_, _>>();
        for change in &result.changes {
            let version = io::version_after_change(change)?;
            versions.insert(windows_path_key(&version.path), version);
        }
        for version in versions.values_mut() {
            if Path::new(&version.path).is_dir()
                && result
                    .changes
                    .iter()
                    .any(|change| Path::new(&change.after_path).starts_with(&version.path))
            {
                *version = io::file_version(Path::new(&version.path))?;
            }
        }
        result.base_versions = versions.into_values().collect();
        trace.record_stage("versions", timer, Vec::new);
        let timer = trace.timer();
        if self.session_id.is_some() {
            result.history = file_history::record_write(
                &self.root,
                &result.changes,
                &result.identity_changes,
                label,
            )?;
        }
        trace.record_stage("history", timer, Vec::new);
        let timer = trace.timer();
        result.session_updates = session_updates::refresh_committed_sessions(
            &self.root,
            self.session_id.as_deref(),
            &result.changes,
        )?;
        trace.record_stage("projection", timer, Vec::new);
        let timer = trace.timer();
        if let Some(session) = self.session_id.as_deref() {
            let actual = identity_versions(session, &result.identity_changes)?;
            if !actual.is_empty() {
                result.base_versions = actual;
            }
        }
        trace.record_stage("identity", timer, Vec::new);
        Ok(result)
    }
}
fn identity_versions(
    session: &str,
    identities: &[EntityIdentityChange],
) -> AppResult<Vec<FileVersion>> {
    let mut versions = BTreeMap::new();
    for identity in identities {
        let target =
            services::query_entity_edit_target(session, identity.after.kind, &identity.after.id)?;
        for version in target.base_versions {
            versions.insert(windows_path_key(&version.path), version);
        }
    }
    Ok(versions.into_values().collect())
}
fn require_replay_source(change: &FileChangeRecord) -> AppResult<()> {
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
            format!("回放来源已经改变：{}", change.before_path),
        )
        .at_path(&change.before_path));
    }
    Ok(())
}
pub fn replay(
    session: &str,
    root: &str,
    direction: FileChangeReplayDirection,
    entry_id: u64,
    revision: u64,
) -> AppResult<WriteResult> {
    let transaction = acquire(root, Some(session))?;
    app_settings::ensure_core_editing_allowed(&transaction.root)?;
    let entry = file_history::prepare_replay(&transaction.root, direction, entry_id, revision)?;
    let changes = match direction {
        FileChangeReplayDirection::Redo => entry.changes.clone(),
        FileChangeReplayDirection::Undo => entry
            .changes
            .iter()
            .rev()
            .map(FileChangeRecord::reversed)
            .collect(),
    };
    for change in &changes {
        require_replay_source(change)?;
    }
    let changes = io::resolve_change_paths(root, changes, FileChangeReplayDirection::Redo)?;
    transaction
        .lease
        .apply_changes(&changes, FileChangeReplayDirection::Redo)?;
    let mut result = WriteResult::from_changes(changes);
    result.base_versions = result
        .changes
        .iter()
        .map(io::version_after_change)
        .collect::<AppResult<_>>()?;
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
    result.session_updates = session_updates::refresh_committed_sessions(
        &transaction.root,
        Some(session),
        &result.changes,
    )?;
    let versions = identity_versions(session, &result.identity_changes)?;
    if !versions.is_empty() {
        result.base_versions = versions;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::services::file_history::query_file_history;
    use crate::services::project_sync::release_project_session;

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
    #[cfg(test)]
    use crate::services::app_settings;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
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
                document: file_formats::json_write(
                    &(serde_json::json!({"variantId":"next","hullId":"hull"})),
                ),
                json_write: Default::default(),
            }))
            .unwrap();
        assert_eq!(saved.session_updates.len(), 2);
        for update in &saved.session_updates {
            assert_eq!(update.content.manifest.session_id, update.session_id);
            assert_eq!(update.content.manifest.mod_root, update.mod_root);
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
                    file_formats::read_json_value(&check_root.join("data/variants/next.variant"))?
                        .get("variantId"),
                    Some(&serde_json::json!("next"))
                );
                assert_eq!(
                    query_file_history(&check_session, &check_root.to_string_lossy())?
                        .undo_stack
                        .len(),
                    1
                );
                assert_eq!(
                    services::query_entity(&check_session, EntityKind::Variant, "next")
                        .unwrap_err()
                        .code(),
                    "session.content_pending"
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
                    document: file_formats::json_write(
                        &(serde_json::json!({"variantId":"next","hullId":"hull"})),
                    ),
                    json_write: Default::default(),
                }))
            },
        )
        .unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        assert_eq!(
            saved.session_updates[0].content.manifest.session_id,
            manifest.session_id
        );
        assert!(
            services::query_entity(&manifest.session_id, EntityKind::Variant, "next")
                .unwrap()
                .is_some()
        );
        assert_eq!(
            query_file_history(&manifest.session_id, &manifest.mod_root)
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
            receipt.session_updates[0].content.manifest.session_id,
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
                previous_id: Some("old".to_string()),
                next_id: next_id.to_string(),
                index_row: serde_json::from_value(serde_json::json!({"mission":next_id})).unwrap(),
                content: file_formats::indexed_content(
                    IndexedConfigKind::Mission,
                    &(serde_json::json!({"descriptor":{"title":"New"},"text":"new text"})),
                ),
                json_write: Default::default(),
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
        let snapshot =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, next_id)
                .unwrap();
        assert_eq!(saved.base_versions, snapshot.base_versions);
        assert_eq!(saved.identity_changes[0].after.id, next_id);
        assert_eq!(
            file_formats::read_csv_table(&root.join("data/missions/mission_list.csv"))
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
        release_project_session(&manifest.session_id).unwrap();
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
        let result = text_file_editing::save_text_file(
            &payload.mod_root,
            &payload.path,
            payload.text.clone(),
        )
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
        release_project_session(&manifest.session_id).unwrap();
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
            query_file_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        let transaction = begin(&payload, &payload.base_versions).unwrap();
        let result = text_file_editing::save_text_file(
            &payload.mod_root,
            &payload.path,
            payload.text.clone(),
        )
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
        release_project_session(&manifest.session_id).unwrap();
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
                columns: vec!["id".into(), "name".into()],
                comment_changed: true,

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
            query_file_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .revision,
            undone.history.revision
        );
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
