use crate::{
    errors::AppError,
    models::{DeleteJsonEntityFilePayload, EntityKind, JsonEntityFilePayload, WriteResult},
    services,
};
use serde_json::Value;

fn json_file_save_context(
    session_id: &str,
    kind: EntityKind,
    previous_id: Option<&str>,
    next_id: &str,
    source_rel_path: Option<&str>,
) -> Result<bool, AppError> {
    let target_exists = services::query_entity(session_id, kind, next_id)?.is_some();
    if let Some(source_rel_path) = source_rel_path {
        let source_id = previous_id.unwrap_or(next_id);
        let entity = services::query_entity(session_id, kind, source_id)?.ok_or_else(|| {
            AppError::message(
                "spec.path_id_mismatch",
                format!("会话索引中找不到源实体: {source_id}"),
            )
        })?;
        let indexed_rel_path = entity.target.write.rel_path;
        if indexed_rel_path != source_rel_path {
            return Err(AppError::message(
                "spec.path_id_mismatch",
                format!("实体路径与会话索引不匹配: {source_rel_path} ({source_id})"),
            ));
        }
    }
    Ok(target_exists)
}

#[command_macros::command(async)]
pub fn save_variant_entity(payload: JsonEntityFilePayload) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
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
    let result = services::save_variant_entity(
        &payload.session_id,
        payload.previous_id.as_deref(),
        &payload.next_id,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    transaction.commit(result, "保存装配")
}

#[command_macros::command(async)]
pub fn create_variant_entity(
    payload: JsonEntityFilePayload,
) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Variant,
        &payload.next_id,
        &payload.base_versions,
    )?;
    let target_exists =
        services::query_entity(&payload.session_id, EntityKind::Variant, &payload.next_id)?
            .is_some();
    let result = services::json_file::create_json_entity_file(
        &payload.mod_root,
        EntityKind::Variant,
        &payload.next_id,
        payload.data,
        target_exists,
    )?;
    transaction.commit(result, "创建装配")
}

#[command_macros::command(async)]
pub fn delete_variant_entity(
    payload: DeleteJsonEntityFilePayload,
) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Variant,
        &payload.entity_id,
        &payload.base_versions,
    )?;
    json_file_save_context(
        &payload.session_id,
        EntityKind::Variant,
        Some(&payload.entity_id),
        &payload.entity_id,
        Some(&payload.rel_path),
    )?;
    let result = services::json_file::delete_json_entity_file(
        &payload.mod_root,
        EntityKind::Variant,
        &payload.entity_id,
        &payload.rel_path,
    )?;
    transaction.commit(result, "删除装配")
}

#[command_macros::command(async)]
pub fn save_skin_entity(payload: JsonEntityFilePayload) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::validate_skin_engine_changes(&payload.session_id, &payload.data)?;
    services::require_entity_version_scope(
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
    let result = services::json_file::save_json_entity_file(
        &payload.mod_root,
        EntityKind::Skin,
        payload.previous_id.as_deref(),
        &payload.next_id,
        services::json_file::JsonEntityFileInput {
            source_rel_path: payload.rel_path.as_deref(),
            target_exists_in_index: target_exists,
            data: payload.data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )?;
    transaction.commit(result, "保存皮肤")
}

#[command_macros::command(async)]
pub fn create_skin_entity(payload: JsonEntityFilePayload) -> Result<WriteResult<Value>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::validate_skin_engine_changes(&payload.session_id, &payload.data)?;
    services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Skin,
        &payload.next_id,
        &payload.base_versions,
    )?;
    let target_exists =
        services::query_entity(&payload.session_id, EntityKind::Skin, &payload.next_id)?.is_some();
    let result = services::json_file::create_json_entity_file(
        &payload.mod_root,
        EntityKind::Skin,
        &payload.next_id,
        payload.data,
        target_exists,
    )?;
    transaction.commit(result, "创建皮肤")
}

#[command_macros::command(async)]
pub fn delete_skin_entity(payload: DeleteJsonEntityFilePayload) -> Result<WriteResult, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    services::require_entity_version_scope(
        &payload.session_id,
        EntityKind::Skin,
        &payload.entity_id,
        &payload.base_versions,
    )?;
    json_file_save_context(
        &payload.session_id,
        EntityKind::Skin,
        Some(&payload.entity_id),
        &payload.entity_id,
        Some(&payload.rel_path),
    )?;
    let result = services::json_file::delete_json_entity_file(
        &payload.mod_root,
        EntityKind::Skin,
        &payload.entity_id,
        &payload.rel_path,
    )?;
    transaction.commit(result, "删除皮肤")
}

#[cfg(test)]
#[path = "json_file_validation_tests.rs"]
mod validation_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{io::write_utf8_no_bom, testutil::temp_dir};

    #[test]
    fn spec_save_scope_matches_indexed_filename_without_previous_id() {
        for (kind, dir, extension, id_field, companion) in [
            (
                EntityKind::Variant,
                "data/variants",
                "variant",
                "variantId",
                "hullId",
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins",
                "skin",
                "skinHullId",
                "baseHullId",
            ),
        ] {
            let root = temp_dir(&format!("spec_scope_{extension}"));
            std::fs::create_dir_all(root.join(dir)).unwrap();
            let indexed = format!("{dir}/filename.{extension}");
            write_utf8_no_bom(
                &root.join(&indexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            let mut trace = services::project::PerformanceTrace::new("project.openSession");
            let manifest =
                services::project::open_project_session_traced(&root, None, &mut trace).unwrap();
            let unindexed = format!("{dir}/other.{extension}");
            write_utf8_no_bom(
                &root.join(&unindexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            assert!(
                json_file_save_context(&manifest.session_id, kind, None, "old", Some(&indexed))
                    .unwrap()
            );
            assert!(
                json_file_save_context(&manifest.session_id, kind, None, "old", Some(&unindexed))
                    .is_err()
            );
            assert!(
                json_file_save_context(
                    &manifest.session_id,
                    kind,
                    Some("missing"),
                    "new",
                    Some(&indexed)
                )
                .is_err()
            );
            assert!(
                !json_file_save_context(&manifest.session_id, kind, None, "new", None).unwrap()
            );
            services::project::close_project_session(manifest.session_id).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }
}
