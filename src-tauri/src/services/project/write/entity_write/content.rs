use super::super::super::definitions::entity_definitions::entity_definition;
use super::super::super::query::entity_targets::describe_entity_target;
use super::super::super::query::json_layers as source_layers;
use super::super::super::session::csv_writes::CsvTableDraft;
use super::super::super::session::{lock_session, session_handle};
use crate::domain::entity_definitions::entity_spec_definition;
use crate::domain::entity_identity::validate_entity_id;
use crate::domain::{entity_construction, json_composition, save_edits, schema, variant_modules};
use crate::errors::{AppError, AppResult};
use crate::io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file};
use crate::models::{
    EntityEditTarget, EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState,
    JsonComposition, JsonWriteOptions, SaveEdit, SpecSave, WriteContentTarget, WriteResult,
};
use crate::services::project::model::ProjectSession;
use crate::services::project::sources::json_documents;
use crate::services::project::write::entity_write::descriptions::DescriptionRename;
use crate::services::project::write::entity_write::{
    descriptions, faction_index, single_files, variant_references,
};
use crate::services::save_entity_spec as save_spec_via_service;
use crate::services::{query_entity, require_entity_version_scope};
use crate::{io, models, parsers};
use serde_json::Value;
use std::path::Path;

fn content_schema(kind: EntityKind) -> Option<&'static Value> {
    Some(parsers::bundled_schema(match kind {
        EntityKind::Faction => "faction",
        EntityKind::Skin => "skin",
        EntityKind::Variant => "variant",
        EntityKind::Ship => "spec-ship",
        EntityKind::Weapon => "spec-weapon",
        EntityKind::Projectile => "spec-projectile",
        EntityKind::System => "spec-system",
        _ => return None,
    }))
}

#[cfg(test)]
pub fn validate_entity_content(
    session_id: &str,
    kind: EntityKind,
    relative: &str,
    data: &Value,
    options: &JsonWriteOptions,
) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let composition = source_layers::json_composition(&session, relative)?;
    validate_entity_content_in(
        &session,
        kind,
        relative,
        data,
        options.replaces(relative),
        Some(&composition),
    )
}

pub(in crate::services::project) fn validate_entity_content_in(
    session: &ProjectSession,
    kind: EntityKind,
    relative: &str,
    data: &Value,
    replacing: bool,
    composition: Option<&JsonComposition>,
) -> AppResult<()> {
    let Some(schema) = content_schema(kind) else {
        return Ok(());
    };
    let mut composition = composition.cloned().unwrap_or_default();
    composition.replace |= replacing;
    let effective = json_composition::compose_game_json(&composition, data)?;
    let mut issues = Vec::new();
    let mut code = "config.shape_invalid";
    let mut collect = |result: AppResult<()>| {
        if let Err(error) = result {
            if issues.is_empty() {
                code = error.code();
            }
            issues.extend(error.field_problems());
        }
    };
    let id_field = entity_spec_definition(kind).expect("spec format").id_field;
    if data
        .get(id_field)
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        collect(schema::validate_partial_document(schema, data));
    } else if matches!(
        kind,
        EntityKind::Faction | EntityKind::Skin | EntityKind::Variant
    ) {
        collect(schema::validate_document(schema, &effective));
    }
    if kind == EntityKind::Weapon
        && data
            .get(id_field)
            .and_then(Value::as_str)
            .is_some_and(|id| !id.is_empty())
        && effective.get("specClass").is_some()
    {
        collect(entity_construction::validate_weapon_editor_spec(
            &effective,
            &Path::new(&session.manifest.mod_root).join(relative),
            schema,
        ));
    }
    if kind == EntityKind::Skin && effective.get("baseHullId").is_some() {
        collect(single_files::validate_skin_engine_changes_in(
            session, &effective,
        ));
    }
    if kind == EntityKind::Ship
        && let Some(bounds) = effective.get("bounds")
    {
        collect(schema::validate_field(
            &schema["definitions"]["bounds"],
            bounds,
            "bounds",
            true,
        ));
    }
    if issues.is_empty() {
        Ok(())
    } else {
        Err(AppError::Validation { code, issues })
    }
}
pub fn save_entity_spec(
    session_id: &str,
    target: &EntityEditTarget,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    let _write_lock = io::acquire_root_write_lock(Path::new(&root))?;
    let mut session = lock_session(&handle)?;
    (entity_definition(target.kind)?.prepare)(&mut session)?;
    let current = describe_entity_target(&mut session, target.kind, &target.id)?;
    if current.target != *target {
        return Err(AppError::message(
            "spec.target_changed",
            "实体目标已变化，请载入外部版本",
        ));
    }
    let mut json = JsonWriteBatch::new(options);
    let mut builder = FileChangeSetBuilder::new(Path::new(&root))?;
    let composition = source_layers::json_composition(&session, &target.write.rel_path)?;
    let staged = stage_entity_content(
        &mut session,
        &mut builder,
        &mut json,
        target,
        data,
        ordered_json,
        Some(&composition),
    )?;
    let description = descriptions::prepare_description_renames(
        &session,
        &staged
            .description_rename
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
    )?;
    variant_references::stage_variant_parents(&session, &mut builder, &mut json, &staged.identity)?;
    let description = description
        .map(|csv| csv.stage(&session, &mut builder))
        .transpose()?;
    let linked_csv = staged
        .linked_csv
        .map(|csv| csv.stage(&session, &mut builder))
        .transpose()?;
    json.stage_replace_paths(&mut builder)?;
    json.finish()?;
    let changes = builder.apply()?;
    if let Some(csv) = description {
        csv.accept(&mut session);
    }
    if let Some(csv) = linked_csv {
        csv.accept(&mut session);
    }
    let owner = WriteContentTarget::Spec {
        target: Box::new(staged.identity.after.clone()),
    };
    let mut result = WriteResult::from_content(changes, owner, staged.data);
    result.identity_changes.push(staged.identity);
    Ok(result)
}

