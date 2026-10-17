use crate::{
    errors::AppError,
    models::{
        DeleteIndexedConfigEntityPayload, IndexedConfigEntityPayload, SaveModInfoPayload,
        WriteResult,
    },
    services,
};
use serde_json::Value;

#[tauri::command(async)]
pub fn save_mod_info(
    payload: SaveModInfoPayload,
) -> Result<WriteResult<serde_json::Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::config_entity::save_mod_info(
        &payload.mod_root,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    transaction.commit(result, "保存 Mod 信息")
}

#[tauri::command(async)]
pub fn save_indexed_config_entity(
    payload: IndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        payload.previous_id.as_deref().unwrap_or(&payload.next_id),
        &payload.base_versions,
    )?;
    if payload.kind == crate::models::IndexedConfigKind::Faction {
        let result = services::save_faction_entity(
            &payload.session_id,
            payload.previous_id.as_deref(),
            &payload.next_id,
            payload.entity_data,
            payload.json_write,
            payload.ordered_json.as_deref(),
        )?;
        return transaction.commit(result, "保存势力");
    }
    let result = services::config_entity::save_mission_with_json(
        &payload.mod_root,
        payload.previous_id.as_deref(),
        &payload.next_id,
        services::config_entity::MissionSaveInput {
            index_row: payload.index_row,
            entity_data: payload.entity_data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )?;
    transaction.commit(result, "保存配置实体")
}

#[tauri::command(async)]
pub fn create_indexed_config_entity(
    payload: IndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        &payload.next_id,
        &payload.base_versions,
    )?;
    if payload.kind == crate::models::IndexedConfigKind::Faction {
        let result = services::save_faction_entity(
            &payload.session_id,
            None,
            &payload.next_id,
            payload.entity_data,
            Default::default(),
            None,
        )?;
        return transaction.commit(result, "创建势力");
    }
    let result = services::config_entity::create_mission_entity(
        &payload.mod_root,
        &payload.next_id,
        payload.index_row,
        payload.entity_data,
    )?;
    transaction.commit(result, "创建配置实体")
}

#[tauri::command(async)]
pub fn delete_indexed_config_entity(
    payload: DeleteIndexedConfigEntityPayload,
) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        &payload.id,
        &payload.base_versions,
    )?;
    if payload.kind == crate::models::IndexedConfigKind::Faction {
        let result = services::delete_faction_entity(
            &payload.session_id,
            &payload.id,
            payload.delete_target,
        )?;
        return transaction.commit(result, "删除势力");
    }
    let result = services::config_entity::delete_mission_entity(
        &payload.mod_root,
        &payload.id,
        payload.delete_target,
    )?;
    transaction.commit(result, "删除配置实体")
}
