use crate::domain::entity_definitions::editor_spec_definition;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::SpecEditorKind;
use crate::models::file_content::JsonFileContent;
use std::path::Path;

pub fn load_imported_editor_spec_file(
    kind: SpecEditorKind,
    path: String,
) -> AppResult<JsonFileContent> {
    let definition = editor_spec_definition(kind)?;
    let path = Path::new(&path);
    io::validate_safe_absolute_path(path, "imported specification")?;
    io::validate_walk_entry(path, "imported specification")?;
    if path.extension().and_then(|extension| extension.to_str())
        != Some(definition.extension_without_dot())
    {
        return Err(AppError::message(
            "spec.extension_invalid",
            format!("规格文件扩展名应为 {}", definition.extension),
        )
        .at_path(path));
    }
    io::read_json_file(path).map(|source| JsonFileContent::from(&source))
}

#[cfg(test)]
mod tests {
    use crate::domain::entity_identity;
    use crate::services::spec_editor;

    use crate::models::{JsonWriteOptions, WriteResult};
    use crate::services::file_history::query_file_history;
    use crate::services::project_sync::release_project_session;
    use serde_json::Value;

    use super::*;
    #[cfg(test)]
    use crate::domain::entity_construction;
    use crate::errors::AppResult;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::models::file_content::SaveLayout;
    #[cfg(test)]
    use crate::models::{
        AssociatedSpecCreateParams, EntityKind, SaveAction, SpecSave, WeaponSpecClass,
    };
    #[cfg(test)]
    use crate::services;
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::{project, project_save};
    use crate::test_support::TestWorkspace;
    use crate::test_support::file_formats;
    use std::fs;
    use std::path::PathBuf;

    fn load_imported_editor_spec_file(kind: SpecEditorKind, path: String) -> AppResult<Value> {
        spec_editor::load_imported_editor_spec_file(kind, path)?
            .content
            .to_json()
            .map_err(Into::into)
    }
    fn save_editor_spec(
        root: &str,
        kind: SpecEditorKind,
        id: &str,
        data: Value,
    ) -> AppResult<WriteResult<Value>> {
        save_editor_spec_with_json_options(root, kind, id, data, Default::default(), None)
    }
    fn save_editor_spec_with_json_options(
        root: &str,
        kind: SpecEditorKind,
        id: &str,
        data: Value,
        options: JsonWriteOptions,
        order: Option<&str>,
    ) -> AppResult<WriteResult<Value>> {
        entity_identity::validate_entity_id(id, "无效武器 ID")?;
        let kind = match kind {
            SpecEditorKind::Ship => EntityKind::Ship,
            SpecEditorKind::Weapon => EntityKind::Weapon,
            SpecEditorKind::Projectile => EntityKind::Projectile,
            SpecEditorKind::System => EntityKind::System,
        };
        let manifest = project::open_project_session_traced(
            Path::new(root),
            None,
            &mut PerformanceTrace::new("spec.fixture"),
        )?;
        let result = (|| {
            let target = services::query_entity_edit_target(&manifest.session_id, kind, id)?.target;
            let data = order.map(serde_json::from_str).transpose()?.unwrap_or(data);
            let mut document = if Path::new(&target.write.path).exists() {
                file_formats::json_write_from_source(
                    &io::read_json_file(Path::new(&target.write.path))?,
                    &data,
                )
            } else {
                file_formats::json_write(&data)
            };
            document.layout = if options.preserve_structure {
                SaveLayout::PreserveStructure
            } else {
                SaveLayout::Expanded
            };
            let actual =
                services::save_entity_spec(&manifest.session_id, &target, id, document, options)?;
            let target = actual.content.as_ref().unwrap().target.clone();
            let value = actual.content.as_ref().unwrap().value.content.to_json()?;
            Ok(actual.with_content(target, value))
        })();
        release_project_session(manifest.session_id)?;
        result
    }
    fn read_json_file(path: &Path) -> AppResult<Value> {
        file_formats::read_json_value(path)
    }

