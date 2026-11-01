use super::*;
#[cfg(test)]
use crate::domain::{entity_construction, entity_definitions};
use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
#[cfg(test)]
use crate::services::file_history;
use crate::services::project::PerformanceTrace;
#[cfg(test)]
use crate::services::project::model;
use crate::services::project::query::csv_window;
use crate::services::project::test_support::project_workspace;
use crate::services::{project, project_save, write_transactions};
#[cfg(test)]
use crate::test_support::work_counts;
#[cfg(test)]
use crate::{io, services, test_support};
use serde_json::json;
#[cfg(test)]
use std::fs;
use std::slice;

fn cases() -> Vec<AssociatedSpecCreateParams> {
    vec![
        AssociatedSpecCreateParams::Ship {
            id: "next".into(),
            hull_name: "CSV name".into(),
        },
        AssociatedSpecCreateParams::Weapon {
            id: "next".into(),
            spec_class: WeaponSpecClass::Beam,
        },
        AssociatedSpecCreateParams::Weapon {
            id: "next".into(),
            spec_class: WeaponSpecClass::Projectile,
        },
        AssociatedSpecCreateParams::System { id: "next".into() },
        AssociatedSpecCreateParams::Skill { id: "next".into() },
    ]
}

fn request(
    manifest: &ProjectManifest,
    change: AssociatedSpecChange,
    mode: AssociatedSpecMode,
) -> CsvSave {
    let table = match &change {
        AssociatedSpecChange::Create { create } | AssociatedSpecChange::Rename { create, .. } => {
            create.table()
        }
        _ => unreachable!(),
    };
    let prepared =
        prepare_csv_associated_specs(&manifest.session_id, table, slice::from_ref(&change))
            .unwrap()
            .remove(0);
    let window = csv_window::query_csv_table_window(
        &manifest.session_id,
        table,
        0,
        10,
        None,
        CsvSearchField::IdName,
    )
    .unwrap();
    let row_key = if matches!(change, AssociatedSpecChange::Rename { .. }) {
        window.rows[0].row_key.clone()
    } else {
        format!("{}:new:0", table.as_str())
    };
    let mut base_versions = window.base_versions;
    for version in &prepared.base_versions {
        if !base_versions.iter().any(|base| base.path == version.path) {
            base_versions.push(version.clone());
        }
    }
    CsvSave {
        row_order: None,
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        table,
        base_versions,
        patches: vec![CsvRowPatch {
            row_key,
            insert_at: None,
            action: CsvRowPatchAction::Upsert,
            row: json!({"id":"next","name":"CSV name","unknown":"007"})
                .as_object()
                .unwrap()
                .clone(),
            is_comment: false,
        }],
        associated_specs: vec![AssociatedSpecWrite {
            change,
            target: prepared.target,
            resolution: Some(AssociatedSpecResolution {
                mode,
                original: prepared.original,
                destination: prepared.destination,
            }),
        }],
        json_write: Default::default(),
    }
}

fn open(root: &Path) -> ProjectManifest {
    let mut trace = PerformanceTrace::new("associated.spec.fixture");
    project::open_project_session_traced(root, None, &mut trace).unwrap()
}

