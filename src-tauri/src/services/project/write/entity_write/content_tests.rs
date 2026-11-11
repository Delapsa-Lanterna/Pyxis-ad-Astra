#![cfg(test)]
use super::content::{save_entity_spec, stage_entity_content, validate_entity_content_in};
use crate::io::FileChangeSetBuilder;
use crate::models::IndexedConfigContent;
use crate::services::file_history::query_file_history;
use crate::services::project::open_project_session_traced;
use crate::services::project::session::{lock_session, session_handle};
#[cfg(test)]
use crate::services::project_sync::release_project_session;
use crate::services::text_file_editing;
use crate::test_support::file_formats;

#[cfg(test)]
use crate::domain::entity_definitions;
use crate::domain::entity_definitions::PROJECTILE_SPEC_DEFINITION;
#[cfg(test)]
use crate::io;
use crate::models::{CsvSearchField, CsvTableKey, EntityKind, FileChangeReplayDirection};
#[cfg(test)]
use crate::models::{
    EntityLinkedRecord, EntityTargetState, IndexedConfigSave, JsonWriteOptions, ResourceSource,
    SaveAction, SpecSave, TextSave,
};
use crate::services::project;
#[cfg(test)]
use crate::services::project::PerformanceTrace;
#[cfg(test)]
use crate::services::project::model::csv_table_spec;
#[cfg(test)]
use crate::services::project::query::{csv_window, entities, entity_targets};
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::{project_save, write_transactions};
use serde_json::json;
#[cfg(test)]
use std::fs;

#[test]
fn spec_rename_updates_the_registered_row_and_preserves_a_comment_with_the_same_id() {
    for (kind, directory) in [
        EntityKind::Ship,
        EntityKind::Weapon,
        EntityKind::System,
        EntityKind::Skill,
    ]
    .into_iter()
    .flat_map(|kind| {
        entity_definitions::entity_spec_definition(kind)
            .unwrap()
            .source_dirs()
            .iter()
            .map(move |directory| (kind, *directory))
    }) {
        let definition = entity_definitions::entity_spec_definition(kind).unwrap();
        let table = definition.csv_table.unwrap();
        let root = project_workspace(&format!("identity_comment_{kind:?}"));
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::create_dir_all(root.join(definition.dir)).unwrap();
        let mut content = json!({"specClass":"beam"});
        if kind == EntityKind::Weapon {
            content["turretOffsets"] = json!([0, 0]);
            content["hardpointOffsets"] = json!([0, 0]);
        }
        content[definition.id_field] = "old".into();
        let source = root.join(format!("{directory}/old{}", definition.extension));
        io::write_utf8_no_bom(&source, &content.to_string()).unwrap();
        let csv = root.join(csv_table_spec(table).rel_path);
        let original = "a,id,name\n# retained note,old,Comment\nactive,old,Original\n";
        io::write_utf8_no_bom(&csv, original).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            entity_targets::query_entity_edit_target(&manifest.session_id, kind, "old").unwrap();
        assert_eq!(
            info.target.write.rel_path,
            format!("{directory}/old{}", definition.extension)
        );
        content["custom"] = json!(7);
        project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            base_versions: info.base_versions,
            document: file_formats::json_write(&(content.clone())),
            json_write: Default::default(),
        }))
        .unwrap();
        assert_eq!(file_formats::read_json_value(&source).unwrap()["custom"], 7);
        let info =
            entity_targets::query_entity_edit_target(&manifest.session_id, kind, "old").unwrap();
        content[definition.id_field] = "next".into();
        let receipt = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            base_versions: info.base_versions,
            document: file_formats::json_write(&(content)),
            json_write: Default::default(),
        }))
        .unwrap();
        assert_eq!(
            receipt.identity_changes[0].after.write.rel_path,
            format!("{directory}/next{}", definition.extension)
        );
        assert_eq!(
            file_formats::read_json_value(
                &root.join(format!("{directory}/next{}", definition.extension))
            )
            .unwrap()["custom"],
            7
        );
        let saved = file_formats::read_csv_table(&csv).unwrap();
        assert_eq!(saved.header, ["a", "id", "name"]);
        assert_eq!(saved.rows[0].data["id"], "old");
        assert_eq!(saved.rows[0].data["a"], "# retained note");
        assert_eq!(saved.rows[1].data["id"], "next");
        assert_eq!(saved.rows[1].data["name"], "Original");
        assert!(matches!(&receipt.identity_changes[0].after.linked_record,
                Some(EntityLinkedRecord::Csv { row_key, .. }) if row_key == &format!("{}:row:1", table.as_str())));
        let undo = write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            receipt.history.undo_stack.last().unwrap().id,
            receipt.history.revision,
        )
        .unwrap();
        assert_eq!(
            file_formats::read_csv_table(&csv).unwrap().rows[1].data["id"],
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
            file_formats::read_csv_table(&csv).unwrap().rows[1].data["id"],
            "next"
        );
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}

