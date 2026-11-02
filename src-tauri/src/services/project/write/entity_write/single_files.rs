use super::super::super::session::{lock_session, session_handle};
use super::content::save_entity_spec;
use crate::domain::entity_definitions::{EntitySpecDefinition, entity_spec_definition};
use crate::domain::entity_identity::validate_entity_id;
use crate::domain::schema;
use crate::errors::{AppError, AppResult};
use crate::io::{
    FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock, read_json_file,
};
use crate::models::{
    EntityEditTarget, EntityFileLocation, EntityIdentityChange, EntityKind, EntityTargetState,
    JsonWriteOptions, ResourceSource, WriteContentTarget, WriteResult,
};
use crate::services::project;
use crate::services::project::query::entity_targets;
use crate::services::project::sources::{core, json_documents};
use crate::{io, models, parsers};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

pub fn validate_skin_engine_changes(session_id: &str, data: &Value) -> AppResult<()> {
    schema::validate_document(parsers::bundled_schema("skin"), data)?;
    if data
        .get("engineSlotChanges")
        .and_then(Value::as_object)
        .is_none_or(|changes| changes.is_empty())
    {
        return Ok(());
    }
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let core_ships = session
        .manifest
        .starsector_root
        .as_deref()
        .map(core::load_core_ship_files)
        .transpose()?;
    let core_skins = session
        .manifest
        .starsector_root
        .as_deref()
        .map(core::load_core_skin_files)
        .transpose()?;
    let mut id = data["baseHullId"]
        .as_str()
        .ok_or_else(|| AppError::message("config.missing_field", "缺少 baseHullId"))?;
    let mut layers = vec![data];
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(id) {
            return Err(AppError::message("skin.base_cycle", "循环船体皮肤引用"));
        }
        let skin = session
            .skin_files
            .iter()
            .find(|skin| skin.skin_hull_id == id)
            .or_else(|| {
                core_skins
                    .as_ref()
                    .and_then(|skins| skins.iter().find(|skin| skin.skin_hull_id == id))
            });
        let Some(skin) = skin else { break };
        layers.push(&skin.data);
        id = skin.data["baseHullId"]
            .as_str()
            .expect("loaded skin base ID");
    }
    let hull = session
        .ship_files
        .get(id)
        .or_else(|| core_ships.as_ref().and_then(|ships| ships.get(id)))
        .ok_or_else(|| {
            AppError::message("config.reference_missing", format!("找不到基础船体：{id}"))
        })?;
    let mut count = hull.data["engineSlots"].as_array().map_or(0, Vec::len);
    for layer in layers.into_iter().rev() {
        let removed: BTreeSet<_> = layer["removeEngineSlots"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
            })
            .filter(|&index| index >= 0.0 && index < count as f64)
            .map(|index| index as usize)
            .collect();
        count -= removed.len();
        if let Some(changes) = layer["engineSlotChanges"].as_object() {
            for key in changes.keys() {
                if !key.parse::<usize>().is_ok_and(|index| index < count) {
                    return Err(AppError::message(
                        "config.shape_invalid",
                        format!("引擎槽索引超出当前船体范围：engineSlotChanges/{key}"),
                    ));
                }
            }
        }
    }
    Ok(())
}