#[test]
fn all_formats_read_and_replace_existing_targets_with_one_reversible_save() {
    for params in cases() {
        for rename in [false, true] {
            for mode in [AssociatedSpecMode::Read, AssociatedSpecMode::Overwrite] {
                for late in [false, true] {
                    let root = project_workspace("associated_existing_target");
                    let table = params.table();
                    let definition = entity_definitions::associated_spec_definition(table).unwrap();
                    let csv_path = root.join(model::csv_table_spec(table).rel_path);
                    fs::create_dir_all(csv_path.parent().unwrap()).unwrap();
                    let csv_before = if rename {
                        "id,name,unknown\nold,Original,001\n"
                    } else {
                        "id,name,unknown\n"
                    };
                    write_utf8_no_bom(&csv_path, csv_before).unwrap();
                    let old = root.join(format!(
                        "{}/nested/filename{}",
                        definition.dir, definition.extension
                    ));
                    fs::create_dir_all(old.parent().unwrap()).unwrap();
                    let mut data = entity_construction::create_associated_spec(&params);
                    data[definition.id_field] = json!("old");
                    data["custom"] = json!({"preserve":[1,2]});
                    let original = serde_json::to_string(&data).unwrap();
                    if rename {
                        write_utf8_no_bom(&old, &original).unwrap();
                    }
                    let destination = root.join(format!(
                        "{}/nested/next{}",
                        definition.dir, definition.extension
                    ));
                    let mut existing = entity_construction::create_associated_spec(&params);
                    existing["custom"] = json!({"destination":true});
                    let target_text = format!(
                        "{}\n# custom formatting\n",
                        serde_json::to_string(&existing).unwrap()
                    );
                    if !late {
                        write_utf8_no_bom(&destination, &target_text).unwrap();
                    }
                    let manifest = open(&root);
                    if late {
                        write_utf8_no_bom(&destination, &target_text).unwrap();
                    }
                    let change = if rename {
                        AssociatedSpecChange::Rename {
                            previous_id: "old".into(),
                            create: params.clone(),
                        }
                    } else {
                        AssociatedSpecChange::Create {
                            create: params.clone(),
                        }
                    };
                    let input = request(&manifest, change, mode);
                    assert!(io::same_physical_path(
                        Path::new(
                            &input.associated_specs[0]
                                .resolution
                                .as_ref()
                                .unwrap()
                                .destination
                                .location
                                .path
                        ),
                        &destination.canonicalize().unwrap()
                    ));
                    let result =
                        project_save::execute_save_action(SaveAction::SaveCsvPatch(input)).unwrap();
                    assert_eq!(result.history.undo_stack.len(), 1);
                    let expected_changes = 1
                        + usize::from(rename)
                        + usize::from(mode == AssociatedSpecMode::Overwrite);
                    assert_eq!(result.changes.len(), expected_changes);
                    assert!(!rename || !old.exists());
                    if mode == AssociatedSpecMode::Read {
                        assert_eq!(read_utf8_no_bom(&destination).unwrap(), target_text);
                    } else {
                        let actual = io::read_json_file(&destination).unwrap();
                        assert_eq!(actual[definition.id_field], "next");
                        assert_eq!(actual.get("custom"), rename.then(|| &data["custom"]));
                    }
                    let info = services::query_entity_edit_target(
                        &manifest.session_id,
                        definition.entity_kind,
                        "next",
                    )
                    .unwrap();
                    assert_eq!(info.target.state, EntityTargetState::Existing);
                    assert_eq!(
                        info.target.write.rel_path,
                        format!("{}/nested/next{}", definition.dir, definition.extension)
                    );
                    let undo = write_transactions::replay(
                        &manifest.session_id,
                        &manifest.mod_root,
                        FileChangeReplayDirection::Undo,
                        result.history.undo_stack[0].id,
                        result.history.revision,
                    )
                    .unwrap();
                    assert_eq!(read_utf8_no_bom(&csv_path).unwrap(), csv_before);
                    assert_eq!(read_utf8_no_bom(&destination).unwrap(), target_text);
                    if rename {
                        assert_eq!(read_utf8_no_bom(&old).unwrap(), original);
                    }
                    write_transactions::replay(
                        &manifest.session_id,
                        &manifest.mod_root,
                        FileChangeReplayDirection::Redo,
                        undo.history.redo_stack[0].id,
                        undo.history.revision,
                    )
                    .unwrap();
                    assert!(!rename || !old.exists());
                    project::close_project_session(manifest.session_id).unwrap();
                    root.close().unwrap();
                }
            }
        }
    }
}

