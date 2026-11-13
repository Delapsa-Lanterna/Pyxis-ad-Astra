use super::entity_write::descriptions::DescriptionRename;
use super::entity_write::{content, descriptions, variant_references};
use crate::domain::document_edit::JsonDraft;
use crate::domain::schema::ScalarKind;
use crate::domain::schema::ScalarRule;
use crate::domain::{
    csv_column_order, entity_construction, entity_definitions, joint_hull, save_edits, schema,
};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::file_content::{
    ChildFormats, JsonFileContent, JsonSource, JsonTarget, JsonWrite, SaveLayout,
};
use crate::models::file_content::{DraftEdit, PreparedValue};
use crate::models::file_value::Value as FileValue;
use crate::models::{
    AssociatedSpecCreateParams, CsvRowKeyMapping, CsvTableKey, EntityIdentityChange, EntityKind,
    EntityLinkedRecord, JointEditKind, JointEditSnapshot, JointEditSubmission, JointRecordTarget,
    JointValue, ResourceSource, SaveEdit, WriteContentTarget, WriteResult, windows_path_key,
};
use crate::parsers;
use crate::services::project::model::{self, SessionCsvRow};
use crate::services::project::query::joint_edit;
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_ready_session, session_handle,
};
use crate::services::project::write::entity_write::replace_paths;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

#[cfg(test)]
#[path = "joint_edit_tests.rs"]
mod tests;

