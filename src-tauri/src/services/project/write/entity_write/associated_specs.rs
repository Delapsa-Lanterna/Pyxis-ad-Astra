use super::associated_spec_preparation::verify_associated_spec_file;
use super::descriptions::{self, DescriptionRename};
use crate::domain::document_edit::JsonDraft;
use crate::domain::schema::ScalarKind;
use crate::domain::schema::ScalarRule;
use crate::domain::{entity_construction, entity_definitions, entity_identity, schema};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::file_content::DraftEdit;
use crate::models::file_content::{JsonSource, JsonWrite, SaveLayout};
use crate::models::file_value::Value as FileValue;
use crate::models::{
    AssociatedSpecChange, AssociatedSpecMode, AssociatedSpecResolution, CsvTableKey,
    EntityEditTarget, EntityIdentityChange, EntityKind, EntityTargetState, JsonWriteOptions,
    ResourceSource,
};
use crate::parsers;
use crate::services::project::model::ProjectSession;
use crate::services::project::sources::core;
use crate::services::project::sources::documents::LoadedSpecRecord;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;

pub(in crate::services::project) struct StagedAssociatedSpec {
    pub identity: EntityIdentityChange,
    pub description_rename: Option<DescriptionRename>,
    pub read_record: Option<LoadedSpecRecord>,
}
fn id(source: &JsonSource, field: &str, path: &str) -> String {
    source
        .content
        .get(field)
        .and_then(|value| match value {
            FileValue::Text(text) => text.as_str(),
            _ => None,
        })
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            Path::new(path)
                .file_stem()
                .expect("spec filename")
                .to_string_lossy()
                .into_owned()
        })
}
fn template_schema(kind: EntityKind) -> &'static Value {
    parsers::bundled_schema(match kind {
        EntityKind::Ship => "spec-ship",
        EntityKind::Weapon => "spec-weapon",
        EntityKind::System => "spec-system",
        _ => unreachable!("associated specification kind"),
    })
}
pub(in crate::services::project) fn stage_associated_spec(
    session: &ProjectSession,
    builder: &mut FileChangeSetBuilder,
    table: CsvTableKey,
    change: &AssociatedSpecChange,
    target: &EntityEditTarget,
    resolution: Option<&AssociatedSpecResolution>,
    options: &JsonWriteOptions,
) -> AppResult<StagedAssociatedSpec> {
    let definition = entity_definitions::associated_spec_definition(table)
        .ok_or_else(|| AppError::message("table.no_associated_spec", "该表没有关联规格"))?;
    let next = entity_identity::validate_entity_id(change.id(), definition.invalid_id_message)?;
    if target.kind != definition.entity_kind {
        return Err(AppError::message(
            "table.associated_spec_kind_mismatch",
            "关联规格目标种类不属于本表",
        ));
    }
    let relative = resolution
        .map(|resolution| resolution.destination.location.rel_path.clone())
        .unwrap_or_else(|| target.write.rel_path.clone());
    let mut description_rename = None;
    let mut read_record = None;
    match change {
        AssociatedSpecChange::Delete { .. } => {
            builder.text_file(&target.write.rel_path, None)?;
        }
        AssociatedSpecChange::Create { create } | AssociatedSpecChange::Rename { create, .. } => {
            if create.table() != table {
                return Err(AppError::message(
                    "table.associated_spec_kind_mismatch",
                    "关联规格创建参数不属于本表",
                ));
            }
            let resolution = resolution.ok_or_else(|| {
                AppError::message("spec.preparation_required", "请重新准备关联文件后保存")
            })?;
            definition.validate_rel_path(&relative, "关联规格目标路径无效")?;
            if !io::same_physical_path(
                Path::new(&resolution.destination.location.root),
                builder.root(),
            ) {
                return Err(AppError::message(
                    "path.outside_root",
                    "关联目标不属于当前 Mod",
                ));
            }
            verify_associated_spec_file(&resolution.destination)?;
            if let Some(original) = &resolution.original {
                let core = original.location.source == ResourceSource::Core
                    && session
                        .manifest
                        .starsector_root
                        .as_ref()
                        .map(|game| core::core_dir(game))
                        .transpose()?
                        .is_some_and(|root| {
                            io::same_physical_path(&root, Path::new(&original.location.root))
                        });
                if original.location.source != ResourceSource::Mod
                    && !core
                    && target.source.as_ref() != Some(&original.location)
                {
                    return Err(AppError::message(
                        "spec.target_changed",
                        "关联原文件来源已变化",
                    ));
                }
                if original.location.source == ResourceSource::Mod {
                    definition
                        .validate_rel_path(&original.location.rel_path, "关联原文件路径无效")?;
                    if !io::same_physical_path(Path::new(&original.location.root), builder.root()) {
                        return Err(AppError::message(
                            "path.outside_root",
                            "原文件不属于当前 Mod",
                        ));
                    }
                }
                verify_associated_spec_file(original)?;
            }
            let original = resolution
                .original
                .as_ref()
                .filter(|file| file.version.fingerprint.is_some() && file.problem.is_none());
            let mut moved = false;
            if resolution.mode == AssociatedSpecMode::Read {
                if let Some(original) = original {
                    let source = io::read_json_file(Path::new(&original.location.path))?;
                    if id(&source, definition.id_field, &original.location.path) != target.id {
                        return Err(AppError::message(
                            "spec.target_changed",
                            "关联原文件 ID 已变化",
                        ));
                    }
                }
                let source = Arc::new(io::read_json_file(&builder.root().join(&relative))?);
                if id(&source, definition.id_field, &relative) != next {
                    return Err(AppError::message(
                        "spec.path_id_mismatch",
                        "关联目标 ID 不匹配",
                    ));
                }
                read_record = Some(LoadedSpecRecord {
                    id: next.into(),
                    location: resolution.destination.location.clone(),
                    data: source.content.to_json()?,
                    document: source,
                });
            } else {
                let source = if let Some(original) = original {
                    let source = Arc::new(io::read_json_file(Path::new(&original.location.path))?);
                    if id(&source, definition.id_field, &original.location.path) != target.id {
                        return Err(AppError::message(
                            "spec.path_id_mismatch",
                            "关联规格源 ID 已变化",
                        ));
                    }
                    description_rename = descriptions::description_rename(
                        target.kind,
                        &target.id,
                        next,
                        &source.content.to_json()?,
                    );
                    let mut draft = JsonDraft::open(source.clone());
                    let value = ScalarRule {
                        kind: ScalarKind::Text,
                        minimum: None,
                        maximum: None,
                    }
                    .prepare(next)?;
                    if source.content.get(definition.id_field).is_some() {
                        draft.replace(&[definition.id_field.into()], value)?;
                    } else {
                        let FileValue::Object(fields) = &source.content else {
                            unreachable!("JSON root")
                        };
                        draft.edit(DraftEdit::ObjectSplice {
                            path: Vec::new(),
                            index: fields.len(),
                            delete: 0,
                            insert: vec![(definition.id_field.into(), value)],
                        })?;
                    }
                    draft.save(if options.preserve_structure {
                        SaveLayout::PreserveStructure
                    } else {
                        SaveLayout::Expanded
                    })?
                } else {
                    let value = entity_construction::create_associated_spec(create);
                    description_rename =
                        descriptions::description_rename(target.kind, &target.id, next, &value);
                    let prepared = if target.kind == EntityKind::Skill {
                        schema::prepare_value(&value)?
                    } else {
                        schema::prepare_document(&value, template_schema(target.kind))?
                    };
                    Arc::new(JsonSource::create(&JsonWrite {
                        content: prepared.value,
                        target: prepared.target,
                        layout: SaveLayout::Expanded,
                    })?)
                };
                if target.kind == EntityKind::Weapon {
                    entity_construction::validate_weapon_spec_class(
                        &source.content.to_json()?,
                        &builder.root().join(&relative),
                        parsers::bundled_schema("spec-weapon"),
                    )?;
                }
                if let Some(original) = original.filter(|original| {
                    original.location.source == ResourceSource::Mod
                        && original.location.rel_path != relative
                        && (resolution.destination.version.fingerprint.is_none()
                            || io::same_physical_path(
                                Path::new(&original.location.path),
                                &builder.root().join(&relative),
                            ))
                }) {
                    builder.rename_text_file(
                        &original.location.rel_path,
                        &relative,
                        source.text.to_string(),
                    )?;
                    moved = true;
                } else {
                    builder.text_file(&relative, Some(source.text.to_string()))?;
                }
            }
            if !moved
                && let Some(original) = resolution.original.as_ref().filter(|file| {
                    file.location.source == ResourceSource::Mod
                        && file.version.fingerprint.is_some()
                        && !io::same_physical_path(
                            Path::new(&file.location.path),
                            &builder.root().join(&relative),
                        )
                })
            {
                builder.text_file(&original.location.rel_path, None)?;
            }
        }
    }
    let mut after = target.clone();
    after.id = next.into();
    after.write.rel_path = relative;
    after.write.path = builder
        .root()
        .join(&after.write.rel_path)
        .to_string_lossy()
        .into_owned();
    after.state = if matches!(change, AssociatedSpecChange::Delete { .. }) {
        EntityTargetState::Create
    } else {
        EntityTargetState::Existing
    };
    after.source = (after.state == EntityTargetState::Existing).then(|| after.write.clone());
    Ok(StagedAssociatedSpec {
        identity: EntityIdentityChange {
            before: target.clone(),
            after,
        },
        description_rename,
        read_record,
    })
}
pub(in crate::services::project) fn accept_read_record(
    session: &mut ProjectSession,
    kind: EntityKind,
    record: LoadedSpecRecord,
) {
    Arc::make_mut(&mut session.documents)
        .insert(record.location.rel_path.clone(), record.document.clone());
    let records = match kind {
        EntityKind::Ship => &mut session.ship_files,
        EntityKind::Weapon => &mut session.weapon_specs,
        EntityKind::System => &mut session.system_files,
        EntityKind::Skill => &mut session.skill_files,
        _ => unreachable!("associated kind"),
    };
    Arc::make_mut(records).insert(record.id.clone(), record);
    match kind {
        EntityKind::Ship => session.manifest.entity_summaries.ships = session.ship_files.len(),
        EntityKind::Weapon => {
            session.manifest.entity_summaries.weapons = session.weapon_specs.len()
        }
        EntityKind::System => {
            session.manifest.entity_summaries.systems = session.system_files.len()
        }
        EntityKind::Skill => session.manifest.entity_summaries.skills = session.skill_files.len(),
        _ => unreachable!("associated kind"),
    }
}