pub(in crate::services::project) struct StagedEntityWrite {
    pub data: Value,
    pub identity: EntityIdentityChange,
    pub(in crate::services::project) linked_csv: Option<CsvTableDraft>,
    pub(in crate::services::project) description_rename: Option<DescriptionRename>,
}

pub(in crate::services::project) fn stage_entity_content(
    session: &mut ProjectSession,
    builder: &mut FileChangeSetBuilder,
    json: &mut JsonWriteBatch,
    target: &EntityEditTarget,
    mut data: Value,
    ordered_json: Option<&str>,
    composition: Option<&JsonComposition>,
) -> AppResult<StagedEntityWrite> {
    let definition = entity_spec_definition(target.kind)
        .ok_or_else(|| AppError::message("spec.kind_unknown", "实体规格格式不存在"))?;
    let schema = content_schema(target.kind);
    validate_entity_content_in(
        session,
        target.kind,
        &target.write.rel_path,
        &data,
        json.replaces(&target.write.rel_path),
        composition,
    )?;
    let next_id =
        models::file_content_id(&data, definition.id_field, Path::new(&target.write.path));
    let next_id = validate_entity_id(&next_id, definition.invalid_id_message)?.to_string();
    if data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .is_some_and(|id| !id.is_empty())
    {
        data[definition.id_field] = Value::String(next_id.clone());
    }
    if target.kind == EntityKind::Variant {
        variant_modules::rename_module_reference(&mut data, &target.id, &next_id);
    }
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "entity write root")?;
    let render_source = target
        .source
        .as_ref()
        .map(|source| Path::new(&source.path))
        .unwrap_or_else(|| Path::new(&target.write.path));
    let source = boundary.resolve_relative(&target.write.rel_path, "entity source")?;
    let original = target
        .source
        .as_ref()
        .filter(|location| {
            Path::new(&location.path).exists()
                || !io::source_recreation_allowed(&session.manifest.mod_root, &location.path)
        })
        .map(|location| read_json_file(Path::new(&location.path)))
        .transpose()?;
    if target.state == EntityTargetState::Existing
        && models::file_content_id(
            original.as_ref().unwrap_or(&data),
            definition.id_field,
            &source,
        ) != target.id
    {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            "实体源文件 ID 与加载身份不一致",
        ));
    }
    let description_rename = descriptions::description_rename(
        target.kind,
        &target.id,
        &next_id,
        original.as_ref().unwrap_or(&data),
    );
    let next_rel = if target.state == EntityTargetState::Create {
        definition.default_rel_path(&next_id)
    } else if next_id != target.id && !json.keep_filename() {
        io::forward_slash_path(
            &Path::new(&target.write.rel_path)
                .with_file_name(format!("{next_id}{}", definition.extension)),
        )
    } else {
        target.write.rel_path.clone()
    };
    if next_rel != target.write.rel_path
        && let Some(schema) = schema
    {
        let previous = source_layers::json_composition(session, &target.write.rel_path)?;
        if !previous.replace && !previous.layers.is_empty() {
            let effective = json_composition::compose_game_json(
                &source_layers::json_composition(session, &next_rel)?,
                &data,
            )?;
            schema::validate_document(schema, &effective)?;
        }
    }
    let destination = boundary.resolve_relative_target(&next_rel, "entity target")?;
    match target.kind {
        EntityKind::Variant => {
            json_documents::build_variant_file(boundary.root(), &next_rel, &data)?;
        }
        EntityKind::Skin => {
            json_documents::build_skin_file(boundary.root(), &next_rel, &data)?;
        }
        _ => {}
    }
    if target.state == EntityTargetState::Create || next_id != target.id {
        io::require_rename_target(&source, &destination)?;
        if target.state == EntityTargetState::Create && destination.exists() {
            return Err(AppError::message(
                "spec.target_exists",
                format!("实体目标已存在: {next_rel}"),
            ));
        }
        let next_target = describe_entity_target(session, target.kind, &next_id)?.target;
        if next_id != target.id && next_target.state == EntityTargetState::Existing {
            return Err(AppError::message(
                "spec.target_exists",
                format!("实体 ID 已存在: {next_id}"),
            ));
        }
    }
    if target.kind == EntityKind::Weapon && data.get("specClass").is_some() {
        entity_construction::validate_weapon_spec_class(
            &data,
            &destination,
            parsers::bundled_schema("spec-weapon"),
        )?;
    }
    let text = json.render(render_source, &data, ordered_json)?;
    if target.state == EntityTargetState::Existing && next_rel != target.write.rel_path {
        builder.rename_text_file(&target.write.rel_path, &next_rel, text)?;
    } else if !source.exists() || io::read_utf8_no_bom(&source)? != text {
        builder.text_file(&next_rel, Some(text))?;
    }
    let mut linked_csv = None;
    if next_id != target.id
        && let Some(EntityLinkedRecord::Csv { table, row_key }) = &target.linked_record
    {
        let mut csv = CsvTableDraft::read(session, *table)?;
        let row = csv
            .rows
            .iter_mut()
            .find(|row| row.row_key == *row_key)
            .ok_or_else(|| AppError::message("table.row_key_unknown", "关联 CSV 行已变化"))?;
        row.data.insert("id".into(), Value::String(next_id.clone()));
        linked_csv = Some(csv);
    }
    let linked_record = faction_index::stage_faction_index(
        session, &boundary, builder, target, &next_id, &next_rel,
    )?;
    let mut next = target.clone();
    next.linked_record = linked_record;
    next.id = next_id;
    next.write.rel_path = next_rel;
    next.write.path = destination.to_string_lossy().to_string();
    next.source = Some(next.write.clone());
    next.state = EntityTargetState::Existing;
    Ok(StagedEntityWrite {
        data,
        identity: EntityIdentityChange {
            before: target.clone(),
            after: next,
        },
        linked_csv,
        description_rename,
    })
}

