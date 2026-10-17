#![cfg(test)]
use crate::{
    io::{read_csv_data, read_json_file, write_utf8_no_bom},
    models::*,
    services::{project, write_transactions},
    testutil::temp_dir,
};
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf};

fn fixture(explicit: bool) -> (PathBuf, ProjectManifest) {
    let root = temp_dir("default_ship_description");
    std::fs::create_dir_all(root.join("data/hulls")).unwrap();
    std::fs::create_dir_all(root.join("data/strings")).unwrap();
    let mut data = json!({"hullId":"old","hullSize":"FRIGATE","custom":{"keep":1}});
    if explicit {
        data["descriptionId"] = json!("old");
    }
    write_utf8_no_bom(&root.join("data/hulls/old.ship"), &data.to_string()).unwrap();
    write_utf8_no_bom(
        &root.join("data/hulls/other.ship"),
        r#"{"hullId":"other","descriptionId":"old"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &root.join("data/hulls/ship_data.csv"),
        "id,name\nold,Old\nother,Other\n",
    )
    .unwrap();
    write_utf8_no_bom(&root.join("data/strings/descriptions.csv"),"id,type,text1,text2,custom\n#note,SHIP,Comment,,007\nold,SHIP,Original,Second,001\nold,WEAPON,Other type,,002\n").unwrap();
    let mut trace = project::PerformanceTrace::new("description.rename");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    (root, manifest)
}

fn rename(
    root: &std::path::Path,
    manifest: &ProjectManifest,
    mode: &str,
) -> crate::errors::AppResult<WriteResult<serde_json::Value>> {
    let info =
        crate::services::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "old")?;
    let mut data = read_json_file(&root.join("data/hulls/old.ship"))?;
    data["hullId"] = json!("new");
    match mode {
        "spec" => crate::commands::save_editor_spec(crate::models::SaveEditorSpecPayload {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            base_versions: info.base_versions,
            data,
            json_write: Default::default(),
            ordered_json: None,
        }),
        "text" => crate::commands::save_text_file(crate::models::SaveTextFilePayload {
            session_id: Some(manifest.session_id.clone()),
            mod_root: manifest.mod_root.clone(),
            path: root.join("data/hulls/old.ship").to_string_lossy().into(),
            base_versions: info.base_versions,
            text: data.to_string(),
        }),
        "csv" => {
            let EntityLinkedRecord::Csv { row_key, .. } =
                info.target.linked_record.clone().unwrap()
            else {
                unreachable!()
            };
            crate::commands::save_csv_patch(crate::models::SaveCsvPatchPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                table: CsvTableKey::Ships,
                base_versions: info.base_versions,
                patches: vec![CsvRowPatch {
                    row_key,
                    action: CsvRowPatchAction::Upsert,
                    row: json!({"id":"new","name":"Old"})
                        .as_object()
                        .unwrap()
                        .clone(),
                    is_comment: false,
                    insert_at: None,
                }],
                associated_specs: vec![AssociatedSpecWrite {
                    target: info.target,
                    change: AssociatedSpecChange::Rename {
                        previous_id: "old".into(),
                        create: AssociatedSpecCreateParams::Ship {
                            id: "new".into(),
                            hull_name: "Old".into(),
                        },
                    },
                }],
                json_write: Default::default(),
            })
            .map(|receipt| receipt.with_refreshed_entity(json!(null)))
        }
        "joint" => {
            let baseline = crate::services::query_joint_edit_request(&JointEditQuery {
                catalog: None,
                root: JointEditRoot {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    kind: JointEditKind::Ship,
                    id: "old".into(),
                },
                row_key: None,
                values: None,
                new_sources: Vec::new(),
            })?;
            let key = baseline.bindings["spec"].clone();
            let prepared = crate::services::prepare_joint_edit(&JointEditDraft {
                baseline,
                values: BTreeMap::from([(key, JointValue::Present(data))]),
            })?;
            crate::commands::save_joint_edit(JointEditSubmission {
                base_versions: prepared.snapshot.base_versions.clone(),
                snapshot: prepared.snapshot,
                values: prepared.values,
                json_write: Default::default(),
                create_overrides: Vec::new(),
            })
            .map(|receipt| {
                let snapshot = json!(receipt.refreshed_entity);
                receipt.with_refreshed_entity(snapshot)
            })
        }
        _ => unreachable!(),
    }
}

