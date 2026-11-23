#![cfg(test)]
#[cfg(test)]
use crate::services::project_sync::release_project_session;

use super::super::model::csv_table_specs;
use crate::domain::csv_column_order::standard_csv_columns;
use crate::io::file_version;
#[cfg(test)]
use crate::models::SaveAction;
use crate::models::{
    CORVUS_SPAWNPOINTS, CsvRowPatch, CsvRowPatchAction, CsvSave, CsvSearchField, CsvTableCreate,
    CsvTableKey, FileChangeReplayDirection, MiscConfigDelete, MiscConfigFileKind,
};
#[cfg(test)]
use crate::services::project::PerformanceTrace;
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::project_save;
use crate::services::write_transactions;
use crate::services::{project, query_csv_table_index};
use crate::test_support::file_formats::read_csv_table as read_csv_data;
use serde_json::json;
#[cfg(test)]
use std::fs;

#[test]
fn csv_headers_and_first_save() {
    for spec in csv_table_specs() {
        for source in ["existing", "core", "schema"] {
            let root = project_workspace("csv_first_save");
            let mod_root = root.join("mod");
            let game = root.join("game");
            let core = game.join("starsector-core");
            fs::create_dir_all(&mod_root).unwrap();
            fs::create_dir_all(&core).unwrap();
            let expected = match source {
                "existing" => vec!["custom".to_string(), spec.entity_id_field.to_string()],
                "core" => vec![spec.entity_id_field.to_string(), "coreColumn".to_string()],
                _ => standard_csv_columns(spec.key),
            };
            if source != "schema" {
                let path = if source == "existing" {
                    mod_root.join(spec.rel_path)
                } else {
                    core.join(spec.rel_path)
                };
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, expected.join(",") + "\n").unwrap();
            }
            let manifest = project::open_project_session_traced(
                &mod_root,
                Some(&game),
                &mut PerformanceTrace::new("test"),
            )
            .unwrap();
            let index = query_csv_table_index(
                &manifest.session_id,
                spec.key,
                0,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
            assert_eq!(index.header, expected, "{}: {source}", spec.key.as_str());
            assert_eq!(index.total_rows, 0);
            let file = mod_root.join(spec.rel_path);
            assert_eq!(file.exists(), source == "existing");
            let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
                row_order: None,
                base_versions: index.base_versions,
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root,
                table: spec.key,
                patches: Vec::new(),
                associated_specs: Vec::new(),
                json_write: Default::default(),
            }))
            .unwrap();
            let saved = read_csv_data(&file).unwrap();
            assert_eq!(saved.header, expected, "{}: {source}", spec.key.as_str());
            assert!(saved.rows.is_empty());
            assert_eq!(result.changes.len(), usize::from(source != "existing"));
            release_project_session(&manifest.session_id).unwrap();
            project::invalidate_core_cache(&game.to_string_lossy()).unwrap();
            root.close().unwrap();
        }
    }
}

#[test]
fn spawnpoint_file_edit_delete_replay_and_clean_creation() {
    let root = project_workspace("spawnpoint_file");
    let path = root.join(CORVUS_SPAWNPOINTS);
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let before = "faction,system,entityID,extra\r\n# note,,,\r\n,,,\r\nfirst,First,A,keep\r\nsecond,Second,B,other\r\n";
    fs::write(&path, before).unwrap();
    let manifest =
        project::open_project_session_traced(&root, None, &mut PerformanceTrace::new("test"))
            .unwrap();
    let session = &manifest.session_id;
    let table = CsvTableKey::CorvusSpawnpoints;
    let index =
        query_csv_table_index(session, table, 20, None, CsvSearchField::IdName, &[]).unwrap();
    let found = &index
        .rows
        .iter()
        .find(|row| row.data["faction"] == "first")
        .unwrap();
    let mut row = found.data.clone();
    row.insert("entityID".into(), json!("changed"));
    let saved = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
        session_id: session.clone(),
        mod_root: manifest.mod_root.clone(),
        table,
        base_versions: index.base_versions,
        patches: vec![CsvRowPatch {
            columns: vec!["entityID".into()],
            comment_changed: false,
            insert_at: None,
            row_key: found.row_key.clone(),
            action: CsvRowPatchAction::Upsert,
            row,
            is_comment: false,
        }],
        row_order: None,
        associated_specs: vec![],
        json_write: Default::default(),
    }))
    .unwrap();
    let edited = fs::read_to_string(&path).unwrap();
    assert_eq!(edited, before.replace("First,A", "First,changed"));
    let deleted =
        project_save::execute_save_action(SaveAction::DeleteMiscConfig(MiscConfigDelete {
            session_id: session.clone(),
            mod_root: manifest.mod_root.clone(),
            kind: MiscConfigFileKind::CorvusSpawnpoints,
            base_versions: saved.base_versions,
        }))
        .unwrap();
    assert!(!path.exists());
    let entry = deleted.history.undo_stack.last().unwrap().id;
    let undo = write_transactions::replay(
        session,
        &manifest.mod_root,
        FileChangeReplayDirection::Undo,
        entry,
        deleted.history.revision,
    )
    .unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
    write_transactions::replay(
        session,
        &manifest.mod_root,
        FileChangeReplayDirection::Redo,
        entry,
        undo.history.revision,
    )
    .unwrap();
    let create = CsvTableCreate {
        session_id: session.clone(),
        mod_root: manifest.mod_root.clone(),
        table,
        base_versions: vec![file_version(&path).unwrap()],
    };
    project_save::execute_save_action(SaveAction::CreateCsvTable(create.clone())).unwrap();
    assert!(project_save::execute_save_action(SaveAction::CreateCsvTable(create)).is_err());
    let index =
        query_csv_table_index(session, table, 20, None, CsvSearchField::IdName, &[]).unwrap();
    assert_eq!(index.header, ["faction", "system", "entityID"]);
    assert_eq!(index.total_rows, 0);
    release_project_session(session).unwrap();
    root.close().unwrap();
}
