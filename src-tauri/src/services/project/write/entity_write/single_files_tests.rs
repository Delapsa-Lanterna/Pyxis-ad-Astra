#![cfg(test)]
use super::single_files::*;
use crate::services::project::test_support::project_workspace;
use crate::{
    errors::AppError,
    io::{read_json_file, read_utf8_no_bom, write_utf8_no_bom},
    models::{EntityKind, FileChangeReplayDirection, JsonWriteOptions},
};
use serde_json::{Value, json};
use std::{fs, path::Path};

fn save_input<'a>(rel_path: Option<&'a str>, data: Value) -> JsonEntityFileInput<'a> {
    JsonEntityFileInput {
        source_rel_path: rel_path,
        target_exists_in_index: false,
        data,
        json_write: JsonWriteOptions::default(),
        ordered_json: None,
    }
}

#[test]
fn variant_rename_preserves_old_file_comments_and_key_order() {
    let root = project_workspace("variant_rename_preserves_json");
    fs::create_dir_all(root.join("data/variants")).unwrap();
    let old = root.join("data/variants/old.variant");
    write_utf8_no_bom(
        &old,
        "{\n  # author note\n  hullId: 'demo',\n  variantId: 'old'\n}\n",
    )
    .unwrap();
    let result = save_json_entity_file(
        &root.to_string_lossy(),
        EntityKind::Variant,
        Some("old"),
        "new",
        JsonEntityFileInput {
            source_rel_path: Some("data/variants/old.variant"),
            target_exists_in_index: false,
            data: json!({"hullId":"demo","variantId":"new"}),
            json_write: JsonWriteOptions {
                keep_filename: false,
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
            ordered_json: Some(r#"{"hullId":"demo","variantId":"new"}"#),
        },
    )
    .unwrap();
    let text = read_utf8_no_bom(&root.join("data/variants/new.variant")).unwrap();
    assert_eq!(result.changes.len(), 1);
    assert!(!old.exists());
    assert!(text.contains("# author note"));
    assert!(text.find("hullId").unwrap() < text.find("variantId").unwrap());
    root.close().unwrap();
}

#[test]
fn variant_save_rename_keeps_the_selected_source_directory() {
    let root = project_workspace("variant_nested_source_directory");
    fs::create_dir_all(root.join("data/variants/nested")).unwrap();
    let old = root.join("data/variants/nested/old.variant");
    write_utf8_no_bom(&old, r#"{"hullId":"demo","variantId":"old"}"#).unwrap();
    let result = save_json_entity_file(
        &root.to_string_lossy(),
        EntityKind::Variant,
        Some("old"),
        "new",
        save_input(
            Some("data/variants/nested/old.variant"),
            json!({"hullId":"demo","variantId":"new"}),
        ),
    )
    .unwrap();
    assert!(root.join("data/variants/nested/new.variant").exists());
    assert!(!root.join("data/variants/new.variant").exists());
    assert_eq!(result.changes.len(), 1);
    root.close().unwrap();
}

struct SpecCase {
    kind: EntityKind,
    dir: &'static str,
    ext: &'static str,
    id_field: &'static str,
    companion_field: &'static str,
    companion_value: &'static str,
}

const VARIANT_CASE: SpecCase = SpecCase {
    kind: EntityKind::Variant,
    dir: "data/variants",
    ext: "variant",
    id_field: "variantId",
    companion_field: "hullId",
    companion_value: "hull",
};

const SKIN_CASE: SpecCase = SpecCase {
    kind: EntityKind::Skin,
    dir: "data/hulls/skins",
    ext: "skin",
    id_field: "skinHullId",
    companion_field: "baseHullId",
    companion_value: "base",
};

fn entity_json(case: &SpecCase, id: &str) -> Value {
    json!({ case.id_field: id, case.companion_field: case.companion_value })
}

fn entity_file_json(case: &SpecCase, id: &str) -> String {
    format!(
        "{{\"{}\":\"{id}\",\"{}\":\"{}\"}}",
        case.id_field, case.companion_field, case.companion_value
    )
}

fn rename_with_undo_redo(case: &SpecCase) {
    let root = project_workspace(&format!("spec_entity_{}_rename", case.ext));
    fs::create_dir_all(root.join(case.dir)).unwrap();
    write_utf8_no_bom(
        &root.join(format!("{}/old.{ext}", case.dir, ext = case.ext)),
        &entity_file_json(case, "old"),
    )
    .unwrap();

    let mut data = entity_json(case, "new");
    data[case.companion_field] = json!(case.companion_value);
    match case.kind {
        EntityKind::Variant => data["weaponGroups"] = json!([{"mode":"LINKED","weapons":{}}]),
        EntityKind::Skin => data["builtInWeapons"] = json!({"WS 001": "demo_weapon"}),
        _ => unreachable!(),
    }
    let source = format!("{}/old.{}", case.dir, case.ext);
    let result = save_json_entity_file(
        &root.to_string_lossy(),
        case.kind,
        Some("old"),
        "new",
        save_input(Some(&source), data),
    )
    .unwrap();
    let refreshed = result.content.clone().unwrap().value;

    assert!(
        !root
            .join(format!("{}/old.{ext}", case.dir, ext = case.ext))
            .exists()
    );
    assert!(
        root.join(format!("{}/new.{ext}", case.dir, ext = case.ext))
            .exists()
    );
    assert_eq!(refreshed[case.id_field], "new");
    match case.kind {
        EntityKind::Variant => assert_eq!(refreshed["weaponGroupCount"], 1),
        EntityKind::Skin => assert_eq!(refreshed["builtInWeaponCount"], 1),
        _ => unreachable!(),
    }

    let replay = crate::io::acquire_root_write_lock(&root).unwrap();
    replay
        .apply_changes(&result.changes, FileChangeReplayDirection::Undo)
        .unwrap();
    assert!(
        root.join(format!("{}/old.{ext}", case.dir, ext = case.ext))
            .exists()
    );
    assert!(
        !root
            .join(format!("{}/new.{ext}", case.dir, ext = case.ext))
            .exists()
    );

    replay
        .apply_changes(&result.changes, FileChangeReplayDirection::Redo)
        .unwrap();
    let text =
        read_utf8_no_bom(&root.join(format!("{}/new.{ext}", case.dir, ext = case.ext))).unwrap();
    assert!(text.contains(&format!("\"{}\": \"new\"", case.id_field)));
    root.close().unwrap();
}

fn delete_returns_replayable_changeset(case: &SpecCase) {
    let root = project_workspace(&format!("spec_entity_{}_delete", case.ext));
    fs::create_dir_all(root.join(case.dir)).unwrap();
    write_utf8_no_bom(
        &root.join(format!("{}/demo.{ext}", case.dir, ext = case.ext)),
        &entity_file_json(case, "demo"),
    )
    .unwrap();

    let result = delete_json_entity_file(
        &root.to_string_lossy(),
        case.kind,
        "demo",
        &format!("{}/demo.{ext}", case.dir, ext = case.ext),
    )
    .unwrap();

    assert!(
        !root
            .join(format!("{}/demo.{ext}", case.dir, ext = case.ext))
            .exists()
    );
    crate::io::acquire_root_write_lock(&root)
        .unwrap()
        .apply_changes(&result.changes, FileChangeReplayDirection::Undo)
        .unwrap();
    let text =
        read_utf8_no_bom(&root.join(format!("{}/demo.{ext}", case.dir, ext = case.ext))).unwrap();
    assert!(text.contains(&format!("\"{}\":\"demo\"", case.id_field)));
    root.close().unwrap();
}

fn delete_rejects_rel_path_outside_directory(case: &SpecCase) {
    let root = project_workspace(&format!("spec_entity_{}_external_rel_path", case.ext));
    write_utf8_no_bom(&root.join("mod_info.json"), "{}").unwrap();

    let result =
        delete_json_entity_file(&root.to_string_lossy(), case.kind, "demo", "mod_info.json");

    let text = read_utf8_no_bom(&root.join("mod_info.json")).unwrap();
    assert!(result.is_err());
    assert_eq!(text, "{}");
    root.close().unwrap();
}

fn delete_requires_rel_path_entity_match(case: &SpecCase) {
    let root = project_workspace(&format!("spec_entity_{}_matching_id", case.ext));
    fs::create_dir_all(root.join(case.dir)).unwrap();
    write_utf8_no_bom(
        &root.join(format!("{}/other.{ext}", case.dir, ext = case.ext)),
        &entity_file_json(case, "other"),
    )
    .unwrap();

    let result = delete_json_entity_file(
        &root.to_string_lossy(),
        case.kind,
        "demo",
        &format!("{}/other.{ext}", case.dir, ext = case.ext),
    );

    let text =
        read_utf8_no_bom(&root.join(format!("{}/other.{ext}", case.dir, ext = case.ext))).unwrap();
    assert!(result.is_err());
    assert!(text.contains(&format!("\"{}\":\"other\"", case.id_field)));
    root.close().unwrap();
}

fn save_requires_data_id_to_match_target_id(case: &SpecCase) {
    let root = project_workspace(&format!("spec_entity_{}_mismatched_data_id", case.ext));
    let result = save_json_entity_file(
        &root.to_string_lossy(),
        case.kind,
        None,
        "new",
        save_input(None, entity_json(case, "other")),
    );

    let target_exists = root
        .join(format!("{}/new.{ext}", case.dir, ext = case.ext))
        .exists();
    assert!(result.is_err());
    assert!(!target_exists);
    root.close().unwrap();
}

#[test]
fn spec_edits_preserve_selected_filename_and_rename_with_replay() {
    for case in [&VARIANT_CASE, &SKIN_CASE] {
        let root = project_workspace(&format!("spec_selected_path_{}", case.ext));
        let source = format!("{}/nested/filename.{}", case.dir, case.ext);
        fs::create_dir_all(root.join(case.dir).join("nested")).unwrap();
        let original = format!(
            "{{\n# author\n{}: 'old',\n{}: '{}'\n}}\n",
            case.id_field, case.companion_field, case.companion_value
        );
        write_utf8_no_bom(&root.join(&source), &original).unwrap();
        let save = save_json_entity_file(
            &root.to_string_lossy(),
            case.kind,
            None,
            "old",
            JsonEntityFileInput {
                json_write: JsonWriteOptions {
                    keep_filename: false,
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ..save_input(Some(&source), entity_json(case, "old"))
            },
        )
        .unwrap();
        assert!(save.changes.is_empty());
        assert_eq!(save.content.unwrap().value["relPath"], source);
        assert_eq!(read_utf8_no_bom(&root.join(&source)).unwrap(), original);
        let renamed = format!("{}/nested/new.{}", case.dir, case.ext);
        let result = save_json_entity_file(
            &root.to_string_lossy(),
            case.kind,
            Some("old"),
            "new",
            JsonEntityFileInput {
                json_write: JsonWriteOptions {
                    keep_filename: false,
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ..save_input(Some(&source), entity_json(case, "new"))
            },
        )
        .unwrap();
        assert_eq!(result.changes.len(), 1);
        assert_eq!(
            Path::new(
                result.content.as_ref().unwrap().value["relPath"]
                    .as_str()
                    .unwrap()
            ),
            Path::new(&renamed)
        );
        assert!(!root.join(&source).exists());
        assert!(
            read_utf8_no_bom(&root.join(&renamed))
                .unwrap()
                .contains("# author")
        );
        let replay = crate::io::acquire_root_write_lock(&root).unwrap();
        replay
            .apply_changes(&result.changes, FileChangeReplayDirection::Undo)
            .unwrap();
        assert_eq!(read_utf8_no_bom(&root.join(&source)).unwrap(), original);
        assert!(!root.join(&renamed).exists());
        replay
            .apply_changes(&result.changes, FileChangeReplayDirection::Redo)
            .unwrap();
        assert!(!root.join(&source).exists());
        assert_eq!(
            read_json_file(&root.join(&renamed)).unwrap()[case.id_field],
            "new"
        );
        root.close().unwrap();
    }
}

#[test]
fn spec_save_validates_disk_id_without_previous_id() {
    for case in [&VARIANT_CASE, &SKIN_CASE] {
        let root = project_workspace(&format!("spec_source_owner_{}", case.ext));
        fs::create_dir_all(root.join(case.dir)).unwrap();
        let source = format!("{}/filename.{}", case.dir, case.ext);
        write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "old")).unwrap();
        let outside_index = format!("{}/unindexed.{}", case.dir, case.ext);
        write_utf8_no_bom(&root.join(&outside_index), &entity_file_json(case, "old")).unwrap();
        write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "other")).unwrap();
        let result = save_json_entity_file(
            &root.to_string_lossy(),
            case.kind,
            None,
            "old",
            save_input(Some(&source), entity_json(case, "old")),
        );
        assert!(matches!(result, Err(AppError::Message { .. })));
        assert_eq!(
            read_json_file(&root.join(&source)).unwrap()[case.id_field],
            "other"
        );
        assert_eq!(
            read_json_file(&root.join(&outside_index)).unwrap()[case.id_field],
            "old"
        );
        root.close().unwrap();
    }
}

#[test]
fn spec_create_rejects_existing_id_in_another_filename() {
    for case in [&VARIANT_CASE, &SKIN_CASE] {
        let root = project_workspace(&format!("spec_create_conflict_{}", case.ext));
        fs::create_dir_all(root.join(case.dir)).unwrap();
        let source = format!("{}/filename.{}", case.dir, case.ext);
        write_utf8_no_bom(&root.join(&source), &entity_file_json(case, "old")).unwrap();
        assert!(
            create_json_entity_file(
                &root.to_string_lossy(),
                case.kind,
                "old",
                entity_json(case, "old"),
                true,
            )
            .is_err()
        );
        let created = create_json_entity_file(
            &root.to_string_lossy(),
            case.kind,
            "new",
            entity_json(case, "new"),
            false,
        )
        .unwrap();
        assert_eq!(
            created.content.unwrap().value["relPath"],
            format!("{}/new.{}", case.dir, case.ext)
        );
        assert_eq!(
            read_json_file(&root.join(&source)).unwrap()[case.id_field],
            "old"
        );
        root.close().unwrap();
    }
}

#[test]
fn variant_save_can_rename_file_with_undo_redo() {
    rename_with_undo_redo(&VARIANT_CASE);
}

#[test]
fn skin_save_can_rename_file_with_undo_redo() {
    rename_with_undo_redo(&SKIN_CASE);
}

#[test]
fn variant_delete_returns_replayable_changeset() {
    delete_returns_replayable_changeset(&VARIANT_CASE);
}

#[test]
fn skin_delete_returns_replayable_changeset() {
    delete_returns_replayable_changeset(&SKIN_CASE);
}

#[test]
fn variant_delete_rejects_rel_path_outside_variant_directory() {
    delete_rejects_rel_path_outside_directory(&VARIANT_CASE);
}

#[test]
fn skin_delete_rejects_rel_path_outside_skin_directory() {
    delete_rejects_rel_path_outside_directory(&SKIN_CASE);
}

#[test]
fn variant_delete_requires_rel_path_entity_match() {
    delete_requires_rel_path_entity_match(&VARIANT_CASE);
}

#[test]
fn skin_delete_requires_rel_path_entity_match() {
    delete_requires_rel_path_entity_match(&SKIN_CASE);
}

#[test]
fn variant_save_requires_data_id_to_match_target_id() {
    save_requires_data_id_to_match_target_id(&VARIANT_CASE);
}

#[test]
fn skin_save_requires_data_id_to_match_target_id() {
    save_requires_data_id_to_match_target_id(&SKIN_CASE);
}
