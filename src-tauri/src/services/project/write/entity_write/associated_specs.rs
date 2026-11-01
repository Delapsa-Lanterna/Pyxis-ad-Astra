use crate::{
    domain::entity_construction::{create_associated_spec, validate_weapon_spec_class},
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, JsonWriteBatch, read_json_file},
    models::{
        AssociatedSpecChange, AssociatedSpecCreateParams, AssociatedSpecMode,
        AssociatedSpecResolution, CsvTableKey,
    },
    services::project::definitions::entity_definitions::associated_spec_definition,
};
use serde_json::Value;
use std::path::Path;
pub(in crate::services::project) struct StagedAssociatedSpec {
    pub identity: crate::models::EntityIdentityChange,
    pub description_rename: Option<super::descriptions::DescriptionRename>,
    pub read_record: Option<super::super::super::sources::documents::LoadedSpecRecord>,
}
pub(in crate::services::project) fn stage_associated_spec(
    session: &super::super::super::model::ProjectSession,
    builder: &mut FileChangeSetBuilder,
    table: CsvTableKey,
    change: &AssociatedSpecChange,
    target: &crate::models::EntityEditTarget,
    resolution: Option<&AssociatedSpecResolution>,
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
    let rel_path = resolution
        .map(|resolution| resolution.destination.location.rel_path.clone())
        .unwrap_or_else(|| target.write.rel_path.clone());
    let mut description_rename = None;
    let mut read_record = None;
    match change {
        AssociatedSpecChange::Delete { .. } => {
            builder.text_file(&target.write.rel_path, None)?;
        }
        AssociatedSpecChange::Create { create } | AssociatedSpecChange::Rename { create, .. } => {
            let resolution = resolution.ok_or_else(|| {
                AppError::message("spec.preparation_required", "请重新准备关联文件后保存")
            })?;
            definition.validate_rel_path(&rel_path, "关联规格目标路径无效")?;
            if !crate::io::same_physical_path(
                Path::new(&resolution.destination.location.root),
                builder.root(),
            ) {
                return Err(AppError::message(
                    "path.outside_root",
                    "关联目标不属于当前 Mod",
                ));
            }
            super::super::super::query::csv_associated_specs::verify_file(&resolution.destination)?;
            let original = resolution.original.as_ref();
            if let Some(original) = original {
                let core_source = original.location.source == crate::models::ResourceSource::Core
                    && session
                        .manifest
                        .starsector_root
                        .as_ref()
                        .map(|game| super::super::super::sources::core::core_dir(game))
                        .transpose()?
                        .is_some_and(|root| {
                            crate::io::same_physical_path(&root, Path::new(&original.location.root))
                        });
                if original.location.source != crate::models::ResourceSource::Mod
                    && !core_source
                    && target.source.as_ref() != Some(&original.location)
                {
                    return Err(AppError::message(
                        "spec.target_changed",
                        "关联原文件来源已变化",
                    ));
                }
                if original.location.source == crate::models::ResourceSource::Mod {
                    definition
                        .validate_rel_path(&original.location.rel_path, "关联原文件路径无效")?;
                    if !crate::io::same_physical_path(
                        Path::new(&original.location.root),
                        builder.root(),
                    ) {
                        return Err(AppError::message(
                            "path.outside_root",
                            "原文件不属于当前 Mod",
                        ));
                    }
                }
                super::super::super::query::csv_associated_specs::verify_file(original)?;
            }
            let usable = original
                .filter(|file| file.version.fingerprint.is_some() && file.problem.is_none());
            if let Some(original) = usable.filter(|_| resolution.mode == AssociatedSpecMode::Read) {
                let value = read_json_file(Path::new(&original.location.path))?;
                if crate::models::file_content_id(
                    &value,
                    definition.id_field,
                    Path::new(&original.location.path),
                ) != target.id
                {
                    return Err(AppError::message(
                        "spec.target_changed",
                        "关联原文件 ID 已变化",
                    ));
                }
            }
            let mut moved = false;
            if resolution.mode == AssociatedSpecMode::Read {
                let value = read_json_file(&builder.root().join(&rel_path))?;
                if !value.is_object()
                    || crate::models::file_content_id(
                        &value,
                        definition.id_field,
                        &builder.root().join(&rel_path),
                    ) != id
                {
                    return Err(AppError::message(
                        "spec.path_id_mismatch",
                        "关联目标 ID 不匹配",
                    ));
                }
                read_record = Some(super::super::super::sources::documents::LoadedSpecRecord {
                    id: id.to_string(),
                    location: resolution.destination.location.clone(),
                    data: value,
                });
            } else {
                let content = if let Some(original) = usable {
                    let (text, rename) = rewrite_associated_spec_id(
                        table,
                        definition.id_field,
                        Path::new(&original.location.path),
                        &target.id,
                        id,
                        json,
                    )?;
                    description_rename = rename;
                    text
                } else {
                    description_rename = super::descriptions::description_rename(
                        target.kind,
                        &target.id,
                        id,
                        &create_associated_spec(create),
                    );
                    default_associated_spec_text(table, create)?
                };
                // Separate destination replacement and source removal retain both snapshots for replay.
                if let Some(original) = usable.filter(|file| {
                    file.location.source == crate::models::ResourceSource::Mod
                        && file.location.rel_path != rel_path
                        && (resolution.destination.version.fingerprint.is_none()
                            || crate::io::same_physical_path(
                                Path::new(&file.location.path),
                                &builder.root().join(&rel_path),
                            ))
                }) {
                    builder.rename_text_file(&original.location.rel_path, &rel_path, content)?;
                    moved = true;
                } else {
                    builder.text_file(&rel_path, Some(content))?;
                }
            }
            if let Some(original) = original.filter(|file| {
                file.location.source == crate::models::ResourceSource::Mod
                    && file.version.fingerprint.is_some()
            }) && !moved
                && !crate::io::same_physical_path(
                    Path::new(&original.location.path),
                    &builder.root().join(&rel_path),
                )
            {
                builder.text_file(&original.location.rel_path, None)?;
            }
        }
    }
    let mut next = target.clone();
    next.id = change.id().to_string();
    next.write.rel_path = rel_path;
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
        read_record,
    })
}

pub(in crate::services::project) fn accept_read_record(
    session: &mut super::super::super::model::ProjectSession,
    kind: crate::models::EntityKind,
    record: super::super::super::sources::documents::LoadedSpecRecord,
) {
    let records = match kind {
        crate::models::EntityKind::Ship => &mut session.ship_files,
        crate::models::EntityKind::Weapon => &mut session.weapon_specs,
        crate::models::EntityKind::System => &mut session.system_files,
        crate::models::EntityKind::Skill => &mut session.skill_files,
        _ => unreachable!("associated spec kind"),
    };
    std::sync::Arc::make_mut(records).insert(record.id.clone(), record);
    match kind {
        crate::models::EntityKind::Ship => {
            session.manifest.entity_summaries.ships = session.ship_files.len()
        }
        crate::models::EntityKind::Weapon => {
            session.manifest.entity_summaries.weapons = session.weapon_specs.len()
        }
        crate::models::EntityKind::System => {
            session.manifest.entity_summaries.systems = session.system_files.len()
        }
        crate::models::EntityKind::Skill => {
            session.manifest.entity_summaries.skills = session.skill_files.len()
        }
        _ => unreachable!("associated spec kind"),
    }
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
    if crate::models::file_content_id(&value, id_field, path) != previous_id {
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
