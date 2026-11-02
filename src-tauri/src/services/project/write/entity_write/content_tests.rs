#![cfg(test)]
#[cfg(test)]
use crate::domain::entity_definitions;
#[cfg(test)]
use crate::io;
use crate::models::{CsvSearchField, CsvTableKey, EntityKind, FileChangeReplayDirection};
#[cfg(test)]
use crate::models::{
    EntityLinkedRecord, EntityTargetState, ResourceSource, SaveAction, SpecSave, TextSave,
};
use crate::services::project;
#[cfg(test)]
use crate::services::project::PerformanceTrace;
#[cfg(test)]
use crate::services::project::definitions::table_definitions;
#[cfg(test)]
use crate::services::project::query::{csv_window, entities, entity_targets};
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::{file_editor, project_save, write_transactions};
use serde_json::json;
#[cfg(test)]
use std::fs;

#[test]
fn spec_rename_updates_the_registered_row_and_preserves_a_comment_with_the_same_id() {
    for kind in [
        EntityKind::Ship,
        EntityKind::Weapon,
        EntityKind::System,
        EntityKind::Skill,
    ] {
        let definition = entity_definitions::entity_spec_definition(kind).unwrap();
        let table = definition.csv_table.unwrap();
        let root = project_workspace(&format!("identity_comment_{kind:?}"));
        fs::create_dir_all(root.join(definition.dir)).unwrap();
        let mut content = json!({"specClass":"beam"});
        if kind == EntityKind::Weapon {
            content["turretOffsets"] = json!([0, 0]);
            content["hardpointOffsets"] = json!([0, 0]);
        }
        content[definition.id_field] = "old".into();
        let source = root.join(definition.default_rel_path("old"));
        io::write_utf8_no_bom(&source, &content.to_string()).unwrap();
        let csv = root.join(table_definitions::csv_table_definition(table).spec.rel_path);
        let original = "a,id,name\n# retained note,old,Comment\nactive,old,Original\n";
        io::write_utf8_no_bom(&csv, original).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            entity_targets::query_entity_edit_target(&manifest.session_id, kind, "old").unwrap();
        content[definition.id_field] = "next".into();
        let receipt = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            base_versions: info.base_versions,
            data: content,
            json_write: Default::default(),
            ordered_json: None,
        }))
        .unwrap();
        let saved = io::read_csv_data(&csv).unwrap();
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
            receipt.history.undo_stack[0].id,
            receipt.history.revision,
        )
        .unwrap();
        assert_eq!(io::read_csv_data(&csv).unwrap().rows[1].data["id"], "old");
        write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undo.history.redo_stack[0].id,
            undo.history.revision,
        )
        .unwrap();
        assert_eq!(io::read_csv_data(&csv).unwrap().rows[1].data["id"], "next");
        project::close_project_session(manifest.session_id).unwrap();
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
        data: json!({"hullId":"new","hullName":"Saved"}),
        json_write: Default::default(),
        ordered_json: None,
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
    project::close_project_session(manifest.session_id).unwrap();
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
        data: json!({"hullId":"imported"}),
        json_write: Default::default(),
        ordered_json: None,
    }))
    .unwrap();
    assert_eq!(result.identity_changes[0].after.id, "imported");
    assert!(root.join("data/hulls/imported.ship").exists());
    project::close_project_session(manifest.session_id).unwrap();
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
    let loaded = file_editor::load_project_editable_file(
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
        io::read_csv_data(&root.join("data/hulls/ship_data.csv"))
            .unwrap()
            .rows[0]
            .data["id"],
        "old"
    );
    project::close_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn core_projectile_saves_to_mod_override_and_keeps_core_source() {
    let game = project_workspace("identity_core_projectile");
    let root = game.join("mods/demo");
    fs::create_dir_all(&root).unwrap();
    fs::create_dir_all(game.join("starsector-core/data/weapons/proj/nested")).unwrap();
    let core = game.join("starsector-core/data/weapons/proj/nested/filename.proj");
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
    assert_eq!(
        info.target.source.as_ref().unwrap().rel_path,
        "data/weapons/proj/nested/filename.proj"
    );
    assert_eq!(info.target.write.rel_path, "data/weapons/proj/core.proj");
    assert_eq!(info.base_versions[0].fingerprint, None);
    let saved = project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        target: info.target,
        base_versions: info.base_versions,
        data: json!({"id":"core","width":8}),
        json_write: Default::default(),
        ordered_json: None,
    }))
    .unwrap();
    assert_eq!(io::read_json_file(&core).unwrap()["width"], 4);
    assert_eq!(
        io::read_json_file(&root.join("data/weapons/proj/core.proj")).unwrap()["width"],
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
    project::close_project_session(manifest.session_id).unwrap();
    game.close().unwrap();
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
        data: json!({"hullId":"next"}),
        json_write: Default::default(),
        ordered_json: None,
    }))
    .unwrap_err();
    assert_eq!(failed.code(), "write.version_conflict");
    assert_eq!(io::read_json_file(&file).unwrap()["hullId"], "demo");
    assert!(
        write_transactions::query_history(&manifest.session_id, &manifest.mod_root)
            .unwrap()
            .undo_stack
            .is_empty()
    );
    project::close_project_session(manifest.session_id).unwrap();
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
            data: json!({"hullId":"next"}),
            json_write: Default::default(),
            ordered_json: None,
        }))
        .unwrap_err();
        assert_eq!(error.code(), "write.version_scope_missing");
        assert_eq!(io::read_json_file(&path).unwrap()["hullId"], "demo");
    }
    assert!(
        write_transactions::query_history(&manifest.session_id, &manifest.mod_root)
            .unwrap()
            .undo_stack
            .is_empty()
    );
    project::close_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}
