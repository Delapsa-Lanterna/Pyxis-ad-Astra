use crate::models::{JsonFileDelete, JsonFileSave};
use crate::{
    domain::entity_definitions::{EntitySpecDefinition, entity_spec_definition},
    domain::entity_identity::validate_entity_id,
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_json_file,
    },
    models::{EntityKind, JsonWriteOptions, WriteResult},
};
use serde_json::Value;
use std::path::Path;

pub struct JsonEntityFileInput<'a> {
    pub source_rel_path: Option<&'a str>,
    pub target_exists_in_index: bool,
    pub data: Value,
    pub json_write: JsonWriteOptions,
    pub ordered_json: Option<&'a str>,
}

pub fn save_json_entity_file(
    mod_root: &str,
    kind: EntityKind,
    previous_id: Option<&str>,
    next_id: &str,
    input: JsonEntityFileInput<'_>,
) -> AppResult<WriteResult<Value>> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let JsonEntityFileInput {
        source_rel_path,
        target_exists_in_index,
        mut data,
        json_write,
        ordered_json,
    } = input;
    let definition = spec_entity_definition(kind)?;
    let next_id = validate_entity_id(next_id, definition.invalid_id_message)?.to_string();
    let content_id = data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message(
                "spec.id_mismatch",
                format!(
                    "{}数据缺少 {}",
                    definition.display_name, definition.id_field
                ),
            )
        })?;
    if validate_entity_id(content_id, definition.invalid_id_message)? != next_id {
        return Err(AppError::message(
            "spec.id_mismatch",
            format!(
                "{}数据 {} 与保存目标不一致",
                definition.display_name, definition.id_field
            ),
        ));
    }
    data[definition.id_field] = Value::String(next_id.clone());
    let mod_root = Path::new(mod_root);
    let previous_id = previous_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| validate_entity_id(value, definition.invalid_id_message).map(str::to_string))
        .transpose()?;
    let renamed = previous_id.as_deref().is_some_and(|id| id != next_id);
    let next_rel_path = if let Some(source) = source_rel_path {
        let source_id = previous_id.as_deref().unwrap_or(&next_id);
        require_spec_file_target(mod_root, definition, kind, source_id, source)?;
        if renamed {
            crate::io::forward_slash_path(
                &Path::new(source).with_file_name(format!("{next_id}{}", definition.extension)),
            )
        } else {
            source.to_string()
        }
    } else {
        if previous_id.is_some() {
            return Err(AppError::message(
                "spec.source_path_required",
                "编辑实体缺少选中文件路径",
            ));
        }
        definition.default_rel_path(&next_id)
    };
    let target = mod_root.join(&next_rel_path);
    let source_path = source_rel_path.map(|source| mod_root.join(source));
    let same_file = source_path
        .as_ref()
        .is_some_and(|source| crate::io::same_physical_path(source, &target));
    if (renamed || source_rel_path.is_none())
        && ((target.exists() && !same_file) || target_exists_in_index)
    {
        return Err(AppError::message(
            "spec.target_exists",
            format!("{}目标已存在: {next_rel_path}", definition.display_name),
        ));
    }

    let (_, refreshed) = build_spec_file(kind, mod_root, &next_rel_path, &data)?;

    let existing = source_rel_path.is_some();
    let source_rel_path = source_rel_path.unwrap_or(&next_rel_path);
    let boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let source_path = boundary.resolve_relative(source_rel_path, "实体源路径")?;
    let preserve_original_json = json_write.preserve_original_json;
    let mut json = JsonWriteBatch::new(json_write);
    let rendered = json.render(&source_path, &data, ordered_json)?;
    json.finish()?;
    let unchanged = preserve_original_json
        && source_rel_path == next_rel_path
        && source_path.exists()
        && crate::io::read_utf8_no_bom(&source_path)? == rendered;
    let changes = if unchanged {
        Vec::new()
    } else {
        let mut builder = FileChangeSetBuilder::new_with_lock(mod_root, write_lock)?;
        if renamed {
            builder.rename_text_file(source_rel_path, &next_rel_path, rendered)?;
        } else {
            builder.text_file(&next_rel_path, Some(rendered))?;
        }
        builder.apply()?
    };

    let result: WriteResult = WriteResult::new(changes, Vec::new(), None);
    let source_id = previous_id.as_deref().unwrap_or(&next_id);
    let before_location = crate::models::EntityFileLocation {
        source: crate::models::ResourceSource::Mod,
        root: boundary.root().to_string_lossy().to_string(),
        rel_path: source_rel_path.to_string(),
        path: source_path.to_string_lossy().to_string(),
    };
    let next_location = crate::models::EntityFileLocation {
        source: crate::models::ResourceSource::Mod,
        root: boundary.root().to_string_lossy().to_string(),
        rel_path: next_rel_path.clone(),
        path: boundary
            .root()
            .join(&next_rel_path)
            .to_string_lossy()
            .to_string(),
    };
    let before = crate::models::EntityEditTarget {
        kind,
        id: source_id.to_string(),
        source: existing.then(|| before_location.clone()),
        write: before_location,
        state: if existing {
            crate::models::EntityTargetState::Existing
        } else {
            crate::models::EntityTargetState::Create
        },
        linked_record: None,
    };
    let after = crate::models::EntityEditTarget {
        kind,
        id: next_id,
        source: Some(next_location.clone()),
        write: next_location,
        state: crate::models::EntityTargetState::Existing,
        linked_record: None,
    };
    let owner = crate::models::WriteContentTarget::Json {
        origin: (&after).into(),
    };
    let mut result = result.with_content(owner, refreshed);
    result
        .identity_changes
        .push(crate::models::EntityIdentityChange { before, after });
    Ok(result)
}