    #[test]
    fn empty_weapon_editor_mounts_preserve_file_and_history_until_corrected() {
        for spec_class in [WeaponSpecClass::Projectile, WeaponSpecClass::Beam] {
            let root = project_workspace("weapon_editor_required_points");
            fs::create_dir_all(root.join("data/weapons")).unwrap();
            let path = root.join("data/weapons/fixture.wpn");
            let mut valid =
                entity_construction::create_associated_spec(&AssociatedSpecCreateParams::Weapon {
                    id: "fixture".into(),
                    spec_class,
                });
            write_utf8_no_bom(&path, &valid.to_string()).unwrap();
            let original = read_utf8_no_bom(&path).unwrap();
            let mut trace = PerformanceTrace::new("project.openSession");
            let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
            let info = services::query_entity_edit_target(
                &manifest.session_id,
                EntityKind::Weapon,
                "fixture",
            )
            .unwrap();
            let save = |data| {
                project_save::execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    target: info.target.clone(),
                    base_versions: info.base_versions.clone(),
                    document: file_formats::json_write(&data),
                    json_write: Default::default(),
                }))
            };
            for (field, code) in [
                ("turretOffsets", "spec.weapon_turret_barrel_required"),
                ("hardpointOffsets", "spec.weapon_hardpoint_barrel_required"),
            ] {
                let mut empty = valid.clone();
                empty[field] = serde_json::json!([]);
                let error = save(empty).unwrap_err();
                assert_eq!(error.code(), code);
                assert_eq!(read_utf8_no_bom(&path).unwrap(), original);
                assert!(
                    query_file_history(&manifest.session_id, &manifest.mod_root)
                        .unwrap()
                        .undo_stack
                        .is_empty()
                );
            }
            valid["turretOffsets"] = serde_json::json!([4, 5]);
            let saved = save(valid.clone()).unwrap();
            assert_eq!(read_json_file(&path).unwrap(), valid);
            assert_eq!(
                saved
                    .content
                    .map(
                        |content| serde_json::from_value::<JsonFileContent>(content.value)
                            .unwrap()
                            .content
                            .to_json()
                            .unwrap()
                    ),
                Some(valid)
            );
            assert_eq!(saved.history.undo_stack.len(), 1);
            release_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn pulse_import_can_be_read_and_corrected_before_structured_save() {
        let root = project_workspace("pulse_editor_read_correct_save");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let path = root.join("data/weapons/demo.wpn");
        let original = r#"{"id":"demo","specClass":"pulse","turretOffsets":[0,0],"hardpointOffsets":[0,0],"builtInWeapons":{"_slot":"w"},"array":[{"_field":1}]}"#;
        write_utf8_no_bom(&path, original).unwrap();
        let mut content =
            load_imported_editor_spec_file(SpecEditorKind::Weapon, path.to_string_lossy().into())
                .unwrap();
        let error = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Weapon,
            "demo",
            content.clone(),
        )
        .unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert_eq!(read_utf8_no_bom(&path).unwrap(), original);
        content["specClass"] = Value::String("projectile".into());
        let saved = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Weapon,
            "demo",
            content.clone(),
        )
        .unwrap();
        assert_eq!(read_json_file(&path).unwrap(), content);
        assert_eq!(saved.content.map(|content| content.value), Some(content));
        root.close().unwrap();
    }

    #[test]
    fn editor_spec_receipts_match_persisted_content_and_preserved_noops() {
        for kind in [
            SpecEditorKind::Ship,
            SpecEditorKind::Weapon,
            SpecEditorKind::Projectile,
            SpecEditorKind::System,
        ] {
            let definition = editor_spec_definition(kind).unwrap();
            let root = project_workspace(&format!(
                "spec_receipt_{}",
                definition.extension_without_dot()
            ));
            fs::create_dir_all(root.join(definition.dir)).unwrap();
            let target = root
                .join(definition.dir)
                .join(format!("demo.{}", definition.extension_without_dot()));
            let mut data = serde_json::json!({definition.id_field: "demo", "nested": {"_slot": 2}, "_tool": true});
            if kind == SpecEditorKind::Weapon {
                data["specClass"] = Value::String("projectile".to_string());
                data["turretOffsets"] = serde_json::json!([0, 0]);
                data["hardpointOffsets"] = serde_json::json!([0, 0]);
            }
            let result = save_editor_spec(&root.to_string_lossy(), kind, "demo", data).unwrap();
            let persisted = read_json_file(&target).unwrap();
            assert_eq!(
                result.content.map(|content| content.value),
                Some(persisted.clone())
            );
            let noop = save_editor_spec_with_json_options(
                &root.to_string_lossy(),
                kind,
                "demo",
                persisted.clone(),
                JsonWriteOptions {
                    replace_paths: Vec::new(),
                    keep_filename: false,
                    preserve_structure: true,
                },
                None,
            )
            .unwrap();
            assert!(noop.changes.is_empty());
            assert_eq!(noop.content.map(|content| content.value), Some(persisted));
            root.close().unwrap();
        }
    }

    #[test]
    fn save_editor_spec_uses_fixed_weapon_target_boundary() {
        let root = project_workspace("save_editor_weapon_spec");
        fs::create_dir_all(root.join("data/weapons/nested")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/nested/demo.wpn"),
            r#"{"id":"demo","weaponType":"BALLISTIC"}"#,
        )
        .unwrap();

        let result = save_editor_spec(
                &root.to_string_lossy(),
                SpecEditorKind::Weapon,
                "demo",
                serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY", "turretOffsets":[0,0], "hardpointOffsets":[0,0]}),
            )
            .unwrap();

        let target = root
            .join("data/weapons/nested/demo.wpn")
            .canonicalize()
            .unwrap();
        let text = read_utf8_no_bom(&target).unwrap();
        assert_eq!(invalidation_paths(&result), [target]);
        assert!(text.contains("\"weaponType\": \"ENERGY\""));
        root.close().unwrap();
    }

    #[test]
    fn editor_spec_save_preserves_existing_comments_and_normalizing_mode_rewrites() {
        let root = project_workspace("save_editor_spec_json_modes");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        let target = root.join("data/weapons/demo.wpn");
        write_utf8_no_bom(
            &target,
            "{\n  # important\n  weaponType: BALLISTIC,\n  id: 'demo'\n}\n",
        )
        .unwrap();
        let saved = save_editor_spec_with_json_options(
                &root.to_string_lossy(),
                SpecEditorKind::Weapon,
                "demo",
                serde_json::json!({"id":"demo","specClass":"projectile","weaponType":"ENERGY","turretOffsets":[0,0],"hardpointOffsets":[0,0]}),
                JsonWriteOptions {
                    replace_paths: Vec::new(),
                    keep_filename: false,
                    preserve_structure: true,
                },
                Some(r#"{"weaponType":"ENERGY","id":"demo","specClass":"projectile","turretOffsets":[0,0],"hardpointOffsets":[0,0]}"#),
            )
            .unwrap();
        let preserved = read_utf8_no_bom(&target).unwrap();
        assert_eq!(saved.changes.len(), 1);
        assert!(preserved.contains("# important"));
        assert!(preserved.find("weaponType").unwrap() < preserved.find("id:").unwrap());
        let normalized = save_editor_spec_with_json_options(
                &root.to_string_lossy(),
                SpecEditorKind::Weapon,
                "demo",
                serde_json::json!({"id":"demo","specClass":"projectile","weaponType":"ENERGY","turretOffsets":[0,0],"hardpointOffsets":[0,0]}),
                JsonWriteOptions::default(),
                None,
            )
            .unwrap();
        assert_eq!(normalized.changes.len(), 1);
        assert!(!read_utf8_no_bom(&target).unwrap().contains("# important"));
        root.close().unwrap();
    }

    #[test]
    fn save_editor_spec_uses_fixed_ship_target_boundary() {
        let root = project_workspace("save_editor_unknown_spec");
        fs::create_dir_all(root.join("data/hulls")).unwrap();

        let result = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Ship,
            "demo",
            serde_json::json!({"hullId": "demo"}),
        )
        .unwrap();

        let target = root.join("data/hulls/demo.ship").canonicalize().unwrap();
        let text = read_utf8_no_bom(&target).unwrap();
        assert_eq!(invalidation_paths(&result), [target]);
        assert!(text.contains("\"hullId\": \"demo\""));
        root.close().unwrap();
    }

    #[test]
    fn save_editor_spec_does_not_skip_broken_target_candidates() {
        let root = project_workspace("save_editor_broken_candidate");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons/broken.wpn"), "{").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Weapon,
            "demo",
            serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let default_target_exists = root.join("data/weapons/demo.wpn").exists();

        assert!(error.contains("broken.wpn"));
        assert!(!default_target_exists);
        root.close().unwrap();
    }

    #[test]
    fn save_editor_spec_rejects_non_directory_candidate_root() {
        let root = project_workspace("save_editor_non_directory_root");
        fs::create_dir_all(root.join("data")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons"), "not a directory").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Weapon,
            "demo",
            serde_json::json!({"id": "demo", "specClass":"projectile", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let default_target_exists = root.join("data/weapons/demo.wpn").exists();

        assert!(error.contains("directory"), "{error}");
        assert!(!default_target_exists);
        root.close().unwrap();
    }

    #[test]
    fn save_editor_spec_rejects_invalid_id_before_candidate_scan() {
        let root = project_workspace("save_editor_invalid_id_before_scan");
        fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(&root.join("data/weapons/broken.wpn"), "{").unwrap();

        let error = save_editor_spec(
            &root.to_string_lossy(),
            SpecEditorKind::Weapon,
            "../outside",
            serde_json::json!({"id": "../outside", "weaponType": "ENERGY"}),
        )
        .unwrap_err()
        .to_string();
        let outside_target_exists = root.join("data/outside.wpn").exists();

        assert!(error.contains("无效武器 ID"));
        assert!(!outside_target_exists);
        root.close().unwrap();
    }

    #[test]
    fn load_imported_editor_spec_file_requires_matching_extension() {
        let root = project_workspace("load_imported_spec_extension");
        let path = root.join("demo.ship");
        write_utf8_no_bom(&path, r#"{"hullId":"demo"}"#).unwrap();

        let error = load_imported_editor_spec_file(
            SpecEditorKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("规格文件扩展名应为 .wpn"));
        root.close().unwrap();
    }

    #[test]
    fn load_imported_editor_spec_file_rejects_parent_dir_path() {
        let root = project_workspace("load_imported_spec_parent_dir");
        let path = root.literal_path("../demo.wpn");

        let error = load_imported_editor_spec_file(
            SpecEditorKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("imported specification"));
        root.close().unwrap();
    }

    #[test]
    fn load_imported_editor_spec_file_rejects_link_file() {
        let (root, outside, link) =
            TestWorkspace::file_link("load_imported_spec_link", "demo.wpn").unwrap();
        write_utf8_no_bom(&outside, r#"{"id":"demo","weaponType":"ENERGY"}"#).unwrap();

        let result = load_imported_editor_spec_file(
            SpecEditorKind::Weapon,
            link.to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn load_imported_editor_spec_file_reads_matching_spec() {
        let root = project_workspace("load_imported_spec_reads");
        let path = root.join("demo.wpn");
        write_utf8_no_bom(&path, r#"{"id":"demo","weaponType":"ENERGY"}"#).unwrap();

        let value = load_imported_editor_spec_file(
            SpecEditorKind::Weapon,
            path.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(value.get("id").and_then(Value::as_str), Some("demo"));
        root.close().unwrap();
    }

    fn invalidation_paths(result: &WriteResult<Value>) -> Vec<PathBuf> {
        result
            .invalidation
            .paths
            .iter()
            .map(PathBuf::from)
            .collect()
    }
}
