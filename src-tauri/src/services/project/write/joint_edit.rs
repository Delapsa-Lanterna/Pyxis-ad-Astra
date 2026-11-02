use super::super::model::{SessionCsvRow, csv_table_spec};
#[cfg(test)]
use super::super::query::joint_edit::query_joint_edit;
use super::super::session::csv_writes::CsvTableDraft;
use super::super::session::{lock_ready_session, session_handle};
use super::super::write::entity_write::content::stage_entity_content;
use crate::domain::{
    csv_column_order, entity_construction, entity_definitions, joint_hull, save_edits,
    variant_modules,
};
use crate::errors::{AppError, AppResult};
use crate::io::{FileChangeSetBuilder, JsonWriteBatch, read_csv_data};
use crate::models::{
    EntityIdentityChange, EntityKind, EntityLinkedRecord, JointEditKind, JointEditQuery,
    JointEditSubmission, JointRecordTarget, JointValue, SaveEdit, WriteContentTarget, *,
};
use crate::services::project::definitions::entity_resources;
use crate::services::project::query::joint_edit;
use crate::services::project::sources::core;
use crate::services::project::write::entity_write::descriptions;
use crate::services::query_joint_edit_request;
use crate::{io, parsers};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::slice;

/// Consumes the current snapshot prepared under the project's root lease.
/// Source credentials are rechecked before staging, while the graph is reused.
pub fn save_joint_edit(payload: &JointEditSubmission) -> AppResult<WriteResult<JointEditSnapshot>> {
    let current = &payload.snapshot;
    let source_versions = current
        .records
        .iter()
        .filter(|record| payload.values.contains_key(&record.key))
        .filter_map(|record| record.source_version.as_ref())
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>();
    for expected in source_versions.into_values() {
        let actual = io::file_version(Path::new(&expected.path))
            .map_err(|error| error.at_path(&expected.path))?;
        if actual != *expected
            && !io::source_recreation_allowed(&current.root.mod_root, &expected.path)
        {
            return Err(
                AppError::message("write.version_conflict", "联合保存来源内容已变化")
                    .at_path(&expected.path),
            );
        }
    }
    for required in current
        .records
        .iter()
        .filter(|record| payload.values.contains_key(&record.key))
        .flat_map(|record| &record.base_versions)
    {
        if !payload
            .base_versions
            .iter()
            .any(|version| windows_path_key(&version.path) == windows_path_key(&required.path))
        {
            return Err(AppError::message(
                "write.version_scope_missing",
                format!("联合保存缺少版本凭据: {}", required.path),
            ));
        }
    }
    let mut values = payload.values.clone();
    let renames = current
        .records
        .iter()
        .filter_map(|record| match (&record.target, values.get(&record.key)) {
            (JointRecordTarget::Spec { target }, Some(JointValue::Present(data)))
                if target.kind == EntityKind::Variant =>
            {
                data.get("variantId")
                    .and_then(Value::as_str)
                    .filter(|id| *id != target.id)
                    .map(|id| (target.id.clone(), id.to_string()))
            }
            _ => None,
        })
        .collect::<Vec<_>>();
    for record in &current.records {
        if !matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant && record.source.as_ref().is_some_and(|source| source.source == ResourceSource::Mod))
        {
            continue;
        }
        let mut value = values
            .get(&record.key)
            .cloned()
            .unwrap_or_else(|| record.value.clone());
        if let JointValue::Present(data) = &mut value {
            let mut changed = false;
            for (previous, next) in &renames {
                changed |= variant_modules::rename_module_reference(data, previous, next);
            }
            if changed {
                values.insert(record.key.clone(), value);
            }
        }
    }
    for key in payload.values.keys() {
        if !current.records.iter().any(|record| &record.key == key) {
            return Err(AppError::message(
                "joint.target_changed",
                "联合保存记录已不属于当前目标",
            ));
        }
    }
    let handle = session_handle(&current.root.session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&current.root.mod_root))?;
    let mut json = JsonWriteBatch::new(payload.json_write.clone());
    let mut tables: BTreeMap<CsvTableKey, CsvTableDraft> = BTreeMap::new();
    let mut identities = Vec::new();
    let mut description_renames = Vec::new();
    let mut key_map = Vec::new();
    let mut saved = current.clone();
    let mut records = current.records.iter().collect::<Vec<_>>();
    records.sort_by_key(|record| !matches!(record.target, JointRecordTarget::Spec { .. }));
    for record in records {
        let Some(value) = values.get(&record.key) else {
            continue;
        };
        let create_override = payload.create_overrides.contains(&record.key);
        if create_override
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
        if value == &record.value
            && !create_override
            && !io::source_recreation_allowed(&current.root.mod_root, &record.target.write().path)
        {
            continue;
        }
        match (&record.target, value) {
            (JointRecordTarget::Spec { target }, JointValue::Present(data)) => {
                let constructed = if matches!(record.value, JointValue::Missing)
                    && matches!(target.kind, EntityKind::Ship | EntityKind::Weapon)
                {
                    let params = if target.kind == EntityKind::Ship {
                        AssociatedSpecCreateParams::Ship {
                            id: target.id.clone(),
                            hull_name: target.id.clone(),
                        }
                    } else {
                        AssociatedSpecCreateParams::Weapon {
                            id: target.id.clone(),
                            spec_class: serde_json::from_value(
                                data.get("specClass").cloned().ok_or_else(|| {
                                    AppError::message(
                                        "spec.weapon_class_unsupported",
                                        "请选择 projectile 或 beam 规格分支",
                                    )
                                })?,
                            )?,
                        }
                    };
                    let mut content = entity_construction::create_associated_spec(&params);
                    let edited = data.as_object().ok_or_else(|| {
                        AppError::message("joint.value_shape", "规格内容必须为对象")
                    })?;
                    content
                        .as_object_mut()
                        .expect("associated spec template is an object")
                        .extend(edited.clone());
                    content
                } else {
                    data.clone()
                };
                let data = &constructed;
                let definition = entity_definitions::entity_spec_definition(target.kind)
                    .expect("joint spec has format");
                if let Some(id) = data
                    .get(definition.id_field)
                    .and_then(Value::as_str)
                    .filter(|id| *id != target.id)
                {
                    let relative = if target.state == EntityTargetState::Create {
                        definition.default_rel_path(id)
                    } else {
                        io::forward_slash_path(
                            &Path::new(&target.write.rel_path)
                                .with_file_name(format!("{id}{}", definition.extension)),
                        )
                    };
                    let path = Path::new(&current.root.mod_root).join(relative);
                    if !payload.base_versions.iter().any(|version| {
                        windows_path_key(&version.path) == windows_path_key(&path.to_string_lossy())
                    }) {
                        return Err(AppError::message(
                            "write.version_scope_missing",
                            "联合改名缺少目标版本凭据",
                        ));
                    }
                }
                let staged = stage_entity_content(
                    &mut session,
                    &mut builder,
                    &mut json,
                    target,
                    data.clone(),
                    None,
                )?;
                if let Some(rename) = staged.description_rename {
                    description_renames.push(rename);
                }
                if let Some(csv) = staged.linked_csv {
                    if let Some(pending) = tables.get_mut(&csv.table) {
                        if let Some(EntityLinkedRecord::Csv { row_key, .. }) =
                            &staged.identity.before.linked_record
                            && let Some(row) =
                                pending.rows.iter_mut().find(|row| row.row_key == *row_key)
                        {
                            row.data
                                .insert("id".into(), staged.identity.after.id.clone().into());
                        }
                    } else {
                        tables.insert(csv.table, csv);
                    }
                }
                let next = saved
                    .records
                    .iter_mut()
                    .find(|entry| entry.key == record.key)
                    .expect("saved record belongs to current graph");
                next.target = JointRecordTarget::Spec {
                    target: staged.identity.after.clone(),
                };
                next.source = Some(staged.identity.after.write.clone());
                if payload.json_write.replaces(&target.write.rel_path)
                    && let Some(composition) = &mut next.composition
                {
                    composition.replace = true;
                }
                next.value = JointValue::Present(staged.data);
                if let JointValue::Present(data) = &next.value {
                    next.resource_refs = match staged.identity.after.kind {
                        EntityKind::Ship => {
                            entity_resources::ship_resource_refs(&staged.identity.after.id, data)
                        }
                        EntityKind::Weapon => {
                            entity_resources::weapon_resource_refs(&staged.identity.after.id, data)
                        }
                        _ => next.resource_refs.clone(),
                    };
                }
                if staged.identity.before.id == current.root.id
                    && matches!(
                        (current.root.kind, staged.identity.before.kind),
                        (JointEditKind::Ship, EntityKind::Ship)
                            | (JointEditKind::Skin, EntityKind::Skin)
                            | (JointEditKind::Weapon, EntityKind::Weapon)
                            | (JointEditKind::Variant, EntityKind::Variant)
                    )
                {
                    saved.root.id = staged.identity.after.id.clone();
                }
                identities.push(staged.identity);
            }
            (JointRecordTarget::Spec { target }, JointValue::Missing) => {
                builder.text_file(&target.write.rel_path, None)?;
            }
            (
                JointRecordTarget::Csv {
                    table,
                    row_key,
                    identity,
                    ..
                },
                value,
            ) => {
                if !tables.contains_key(table) {
                    tables.insert(*table, CsvTableDraft::read(&session, *table)?);
                }
                let CsvTableDraft {
                    header,
                    rows,
                    next_row_seq: next_seq,
                    ..
                } = tables.get_mut(table).expect("joint table staged");
                if header.is_empty()
                    && let Some(source) = &record.source
                {
                    *header = read_csv_data(Path::new(&source.path))?.header;
                }
                let index = rows
                    .iter()
                    .position(|row| row.row_key == *row_key)
                    .or_else(|| {
                        rows.iter().position(|row| {
                            !row.is_comment
                                && identity.iter().all(|(field, id)| {
                                    row.data.get(field).and_then(Value::as_str) == Some(id)
                                })
                        })
                    });
                match value {
                    JointValue::Missing => {
                        if let Some(index) = index {
                            rows.remove(index);
                        }
                    }
                    JointValue::Present(Value::Object(data)) => {
                        let mut data = data.clone();
                        let added = data
                            .keys()
                            .filter(|field| !header.contains(field))
                            .cloned()
                            .collect::<Vec<_>>();
                        if !added.is_empty() {
                            let standard = if let Some(root) = &session.manifest.starsector_root {
                                let core =
                                    core::core_dir(root)?.join(csv_table_spec(*table).rel_path);
                                if core.exists() {
                                    read_csv_data(&core)?.header
                                } else {
                                    csv_column_order::standard_csv_columns(*table)
                                }
                            } else {
                                csv_column_order::standard_csv_columns(*table)
                            };
                            csv_column_order::add_ordered_csv_columns(header, &added, &standard);
                        }
                        for identity_change in &identities {
                            if let Some(EntityLinkedRecord::Csv {
                                table: linked,
                                row_key: linked_key,
                            }) = &identity_change.before.linked_record
                                && linked == table
                                && linked_key == row_key
                            {
                                data.insert("id".into(), identity_change.after.id.clone().into());
                            }
                        }
                        if let Some(index) = index {
                            rows[index].data = data;
                        } else {
                            let next_key = format!("{}:row:{next_seq}", table.as_str());
                            *next_seq += 1;
                            key_map.push(CsvRowKeyMapping {
                                previous_key: row_key.clone(),
                                next_key: next_key.clone(),
                                row_index: rows.len(),
                            });
                            rows.push(SessionCsvRow {
                                row_key: next_key,
                                data,
                                is_comment: false,
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
                if current.root.kind == JointEditKind::Wing
                    && *table == CsvTableKey::Wings
                    && identity.get("id") == Some(&current.root.id)
                    && let JointValue::Present(data) = value
                {
                    saved.root.id = data
                        .get("id")
                        .and_then(Value::as_str)
                        .ok_or_else(|| AppError::message("joint.id_missing", "战机联队缺少 ID"))?
                        .into();
                }
            }
            (JointRecordTarget::Text { write }, JointValue::Present(Value::String(text))) => {
                builder.text_file(&write.rel_path, Some(text.clone()))?;
            }
            (JointRecordTarget::Text { write }, JointValue::Missing) => {
                builder.text_file(&write.rel_path, None)?;
            }
            _ => {
                return Err(AppError::message(
                    "joint.value_shape",
                    "联合编辑内容形状无效",
                ));
            }
        }
        if !matches!(record.target, JointRecordTarget::Spec { .. }) {
            saved
                .records
                .iter_mut()
                .find(|entry| entry.key == record.key)
                .expect("saved record belongs to current graph")
                .value = value.clone();
        }
    }
    if !description_renames.is_empty() {
        if let Some(table) = tables.get_mut(&CsvTableKey::Descriptions) {
            for rename in &description_renames {
                descriptions::rename_description_row(
                    &session,
                    table,
                    &rename.previous_id,
                    &rename.next_id,
                    rename.description_type,
                )?;
            }
        } else if let Some(csv) =
            descriptions::prepare_description_renames(&session, &description_renames)?
        {
            tables.insert(csv.table, csv);
        }
    }
    let mut staged_tables = BTreeMap::new();
    for (table, mut draft) in tables {
        if let Some(first) = draft.header.first() {
            for row in draft
                .rows
                .iter_mut()
                .filter(|row| row.is_comment && !row.data.is_empty())
            {
                let value = parsers::value_to_cell(row.data.get(first).unwrap_or(&Value::Null))?;
                if !value.starts_with('#') {
                    row.data
                        .insert(first.clone(), Value::String(format!("#{value}")));
                }
            }
        }
        staged_tables.insert(table, draft.stage(&session, &mut builder)?);
    }
    json.stage_replace_paths(&mut builder)?;
    json.finish()?;
    for identity in &mut identities {
        if let Some(table) = entity_definitions::entity_spec_definition(identity.after.kind)
            .and_then(|definition| definition.csv_table)
            && let Some(rows) = staged_tables.get(&table).map(|csv| &csv.draft.rows)
            && let Some(row) = rows.iter().find(|row| {
                !row.is_comment
                    && row.data.get("id").and_then(Value::as_str)
                        == Some(identity.after.id.as_str())
            })
        {
            identity.after.linked_record = Some(EntityLinkedRecord::Csv {
                table,
                row_key: row.row_key.clone(),
            });
        }
    }
    for record in &mut saved.records {
        if let JointRecordTarget::Spec { target } = &mut record.target
            && let Some(identity) = identities.iter().find(|identity| {
                identity.after.kind == target.kind && identity.after.id == target.id
            })
        {
            *target = identity.after.clone();
        }
        if let JointRecordTarget::Csv {
            table,
            row_key,
            identity,
            ..
        } = &mut record.target
            && let Some(rows) = staged_tables.get(table).map(|csv| &csv.draft.rows)
        {
            let next_key = key_map
                .iter()
                .find(|mapping| mapping.previous_key == *row_key)
                .map(|mapping| mapping.next_key.as_str())
                .unwrap_or(row_key);
            let renamed = (*table == CsvTableKey::Descriptions)
                .then(|| {
                    description_renames.iter().find(|rename| {
                        identity.get("id") == Some(&rename.previous_id)
                            && identity.get("type").map(String::as_str)
                                == Some(rename.description_type)
                    })
                })
                .flatten();
            let row = rows.iter().find(|row| row.row_key == next_key).or_else(|| {
                renamed.and_then(|rename| {
                    rows.iter().find(|row| {
                        !row.is_comment
                            && row.data.get("id").and_then(Value::as_str) == Some(&rename.next_id)
                            && row.data.get("type").and_then(Value::as_str)
                                == Some(rename.description_type)
                    })
                })
            });
            record.value = row
                .map(|row| JointValue::Present(Value::Object(row.data.clone())))
                .unwrap_or(JointValue::Missing);
            if let Some(row) = row {
                if *row_key != row.row_key
                    && !key_map
                        .iter()
                        .any(|mapping| mapping.previous_key == *row_key)
                {
                    key_map.push(CsvRowKeyMapping {
                        previous_key: row_key.clone(),
                        next_key: row.row_key.clone(),
                        row_index: rows
                            .iter()
                            .position(|entry| entry.row_key == row.row_key)
                            .expect("saved row belongs to table"),
                    });
                }
                *row_key = row.row_key.clone();
                for (field, id) in identity {
                    if let Some(value) = row.data.get(field).and_then(Value::as_str) {
                        *id = value.into();
                    }
                }
            }
        }
    }
    let changes = builder.apply()?;
    for csv in staged_tables.into_values() {
        csv.accept(&mut session);
    }
    let changed_versions = changes
        .iter()
        .map(io::version_after_change)
        .collect::<AppResult<Vec<_>>>()?;
    let versions = changed_versions
        .iter()
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>();
    for record in &mut saved.records {
        let previous = current
            .records
            .iter()
            .find(|entry| entry.key == record.key)
            .expect("saved record belongs to current graph");
        if record.value != previous.value || record.target != previous.target {
            record.source = if matches!(record.value, JointValue::Missing) {
                None
            } else {
                Some(record.target.write().clone())
            };
        }
        for identity in &identities {
            record.base_versions.retain(|version| {
                windows_path_key(&version.path) != windows_path_key(&identity.before.write.path)
                    || identity.before.write.path == identity.after.write.path
            });
        }
        if let Some(version) = versions.get(&windows_path_key(&record.target.write().path)) {
            record.base_versions.push((*version).clone());
        }
        for version in &mut record.base_versions {
            if let Some(changed) = versions.get(&windows_path_key(&version.path)) {
                *version = (*changed).clone();
            }
        }
        record
            .base_versions
            .sort_by_key(|version| windows_path_key(&version.path));
        record
            .base_versions
            .dedup_by(|left, right| windows_path_key(&left.path) == windows_path_key(&right.path));
        if record
            .source
            .as_ref()
            .is_some_and(|source| source.source == ResourceSource::Mod)
        {
            record.source_version = record
                .source
                .as_ref()
                .and_then(|source| {
                    versions
                        .get(&windows_path_key(&source.path))
                        .map(|version| (*version).clone())
                })
                .or(record.source_version.clone());
        }
        let old_key = record.key.clone();
        record.key = match &record.target {
            JointRecordTarget::Spec { target } => {
                serde_json::to_string(&("spec", target.kind, &target.id))?
            }
            JointRecordTarget::Csv {
                table, identity, ..
            } => serde_json::to_string(&("csv", table, identity))?,
            JointRecordTarget::Text { write } => serde_json::to_string(&("text", &write.path))?,
        };
        for key in saved.bindings.values_mut() {
            if *key == old_key {
                *key = record.key.clone();
            }
        }
    }
    saved.base_versions = saved
        .records
        .iter()
        .flat_map(|record| record.base_versions.iter().cloned())
        .map(|version| (windows_path_key(&version.path), version))
        .collect::<BTreeMap<_, _>>()
        .into_values()
        .collect();
    if let Some(key) = saved.bindings.get("variant") {
        let referenced = |snapshot: &JointEditSnapshot, record_key: &str, path: &str| {
            snapshot
                .records
                .iter()
                .find(|record| record.key == record_key)
                .and_then(|record| match &record.value {
                    JointValue::Present(data) => data.get(path).cloned(),
                    JointValue::Missing => None,
                })
        };
        let changed = current.hull.is_none()
            || referenced(current, key, "hullId") != referenced(&saved, key, "hullId")
            || (current.root.kind == JointEditKind::Wing
                && referenced(current, &current.bindings["csv"], "variant")
                    != referenced(&saved, &saved.bindings["csv"], "variant"));
        saved.hull = if changed {
            None
        } else {
            joint_hull::project_joint_hull(&saved.records, key)?
        };
    }
    if matches!(saved.root.kind, JointEditKind::Ship | JointEditKind::Skin) {
        saved.hull = joint_hull::project_ship_hull(&saved.records, &saved.bindings["spec"])?;
    }
    if saved.root.kind == JointEditKind::Variant {
        saved.variants.clear();
        for record in &saved.records {
            let previous_key = identities.iter().find(|identity| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == identity.after.kind && target.id == identity.after.id)).map(|identity| serde_json::to_string(&("spec", identity.before.kind, &identity.before.id))).transpose()?.unwrap_or_else(|| record.key.clone());
            if matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant)
                && current.variants.contains_key(&previous_key)
                && current
                    .records
                    .iter()
                    .find(|before| before.key == previous_key)
                    .is_some_and(|before| match (&before.value, &record.value) {
                        (JointValue::Present(old), JointValue::Present(next)) => {
                            old.get("hullId") == next.get("hullId")
                        }
                        _ => false,
                    })
                && let Some(hull) = joint_hull::project_joint_hull(&saved.records, &record.key)?
            {
                saved.variants.insert(record.key.clone(), hull);
            }
        }
    }
    let owner = WriteContentTarget::Joint {
        root: saved.root.clone(),
    };
    let mut result = WriteResult::from_content(changes, owner, saved);
    result.key_map = key_map;
    result.identity_changes = identities;
    Ok(result)
}
#[cfg(test)]
#[path = "joint_edit_tests.rs"]
mod tests;

pub fn prepare_joint_save(
    payload: &mut JointEditSubmission,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> Result<(), AppError> {
    for identity in identities {
        if identity.before.id == payload.snapshot.root.id
            && matches!(
                (payload.snapshot.root.kind, identity.before.kind),
                (JointEditKind::Ship, EntityKind::Ship)
                    | (JointEditKind::Skin, EntityKind::Skin)
                    | (JointEditKind::Weapon, EntityKind::Weapon)
                    | (JointEditKind::Variant, EntityKind::Variant)
            )
        {
            payload.snapshot.root.id = identity.after.id.clone();
        }
    }
    let retained = joint_edit::retained_joint_sources(&payload.snapshot)?;
    let current = query_joint_edit_request(&JointEditQuery {
        root: payload.snapshot.root.clone(),
        row_key: None,
        values: Some(retained),
        new_sources: payload.snapshot.new_sources.clone(),
        catalog: None,
        catalog_source: None,
    })?;
    let resolve_key = |key: &String| -> Result<String, AppError> {
        let mut target = payload
            .snapshot
            .records
            .iter()
            .find(|record| record.key == *key)
            .expect("captured changes belong to the submitted snapshot")
            .target
            .clone();
        for identity in identities {
            match &mut target {
                JointRecordTarget::Spec { target }
                    if target.kind == identity.before.kind && target.id == identity.before.id =>
                {
                    *target = identity.after.clone()
                }
                JointRecordTarget::Csv { table, row_key, .. } => {
                    if let (
                        Some(EntityLinkedRecord::Csv {
                            table: before,
                            row_key: previous,
                        }),
                        Some(EntityLinkedRecord::Csv {
                            table: after,
                            row_key: next,
                        }),
                    ) = (
                        &identity.before.linked_record,
                        &identity.after.linked_record,
                    ) && *table == *before
                        && *row_key == *previous
                    {
                        *table = *after;
                        *row_key = next.clone();
                    }
                }
                JointRecordTarget::Text { write } if write.path == identity.before.write.path => {
                    *write = identity.after.write.clone()
                }
                _ => {}
            }
        }
        current
            .records
            .iter()
            .find(|record| match (&target, &record.target) {
                (
                    JointRecordTarget::Spec { target: old },
                    JointRecordTarget::Spec { target: next },
                ) => old.kind == next.kind && old.id == next.id,
                (
                    JointRecordTarget::Csv {
                        table: old,
                        row_key: previous,
                        ..
                    },
                    JointRecordTarget::Csv {
                        table: next,
                        row_key,
                        ..
                    },
                ) => old == next && previous == row_key,
                (
                    JointRecordTarget::Text { write: old },
                    JointRecordTarget::Text { write: next },
                ) => old == next,
                _ => false,
            })
            .map(|record| record.key.clone())
            .ok_or_else(|| {
                AppError::message(
                    "joint.target_changed",
                    format!("保存来源已删除或替换: {key}"),
                )
            })
    };
    let mut values = BTreeMap::new();
    let overrides = payload
        .create_overrides
        .iter()
        .map(|key| {
            let next = resolve_key(key)?;
            values.insert(next.clone(), serde_json::to_value(&payload.values[key])?);
            Ok(next)
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    let keys = edits
        .iter()
        .map(|edit| match edit {
            SaveEdit::Set { path, .. } | SaveEdit::Remove { path } => path
                .first()
                .expect("joint edits identify their source record"),
        })
        .collect::<BTreeSet<_>>();
    for previous in keys {
        let key = resolve_key(previous)?;
        let record = current
            .records
            .iter()
            .find(|record| record.key == key)
            .expect("resolved source belongs to the current graph");
        let value = values
            .entry(key)
            .or_insert(serde_json::to_value(&record.value)?);
        save_edits::apply_save_edits_at(value, edits, slice::from_ref(previous));
    }
    payload.values = values
        .into_iter()
        .map(|(key, value)| serde_json::from_value::<JointValue>(value).map(|value| (key, value)))
        .collect::<Result<_, _>>()?;
    payload.create_overrides = overrides;
    let mut versions = current.base_versions.clone();
    for version in &payload.base_versions {
        if !versions
            .iter()
            .any(|current| windows_path_key(&current.path) == windows_path_key(&version.path))
        {
            versions.push(version.clone());
        }
    }
    payload.base_versions = versions;
    payload.snapshot = current;
    Ok(())
}