pub fn create_json_entity_file(
    mod_root: &str,
    kind: EntityKind,
    next_id: &str,
    data: Value,
    target_exists_in_index: bool,
) -> AppResult<WriteResult<Value>> {
    save_json_entity_file(
        mod_root,
        kind,
        None,
        next_id,
        JsonEntityFileInput {
            source_rel_path: None,
            target_exists_in_index,
            data,
            json_write: JsonWriteOptions::default(),
            ordered_json: None,
        },
    )
}

pub fn delete_json_entity_file(
    mod_root: &str,
    kind: EntityKind,
    id: &str,
    rel_path: &str,
) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let definition = spec_entity_definition(kind)?;
    validate_entity_id(id, definition.invalid_id_message)?;
    require_spec_file_target(Path::new(mod_root), definition, kind, id, rel_path)?;
    let mut builder = FileChangeSetBuilder::new_with_lock(Path::new(mod_root), write_lock)?;
    builder.text_file(rel_path, None)?;
    let changes = builder.apply()?;
    Ok(WriteResult::from_changes(changes))
}

fn spec_entity_definition(kind: EntityKind) -> AppResult<&'static EntitySpecDefinition> {
    let definition = entity_spec_definition(kind).ok_or_else(|| {
        AppError::message("spec.kind_unknown", format!("spec 定义不存在: {kind:?}"))
    })?;
    match definition.entity_kind {
        EntityKind::Variant | EntityKind::Skin => Ok(definition),
        _ => Err(AppError::message(
            "spec.not_single_file",
            format!("{} 不是单文件 spec 实体", definition.display_name),
        )),
    }
}

pub(crate) fn json_file_save_context(
    session_id: &str,
    kind: EntityKind,
    previous_id: Option<&str>,
    next_id: &str,
    source_rel_path: Option<&str>,
) -> Result<bool, AppError> {
    let target_exists = crate::services::query_entity(session_id, kind, next_id)?.is_some();
    if let Some(source_rel_path) = source_rel_path {
        let source_id = previous_id.unwrap_or(next_id);
        let info = crate::services::query_entity_edit_target(session_id, kind, source_id)?;
        let indexed_rel_path = info.target.write.rel_path;
        if indexed_rel_path != source_rel_path {
            return Err(AppError::message(
                "spec.path_id_mismatch",
                format!("实体路径与会话索引不匹配: {source_rel_path} ({source_id})"),
            ));
        }
    }
    Ok(target_exists)
}

pub(crate) fn prepare_file_save(
    payload: &mut JsonFileSave,
    edits: &[crate::models::SaveEdit],
    identities: &[crate::models::EntityIdentityChange],
    kind: EntityKind,
) -> Result<(), AppError> {
    if payload
        .base_versions
        .iter()
        .any(|version| crate::io::source_recreation_allowed(&payload.mod_root, &version.path))
    {
        return Ok(());
    }
    let id_field = spec_entity_definition(kind)?.id_field;
    let current = crate::services::prepare_json_save(
        &payload.session_id,
        kind,
        payload.previous_id.as_ref().unwrap_or(&payload.next_id),
        edits,
        identities,
    )?;
    payload.previous_id = Some(current.id);
    payload.base_versions = current.base_versions;
    payload.rel_path = Some(current.target.write.rel_path);
    payload.data = current.data;
    payload.next_id = payload.data[id_field]
        .as_str()
        .expect("validated entity ID")
        .to_string();
    payload.ordered_json = Some(serde_json::to_string(&payload.data)?);
    Ok(())
}

