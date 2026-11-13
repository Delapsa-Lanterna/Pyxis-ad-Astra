use super::content;
use crate::domain::entity_definitions::{self, EntitySpecDefinition};
use crate::domain::entity_identity;
use crate::errors::{AppError, AppResult};
use crate::io::FileChangeSetBuilder;
use crate::models::file_content::JsonSource;
use crate::models::file_value::Value as FileValue;
use crate::models::{
    EntityKind, EntityTargetState, JsonFileDelete, JsonFileSave, WriteContentTarget, WriteResult,
};
use crate::services::project::model::ProjectSession;
use crate::services::project::query::entity_targets;
use crate::services::project::sources::{core, json_documents};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

pub fn spec_entity_definition(kind: EntityKind) -> AppResult<&'static EntitySpecDefinition> {
    entity_definitions::entity_spec_definition(kind)
        .ok_or_else(|| AppError::message("spec.kind_unknown", "此实体没有 JSON 规格定义"))
}
pub fn save_file_entity(input: &JsonFileSave, kind: EntityKind) -> AppResult<WriteResult<Value>> {
    entity_targets::require_entity_version_scope(
        &input.session_id,
        kind,
        input.previous_id.as_deref().unwrap_or(&input.next_id),
        &input.base_versions,
    )?;
    json_file_save_context(
        &input.session_id,
        kind,
        input.previous_id.as_deref(),
        &input.next_id,
        input.rel_path.as_deref(),
    )?;
    let definition = spec_entity_definition(kind)?;
    let next = entity_identity::validate_entity_id(&input.next_id, definition.invalid_id_message)?;
    if input
        .document
        .content
        .get(definition.id_field)
        .is_some_and(|value| match value {
            FileValue::Text(value) => value
                .as_str()
                .is_some_and(|value| !value.is_empty() && value != next),
            _ => true,
        })
    {
        return Err(AppError::message(
            "spec.id_mismatch",
            "文件内容 ID 与保存目标不一致",
        ));
    }
    let before = entity_targets::query_entity_edit_target(
        &input.session_id,
        kind,
        input.previous_id.as_deref().unwrap_or(next),
    )?
    .target;
    let result = content::save_entity_spec(
        &input.session_id,
        &before,
        next,
        &input.document,
        &input.json_write,
    )?;
    let after = &result.identity_changes[0].after;
    let saved = &result.content.as_ref().expect("specification output").value;
    let actual = JsonSource {
        text: Arc::from(saved.source.as_str()),
        content: saved.content.clone(),
    };
    let value = if kind == EntityKind::Variant {
        serde_json::to_value(json_documents::build_variant_file(
            Path::new(&input.mod_root),
            &after.write.rel_path,
            &actual,
        )?)?
    } else {
        serde_json::to_value(json_documents::build_skin_file(
            Path::new(&input.mod_root),
            &after.write.rel_path,
            &actual,
        )?)?
    };
    let target = WriteContentTarget::Json {
        origin: after.into(),
    };
    Ok(result.with_content(target, value))
}

pub fn create_json_entity_file(
    input: &JsonFileSave,
    kind: EntityKind,
) -> AppResult<WriteResult<Value>> {
    let target =
        entity_targets::query_entity_edit_target(&input.session_id, kind, &input.next_id)?.target;
    if target.state == EntityTargetState::Existing {
        return Err(AppError::EntityTargetExists {
            target: Box::new(target),
        });
    }
    save_file_entity(input, kind)
}
pub fn delete_json_entity_file(input: &JsonFileDelete, kind: EntityKind) -> AppResult<WriteResult> {
    entity_targets::require_entity_version_scope(
        &input.session_id,
        kind,
        &input.entity_id,
        &input.base_versions,
    )?;
    let target =
        entity_targets::query_entity_edit_target(&input.session_id, kind, &input.entity_id)?.target;
    if target.write.rel_path != input.rel_path {
        return Err(AppError::message(
            "spec.target_changed",
            "所选删除文件已经改变",
        ));
    }
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    builder.text_file(&target.write.rel_path, None)?;
    Ok(WriteResult::from_changes(builder.apply()?))
}
pub(in crate::services::project) fn validate_skin_engine_changes_in(
    session: &ProjectSession,
    data: &Value,
) -> AppResult<()> {
    if data
        .get("engineSlotChanges")
        .and_then(Value::as_object)
        .is_none_or(|changes| changes.is_empty())
    {
        return Ok(());
    }
    let ships = session
        .manifest
        .starsector_root
        .as_deref()
        .map(core::load_core_ship_files)
        .transpose()?;
    let skins = session
        .manifest
        .starsector_root
        .as_deref()
        .map(core::load_core_skin_files)
        .transpose()?;
    let mut id = data["baseHullId"].as_str().ok_or_else(|| {
        AppError::message("config.missing_field", "缺少 baseHullId").at_field("baseHullId")
    })?;
    let mut layers = vec![data];
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(id) {
            return Err(
                AppError::message("skin.base_cycle", "循环船体皮肤引用").at_field("baseHullId")
            );
        }
        let skin = session
            .skin_files
            .iter()
            .find(|skin| skin.skin_hull_id == id)
            .or_else(|| {
                skins
                    .as_ref()
                    .and_then(|skins| skins.iter().find(|skin| skin.skin_hull_id == id))
            });
        let Some(skin) = skin else {
            break;
        };
        layers.push(&skin.data);
        id = skin.data["baseHullId"]
            .as_str()
            .expect("loaded skin base ID");
    }
    let hull = session
        .ship_files
        .get(id)
        .or_else(|| ships.as_ref().and_then(|ships| ships.get(id)))
        .ok_or_else(|| {
            AppError::message("config.reference_missing", format!("找不到基础船体：{id}"))
                .at_field("baseHullId")
        })?;
    let mut count = hull.data["engineSlots"].as_array().map_or(0, Vec::len);
    for layer in layers.into_iter().rev() {
        let removed = layer["removeEngineSlots"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_u64)
            .filter(|index| *index < count as u64)
            .collect::<BTreeSet<_>>();
        count -= removed.len();
        if let Some(changes) = layer["engineSlotChanges"].as_object() {
            for key in changes.keys() {
                if !key.parse::<usize>().is_ok_and(|index| index < count) {
                    return Err(AppError::message(
                        "config.shape_invalid",
                        format!("引擎槽索引超出当前船体范围：{key}"),
                    )
                    .at_field(format!("engineSlotChanges[{key:?}]")));
                }
            }
        }
    }
    Ok(())
}

pub fn json_file_save_context(
    session: &str,
    kind: EntityKind,
    previous: Option<&str>,
    next: &str,
    relative: Option<&str>,
) -> AppResult<bool> {
    let target =
        entity_targets::query_entity_edit_target(session, kind, previous.unwrap_or(next))?.target;
    if let Some(relative) = relative {
        if target.write.rel_path != relative {
            return Err(
                AppError::message("spec.target_changed", "所选文件与保存来源不一致")
                    .at_path(Path::new(relative)),
            );
        }
        Ok(target.source.is_some())
    } else if previous.is_some() {
        Err(AppError::message(
            "spec.source_path_required",
            "编辑实体缺少所选文件路径",
        ))
    } else {
        Ok(false)
    }
}
