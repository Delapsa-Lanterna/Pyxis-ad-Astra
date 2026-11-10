use super::descriptions::DescriptionRename;
use super::{descriptions, single_files, variant_references};
use crate::domain::{
    entity_construction, entity_definitions, entity_identity, json_composition, save_edits, schema,
};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::file_content::{JsonFileContent, JsonSource, JsonWrite, SaveLayout};
use crate::models::file_value::Value as FileValue;
use crate::models::{
    CsvTableKey, EntityEditTarget, EntityIdentityChange, EntityKind, EntityLinkedRecord,
    EntityTargetState, JsonComposition, JsonWriteOptions, SaveEdit, SpecSave, WriteContentTarget,
    WriteResult,
};
use crate::parsers;
use crate::services::project::model::{self, ProjectSession};
use crate::services::project::query::{entity_targets, json_layers};
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_session, session_handle,
};
use crate::services::project::write::entity_write::replace_paths;
use serde_json::Value;
use std::path::Path;
use std::sync::Arc;

fn content_schema(kind: EntityKind) -> Option<&'static Value> {
    Some(parsers::bundled_schema(match kind {
        EntityKind::Ship => "spec-ship",
        EntityKind::Weapon => "spec-weapon",
        EntityKind::Projectile => "spec-projectile",
        EntityKind::System => "spec-system",
        EntityKind::Faction => "faction",
        EntityKind::Variant => "variant",
        EntityKind::Skin => "skin",
        EntityKind::Skill | EntityKind::Mission => return None,
    }))
}
pub(in crate::services::project) fn validate_entity_content_in(
    session: &ProjectSession,
    kind: EntityKind,
    relative: &str,
    data: &Value,
    replacing: bool,
    composition: Option<&JsonComposition>,
) -> AppResult<()> {
    let Some(definition) = content_schema(kind) else {
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
    let id = entity_definitions::entity_spec_definition(kind)
        .expect("file kind")
        .id_field;
    if data
        .get(id)
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
    {
        collect(schema::validate_partial_document(definition, data));
    } else if matches!(
        kind,
        EntityKind::Faction | EntityKind::Variant | EntityKind::Skin
    ) {
        collect(schema::validate_document(definition, &effective));
    }
    if kind == EntityKind::Weapon
        && data
            .get(id)
            .and_then(Value::as_str)
            .is_some_and(|value| !value.is_empty())
        && effective.get("specClass").is_some()
    {
        collect(entity_construction::validate_weapon_editor_spec(
            &effective,
            &Path::new(&session.manifest.mod_root).join(relative),
            definition,
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
            &definition["definitions"]["bounds"],
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
pub fn prepare_spec_save(
    input: &mut SpecSave,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    for identity in identities {
        if identity.before.kind == input.target.kind && identity.before.id == input.target.id {
            input.target = identity.after.clone();
        }
    }
    if io::source_recreation_allowed(&input.mod_root, &input.target.write.path)
        && !Path::new(&input.target.write.path).exists()
    {
        return Ok(());
    }
    let snapshot = entity_targets::query_entity_edit_target(
        &input.session_id,
        input.target.kind,
        &input.target.id,
    )?;
    input.target = snapshot.target;
    input.base_versions = snapshot.base_versions;
    if !edits.is_empty() && Path::new(&input.target.write.path).is_file() {
        input.document = save_edits::prepare_json_write(
            Arc::new(io::read_json_file(Path::new(&input.target.write.path))?),
            edits,
            input.document.layout,
        )?;
    }
    Ok(())
}
fn content_id<'a>(target: &'a EntityEditTarget, request: &'a JsonWrite) -> &'a str {
    let field = entity_definitions::entity_spec_definition(target.kind)
        .expect("specification definition")
        .id_field;
    match request.content.get(field) {
        Some(FileValue::Text(text)) => text
            .as_str()
            .filter(|text| !text.is_empty())
            .unwrap_or(&target.id),
        _ => &target.id,
    }
}
pub fn write_spec_request(input: SpecSave) -> AppResult<WriteResult<JsonFileContent>> {
    entity_targets::require_entity_version_scope(
        &input.session_id,
        input.target.kind,
        &input.target.id,
        &input.base_versions,
    )?;
    let next = content_id(&input.target, &input.document).to_owned();
    save_entity_spec(
        &input.session_id,
        &input.target,
        &next,
        input.document,
        input.json_write,
    )
}
pub(in crate::services::project) struct StagedEntityWrite {
    pub document: JsonSource,
    pub identity: EntityIdentityChange,
    pub linked_csv: Option<(CsvTableKey, CsvTableDraft)>,
    pub description_rename: Option<DescriptionRename>,
}
pub(in crate::services::project) struct ValidatedEntityContent(Value);
pub(in crate::services::project) fn prepare_entity_content(
    session: &ProjectSession,
    target: &EntityEditTarget,
    request: &JsonWrite,
    options: &JsonWriteOptions,
    composition: Option<&JsonComposition>,
) -> AppResult<ValidatedEntityContent> {
    let data = request.content.to_json()?;
    validate_entity_content_in(
        session,
        target.kind,
        &target.write.rel_path,
        &data,
        options.replaces(&target.write.rel_path),
        composition,
    )
    .map_err(|error| error.at_path(&target.write.path))?;
    Ok(ValidatedEntityContent(data))
}
pub(in crate::services::project) fn stage_entity_content(
    session: &mut ProjectSession,
    builder: &mut FileChangeSetBuilder,
    target: &EntityEditTarget,
    next: &str,
    request: &JsonWrite,
    options: &JsonWriteOptions,
    composition: Option<&JsonComposition>,
) -> AppResult<StagedEntityWrite> {
    let validated = prepare_entity_content(session, target, request, options, composition)?;
    stage_validated_entity(session, builder, target, next, request, options, validated)
}
pub(in crate::services::project) fn stage_validated_entity(
    session: &mut ProjectSession,
    builder: &mut FileChangeSetBuilder,
    target: &EntityEditTarget,
    next: &str,
    request: &JsonWrite,
    options: &JsonWriteOptions,
    validated: ValidatedEntityContent,
) -> AppResult<StagedEntityWrite> {
    let definition =
        entity_definitions::entity_spec_definition(target.kind).expect("file entity definition");
    let next = entity_identity::validate_entity_id(next, definition.invalid_id_message)?;
    let mut current =
        entity_targets::describe_entity_target(session, target.kind, &target.id)?.target;
    if current.source.is_none() {
        current.source = target.source.clone();
    }
    if current != *target {
        return Err(AppError::message(
            "spec.target_changed",
            format!("{}目标已变化，请载入外部版本", definition.display_name),
        ));
    }
    let data = validated.0;
    let relative = if options.keep_filename || next == target.id {
        target.write.rel_path.clone()
    } else if target.state == EntityTargetState::Create {
        definition.default_rel_path(next)
    } else {
        io::forward_slash_path(
            &Path::new(&target.write.rel_path)
                .with_file_name(format!("{next}{}", definition.extension)),
        )
    };
    let mut after = target.clone();
    after.id = next.into();
    after.state = EntityTargetState::Existing;
    after.write = entity_targets::location(&session.manifest.mod_root, &relative);
    after.source = Some(after.write.clone());
    let source: Option<Arc<JsonSource>> =
        if let Some(source) = session.documents.get(&target.write.rel_path) {
            Some(source.clone())
        } else if Path::new(&target.write.path).is_file() {
            Some(Arc::new(io::read_json_file(Path::new(&target.write.path))?))
        } else if let Some(source) = &target.source {
            Some(Arc::new(
                session.read_spec_source(target.kind, &target.id, source)?.1,
            ))
        } else {
            None
        };
    let document = match source {
        Some(source) => source.write(request)?,
        None => JsonSource::create(request)?,
    };
    if target.state == EntityTargetState::Existing && target.write.rel_path != relative {
        builder.rename_text_file(&target.write.rel_path, &relative, document.text.to_string())?;
    } else {
        builder.text_file(&relative, Some(document.text.to_string()))?;
    }
    let linked_csv = if next != target.id {
        if let Some(EntityLinkedRecord::Csv { table, row_key }) = &target.linked_record {
            csv_tables::ensure_registered_table_rows(session, *table)?;
            let mut draft = CsvTableDraft::read(session, *table)?;
            let row = draft
                .rows
                .iter_mut()
                .find(|row| row.row_key == *row_key)
                .ok_or_else(|| AppError::message("csv.row_key_unknown", "关联数据行已变化"))?;
            row.data.insert("id".into(), Value::String(next.into()));
            Some((*table, draft))
        } else {
            None
        }
    } else {
        None
    };
    let description_rename = descriptions::description_rename(target.kind, &target.id, next, &data);
    Ok(StagedEntityWrite {
        document,
        identity: EntityIdentityChange {
            before: target.clone(),
            after,
        },
        linked_csv,
        description_rename,
    })
}
pub fn save_entity_spec(
    session_id: &str,
    target: &EntityEditTarget,
    next: &str,
    request: JsonWrite,
    options: JsonWriteOptions,
) -> AppResult<WriteResult<JsonFileContent>> {
    let mut builder = FileChangeSetBuilder::new(Path::new(&target.write.root))?;
    let handle = session_handle(session_id)?;
    let mut session = lock_session(&handle)?;
    let composition = json_layers::json_composition(&session, &target.write.rel_path)?;
    let staged = stage_entity_content(
        &mut session,
        &mut builder,
        target,
        next,
        &request,
        &options,
        Some(&composition),
    )?;
    let mut tables = staged.linked_csv.into_iter().collect::<Vec<_>>();
    if let Some(rename) = staged.description_rename {
        csv_tables::ensure_registered_table_rows(&mut session, CsvTableKey::Descriptions)?;
        if let Some(table) = descriptions::prepare_description_renames(&session, &[rename])? {
            tables.push((CsvTableKey::Descriptions, table));
        }
    }
    variant_references::stage_variant_parents(
        &session,
        &staged.identity.before,
        &staged.identity.after,
        &mut builder,
    )?;
    let mut outputs = Vec::new();
    for (key, table) in tables {
        let output = table.output(SaveLayout::PreserveStructure)?;
        builder.text_file(
            model::csv_table_spec(key).rel_path,
            Some(output.document.source.to_string()),
        )?;
        outputs.push((key, table, output));
    }
    replace_paths::stage_replace_paths(&mut builder, &options)?;
    let target = WriteContentTarget::Spec {
        target: Box::new(staged.identity.after.clone()),
    };
    let mut result = WriteResult::from_content(
        builder.apply()?,
        target,
        JsonFileContent::from(&staged.document),
    );
    for (table, draft, actual) in outputs {
        draft.accept(&mut session, table, actual)?;
    }
    result.identity_changes.push(staged.identity);
    Ok(result)
}
