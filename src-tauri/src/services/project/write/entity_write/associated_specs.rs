use crate::{
    domain::entity_construction::{create_associated_spec, validate_weapon_spec_class},
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, JsonWriteBatch, read_json_file},
    models::{AssociatedSpecChange, AssociatedSpecCreateParams, CsvTableKey},
    services::project::definitions::entity_definitions::associated_spec_definition,
};
use serde_json::Value;
use std::path::Path;
pub(in crate::services::project) struct StagedAssociatedSpec {
    pub identity: crate::models::EntityIdentityChange,
    pub description_rename: Option<super::descriptions::DescriptionRename>,
}
pub(in crate::services::project) fn stage_associated_spec(
    builder: &mut FileChangeSetBuilder,
    table: CsvTableKey,
    change: &AssociatedSpecChange,
    target: &crate::models::EntityEditTarget,
    json: &mut JsonWriteBatch,
) -> AppResult<StagedAssociatedSpec> {
    let definition = associated_spec_definition(table).ok_or_else(|| {
        AppError::message(
            "table.no_associated_spec",
            format!("CSV 表没有关联 spec 定义: {}", table.as_str()),
        )
    })?;
    let id = change.id();
    let id = crate::domain::entity_identity::validate_entity_id(id, definition.invalid_id_message)?;
    if target.kind != definition.entity_kind {
        return Err(AppError::message(
            "table.associated_spec_kind_mismatch",
            "关联规格目标种类不属于本表",
        ));
    }
    let rel_path = if matches!(change, AssociatedSpecChange::Rename { .. }) {
        if target.state == crate::models::EntityTargetState::Existing {
            crate::io::forward_slash_path(
                &Path::new(&target.write.rel_path)
                    .with_file_name(format!("{id}{}", definition.extension)),
            )
        } else {
            definition.default_rel_path(id)
        }
    } else {
        target.write.rel_path.clone()
    };
    let mut description_rename = None;
    match change {
        AssociatedSpecChange::Create { create } => {
            if target.id != id || target.state != crate::models::EntityTargetState::Create {
                return Err(AppError::message("spec.target_exists", "关联规格已存在"));
            }
            if builder.root().join(&rel_path).exists() {
                return Err(AppError::message(
                    "spec.target_exists",
                    format!("关联文件已存在: {rel_path}"),
                ));
            }
            builder.text_file(rel_path, Some(default_associated_spec_text(table, create)?))?;
        }
        AssociatedSpecChange::Delete { .. } => {
            builder.text_file(&target.write.rel_path, None)?;
        }
        AssociatedSpecChange::Rename {
            previous_id,
            create,
        } => {
            if builder.root().join(&rel_path).exists()
                && !crate::io::same_physical_path(
                    &builder.root().join(&target.write.rel_path),
                    &builder.root().join(&rel_path),
                )
            {
                return Err(AppError::message(
                    "spec.target_exists",
                    format!("关联目标已存在: {rel_path}"),
                ));
            }
            let previous_id = crate::domain::entity_identity::validate_entity_id(
                previous_id,
                definition.invalid_id_message,
            )?;
            if target.id != previous_id {
                return Err(AppError::message(
                    "spec.path_id_mismatch",
                    "关联规格源身份不一致",
                ));
            }
            let previous_rel_path = target.write.rel_path.clone();
            let previous_full = builder.root().join(&previous_rel_path);
            let content = if previous_full.exists() {
                let (text, rename) = rewrite_associated_spec_id(
                    table,
                    definition.id_field,
                    &previous_full,
                    previous_id,
                    id,
                    json,
                )?;
                description_rename = rename;
                text
            } else {
                description_rename = super::descriptions::description_rename(
                    target.kind,
                    previous_id,
                    id,
                    &create_associated_spec(create),
                );
                default_associated_spec_text(table, create)?
            };
            if previous_full.exists() {
                builder.rename_text_file(&previous_rel_path, &rel_path, content)?;
            } else {
                builder.text_file(definition.default_rel_path(id), Some(content))?;
            }
        }
    }
    let definition = associated_spec_definition(table).expect("associated format exists");
    let mut next = target.clone();
    next.id = change.id().to_string();
    next.write.rel_path = if target.state == crate::models::EntityTargetState::Existing
        && matches!(change, AssociatedSpecChange::Rename { .. })
    {
        crate::io::forward_slash_path(
            &Path::new(&target.write.rel_path)
                .with_file_name(format!("{}{}", next.id, definition.extension)),
        )
    } else if matches!(change, AssociatedSpecChange::Delete { .. }) {
        target.write.rel_path.clone()
    } else {
        definition.default_rel_path(&next.id)
    };
    next.write.path = builder
        .root()
        .join(&next.write.rel_path)
        .to_string_lossy()
        .to_string();
    next.state = if matches!(change, AssociatedSpecChange::Delete { .. }) {
        crate::models::EntityTargetState::Create
    } else {
        crate::models::EntityTargetState::Existing
    };
    next.source =
        (next.state == crate::models::EntityTargetState::Existing).then(|| next.write.clone());

    Ok(StagedAssociatedSpec {
        identity: crate::models::EntityIdentityChange {
            before: target.clone(),
            after: next,
        },
        description_rename,
    })
}

fn default_associated_spec_text(
    table: CsvTableKey,
    params: &AssociatedSpecCreateParams,
) -> AppResult<String> {
    if params.table() != table {
        return Err(AppError::message(
            "table.associated_spec_kind_mismatch",
            "associated spec create parameters must belong to the saved CSV table",
        ));
    }
    serde_json::to_string_pretty(&create_associated_spec(params)).map_err(AppError::from)
}

fn rewrite_associated_spec_id(
    table: CsvTableKey,
    id_field: &str,
    path: &Path,
    previous_id: &str,
    new_id: &str,
    json: &mut JsonWriteBatch,
) -> AppResult<(String, Option<super::descriptions::DescriptionRename>)> {
    let mut value = read_json_file(path)?;
    let description_rename = super::descriptions::description_rename(
        associated_spec_definition(table)
            .expect("associated format")
            .entity_kind,
        previous_id,
        new_id,
        &value,
    );
    if value.get(id_field).and_then(Value::as_str) != Some(previous_id) {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            format!("关联规格源 ID 已变化: {}", path.display()),
        ));
    }
    let Some(object) = value.as_object_mut() else {
        return Err(AppError::message(
            "spec.file_not_object",
            format!("关联 spec 文件不是 JSON object: {}", path.display()),
        ));
    };
    object.insert(id_field.to_string(), Value::String(new_id.to_string()));
    if table == CsvTableKey::Weapons {
        validate_weapon_spec_class(&value, path, crate::parsers::bundled_schema("spec-weapon"))?;
    }
    Ok((json.render(path, &value, None)?, description_rename))
}
