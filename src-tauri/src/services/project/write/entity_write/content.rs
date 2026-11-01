use super::super::super::definitions::entity_definitions::entity_definition;
use super::super::super::query::entity_targets::describe_entity_target;
use super::super::super::session::csv_writes::CsvTableDraft;
use super::super::super::session::{lock_session, session_handle};
use crate::domain::entity_definitions::entity_spec_definition;
use crate::domain::entity_identity::validate_entity_id;
use crate::domain::{entity_construction, json_composition, save_edits, schema, variant_modules};
use crate::errors::{AppError, AppResult};
use crate::io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file};
use crate::models::{
    EntityEditTarget, EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState,
    JsonWriteOptions, SaveEdit, SpecSave, WriteContentTarget, WriteResult,
};
use crate::services::project::composition_for_session;
use crate::services::project::model::ProjectSession;
use crate::services::project::sources::json_documents;
use crate::services::project::write::entity_write::descriptions::DescriptionRename;
use crate::services::project::write::entity_write::{
    descriptions, faction_index, variant_references,
};
use crate::services::save_entity_spec as save_spec_via_service;
use crate::services::{query_entity, require_entity_version_scope};
use crate::{io, models, parsers};
use serde_json::Value;
use std::path::Path;

pub fn save_entity_spec(
    session_id: &str,
    target: &EntityEditTarget,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let composition = composition_for_session(session_id, &target.write.rel_path)?;
    let effective = json_composition::compose_game_json(&composition, &data)?;
    if let Some(schema) = match target.kind {
        EntityKind::Variant => Some("variant"),
        EntityKind::Faction => Some("faction"),
        EntityKind::Skin => Some("skin"),
        _ => None,
    } {
        schema::validate_partial_document(parsers::bundled_schema(schema), &data)?;
    }
    if target.kind == EntityKind::Weapon && effective.get("specClass").is_some() {
        entity_construction::validate_weapon_editor_spec(
            &effective,
            Path::new(&target.write.path),
            parsers::bundled_schema("spec-weapon"),
        )?;
    }
    save_entity_content(session_id, target, data, options, ordered_json, None)
}
pub fn save_entity_text(
    session_id: &str,
    target: &EntityEditTarget,
    text: String,
    options: JsonWriteOptions,
) -> AppResult<WriteResult<Value>> {
    let data = parsers::parse_starsector_json(&text).map_err(|error| {
        AppError::context(format!("解析 JSON 文件失败 ({})", target.write.path), error)
            .at_path(&target.write.path)
    })?;
    let definition =
        entity_spec_definition(target.kind).expect("recognized text has a format definition");
    let raw_id = models::file_content_id(&data, definition.id_field, Path::new(&target.write.path));
    let id = validate_entity_id(&raw_id, definition.invalid_id_message)?;
    let text = if raw_id == id || data.get(definition.id_field).is_none() {
        text
    } else {
        parsers::replace_root_string(&text, definition.id_field, id)?
    };
    let result = save_entity_content(session_id, target, data, options, None, Some(&text))?;
    let owner = WriteContentTarget::Text {
        path: result.identity_changes[0].after.write.path.clone(),
    };
    Ok(result.with_content(owner, serde_json::json!({"text":text})))
}

fn save_entity_content(
    session_id: &str,
    target: &EntityEditTarget,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
    raw_text: Option<&str>,
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
    let staged = stage_entity_content(
        &mut session,
        &mut builder,
        &mut json,
        target,
        data,
        ordered_json,
        raw_text,
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
    raw_text: Option<&str>,
) -> AppResult<StagedEntityWrite> {
    let definition = entity_spec_definition(target.kind)
        .ok_or_else(|| AppError::message("spec.kind_unknown", "实体规格格式不存在"))?;
    let next_id =
        models::file_content_id(&data, definition.id_field, Path::new(&target.write.path));
    let next_id = validate_entity_id(&next_id, definition.invalid_id_message)?.to_string();
    if data.get(definition.id_field).is_some() {
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
    let text = if let Some(text) = raw_text {
        text.to_string()
    } else {
        json.render(render_source, &data, ordered_json)?
    };
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
    faction_index::stage_faction_index(session, &boundary, builder, target, &next_id, &next_rel)?;
    let mut next = target.clone();
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
