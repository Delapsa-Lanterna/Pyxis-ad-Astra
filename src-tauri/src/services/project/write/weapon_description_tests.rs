#![cfg(test)]
use crate::{
    io::{read_csv_data, read_json_file, write_utf8_no_bom},
    models::*,
    services::{project, write_transactions},
    testutil::temp_dir,
};
use serde_json::json;
use std::{collections::BTreeMap, path::Path};

fn fixture(collision: bool) -> (std::path::PathBuf, ProjectManifest) {
    let root = temp_dir("weapon_description");
    std::fs::create_dir_all(root.join("data/weapons")).unwrap();
    std::fs::create_dir_all(root.join("data/strings")).unwrap();
    write_utf8_no_bom(
        &root.join("data/weapons/old.wpn"),
        &json!({"id":"old","specClass":"projectile","descriptionId":"unused","custom":{"keep":1}})
            .to_string(),
    )
    .unwrap();
    write_utf8_no_bom(
        &root.join("data/weapons/weapon_data.csv"),
        "id,name\nold,Old\n",
    )
    .unwrap();
    let text = "id,type,text1,text2,custom\n#note,WEAPON,Comment,,007\nold,WEAPON,Original,Second,001\nold,SHIP,Other type,,002\n".to_string() + if collision {"new,WEAPON,Occupied,,keep\n"} else {""};
    write_utf8_no_bom(&root.join("data/strings/descriptions.csv"), &text).unwrap();
    let mut trace = project::PerformanceTrace::new("weapon.description");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    (root, manifest)
}

fn rename(
    root: &Path,
    manifest: &ProjectManifest,
    mode: &str,
) -> crate::errors::AppResult<WriteResult<serde_json::Value>> {
    let info = project::query_entity_edit_target(&manifest.session_id, EntityKind::Weapon, "old")?;
    let mut data = read_json_file(&root.join("data/weapons/old.wpn"))?;
    data["id"] = json!("new");
    match mode {
        "spec" => crate::commands::save_editor_spec(
            crate::models::command_payloads::SaveEditorSpecPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data,
                json_write: Default::default(),
                ordered_json: None,
            },
        ),
        "text" => {
            crate::commands::save_text_file(crate::models::command_payloads::SaveTextFilePayload {
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: root.join("data/weapons/old.wpn").to_string_lossy().into(),
                base_versions: info.base_versions,
                text: data.to_string(),
            })
        }
        "csv" => {
            let EntityLinkedRecord::Csv { row_key, .. } =
                info.target.linked_record.clone().unwrap()
            else {
                unreachable!()
            };
            crate::commands::save_csv_patch(crate::models::command_payloads::SaveCsvPatchPayload {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                table: CsvTableKey::Weapons,
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
                        create: AssociatedSpecCreateParams::Weapon {
                            id: "new".into(),
                            spec_class: WeaponSpecClass::Projectile,
                        },
                    },
                }],
                json_write: Default::default(),
            })
            .map(|receipt| receipt.with_refreshed_entity(json!(null)))
        }
        "joint" => {
            let baseline = project::query_joint_edit_request(&JointEditQuery {
                root: JointEditRoot {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    kind: JointEditKind::Weapon,
                    id: "old".into(),
                },
                row_key: None,
                values: None,
            })?;
            let key = baseline.bindings["spec"].clone();
            let description = baseline
                .records
                .iter()
                .find(|record| record.key == baseline.bindings["description"])
                .unwrap();
            assert!(matches!(&description.value,JointValue::Present(value) if value["id"]=="old"));
            let prepared = project::prepare_joint_edit(&JointEditDraft {
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
fn weapon_description_replay() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(false);
        let receipt = rename(&root, &manifest, mode).unwrap();
        let rows = read_csv_data(&root.join("data/strings/descriptions.csv")).unwrap();
        assert!(rows.rows[0].is_comment);
        assert_eq!(
            rows.rows[1].data,
            json!({"id":"new","type":"WEAPON","text1":"Original","text2":"Second","custom":"001"})
                .as_object()
                .unwrap()
                .clone()
        );
        assert_eq!(rows.rows[2].data["id"], "old");
        assert_eq!(
            read_json_file(&root.join("data/weapons/new.wpn")).unwrap()["descriptionId"],
            "unused"
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
fn weapon_description_collision() {
    for mode in ["csv", "spec", "text", "joint"] {
        let (root, manifest) = fixture(true);
        let path = root.join("data/strings/descriptions.csv");
        let before = std::fs::read(&path).unwrap();
        let error = rename(&root, &manifest, mode).unwrap_err();
        assert_eq!(error.code(), "weapon.description_target_exists");
        assert!(root.join("data/weapons/old.wpn").exists());
        assert!(!root.join("data/weapons/new.wpn").exists());
        assert_eq!(std::fs::read(&path).unwrap(), before);
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