#[test]
fn loaded_nested_target_renames_with_its_csv_row_and_replays_identity() {
    let root = project_workspace("identity_spec_csv");
    fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
    fs::write(
        root.join("data/hulls/nested/filename.ship"),
        r#"{"hullId":"old","hullName":"Loaded"}"#,
    )
    .unwrap();
    fs::write(
        root.join("data/hulls/ship_data.csv"),
        "id,name,custom\nold,Loaded,keep\nother,Other,value\n",
    )
    .unwrap();
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    let info =
        entity_targets::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "old")
            .unwrap();
    let detail = entities::query_entity(&manifest.session_id, EntityKind::Ship, "old")
        .unwrap()
        .unwrap();
    let list = entities::query_entity_list(&manifest.session_id, EntityKind::Ship).unwrap();
    assert_eq!(info.target, detail.target);
    assert_eq!(info.base_versions, detail.base_versions);
    assert_eq!(info.base_versions, list[0].base_versions);
    assert_eq!(info.base_versions.len(), 2);
    assert_eq!(
        info.target.write.rel_path,
        "data/hulls/nested/filename.ship"
    );
    let before = csv_window::query_csv_table_window(
        &manifest.session_id,
        CsvTableKey::Ships,
        0,
        20,
        None,
        CsvSearchField::IdName,
    )
    .unwrap();
    let result = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        document: file_formats::json_write(&(json!({"hullId":"new","hullName":"Saved"}))),
        json_write: Default::default(),
    }))
    .unwrap();
    assert!(!root.join("data/hulls/nested/filename.ship").exists());
    assert!(root.join("data/hulls/nested/new.ship").is_file());
    assert_eq!(result.changes.len(), 2);
    assert_eq!(result.identity_changes[0].after.id, "new");
    let current = csv_window::query_csv_table_window(
        &manifest.session_id,
        CsvTableKey::Ships,
        0,
        20,
        None,
        CsvSearchField::IdName,
    )
    .unwrap();
    assert_eq!(before.rows[0].row_key, current.rows[0].row_key);
    assert_eq!(current.rows[0].data["id"], "new");
    assert_eq!(current.rows[0].data["custom"], "keep");
    assert_eq!(current.rows[1].data["id"], "other");
    let next =
        entity_targets::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "new")
            .unwrap();
    assert_eq!(result.base_versions, next.base_versions);
    let undo = write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Undo,
        result.history.undo_stack[0].id,
        result.history.revision,
    )
    .unwrap();
    assert_eq!(undo.identity_changes[0].after.id, "old");
    assert!(root.join("data/hulls/nested/filename.ship").is_file());
    write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Redo,
        undo.history.redo_stack[0].id,
        undo.history.revision,
    )
    .unwrap();
    assert!(root.join("data/hulls/nested/new.ship").is_file());
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn missing_spec_import_uses_content_identity() {
    let root = project_workspace("identity_missing_import");
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    let info =
        entity_targets::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "missing")
            .unwrap();
    let result = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        document: file_formats::json_write(&(json!({"hullId":"imported"}))),
        json_write: Default::default(),
    }))
    .unwrap();
    assert_eq!(result.identity_changes[0].after.id, "imported");
    assert!(root.join("data/hulls/imported.ship").exists());
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn text_save_writes_submitted_text_without_identity_changes() {
    let root = project_workspace("text_identity_source");
    fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
    let old = root.join("data/hulls/nested/filename.ship");
    fs::write(&old, "{hullId:'old', # keep\n hullName:'Old'}\n").unwrap();
    fs::write(
        root.join("data/hulls/ship_data.csv"),
        "id,name,custom\nold,Old,keep\n",
    )
    .unwrap();
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    let loaded = text_file_editing::load_project_text_file(
        Some(&manifest.session_id),
        &manifest.mod_root,
        old.to_string_lossy().to_string(),
    )
    .unwrap();
    assert_eq!(loaded.entity.as_ref().unwrap().target.id, "old");
    let text = "{hullId:'new', # keep\n hullName:'Edited', extra:{'_key':1}}\n";
    let saved = project_save::execute_save_action(SaveAction::SaveTextFile(TextSave {
        session_id: Some(manifest.session_id.clone()),
        mod_root: manifest.mod_root.clone(),
        path: loaded.path,
        text: text.to_string(),
        base_versions: loaded.base_versions,
    }))
    .unwrap();
    assert_eq!(saved.content.unwrap().value["text"], text);
    assert!(saved.identity_changes.is_empty());
    assert_eq!(fs::read_to_string(&old).unwrap(), text);
    assert!(!root.join("data/hulls/nested/new.ship").exists());
    assert_eq!(
        file_formats::read_csv_table(&root.join("data/hulls/ship_data.csv"))
            .unwrap()
            .rows[0]
            .data["id"],
        "old"
    );
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn core_projectile_saves_to_mod_override_and_keeps_core_source() {
    for directory in PROJECTILE_SPEC_DEFINITION.source_dirs() {
        assert_core_projectile_override(directory);
    }
}

fn assert_core_projectile_override(directory: &str) {
    let game = project_workspace("identity_core_projectile");
    let root = game.join("mods/demo");
    fs::create_dir_all(&root).unwrap();
    let relative = format!("{directory}/nested/filename.proj");
    let core = game.join("starsector-core").join(&relative);
    fs::create_dir_all(core.parent().unwrap()).unwrap();
    fs::write(&core, r#"{"id":"core","width":4}"#).unwrap();
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, Some(&game), &mut trace).unwrap();
    let info = entity_targets::query_entity_edit_target(
        &manifest.session_id,
        EntityKind::Projectile,
        "core",
    )
    .unwrap();
    assert_eq!(
        info.target.source.as_ref().unwrap().source,
        ResourceSource::Core
    );
    assert_eq!(info.target.source.as_ref().unwrap().rel_path, relative);
    assert_eq!(info.target.write.rel_path, "data/weapons/proj/core.proj");
    assert_eq!(info.base_versions[0].fingerprint, None);
    let saved = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        document: file_formats::json_write(&(json!({"id":"core","width":8}))),
        json_write: Default::default(),
    }))
    .unwrap();
    assert_eq!(file_formats::read_json_value(&core).unwrap()["width"], 4);
    assert_eq!(
        file_formats::read_json_value(&root.join("data/weapons/proj/core.proj")).unwrap()["width"],
        8
    );
    let next = entity_targets::query_entity_edit_target(
        &manifest.session_id,
        EntityKind::Projectile,
        "core",
    )
    .unwrap();
    assert_eq!(saved.base_versions, next.base_versions);
    assert_eq!(next.target.state, EntityTargetState::Existing);
    let undone = write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Undo,
        saved.history.undo_stack[0].id,
        saved.history.revision,
    )
    .unwrap();
    let restored = entities::query_entity(&manifest.session_id, EntityKind::Projectile, "core")
        .unwrap()
        .unwrap();
    assert_eq!(restored.data["width"], 4);
    assert_eq!(restored.target.source.unwrap().source, ResourceSource::Core);
    assert_eq!(restored.target.state, EntityTargetState::Create);
    write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Redo,
        undone.history.redo_stack[0].id,
        undone.history.revision,
    )
    .unwrap();
    assert_eq!(
        entities::query_entity(&manifest.session_id, EntityKind::Projectile, "core")
            .unwrap()
            .unwrap()
            .data["width"],
        8
    );
    release_project_session(manifest.session_id).unwrap();
    game.close().unwrap();
}