fn verify_sources(snapshot: &JointEditSnapshot) -> AppResult<()> {
    let versions = snapshot
        .records
        .iter()
        .filter(|record| {
            record
                .source
                .as_ref()
                .is_some_and(|source| source.source != ResourceSource::Mod)
        })
        .filter_map(|record| record.source_version.as_ref())
        .chain(
            snapshot
                .records
                .iter()
                .filter_map(|record| record.composition.as_ref())
                .flat_map(|composition| composition.layers.iter().map(|layer| &layer.version)),
        )
        .chain(&snapshot.reference_settings.versions)
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>();
    for expected in versions.into_values() {
        if io::file_version(Path::new(&expected.path))? != *expected
            && !io::source_recreation_allowed(&snapshot.root.mod_root, &expected.path)
        {
            return Err(
                AppError::message("write.version_conflict", "联合保存来源内容已变化")
                    .at_path(&expected.path),
            );
        }
    }
    Ok(())
}
fn root_identity(kind: JointEditKind, entity: EntityKind) -> bool {
    matches!(
        (kind, entity),
        (JointEditKind::Ship, EntityKind::Ship)
            | (JointEditKind::Weapon, EntityKind::Weapon)
            | (JointEditKind::Skin, EntityKind::Skin)
            | (JointEditKind::Variant, EntityKind::Variant)
    )
}
fn complete_new_spec(request: &JsonWrite, kind: EntityKind, id: &str) -> AppResult<JsonWrite> {
    let parameters = match kind {
        EntityKind::Ship => AssociatedSpecCreateParams::Ship {
            id: id.into(),
            hull_name: id.into(),
        },
        EntityKind::Weapon => {
            let class = request
                .content
                .get("specClass")
                .and_then(|value| match value {
                    FileValue::Text(value) => value.as_str(),
                    _ => None,
                })
                .ok_or_else(|| {
                    AppError::message(
                        "spec.weapon_class_unsupported",
                        "请选择 projectile 或 beam 规格分支",
                    )
                })?;
            AssociatedSpecCreateParams::Weapon {
                id: id.into(),
                spec_class: serde_json::from_value(Value::String(class.into()))?,
            }
        }
        _ => return Ok(request.clone()),
    };
    let schema = parsers::bundled_schema(if kind == EntityKind::Ship {
        "spec-ship"
    } else {
        "spec-weapon"
    });
    let mut defaults = schema::prepare_document(
        &entity_construction::create_associated_spec(&parameters),
        schema,
    )?;
    let mut target = request.target.clone();
    target.materialize(&request.content);
    if let (
        FileValue::Object(fields),
        Some(ChildFormats::Object(formats)),
        FileValue::Object(provided),
        Some(ChildFormats::Object(provided_formats)),
    ) = (
        &mut defaults.value,
        &mut defaults.target.children,
        &request.content,
        &target.children,
    ) {
        for ((key, value), (_, format)) in provided.iter().zip(provided_formats) {
            if let Some(index) = fields.iter().position(|(field, _)| field == key) {
                fields[index].1 = value.clone();
                formats[index].1 = format.clone();
            } else {
                fields.push((key.clone(), value.clone()));
                formats.push((key.clone(), format.clone()));
            }
        }
    }
    Ok(JsonWrite {
        content: defaults.value,
        target: defaults.target,
        layout: request.layout,
    })
}
pub fn save_joint_edit(input: &JointEditSubmission) -> AppResult<WriteResult<JointEditSnapshot>> {
    let snapshot = &input.snapshot;
    verify_sources(snapshot)?;
    let mut documents = input.documents.clone();
    let mut values = input.values.clone();
    for key in values.keys().chain(documents.keys()) {
        if !snapshot.records.iter().any(|record| record.key == *key) {
            return Err(AppError::message(
                "joint.target_changed",
                "联合保存记录已不属于当前目标",
            ));
        }
    }
    for required in snapshot
        .records
        .iter()
        .filter(|record| values.contains_key(&record.key) || documents.contains_key(&record.key))
        .flat_map(|record| &record.base_versions)
    {
        if !input
            .base_versions
            .iter()
            .any(|version| windows_path_key(&version.path) == windows_path_key(&required.path))
        {
            return Err(AppError::message(
                "write.version_scope_missing",
                "联合保存缺少读取版本凭据",
            )
            .at_path(&required.path));
        }
    }
    let renames = snapshot
        .records
        .iter()
        .filter_map(|record| {
            let JointRecordTarget::Spec { target } = &record.target else {
                return None;
            };
            if target.kind != EntityKind::Variant {
                return None;
            }
            let next = documents.get(&record.key)?.content.get("variantId")?;
            match next {
                FileValue::Text(value) => value
                    .as_str()
                    .filter(|next| *next != target.id)
                    .map(|next| (target.id.clone(), next.into())),
                _ => None,
            }
        })
        .collect::<Vec<(String, String)>>();
    for record in &snapshot.records {
        if !matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Variant)
            || !record
                .source
                .as_ref()
                .is_some_and(|source| source.source == ResourceSource::Mod)
        {
            continue;
        }
        let Some(original) = &record.document else {
            continue;
        };
        let request = documents
            .get(&record.key)
            .cloned()
            .unwrap_or_else(|| JsonWrite {
                content: original.content.clone(),
                target: JsonTarget::source(Vec::new()),
                layout: if input.json_write.preserve_structure {
                    SaveLayout::PreserveStructure
                } else {
                    SaveLayout::Expanded
                },
            });
        let changes = renames
            .iter()
            .flat_map(|(previous, next)| {
                variant_references::module_paths(&request.content, previous)
                    .into_iter()
                    .map(move |path| (path, next.clone()))
            })
            .collect::<Vec<_>>();
        if changes.is_empty() {
            continue;
        }
        let source = Arc::new(JsonSource {
            text: Arc::from(original.source.as_str()),
            content: original.content.clone(),
        });
        let mut draft = JsonDraft::open(source);
        draft.edit(&DraftEdit::Replace {
            path: Vec::new(),
            value: PreparedValue {
                value: request.content,
                target: request.target,
            },
        })?;
        let rule = ScalarRule {
            kind: ScalarKind::Text,
            minimum: None,
            maximum: None,
        };
        for (path, next) in changes {
            draft.edit(&DraftEdit::Replace {
                path,
                value: rule.prepare(&next)?,
            })?;
        }
        let request = draft.request(request.layout);
        values.insert(
            record.key.clone(),
            JointValue::Present(request.content.to_json()?),
        );
        documents.insert(record.key.clone(), request);
    }
    let handle = session_handle(&snapshot.root.session_id)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&snapshot.root.mod_root))?;
    let mut session = lock_ready_session(&handle)?;
    let mut prepared_contents = BTreeMap::new();
    let mut issues = Vec::new();
    let mut failure_code = "config.shape_invalid";
    for (key, request) in &mut documents {
        let record = snapshot
            .records
            .iter()
            .find(|record| record.key == *key)
            .expect("document belongs to snapshot");
        let JointRecordTarget::Spec { target } = &record.target else {
            continue;
        };
        if matches!(record.value, JointValue::Missing) {
            *request = complete_new_spec(request, target.kind, &target.id)?;
        }
        match content::prepare_entity_content(
            &session,
            target,
            request,
            &input.json_write,
            record.composition.as_ref(),
        ) {
            Ok(content) => {
                prepared_contents.insert(key.clone(), content);
            }
            Err(error) => {
                if issues.is_empty() {
                    failure_code = error.code();
                }
                issues.extend(error.field_problems());
            }
        }
    }
    if !issues.is_empty() {
        return Err(AppError::Validation {
            code: failure_code,
            issues,
        });
    }
    let mut saved = snapshot.clone();
    let mut tables = BTreeMap::<CsvTableKey, CsvTableDraft>::new();
    let mut identities = Vec::new();
    let mut description_changes = Vec::<DescriptionRename>::new();
    let mut key_map = Vec::new();
    let mut records = snapshot.records.iter().collect::<Vec<_>>();
    records.sort_by_key(|record| !matches!(record.target, JointRecordTarget::Spec { .. }));
    for record in records {
        let value = values.get(&record.key);
        let request = documents.get(&record.key);
        if value.is_none() && request.is_none() {
            continue;
        }
        let create = input.create_overrides.contains(&record.key);
        if create
            && record
                .source
                .as_ref()
                .is_none_or(|source| source.source == ResourceSource::Mod)
        {
            return Err(AppError::message(
                "joint.override_changed",
                "覆盖创建来源已变化",
            ));
        }
        if value == Some(&record.value)
            && request.is_none()
            && input.csv_columns.get(&record.key).is_none_or(Vec::is_empty)
            && !create
            && !io::source_recreation_allowed(&snapshot.root.mod_root, &record.target.write().path)
        {
            continue;
        }
        let next = saved
            .records
            .iter_mut()
            .find(|next| next.key == record.key)
            .expect("saved graph record");
        match &record.target {
            JointRecordTarget::Spec { target } => {
                if value == Some(&JointValue::Missing) {
                    builder.text_file(&target.write.rel_path, None)?;
                    next.value = JointValue::Missing;
                    next.document = None;
                    continue;
                }
                let request = request.ok_or_else(|| {
                    AppError::message(
                        "joint.document_required",
                        "联合规格写入缺少完整数据和目标格式",
                    )
                })?;
                let request = request.clone();
                let definition = entity_definitions::entity_spec_definition(target.kind)
                    .expect("joint specification kind");
                let id = request
                    .content
                    .get(definition.id_field)
                    .and_then(|value| match value {
                        FileValue::Text(value) => value.as_str(),
                        _ => None,
                    })
                    .unwrap_or(&target.id);
                let staged = content::stage_validated_entity(
                    &mut session,
                    &mut builder,
                    target,
                    id,
                    &request,
                    &input.json_write,
                    prepared_contents
                        .remove(&record.key)
                        .expect("document has been validated"),
                )?;
                if let Some((table, draft)) = staged.linked_csv {
                    if let Some(current) = tables.get_mut(&table) {
                        if let Some(EntityLinkedRecord::Csv { row_key, .. }) =
                            &staged.identity.before.linked_record
                            && let Some(row) =
                                current.rows.iter_mut().find(|row| row.row_key == *row_key)
                        {
                            row.data.insert(
                                "id".into(),
                                Value::String(staged.identity.after.id.clone()),
                            );
                        }
                    } else {
                        tables.insert(table, draft);
                    }
                }
                if let Some(rename) = staged.description_rename {
                    description_changes.push(rename);
                }
                next.value = JointValue::Present(staged.document.content.to_json()?);
                next.document = Some(JsonFileContent::from(&staged.document));
                next.source = Some(staged.identity.after.write.clone());
                next.target = JointRecordTarget::Spec {
                    target: staged.identity.after.clone(),
                };
                if input.json_write.replaces(&target.write.rel_path)
                    && let Some(composition) = &mut next.composition
                {
                    composition.replace = true;
                }
                if staged.identity.before.id == snapshot.root.id
                    && root_identity(snapshot.root.kind, staged.identity.before.kind)
                {
                    saved.root.id.clone_from(&staged.identity.after.id);
                }
                identities.push(staged.identity);
            }
            JointRecordTarget::Csv {
                table,
                row_key,
                identity,
                ..
            } => {
                if !tables.contains_key(table) {
                    csv_tables::ensure_registered_table_rows(&mut session, *table)?;
                    tables.insert(*table, CsvTableDraft::read(&session, *table)?);
                }
                let draft = tables.get_mut(table).expect("joint table");
                let position = draft
                    .rows
                    .iter()
                    .position(|row| row.row_key == *row_key)
                    .or_else(|| {
                        draft.rows.iter().position(|row| {
                            !row.is_comment
                                && identity.iter().all(|(key, value)| {
                                    row.data.get(key).and_then(Value::as_str) == Some(value)
                                })
                        })
                    });
                match value {
                    Some(JointValue::Missing) => {
                        if let Some(index) = position {
                            draft.rows.remove(index);
                        }
                    }
                    Some(JointValue::Present(Value::Object(fields))) => {
                        let columns = input.csv_columns.get(&record.key).ok_or_else(|| {
                            AppError::message(
                                "joint.columns_required",
                                "联合 CSV 写入缺少修改列范围",
                            )
                        })?;
                        let mut data = position
                            .map(|index| draft.rows[index].data.clone())
                            .unwrap_or_default();
                        for key in columns {
                            data.insert(
                                key.clone(),
                                fields
                                    .get(key)
                                    .cloned()
                                    .unwrap_or_else(|| Value::String(String::new())),
                            );
                        }
                        for change in &identities {
                            if matches!(&change.before.linked_record,Some(EntityLinkedRecord::Csv {table:linked,row_key:linked_key}) if linked==table && linked_key==row_key)
                            {
                                data.insert("id".into(), Value::String(change.after.id.clone()));
                            }
                        }
                        let added = data
                            .keys()
                            .filter(|key| !draft.header.contains(key))
                            .cloned()
                            .collect::<Vec<_>>();
                        csv_column_order::add_ordered_csv_columns(
                            &mut draft.header,
                            &added,
                            &csv_column_order::standard_csv_columns(*table),
                        );
                        if let Some(index) = position {
                            draft.rows[index].data = data;
                        } else {
                            let key = format!("{}:row:{}", table.as_str(), draft.next_row_seq);
                            draft.next_row_seq += 1;
                            key_map.push(CsvRowKeyMapping {
                                previous_key: row_key.clone(),
                                next_key: key.clone(),
                                row_index: draft.rows.len(),
                            });
                            draft.rows.push(SessionCsvRow {
                                row_key: key,
                                data,
                                is_comment: false,
                                source_row: None,
                            });
                        }
                    }
                    _ => {
                        return Err(AppError::message(
                            "joint.csv_shape",
                            "联合 CSV 记录必须为对象",
                        ));
                    }
                }
                if snapshot.root.kind == JointEditKind::Wing
                    && *table == CsvTableKey::Wings
                    && identity.get("id") == Some(&snapshot.root.id)
                    && let Some(JointValue::Present(data)) = value
                {
                    saved.root.id = data
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| AppError::message("joint.id_missing", "战机联队缺少 ID"))?
                        .into();
                }
            }
            JointRecordTarget::Text { write } => match value {
                Some(JointValue::Present(Value::String(text))) => {
                    builder.text_file(&write.rel_path, Some(text.clone()))?;
                    next.value = JointValue::Present(Value::String(text.clone()));
                }
                Some(JointValue::Missing) => {
                    builder.text_file(&write.rel_path, None)?;
                    next.value = JointValue::Missing;
                }
                _ => {
                    return Err(AppError::message(
                        "joint.value_shape",
                        "联合文本记录必须为文字",
                    ));
                }
            },
        }
    }
    if !description_changes.is_empty() {
        csv_tables::ensure_registered_table_rows(&mut session, CsvTableKey::Descriptions)?;
        if let Some(table) = tables.get_mut(&CsvTableKey::Descriptions) {
            for change in &description_changes {
                descriptions::rename_description_row(
                    &session,
                    table,
                    &change.previous_id,
                    &change.next_id,
                    change.description_type,
                )?;
            }
        } else if let Some(table) =
            descriptions::prepare_description_renames(&session, &description_changes)?
        {
            tables.insert(CsvTableKey::Descriptions, table);
        }
    }
    let mut outputs = BTreeMap::new();
    for (key, draft) in tables {
        let actual = draft.output(SaveLayout::PreserveStructure)?;
        builder.text_file(
            model::csv_table_spec(key).rel_path,
            Some(actual.document.source.to_string()),
        )?;
        outputs.insert(key, (draft, actual));
    }
    replace_paths::stage_replace_paths(&mut builder, &input.json_write)?;
    for change in &mut identities {
        if let Some(table) = entity_definitions::entity_spec_definition(change.after.kind)
            .and_then(|definition| definition.csv_table)
            && let Some((draft, _)) = outputs.get(&table)
        {
            change.after.linked_record = draft
                .rows
                .iter()
                .find(|row| {
                    !row.is_comment
                        && row.data.get("id").and_then(Value::as_str) == Some(&change.after.id)
                })
                .map(|row| EntityLinkedRecord::Csv {
                    table,
                    row_key: row.row_key.clone(),
                });
        }
    }
    for record in &mut saved.records {
        match &mut record.target {
            JointRecordTarget::Spec { target } => {
                if let Some(change) = identities
                    .iter()
                    .find(|change| change.after.kind == target.kind && change.after.id == target.id)
                {
                    *target = change.after.clone();
                }
            }
            JointRecordTarget::Csv {
                table,
                row_key,
                identity,
                ..
            } => {
                if let Some((draft, _)) = outputs.get(table) {
                    let key = key_map
                        .iter()
                        .find(|entry| entry.previous_key == *row_key)
                        .map(|entry| entry.next_key.as_str())
                        .unwrap_or(row_key);
                    let row = draft
                        .rows
                        .iter()
                        .find(|row| row.row_key == key)
                        .or_else(|| {
                            description_changes
                                .iter()
                                .find(|change| {
                                    identity.get("id") == Some(&change.previous_id)
                                        && identity.get("type").map(String::as_str)
                                            == Some(change.description_type)
                                })
                                .and_then(|change| {
                                    draft.rows.iter().find(|row| {
                                        row.data.get("id").and_then(Value::as_str)
                                            == Some(&change.next_id)
                                            && row.data.get("type").and_then(Value::as_str)
                                                == Some(change.description_type)
                                    })
                                })
                        });
                    record.value = row
                        .map(|row| JointValue::Present(Value::Object(row.data.clone())))
                        .unwrap_or(JointValue::Missing);
                    if let Some(row) = row {
                        *row_key = row.row_key.clone();
                        for (key, value) in identity {
                            if let Some(text) = row.data.get(key).and_then(Value::as_str) {
                                *value = text.into();
                            }
                        }
                    }
                }
            }
            _ => {}
        }
    }
    let changes = builder.apply()?;
    for (key, (draft, actual)) in outputs {
        draft.accept(&mut session, key, actual)?;
    }
    let changed = changes
        .iter()
        .map(io::version_after_change)
        .collect::<AppResult<Vec<_>>>()?
        .into_iter()
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>();
    for record in &mut saved.records {
        if let Some(version) = changed.get(&windows_path_key(&record.target.write().path)) {
            record.source = (!matches!(record.value, JointValue::Missing))
                .then(|| record.target.write().clone());
            record.source_version = Some(version.clone());
        }
        for identity in &identities {
            record.base_versions.retain(|version| {
                identity.before.write.path == identity.after.write.path
                    || windows_path_key(&version.path)
                        != windows_path_key(&identity.before.write.path)
            });
        }
        for version in &mut record.base_versions {
            if let Some(actual) = changed.get(&windows_path_key(&version.path)) {
                *version = actual.clone();
            }
        }
        if let Some(version) = changed.get(&windows_path_key(&record.target.write().path)) {
            record.base_versions.push(version.clone());
        }
        record
            .base_versions
            .sort_by_cached_key(|version| windows_path_key(&version.path));
        record
            .base_versions
            .dedup_by(|a, b| windows_path_key(&a.path) == windows_path_key(&b.path));
        let key = match &record.target {
            JointRecordTarget::Spec { target } => {
                serde_json::to_string(&("spec", target.kind, &target.id))?
            }
            JointRecordTarget::Csv {
                table, identity, ..
            } => serde_json::to_string(&("csv", table, identity))?,
            JointRecordTarget::Text { write } => serde_json::to_string(&("text", &write.path))?,
        };
        for binding in saved.bindings.values_mut() {
            if *binding == record.key {
                binding.clone_from(&key);
            }
        }
        record.key = key;
    }
    saved.base_versions = saved
        .records
        .iter()
        .flat_map(|record| record.base_versions.iter().cloned())
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect();
    if matches!(saved.root.kind, JointEditKind::Ship | JointEditKind::Skin) {
        saved.hull = joint_hull::project_ship_hull(&saved.records, &saved.bindings["spec"])?;
    }
    if let Some(key) = saved.bindings.get("variant") {
        saved.hull = joint_hull::project_joint_hull(&saved.records, key)?;
    }
    saved.variants.clear();
    for record in &saved.records {
        if matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Variant)
            && let Some(hull) = joint_hull::project_joint_hull(&saved.records, &record.key)?
        {
            saved.variants.insert(record.key.clone(), hull);
        }
    }
    let target = WriteContentTarget::Joint {
        root: saved.root.clone(),
    };
    let mut result = WriteResult::from_content(changes, target, saved);
    result.identity_changes = identities;
    result.key_map = key_map;
    Ok(result)
}
pub fn prepare_joint_save(
    input: &mut JointEditSubmission,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    verify_sources(&input.snapshot)?;
    io::verify_versions(&input.snapshot.root.mod_root, &input.base_versions)?;
    let mut parent_ids = joint_edit::renamed_variants(&input.snapshot.records, &input.values);
    for identity in identities {
        if identity.before.kind == EntityKind::Variant && parent_ids.remove(&identity.before.id) {
            parent_ids.insert(identity.after.id.clone());
        }
        if identity.before.id == input.snapshot.root.id
            && root_identity(input.snapshot.root.kind, identity.before.kind)
        {
            input.snapshot.root.id.clone_from(&identity.after.id);
        }
    }
    let current = if identities.is_empty()
        && parent_ids.is_empty()
        && input.snapshot.new_sources.is_empty()
        && input.base_versions == input.snapshot.base_versions
    {
        // Verified credentials make the confirmed source graph authoritative for this transaction.
        input.snapshot.clone()
    } else {
        let mut retained = joint_edit::retained_joint_sources(&input.snapshot)?;
        retained.extend(
            input
                .values
                .iter()
                .filter(|(key, value)| {
                    input
                        .snapshot
                        .records
                        .iter()
                        .find(|record| record.key == **key)
                        .is_none_or(|record| record.value != **value)
                })
                .map(|(key, value)| (key.clone(), value.clone())),
        );
        joint_edit::query_joint_edit_values(
            &input.snapshot.root,
            Some(&retained),
            &input.snapshot.new_sources,
            &parent_ids,
        )?
    };
    for record in &current.records {
        if !parent_ids.is_empty()
            && !input
                .snapshot
                .records
                .iter()
                .any(|original| original.key == record.key)
        {
            return Err(AppError::message(
                "write.version_conflict",
                "联合改名影响范围已变化，请重新确认",
            )
            .at_path(&record.target.write().path));
        }
    }
    let mut documents = BTreeMap::new();
    let mut values = BTreeMap::new();
    let mut columns = BTreeMap::new();
    let mut overrides = Vec::new();
    for original in &input.snapshot.records {
        let selected = edits
            .iter()
            .filter_map(|edit| prefix_edit(edit, &original.key))
            .collect::<Vec<_>>();
        let changed = !selected.is_empty()
            || input.documents.contains_key(&original.key)
            || input
                .csv_columns
                .get(&original.key)
                .is_some_and(|columns| !columns.is_empty())
            || input.create_overrides.contains(&original.key)
            || input
                .values
                .get(&original.key)
                .is_some_and(|value| *value != original.value);
        if !changed {
            continue;
        }
        let mut expected = original.target.clone();
        if let JointRecordTarget::Spec { target } = &mut expected {
            for change in identities {
                if change.before.kind == target.kind && change.before.id == target.id {
                    *target = change.after.clone();
                }
            }
        }
        if let JointRecordTarget::Csv {
            table,
            row_key,
            identity,
            ..
        } = &mut expected
        {
            for change in identities {
                if matches!(&change.before.linked_record, Some(EntityLinkedRecord::Csv {table: linked, row_key: key}) if linked == table && key == row_key)
                {
                    identity.insert("id".into(), change.after.id.clone());
                    if let Some(EntityLinkedRecord::Csv { row_key: key, .. }) =
                        &change.after.linked_record
                    {
                        row_key.clone_from(key);
                    }
                }
            }
        }
        let latest = current
            .records
            .iter()
            .find(|record| {
                record.target == expected
                    || record.key == original.key
                    || match (&record.target, &expected) {
                        (
                            JointRecordTarget::Spec { target: actual },
                            JointRecordTarget::Spec { target: expected },
                        ) => actual.kind == expected.kind && actual.id == expected.id,
                        (
                            JointRecordTarget::Csv {
                                table, identity, ..
                            },
                            JointRecordTarget::Csv {
                                table: expected_table,
                                identity: expected_identity,
                                ..
                            },
                        ) => table == expected_table && identity == expected_identity,
                        _ => false,
                    }
            })
            .ok_or_else(|| AppError::message("joint.target_changed", "联合记录已变化"))?;
        if let Some(value) = input.values.get(&original.key) {
            values.insert(latest.key.clone(), value.clone());
        }
        if let Some(fields) = input.csv_columns.get(&original.key) {
            columns.insert(latest.key.clone(), fields.clone());
        }
        if input.create_overrides.contains(&original.key) {
            overrides.push(latest.key.clone());
        }
        if matches!(latest.target, JointRecordTarget::Spec { .. }) && !selected.is_empty() {
            if let Some(source) = latest.document.as_ref().or(original.document.as_ref()) {
                let layout = input
                    .documents
                    .get(&original.key)
                    .map(|request| request.layout)
                    .unwrap_or(if input.json_write.preserve_structure {
                        SaveLayout::PreserveStructure
                    } else {
                        SaveLayout::Expanded
                    });
                let request = save_edits::prepare_json_write(
                    Arc::new(JsonSource {
                        text: Arc::from(source.source.as_str()),
                        content: source.content.clone(),
                    }),
                    &selected,
                    layout,
                )?;
                values.insert(
                    latest.key.clone(),
                    JointValue::Present(request.content.to_json()?),
                );
                documents.insert(latest.key.clone(), request);
            }
        } else if let Some(request) = input.documents.get(&original.key) {
            let request = request.clone();
            documents.insert(latest.key.clone(), request);
        }
        if matches!(latest.target, JointRecordTarget::Csv { .. }) && !selected.is_empty() {
            let JointValue::Present(Value::Object(mut data)) = latest.value.clone() else {
                unreachable!("edited CSV row is present")
            };
            let fields = columns.entry(latest.key.clone()).or_default();
            for edit in selected {
                let DraftEdit::Replace { path, value } = edit else {
                    unreachable!("CSV changes replace scalar cells")
                };
                let key = path[0].as_str().expect("CSV column is text").to_string();
                data.insert(key.clone(), value.value.to_json()?);
                if !fields.contains(&key) {
                    fields.push(key);
                }
            }
            values.insert(latest.key.clone(), JointValue::Present(Value::Object(data)));
        }
    }
    input.snapshot = current;
    input.values = values;
    input.documents = documents;
    input.csv_columns = columns;
    input.create_overrides = overrides;
    input.base_versions = input.snapshot.base_versions.clone();
    Ok(())
}
fn prefix_edit(edit: &DraftEdit, key: &str) -> Option<DraftEdit> {
    let mut result = edit.clone();
    let path = match &mut result {
        DraftEdit::Replace { path, .. }
        | DraftEdit::ArraySplice { path, .. }
        | DraftEdit::ObjectSplice { path, .. }
        | DraftEdit::Reorder { path, .. } => path,
    };
    if !path.first().is_some_and(|part| part.equals(key)) {
        return None;
    }
    path.remove(0);
    if path.first().is_some_and(|part| part.equals("value")) {
        path.remove(0);
    }
    Some(result)
}