pub fn prepare_spec_save(
    input: &mut SpecSave,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> Result<(), AppError> {
    let SpecSave {
        session_id,
        target,
        data,
        base_versions,
        ordered_json,
        ..
    } = input;
    for identity in identities {
        if identity.before.kind == target.kind && identity.before.id == target.id {
            *target = identity.after.clone();
        }
    }
    if io::source_recreation_allowed(&target.write.root, &target.write.path) {
        return Ok(());
    }
    let current = query_entity(session_id, target.kind, &target.id)?;
    if let Some(current) = current {
        *data = if matches!(target.kind, EntityKind::Weapon | EntityKind::Skill) {
            current.data["spec"].clone()
        } else {
            current.data
        };
        *target = current.target;
        *base_versions = current.base_versions;
        save_edits::apply_save_edits(data, edits);
        *ordered_json = Some(serde_json::to_string(&data)?);
    } else if target.state == EntityTargetState::Existing {
        return Err(AppError::message("write.target_removed", "保存目标已删除"));
    }
    Ok(())
}

pub fn write_spec_request(payload: SpecSave) -> Result<WriteResult<Value>, AppError> {
    require_entity_version_scope(
        &payload.session_id,
        payload.target.kind,
        &payload.target.id,
        &payload.base_versions,
    )?;
    let result = save_spec_via_service(
        &payload.session_id,
        &payload.target,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    Ok(result)
}

#[cfg(test)]
mod phase42_tests {
    use super::*;
    use crate::services::project::query::entity_targets;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project::{PerformanceTrace, open_project_session_traced};
    use crate::services::project_sync::release_project_session;
    use serde_json::json;
    use std::fs;

    #[test]
    fn phase42_single_and_joint_staging_share_field_and_engine_checks() {
        for (kind, relative, valid, invalid, code) in [
            (
                EntityKind::Weapon,
                "data/weapons/entry.wpn",
                json!({"id":"entry","specClass":"beam","turretOffsets":[0,0],"hardpointOffsets":[0,0]}),
                json!({"id":"entry","specClass":"beam","turretOffsets":[],"hardpointOffsets":[0,0]}),
                "spec.weapon_turret_barrel_required",
            ),
            (
                EntityKind::Ship,
                "data/hulls/entry.ship",
                json!({"hullId":"entry","bounds":[0,0,1,2]}),
                json!({"hullId":"entry","bounds":[0,0,"invalid",2]}),
                "config.shape_invalid",
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins/entry.skin",
                json!({"skinHullId":"entry","baseHullId":"base"}),
                json!({"skinHullId":"entry","baseHullId":"base","engineSlotChanges":{"4":{"length":2}}}),
                "config.shape_invalid",
            ),
        ] {
            let root = project_workspace("phase42_shared_validation");
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::create_dir_all(root.join("data/hulls")).unwrap();
            fs::write(
                root.join("data/hulls/base.ship"),
                "{hullId:'base',engineSlots:[]}",
            )
            .unwrap();
            fs::write(&path, valid.to_string()).unwrap();
            let before = fs::read(&path).unwrap();
            let manifest = open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("phase42.validation"),
            )
            .unwrap();
            let target =
                entity_targets::query_entity_edit_target(&manifest.session_id, kind, "entry")
                    .unwrap()
                    .target;
            let options = JsonWriteOptions::default();
            validate_entity_content(&manifest.session_id, kind, relative, &valid, &options)
                .unwrap();
            assert_eq!(
                validate_entity_content(&manifest.session_id, kind, relative, &invalid, &options)
                    .unwrap_err()
                    .code(),
                code
            );
            assert_eq!(
                save_entity_spec(
                    &manifest.session_id,
                    &target,
                    invalid.clone(),
                    options.clone(),
                    None
                )
                .unwrap_err()
                .code(),
                code
            );
            let handle = session_handle(&manifest.session_id).unwrap();
            {
                let mut session = lock_session(&handle).unwrap();
                let mut builder = FileChangeSetBuilder::new(&root).unwrap();
                let mut json = JsonWriteBatch::new(options);
                let result = stage_entity_content(
                    &mut session,
                    &mut builder,
                    &mut json,
                    &target,
                    invalid,
                    None,
                    None,
                );
                assert_eq!(result.err().unwrap().code(), code);
            }
            assert_eq!(fs::read(&path).unwrap(), before);
            release_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}