#[test]
fn projectile_save_and_rename_preserve_the_loaded_directory() {
    for directory in PROJECTILE_SPEC_DEFINITION.source_dirs() {
        let root = project_workspace("projectile_saved_directory");
        let relative = format!("{directory}/nested/filename.proj");
        let path = root.join(&relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"id":"probe","width":1}"#).unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("projectile.save"),
        )
        .unwrap();
        for (id, before_width) in [("probe", 1), ("renamed", 2)] {
            let entity =
                entities::query_entity(&manifest.session_id, EntityKind::Projectile, "probe")
                    .unwrap()
                    .unwrap();
            let saved = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: entity.target,
                base_versions: entity.base_versions,
                document: file_formats::json_write(&(json!({"id":id,"width":2}))),
                json_write: Default::default(),
            }))
            .unwrap();
            let expected = if id == "probe" {
                relative.clone()
            } else {
                format!("{directory}/nested/{id}.proj")
            };
            let current = entities::query_entity(&manifest.session_id, EntityKind::Projectile, id)
                .unwrap()
                .unwrap();
            assert_eq!(current.target.write.rel_path, expected);
            assert_eq!(
                file_formats::read_json_value(&root.join(&expected)).unwrap()["width"],
                2
            );
            let undo = write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack.last().unwrap().id,
                saved.history.revision,
            )
            .unwrap();
            assert_eq!(
                file_formats::read_json_value(&path).unwrap()["width"],
                before_width
            );
            write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undo.history.redo_stack.last().unwrap().id,
                undo.history.revision,
            )
            .unwrap();
            assert_eq!(
                file_formats::read_json_value(&root.join(&expected)).unwrap()["id"],
                id
            );
        }
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}