#[test]
fn default_description_command_rename() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(false);
        let shared = std::fs::read(root.join("data/hulls/other.ship")).unwrap();
        super::csv_staging::take_render_counts();
        let receipt = rename(&root, &manifest, mode).unwrap();
        assert_eq!(
            super::csv_staging::take_render_counts(),
            BTreeMap::from([(CsvTableKey::Ships, 1), (CsvTableKey::Descriptions, 1)]),
            "{mode}"
        );
        let rows = read_csv_data(&root.join("data/strings/descriptions.csv")).unwrap();
        assert_eq!(rows.header, ["id", "type", "text1", "text2", "custom"]);
        assert!(rows.rows[0].is_comment);
        assert_eq!(
            rows.rows[1].data,
            json!({"id":"new","type":"SHIP","text1":"Original","text2":"Second","custom":"001"})
                .as_object()
                .unwrap()
                .clone()
        );
        assert_eq!(rows.rows[2].data["id"], "old");
        assert_eq!(
            std::fs::read(root.join("data/hulls/other.ship")).unwrap(),
            shared
        );
        assert!(
            read_json_file(&root.join("data/hulls/new.ship"))
                .unwrap()
                .get("descriptionId")
                .is_none()
        );
        assert_eq!(receipt.changes.len(), 3);
        let undo = write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            receipt.history.undo_stack[0].id,
            receipt.history.revision,
        )
        .unwrap();
        assert_eq!(
            read_csv_data(&root.join("data/strings/descriptions.csv"))
                .unwrap()
                .rows[1]
                .data["id"],
            "old"
        );
        write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undo.history.redo_stack[0].id,
            undo.history.revision,
        )
        .unwrap();
        assert_eq!(
            read_csv_data(&root.join("data/strings/descriptions.csv"))
                .unwrap()
                .rows[1]
                .data["id"],
            "new"
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn explicit_description_commands() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(true);
        let before = std::fs::read(root.join("data/strings/descriptions.csv")).unwrap();
        let receipt = rename(&root, &manifest, mode).unwrap();
        assert_eq!(
            std::fs::read(root.join("data/strings/descriptions.csv")).unwrap(),
            before
        );
        assert_eq!(
            read_json_file(&root.join("data/hulls/new.ship")).unwrap()["descriptionId"],
            "old"
        );
        assert_eq!(receipt.changes.len(), 2);
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn description_collision_is_atomic() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(false);
        project::close_project_session(manifest.session_id).unwrap();
        let path = root.join("data/strings/descriptions.csv");
        let text = std::fs::read_to_string(&path).unwrap() + "new,SHIP,Occupied,,keep\n";
        write_utf8_no_bom(&path, &text).unwrap();
        let mut trace = project::PerformanceTrace::new("description.collision");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = rename(&root, &manifest, mode).unwrap_err();
        assert_eq!(error.code(), "ship.description_target_exists");
        assert!(root.join("data/hulls/old.ship").exists());
        assert!(!root.join("data/hulls/new.ship").exists());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), text);
        assert!(
            write_transactions::query_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn description_version_conflict() {
    let (root, manifest) = fixture(false);
    let info =
        crate::services::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "old")
            .unwrap();
    assert!(
        info.base_versions
            .iter()
            .any(|version| version.path.ends_with("descriptions.csv"))
    );
    let path = root.join("data/strings/descriptions.csv");
    let text = std::fs::read_to_string(&path)
        .unwrap()
        .replace("Original", "External");
    write_utf8_no_bom(&path, &text).unwrap();
    let mut data = read_json_file(&root.join("data/hulls/old.ship")).unwrap();
    data["hullId"] = json!("new");
    let error = crate::commands::save_editor_spec(crate::models::SaveEditorSpecPayload {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        data,
        json_write: Default::default(),
        ordered_json: None,
    })
    .unwrap_err();
    assert_eq!(error.code(), "write.version_conflict");
    assert!(root.join("data/hulls/old.ship").exists());
    assert!(!root.join("data/hulls/new.ship").exists());
    assert_eq!(std::fs::read_to_string(path).unwrap(), text);
    project::close_project_session(manifest.session_id).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn missing_description_stays_missing() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(false);
        project::close_project_session(manifest.session_id).unwrap();
        let path = root.join("data/strings/descriptions.csv");
        std::fs::remove_file(&path).unwrap();
        let mut trace = project::PerformanceTrace::new("description.absent");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let receipt = rename(&root, &manifest, mode).unwrap();
        assert!(!path.exists());
        assert_eq!(receipt.changes.len(), 2);
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn core_description_copy_rename() {
    let (root, manifest) = fixture(false);
    project::close_project_session(manifest.session_id).unwrap();
    let path = root.join("data/strings/descriptions.csv");
    std::fs::remove_file(&path).unwrap();
    let game = temp_dir("default_description_core");
    let core = game.join("starsector-core/data/strings");
    std::fs::create_dir_all(&core).unwrap();
    let core_text = "id,type,text1,text5,notes\nold,SHIP,Core description,Fifth,kept\n";
    write_utf8_no_bom(&core.join("descriptions.csv"), core_text).unwrap();
    let mut trace = project::PerformanceTrace::new("description.core");
    let manifest = project::open_project_session_traced(&root, Some(&game), &mut trace).unwrap();
    let receipt = rename(&root, &manifest, "joint").unwrap();
    let rows = read_csv_data(&path).unwrap();
    assert_eq!(rows.rows[0].data["id"], "new");
    assert_eq!(rows.rows[0].data["text1"], "Core description");
    assert_eq!(rows.rows[0].data["text5"], "Fifth");
    assert_eq!(
        std::fs::read_to_string(core.join("descriptions.csv")).unwrap(),
        core_text
    );
    let value = receipt.refreshed_entity.unwrap();
    let key = value["bindings"]["description"].as_str().unwrap();
    let record = value["records"]
        .as_array()
        .unwrap()
        .iter()
        .find(|record| record["key"] == key)
        .unwrap();
    assert_eq!(record["value"]["value"]["id"], "new");
    project::close_project_session(manifest.session_id).unwrap();
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(game).unwrap();
}