pub fn save_variant_entity(
    session_id: &str,
    previous_id: Option<&str>,
    next_id: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let content_id = data
        .get("variantId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::message("spec.id_mismatch", "装配数据缺少 variantId"))?;
    if validate_entity_id(content_id, "装配 ID 无效")?
        != validate_entity_id(next_id, "装配 ID 无效")?
    {
        return Err(AppError::message(
            "spec.id_mismatch",
            "装配数据 variantId 与保存目标不一致",
        ));
    }
    let info = entity_targets::query_entity_edit_target(
        session_id,
        EntityKind::Variant,
        previous_id.unwrap_or(next_id),
    )?;
    let result = save_entity_spec(session_id, &info.target, data, options, ordered_json)?;
    let after = &result.identity_changes[0].after;
    let content = &result
        .content
        .as_ref()
        .expect("variant save returns data")
        .value;
    let refreshed = json_documents::build_variant_file(
        Path::new(&after.write.root),
        &after.write.rel_path,
        content,
    )?;
    let owner = WriteContentTarget::Json {
        origin: after.into(),
    };
    Ok(result.with_content(owner, serde_json::to_value(refreshed)?))
}

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
    let content_id = models::file_content_id(
        &data,
        definition.id_field,
        Path::new(source_rel_path.unwrap_or(&next_id)),
    );
    if validate_entity_id(&content_id, definition.invalid_id_message)? != next_id {
        return Err(AppError::message(
            "spec.id_mismatch",
            format!(
                "{}数据 {} 与保存目标不一致",
                definition.display_name, definition.id_field
            ),
        ));
    }
    if data.get(definition.id_field).is_some() {
        data[definition.id_field] = Value::String(next_id.clone());
    }
    let mod_root = Path::new(mod_root);
    let previous_id = previous_id
        .filter(|value| !value.trim().is_empty())
        .map(|value| validate_entity_id(value, definition.invalid_id_message).map(str::to_string))
        .transpose()?;
    let renamed = previous_id.as_deref().is_some_and(|id| id != next_id);
    let next_rel_path = if let Some(source) = source_rel_path {
        let source_id = previous_id.as_deref().unwrap_or(&next_id);
        require_spec_file_target(mod_root, definition, kind, source_id, source)?;
        if renamed && !json_write.keep_filename {
            io::forward_slash_path(
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
        .is_some_and(|source| io::same_physical_path(source, &target));
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
    let replacing = !json_write.replace_paths.is_empty();
    let mut json = JsonWriteBatch::new(json_write);
    let rendered = json.render(&source_path, &data, ordered_json)?;
    let unchanged = preserve_original_json
        && !replacing
        && source_rel_path == next_rel_path
        && source_path.exists()
        && io::read_utf8_no_bom(&source_path)? == rendered;
    let changes = if unchanged {
        json.finish()?;
        Vec::new()
    } else {
        let mut builder = FileChangeSetBuilder::new_with_lock(mod_root, write_lock)?;
        if renamed && source_rel_path != next_rel_path {
            builder.rename_text_file(source_rel_path, &next_rel_path, rendered)?;
        } else {
            builder.text_file(&next_rel_path, Some(rendered))?;
        }
        json.stage_replace_paths(&mut builder)?;
        json.finish()?;
        builder.apply()?
    };

    let result: WriteResult = WriteResult::new(changes, Vec::new(), None);
    let source_id = previous_id.as_deref().unwrap_or(&next_id);
    let before_location = EntityFileLocation {
        reference: None,
        source: ResourceSource::Mod,
        root: boundary.root().to_string_lossy().to_string(),
        rel_path: source_rel_path.to_string(),
        path: source_path.to_string_lossy().to_string(),
    };
    let next_location = EntityFileLocation {
        reference: None,
        source: ResourceSource::Mod,
        root: boundary.root().to_string_lossy().to_string(),
        rel_path: next_rel_path.clone(),
        path: boundary
            .root()
            .join(&next_rel_path)
            .to_string_lossy()
            .to_string(),
    };
    let before = EntityEditTarget {
        kind,
        id: source_id.to_string(),
        source: existing.then(|| before_location.clone()),
        write: before_location,
        state: if existing {
            EntityTargetState::Existing
        } else {
            EntityTargetState::Create
        },
        linked_record: None,
    };
    let after = EntityEditTarget {
        kind,
        id: next_id,
        source: Some(next_location.clone()),
        write: next_location,
        state: EntityTargetState::Existing,
        linked_record: None,
    };
    let owner = WriteContentTarget::Json {
        origin: (&after).into(),
    };
    let mut result = result.with_content(owner, refreshed);
    result
        .identity_changes
        .push(EntityIdentityChange { before, after });
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

pub fn spec_entity_definition(kind: EntityKind) -> AppResult<&'static EntitySpecDefinition> {
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
        && io::source_recreation_allowed(&mod_root.to_string_lossy(), &source.to_string_lossy())
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
    schema::validate_partial_document(
        parsers::bundled_schema(if kind == EntityKind::Variant {
            "variant"
        } else {
            "skin"
        }),
        data,
    )?;
    match kind {
        EntityKind::Variant => {
            let file = project::build_variant_file(mod_root, rel_path, data)?;
            let entity_id = file.variant_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        EntityKind::Skin => {
            let file = project::build_skin_file(mod_root, rel_path, data)?;
            let entity_id = file.skin_hull_id.clone();
            Ok((entity_id, serde_json::to_value(file)?))
        }
        other => Err(AppError::message(
            "spec.not_single_file",
            format!("{other:?} 不是单文件 spec 实体"),
        )),
    }
}