pub(crate) fn create_entity_request(
    payload: JsonFileSave,
    kind: EntityKind,
) -> Result<WriteResult<Value>, AppError> {
    if kind == EntityKind::Skin {
        crate::services::validate_skin_engine_changes(&payload.session_id, &payload.data)?;
    }
    crate::services::require_entity_version_scope(
        &payload.session_id,
        kind,
        &payload.next_id,
        &payload.base_versions,
    )?;
    let target_exists =
        crate::services::query_entity(&payload.session_id, kind, &payload.next_id)?.is_some();
    let result = create_json_entity_file(
        &payload.mod_root,
        kind,
        &payload.next_id,
        payload.data,
        target_exists,
    )?;
    Ok(result)
}

pub(crate) fn delete_entity_request(
    payload: JsonFileDelete,
    kind: EntityKind,
) -> Result<WriteResult, AppError> {
    crate::services::require_entity_version_scope(
        &payload.session_id,
        kind,
        &payload.entity_id,
        &payload.base_versions,
    )?;
    json_file_save_context(
        &payload.session_id,
        kind,
        Some(&payload.entity_id),
        &payload.entity_id,
        Some(&payload.rel_path),
    )?;
    let result = delete_json_entity_file(
        &payload.mod_root,
        kind,
        &payload.entity_id,
        &payload.rel_path,
    )?;
    Ok(result)
}

pub fn write_variant_request(payload: JsonFileSave) -> Result<WriteResult<Value>, AppError> {
    crate::services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Variant,
        payload.previous_id.as_deref().unwrap_or(&payload.next_id),
        &payload.base_versions,
    )?;
    json_file_save_context(
        &payload.session_id,
        EntityKind::Variant,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.rel_path.as_deref(),
    )?;
    let result = crate::services::save_variant_entity(
        &payload.session_id,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    Ok(result)
}

pub fn write_skin_request(payload: JsonFileSave) -> Result<WriteResult<Value>, AppError> {
    crate::services::validate_skin_engine_changes(&payload.session_id, &payload.data)?;
    crate::services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Skin,
        payload.previous_id.as_deref().unwrap_or(&payload.next_id),
        &payload.base_versions,
    )?;
    let target_exists = json_file_save_context(
        &payload.session_id,
        EntityKind::Skin,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.rel_path.as_deref(),
    )?;
    let result = save_json_entity_file(
        &payload.mod_root,
        EntityKind::Skin,
        payload.previous_id.as_deref(),
        &payload.next_id,
        JsonEntityFileInput {
            source_rel_path: payload.rel_path.as_deref(),
            target_exists_in_index: target_exists,
            data: payload.data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )?;
    Ok(result)
}

fn require_spec_file_target(
    mod_root: &Path,
    definition: &EntitySpecDefinition,
    kind: EntityKind,
    id: &str,
    rel_path: &str,
) -> AppResult<()> {
    definition.validate_rel_path(rel_path, &format!("{}路径无效", definition.display_name))?;
    let boundary = FsRootBoundary::new(mod_root, "mod root")?;
    let source = boundary.resolve_relative(rel_path, "实体源路径")?;
    if !source.exists()
        && crate::io::source_recreation_allowed(
            &mod_root.to_string_lossy(),
            &source.to_string_lossy(),
        )
    {
        return Ok(());
    }
    let data = read_json_file(&boundary.resolve_relative(rel_path, "实体源路径")?)?;
    let (entity_id, _) = build_spec_file(kind, mod_root, rel_path, &data)?;
    if entity_id != id {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            format!(
                "{}路径与实体 ID 不匹配: {rel_path}",
                definition.display_name
            ),
        ));
    }
    Ok(())
}

/// Variant and skin are the two spec kinds stored as one writable file per
/// entity; the merged save/delete flow exists for exactly these two.
fn build_spec_file(
    kind: EntityKind,
    mod_root: &Path,
    rel_path: &str,
    data: &Value,
) -> AppResult<(String, Value)> {
    crate::domain::schema::validate_document(
        crate::parsers::bundled_schema(if kind == EntityKind::Variant {
            "variant"
        } else {
            "skin"
        }),
        data,
    )?;
    match kind {
        EntityKind::Variant => {
            let file = crate::domain::json_documents::build_variant_file(mod_root, rel_path, data)?;
            let entity_id = file.variant_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        EntityKind::Skin => {
            let file = crate::domain::json_documents::build_skin_file(mod_root, rel_path, data)?;
            let entity_id = file.skin_hull_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        other => Err(AppError::message(
            "spec.not_single_file",
            format!("{other:?} 不是单文件 spec 实体"),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        models::FileChangeReplayDirection,
    };
    use serde_json::json;
    use std::fs;

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
        let text = read_utf8_no_bom(&root.join(format!("{}/new.{ext}", case.dir, ext = case.ext)))
            .unwrap();
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
        let text = read_utf8_no_bom(&root.join(format!("{}/demo.{ext}", case.dir, ext = case.ext)))
            .unwrap();
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
            read_utf8_no_bom(&root.join(format!("{}/other.{ext}", case.dir, ext = case.ext)))
                .unwrap();
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
}