#[test]
fn linked_csv_version_conflict_keeps_loaded_spec_and_history() {
    let root = project_workspace("identity_csv_conflict");
    fs::create_dir_all(root.join("data/hulls")).unwrap();
    let file = root.join("data/hulls/demo.ship");
    fs::write(&file, r#"{"hullId":"demo"}"#).unwrap();
    fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    let info =
        entity_targets::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "demo")
            .unwrap();
    fs::write(
        root.join("data/hulls/ship_data.csv"),
        "id,name\ndemo,External\n",
    )
    .unwrap();
    let failed = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        document: file_formats::json_write(&(json!({"hullId":"next"}))),
        json_write: Default::default(),
    }))
    .unwrap_err();
    assert_eq!(failed.code(), "write.version_conflict");
    assert_eq!(
        file_formats::read_json_value(&file).unwrap()["hullId"],
        "demo"
    );
    assert!(
        query_file_history(&manifest.session_id, &manifest.mod_root)
            .unwrap()
            .undo_stack
            .is_empty()
    );
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn spec_save_requires_the_complete_loaded_version_scope() {
    let root = project_workspace("identity_required_scope");
    fs::create_dir_all(root.join("data/hulls")).unwrap();
    let path = root.join("data/hulls/demo.ship");
    fs::write(&path, r#"{"hullId":"demo"}"#).unwrap();
    fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
    let mut trace = PerformanceTrace::new("project.openSession");
    let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
    let info =
        entity_targets::query_entity_edit_target(&manifest.session_id, EntityKind::Ship, "demo")
            .unwrap();
    for versions in [
        vec![],
        vec![info.base_versions[0].clone()],
        vec![info.base_versions[1].clone()],
    ] {
        let error = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target.clone(),
            base_versions: versions,
            document: file_formats::json_write(&(json!({"hullId":"next"}))),
            json_write: Default::default(),
        }))
        .unwrap_err();
        assert_eq!(error.code(), "write.version_scope_missing");
        assert_eq!(
            file_formats::read_json_value(&path).unwrap()["hullId"],
            "demo"
        );
    }
    assert!(
        query_file_history(&manifest.session_id, &manifest.mod_root)
            .unwrap()
            .undo_stack
            .is_empty()
    );
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn partial_identity_preserves_nested_omissions_and_empty_id_through_reopen() {
    for (kind, relative) in [
        (EntityKind::Faction, "data/world/factions/sample.faction"),
        (EntityKind::Projectile, "data/weapons/proj/sample.proj"),
    ] {
        for id in [None, Some("")] {
            let root = project_workspace("partial_identity_fields");
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            let mut data = if kind == EntityKind::Faction {
                json!({"knownShips":{}})
            } else {
                json!({"width":1,"engineSlots":[{}]})
            };
            if let Some(id) = id {
                data["id"] = json!(id);
            }
            fs::write(&path, data.to_string()).unwrap();
            let manifest = project::open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("partial.open"),
            )
            .unwrap();
            let entity = entities::query_entity(&manifest.session_id, kind, "sample")
                .unwrap()
                .unwrap();
            data["displayNameLong"] = json!("Partial");
            let save = |data| {
                project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    target: entity.target.clone(),
                    base_versions: entity.base_versions.clone(),
                    document: file_formats::json_write(&data),
                    json_write: Default::default(),
                }))
            };
            let mut invalid = data.clone();
            if kind == EntityKind::Faction {
                invalid["color"] = json!([999, 0, 0, 255]);
            } else {
                invalid["width"] = json!(false);
            }
            assert_eq!(save(invalid).unwrap_err().code(), "config.shape_invalid");
            save(data.clone()).unwrap();
            assert_eq!(file_formats::read_json_value(&path).unwrap(), data);
            release_project_session(manifest.session_id).unwrap();
            let reopened = project::open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("partial.reopen"),
            )
            .unwrap();
            assert_eq!(
                entities::query_entity(&reopened.session_id, kind, "sample")
                    .unwrap()
                    .unwrap()
                    .data,
                data
            );
            release_project_session(reopened.session_id).unwrap();
            root.close().unwrap();
        }
    }
}

