use crate::models::{JsonFileDelete, JsonFileSave};
use crate::{
    errors::AppError,
    models::{EntityKind, WriteResult},
};
use serde_json::Value;
use std::path::Path;

use crate::services::{
    JsonEntityFileInput, create_json_entity_file, delete_json_entity_file, save_json_entity_file,
    spec_entity_definition,
};
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
    let current = crate::services::config_entity::prepare_json_entity_save(
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
    payload.next_id = crate::models::file_content_id(
        &payload.data,
        id_field,
        Path::new(payload.rel_path.as_ref().expect("entity path")),
    );
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
    let composition = crate::services::project::composition_for_session(
        &payload.session_id,
        payload.rel_path.as_deref().expect("skin source path"),
    )?;
    let effective =
        crate::domain::json_composition::compose_game_json(&composition, &payload.data)?;
    if effective.get("baseHullId").is_some() {
        crate::services::validate_skin_engine_changes(&payload.session_id, &effective)?;
    }
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