#[test]
fn preparation_shares_actual_reads_and_keeps_invalid_files_as_choices() {
    let root = project_workspace("associated_read_counts");
    fs::create_dir_all(root.join("data/hulls")).unwrap();
    write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), "id,name\nold,Old\n").unwrap();
    let manifest = open(&root);
    let path = root.join("data/hulls/next.ship");
    write_utf8_no_bom(&path, "{broken").unwrap();
    let change = AssociatedSpecChange::Create {
        create: cases().remove(0),
    };
    let before = work_counts::count("parse", &path);
    let walks = work_counts::count("walk", &root.join("data/hulls"));
    let prepared = prepare_csv_associated_specs(
        &manifest.session_id,
        CsvTableKey::Ships,
        &[change.clone(), change.clone()],
    )
    .unwrap();
    assert_eq!(work_counts::count("parse", &path) - before, 1);
    assert_eq!(
        work_counts::count("walk", &root.join("data/hulls")) - walks,
        1
    );
    assert!(
        prepared
            .iter()
            .all(|entry| entry.destination.problem.is_some())
    );
    let input = request(&manifest, change, AssociatedSpecMode::Overwrite);
    let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(input)).unwrap();
    assert_eq!(result.changes.len(), 2);
    assert_eq!(io::read_json_file(&path).unwrap()["hullId"], "next");
    project::close_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn confirmed_versions_reject_replaced_and_deleted_files_before_any_csv_write() {
    for remove in [false, true] {
        let root = project_workspace("associated_version_conflict");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        write_utf8_no_bom(&csv, "id,name\n").unwrap();
        let target = root.join("data/hulls/next.ship");
        write_utf8_no_bom(&target, "{hullId:'next'}").unwrap();
        let manifest = open(&root);
        let change = AssociatedSpecChange::Create {
            create: cases().remove(0),
        };
        let input = request(&manifest, change, AssociatedSpecMode::Read);
        if remove {
            fs::remove_file(&target).unwrap();
        } else {
            write_utf8_no_bom(&target, "{hullId:'next',changed:true}").unwrap();
        }
        let error = project_save::execute_save_action(SaveAction::SaveCsvPatch(input)).unwrap_err();
        assert_eq!(error.code(), "write.version_conflict");
        assert_eq!(read_utf8_no_bom(&csv).unwrap(), "id,name\n");
        assert!(
            file_history::query(&manifest.mod_root)
                .unwrap()
                .undo_stack
                .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}

#[test]
fn inherited_originals_supply_all_formats_without_changing_their_sources() {
    if test_support::isolated_test() {
        return;
    }
    for params in cases() {
        for reference in [false, true] {
            let root = project_workspace("associated_inherited_original");
            let game = root.join("game");
            let local = game.join("mods/local");
            let external = if reference {
                game.join("mods/reference")
            } else {
                game.join("starsector-core")
            };
            fs::create_dir_all(game.join("starsector-core")).unwrap();
            let definition =
                entity_definitions::associated_spec_definition(params.table()).unwrap();
            let csv_path = local.join(model::csv_table_spec(params.table()).rel_path);
            fs::create_dir_all(csv_path.parent().unwrap()).unwrap();
            write_utf8_no_bom(&csv_path, "id,name\nold,Original\n").unwrap();
            let source = external.join(definition.default_rel_path("old"));
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            let mut data = entity_construction::create_associated_spec(&params);
            data[definition.id_field] = json!("old");
            data["custom"] = json!({"inherited":true});
            let text = data.to_string();
            write_utf8_no_bom(&source, &text).unwrap();
            let mut trace = PerformanceTrace::new("inherited.fixture");
            let manifest =
                project::open_project_session_traced(&local, Some(&game), &mut trace).unwrap();
            let external_session = if reference {
                let manifest = open(&external);
                project::set_reference_sources(vec![manifest.session_id.clone()]).unwrap();
                Some(manifest.session_id)
            } else {
                None
            };
            let change = AssociatedSpecChange::Rename {
                previous_id: "old".into(),
                create: params.clone(),
            };
            let parses = work_counts::count("parse", &source);
            let input = request(&manifest, change, AssociatedSpecMode::Overwrite);
            assert_eq!(work_counts::count("parse", &source) - parses, 1);
            assert_eq!(
                input.associated_specs[0]
                    .resolution
                    .as_ref()
                    .unwrap()
                    .original
                    .as_ref()
                    .unwrap()
                    .location
                    .source,
                if reference {
                    ResourceSource::Reference
                } else {
                    ResourceSource::Core
                }
            );
            project_save::execute_save_action(SaveAction::SaveCsvPatch(input)).unwrap();
            assert_eq!(read_utf8_no_bom(&source).unwrap(), text);
            assert_eq!(
                io::read_json_file(&local.join(definition.default_rel_path("next"))).unwrap()["custom"],
                data["custom"]
            );
            project::set_reference_sources(Vec::new()).unwrap();
            if let Some(session) = external_session {
                project::close_project_session(session).unwrap();
            }
            project::close_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}

#[test]
fn reading_targets_retains_descriptions_and_overwriting_uses_existing_collision_rules() {
    for mode in [AssociatedSpecMode::Read, AssociatedSpecMode::Overwrite] {
        let root = project_workspace("associated_description_choice");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("data/strings")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        write_utf8_no_bom(&csv, "id,name\nold,Original\n").unwrap();
        for id in ["old", "next"] {
            write_utf8_no_bom(
                &root.join(format!("data/hulls/{id}.ship")),
                &json!({"hullId":id}).to_string(),
            )
            .unwrap();
        }
        let description = root.join("data/strings/descriptions.csv");
        let text = "id,type,text1\nold,SHIP,Original\nnext,SHIP,Target\n";
        write_utf8_no_bom(&description, text).unwrap();
        let manifest = open(&root);
        let input = request(
            &manifest,
            AssociatedSpecChange::Rename {
                previous_id: "old".into(),
                create: cases().remove(0),
            },
            mode,
        );
        let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(input));
        if mode == AssociatedSpecMode::Read {
            assert!(result.is_ok());
            assert!(!root.join("data/hulls/old.ship").exists());
        } else {
            assert_eq!(result.unwrap_err().code(), "ship.description_target_exists");
            assert!(root.join("data/hulls/old.ship").exists());
        }
        assert_eq!(read_utf8_no_bom(&description).unwrap(), text);
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}

#[test]
fn invalid_originals_allow_target_reuse_template_replacement_and_csv_only() {
    for choice in ["read", "overwrite", "csv"] {
        let root = project_workspace("associated_invalid_original");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let csv = root.join("data/hulls/ship_data.csv");
        write_utf8_no_bom(&csv, "id,name\nold,Original\n").unwrap();
        let manifest = open(&root);
        let source = root.join("data/hulls/old.ship");
        let destination = root.join("data/hulls/next.ship");
        write_utf8_no_bom(&source, "{broken").unwrap();
        write_utf8_no_bom(&destination, "{hullId:'next',custom:true}").unwrap();
        let mut input = request(
            &manifest,
            AssociatedSpecChange::Rename {
                previous_id: "old".into(),
                create: cases().remove(0),
            },
            if choice == "read" {
                AssociatedSpecMode::Read
            } else {
                AssociatedSpecMode::Overwrite
            },
        );
        assert!(
            input.associated_specs[0]
                .resolution
                .as_ref()
                .unwrap()
                .original
                .as_ref()
                .unwrap()
                .problem
                .is_some()
        );
        if choice == "csv" {
            input.associated_specs.clear();
        }
        let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(input)).unwrap();
        assert_eq!(result.history.undo_stack.len(), 1);
        assert_eq!(source.exists(), choice == "csv");
        if choice == "overwrite" {
            assert!(
                io::read_json_file(&destination)
                    .unwrap()
                    .get("custom")
                    .is_none()
            );
        } else {
            assert_eq!(
                read_utf8_no_bom(&destination).unwrap(),
                "{hullId:'next',custom:true}"
            );
        }
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