#[test]
fn inherited_faction_filename_choices_commit_index_and_history_together() {
    for layout in ["missing", "unrelated", "linked"] {
        for keep in [false, true] {
            let work = project_workspace("inherited_faction_rename");
            let root = work.join("mods/overlay");
            let relative = "data/world/factions/sample.faction";
            let source = root.join(relative);
            let core = work.join("starsector-core").join(relative);
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            fs::create_dir_all(core.parent().unwrap()).unwrap();
            let base = json!({"id":"sample","displayName":"Base","displayNameWithArticle":"Base",
                "logo":"logo.png","crest":"crest.png","color":[1,2,3,255],
                "knownShips":{},"knownFighters":{},"knownWeapons":{},
                "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                    "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}});
            fs::write(&core, base.to_string()).unwrap();
            fs::write(&source, "{}").unwrap();
            let index = root.join("data/world/factions/factions.csv");
            let original = match layout {
                "unrelated" => Some("faction\ndata/world/factions/other.faction\n"),
                "linked" => Some(
                    "id,file,note\n#comment,,keep\nsample,data/world/factions/sample.faction,retained\n",
                ),
                _ => None,
            };
            if let Some(original) = original {
                fs::write(&index, original).unwrap();
            }
            let manifest = project::open_project_session_traced(
                &root,
                Some(&work),
                &mut PerformanceTrace::new("rename.open"),
            )
            .unwrap();
            let info = entity_targets::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Faction,
                "sample",
            )
            .unwrap();
            let intent = entity_targets::query_entity_identity_intent(
                &manifest.session_id,
                &info.target,
                "next",
            )
            .unwrap();
            assert!(intent.inherits);
            assert!(!intent.filename_taken);
            let mut versions = info.base_versions.clone();
            if !keep {
                versions.push(intent.destination_version);
            }
            let save = |data| {
                project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
                    IndexedConfigSave {
                        session_id: manifest.session_id.clone(),
                        mod_root: manifest.mod_root.clone(),
                        base_versions: versions.clone(),
                        previous_id: Some("sample".into()),
                        next_id: "next".into(),
                        index_row: Default::default(),
                        content: IndexedConfigContent::Faction {
                            document: file_formats::json_write(&(json!({"file":data}))["file"]),
                        },
                        json_write: JsonWriteOptions {
                            keep_filename: keep,
                            ..Default::default()
                        },
                    },
                ))
            };
            let partial = json!({"id":"next","displayName":"Saved"});
            if !keep {
                assert_eq!(
                    save(partial.clone()).unwrap_err().code(),
                    "config.shape_invalid"
                );
                assert_eq!(fs::read_to_string(&source).unwrap(), "{}");
                assert_eq!(fs::read_to_string(&index).ok().as_deref(), original);
            }
            let mut complete = base.clone();
            complete["id"] = json!("next");
            let submitted = if keep { partial } else { complete };
            let saved = save(submitted.clone()).unwrap();
            let next = entity_targets::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Faction,
                "next",
            )
            .unwrap();
            let next_path = root.join(if keep {
                relative
            } else {
                "data/world/factions/next.faction"
            });
            assert_eq!(
                file_formats::read_json_value(&next_path).unwrap(),
                submitted
            );
            assert_eq!(saved.identity_changes[0].after, next.target);
            let detail = entities::query_entity(&manifest.session_id, EntityKind::Faction, "next")
                .unwrap()
                .unwrap();
            assert_eq!(detail.composition.unwrap().layers.len(), usize::from(keep));
            assert_eq!(file_formats::read_json_value(&core).unwrap(), base);
            let touches_index = !keep || layout == "linked";
            assert_eq!(saved.changes.len(), 1 + usize::from(touches_index));
            if touches_index {
                let table = file_formats::read_csv_table(&index).unwrap();
                assert_eq!(table.rows.len(), if layout == "missing" { 1 } else { 2 });
                let row = table.rows.last().unwrap();
                assert!(row.data.values().any(|value| value
                    == if keep {
                        relative
                    } else {
                        "data/world/factions/next.faction"
                    }));
                if layout == "linked" {
                    assert_eq!(row.data["id"], "next");
                    assert_eq!(row.data["note"], "retained");
                    assert!(table.rows[0].is_comment);
                }
            } else {
                assert_eq!(fs::read_to_string(&index).ok().as_deref(), original);
            }
            let undo = write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                saved.history.undo_stack.last().unwrap().id,
                saved.history.revision,
            )
            .unwrap();
            assert_eq!(fs::read_to_string(&source).unwrap(), "{}");
            assert_eq!(fs::read_to_string(&index).ok().as_deref(), original);
            write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undo.history.redo_stack.last().unwrap().id,
                undo.history.revision,
            )
            .unwrap();
            assert_eq!(
                file_formats::read_json_value(&next_path).unwrap(),
                submitted
            );
            release_project_session(manifest.session_id).unwrap();
            work.close().unwrap();
        }
    }
}

#[test]
fn phase42_single_and_joint_staging_share_field_and_engine_checks() {
    for (kind, relative, valid, invalid, code) in [
        (
            EntityKind::Weapon,
            "data/weapons/entry.wpn",
            json!({"id":"entry","specClass":"beam","turretOffsets":[0,0],"hardpointOffsets":[0,0]}),
            json!({"id":"entry","specClass":"beam","turretOffsets":[],"hardpointOffsets":[0,0]}),
            "spec.weapon_turret_barrel_required",
        ),
        (
            EntityKind::Ship,
            "data/hulls/entry.ship",
            json!({"hullId":"entry","bounds":[0,0,1,2]}),
            json!({"hullId":"entry","bounds":[0,0,"invalid",2]}),
            "config.shape_invalid",
        ),
        (
            EntityKind::Skin,
            "data/hulls/skins/entry.skin",
            json!({"skinHullId":"entry","baseHullId":"base"}),
            json!({"skinHullId":"entry","baseHullId":"base","engineSlotChanges":{"4":{"length":2}}}),
            "config.shape_invalid",
        ),
    ] {
        let root = project_workspace("phase42_shared_validation");
        let path = root.join(relative);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::write(
            root.join("data/hulls/base.ship"),
            "{hullId:'base',engineSlots:[]}",
        )
        .unwrap();
        fs::write(&path, valid.to_string()).unwrap();
        let before = fs::read(&path).unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("phase42.validation"),
        )
        .unwrap();
        let target = entity_targets::query_entity_edit_target(&manifest.session_id, kind, "entry")
            .unwrap()
            .target;
        let options = JsonWriteOptions::default();
        let handle = session_handle(&manifest.session_id).unwrap();
        let session = lock_session(&handle).unwrap();
        validate_entity_content_in(&session, kind, relative, &valid, false, None).unwrap();
        assert_eq!(
            validate_entity_content_in(&session, kind, relative, &invalid, false, None)
                .unwrap_err()
                .code(),
            code
        );
        drop(session);
        assert_eq!(
            save_entity_spec(
                &manifest.session_id,
                &target,
                "entry",
                file_formats::json_write(&invalid),
                options.clone()
            )
            .unwrap_err()
            .code(),
            code
        );
        let handle = session_handle(&manifest.session_id).unwrap();
        {
            let mut session = lock_session(&handle).unwrap();
            let mut builder = FileChangeSetBuilder::new(&root).unwrap();
            let result = stage_entity_content(
                &mut session,
                &mut builder,
                &target,
                "entry",
                &file_formats::json_write(&invalid),
                &options,
                None,
            );
            assert_eq!(result.err().unwrap().code(), code);
        }
        assert_eq!(fs::read(&path).unwrap(), before);
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
