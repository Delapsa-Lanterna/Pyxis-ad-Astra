use super::super::{
    cache::{lock_session, session_handle},
    definitions::entity_definitions::entity_definition,
    query::entity_targets::describe_entity_target,
};
use super::csv_staging::CsvTableDraft;
use crate::models::SpecSave;
use crate::{
    domain::{entity_definitions::entity_spec_definition, entity_identity::validate_entity_id},
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file},
    models::{
        EntityEditTarget, EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState,
        JsonWriteOptions, WriteResult,
    },
    parsers::render_csv_text,
};
use serde_json::Value;
use std::path::Path;

pub fn validate_skin_engine_changes(session_id: &str, data: &Value) -> AppResult<()> {
    crate::domain::schema::validate_document(crate::parsers::bundled_schema("skin"), data)?;
    if data
        .get("engineSlotChanges")
        .and_then(Value::as_object)
        .is_none_or(|changes| changes.is_empty())
    {
        return Ok(());
    }
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let core_ships = session
        .manifest
        .starsector_root
        .as_deref()
        .map(super::super::sources::core::load_core_ship_files)
        .transpose()?;
    let core_skins = session
        .manifest
        .starsector_root
        .as_deref()
        .map(super::super::sources::core::load_core_skin_files)
        .transpose()?;
    let mut id = data["baseHullId"]
        .as_str()
        .ok_or_else(|| AppError::message("config.missing_field", "缺少 baseHullId"))?;
    let mut layers = vec![data];
    let mut seen = std::collections::BTreeSet::new();
    loop {
        if !seen.insert(id) {
            return Err(AppError::message("skin.base_cycle", "循环船体皮肤引用"));
        }
        let skin = session
            .skin_files
            .iter()
            .find(|skin| skin.skin_hull_id == id)
            .or_else(|| {
                core_skins
                    .as_ref()
                    .and_then(|skins| skins.iter().find(|skin| skin.skin_hull_id == id))
            });
        let Some(skin) = skin else { break };
        layers.push(&skin.data);
        id = skin.data["baseHullId"]
            .as_str()
            .expect("loaded skin base ID");
    }
    let hull = session
        .ship_files
        .get(id)
        .or_else(|| core_ships.as_ref().and_then(|ships| ships.get(id)))
        .ok_or_else(|| {
            AppError::message("config.reference_missing", format!("找不到基础船体：{id}"))
        })?;
    let mut count = hull.data["engineSlots"].as_array().map_or(0, Vec::len);
    for layer in layers.into_iter().rev() {
        let removed: std::collections::BTreeSet<_> = layer["removeEngineSlots"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| {
                value
                    .as_f64()
                    .or_else(|| value.as_str().and_then(|text| text.parse::<f64>().ok()))
            })
            .filter(|&index| index >= 0.0 && index < count as f64)
            .map(|index| index as usize)
            .collect();
        count -= removed.len();
        if let Some(changes) = layer["engineSlotChanges"].as_object() {
            for key in changes.keys() {
                if !key.parse::<usize>().is_ok_and(|index| index < count) {
                    return Err(AppError::message(
                        "config.shape_invalid",
                        format!("引擎槽索引超出当前船体范围：engineSlotChanges/{key}"),
                    ));
                }
            }
        }
    }
    Ok(())
}

pub fn save_entity_spec(
    session_id: &str,
    target: &EntityEditTarget,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    if let Some(schema) = match target.kind {
        EntityKind::Variant => Some("variant"),
        EntityKind::Faction => Some("faction"),
        EntityKind::Skin => Some("skin"),
        _ => None,
    } {
        crate::domain::schema::validate_document(crate::parsers::bundled_schema(schema), &data)?;
    }
    if target.kind == EntityKind::Weapon {
        crate::domain::spec_construction::validate_weapon_editor_spec(
            &data,
            Path::new(&target.write.path),
        )?;
    }
    save_entity_content(session_id, target, data, options, ordered_json, None)
}
pub fn save_variant_entity(
    session_id: &str,
    previous_id: Option<&str>,
    next_id: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let content_id = data
        .get("variantId")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::message("spec.id_mismatch", "装配数据缺少 variantId"))?;
    if validate_entity_id(content_id, "装配 ID 无效")?
        != validate_entity_id(next_id, "装配 ID 无效")?
    {
        return Err(AppError::message(
            "spec.id_mismatch",
            "装配数据 variantId 与保存目标不一致",
        ));
    }
    let info = super::super::query::entity_targets::query_entity_edit_target(
        session_id,
        EntityKind::Variant,
        previous_id.unwrap_or(next_id),
    )?;
    let result = save_entity_spec(session_id, &info.target, data, options, ordered_json)?;
    let after = &result.identity_changes[0].after;
    let content = &result
        .content
        .as_ref()
        .expect("variant save returns data")
        .value;
    let refreshed = crate::domain::json_documents::build_variant_file(
        Path::new(&after.write.root),
        &after.write.rel_path,
        content,
    )?;
    let owner = crate::models::WriteContentTarget::Json {
        origin: after.into(),
    };
    Ok(result.with_content(owner, serde_json::to_value(refreshed)?))
}

pub fn save_entity_text(
    session_id: &str,
    target: &EntityEditTarget,
    text: String,
) -> AppResult<WriteResult<Value>> {
    let data = crate::parsers::parse_starsector_json(&text).map_err(|error| {
        AppError::context(format!("解析 JSON 文件失败 ({})", target.write.path), error)
            .at_path(&target.write.path)
    })?;
    let definition =
        entity_spec_definition(target.kind).expect("recognized text has a format definition");
    let raw_id = data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("spec.id_missing", format!("缺少 {}", definition.id_field))
        })?;
    let id = validate_entity_id(raw_id, definition.invalid_id_message)?;
    let text = if raw_id == id {
        text
    } else {
        crate::parsers::replace_root_string(&text, definition.id_field, id)?
    };
    let result = save_entity_content(
        session_id,
        target,
        data,
        Default::default(),
        None,
        Some(&text),
    )?;
    let owner = crate::models::WriteContentTarget::Text {
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
    let _write_lock = crate::io::acquire_root_write_lock(Path::new(&root))?;
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
    let description = super::entity_description::prepare_description_renames(
        &session,
        &staged
            .description_rename
            .iter()
            .cloned()
            .collect::<Vec<_>>(),
    )?;
    super::variant_identity::stage_variant_parents(
        &session,
        &mut builder,
        &mut json,
        &staged.identity,
    )?;
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
    let owner = crate::models::WriteContentTarget::Spec {
        target: Box::new(staged.identity.after.clone()),
    };
    let mut result = WriteResult::from_content(changes, owner, staged.data);
    result.identity_changes.push(staged.identity);
    Ok(result)
}

pub(in crate::services::project) struct StagedEntityWrite {
    pub data: Value,
    pub identity: EntityIdentityChange,
    pub(super) linked_csv: Option<CsvTableDraft>,
    pub(super) description_rename: Option<super::entity_description::DescriptionRename>,
}

pub(in crate::services::project) fn stage_entity_content(
    session: &mut super::super::model::ProjectSession,
    builder: &mut FileChangeSetBuilder,
    json: &mut JsonWriteBatch,
    target: &EntityEditTarget,
    mut data: Value,
    ordered_json: Option<&str>,
    raw_text: Option<&str>,
) -> AppResult<StagedEntityWrite> {
    let definition = entity_spec_definition(target.kind)
        .ok_or_else(|| AppError::message("spec.kind_unknown", "实体规格格式不存在"))?;
    let next_id = data
        .get(definition.id_field)
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("spec.id_missing", format!("缺少 {}", definition.id_field))
        })?;
    let next_id = validate_entity_id(next_id, definition.invalid_id_message)?.to_string();
    data[definition.id_field] = Value::String(next_id.clone());
    if target.kind == EntityKind::Variant {
        crate::domain::joint_hull::rename_module_reference(&mut data, &target.id, &next_id);
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
                || !crate::io::source_recreation_allowed(&session.manifest.mod_root, &location.path)
        })
        .map(|location| read_json_file(Path::new(&location.path)))
        .transpose()?;
    if target.state == EntityTargetState::Existing
        && original
            .as_ref()
            .unwrap_or(&data)
            .get(definition.id_field)
            .and_then(Value::as_str)
            != Some(&target.id)
    {
        return Err(AppError::message(
            "spec.path_id_mismatch",
            "实体源文件 ID 与加载身份不一致",
        ));
    }
    let description_rename = super::entity_description::description_rename(
        target.kind,
        &target.id,
        &next_id,
        original.as_ref().unwrap_or(&data),
    );
    let next_rel = if target.state == EntityTargetState::Create {
        definition.default_rel_path(&next_id)
    } else if next_id != target.id {
        crate::io::forward_slash_path(
            &Path::new(&target.write.rel_path)
                .with_file_name(format!("{next_id}{}", definition.extension)),
        )
    } else {
        target.write.rel_path.clone()
    };
    let destination = boundary.resolve_relative_target(&next_rel, "entity target")?;
    match target.kind {
        EntityKind::Variant => {
            crate::domain::json_documents::build_variant_file(boundary.root(), &next_rel, &data)?;
        }
        EntityKind::Skin => {
            crate::domain::json_documents::build_skin_file(boundary.root(), &next_rel, &data)?;
        }
        _ => {}
    }
    if target.state == EntityTargetState::Create || next_id != target.id {
        crate::io::require_rename_target(&source, &destination)?;
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
    if target.kind == EntityKind::Weapon {
        crate::domain::spec_construction::validate_weapon_spec_class(&data, &destination)?;
    }
    let text = if let Some(text) = raw_text {
        text.to_string()
    } else {
        json.render(render_source, &data, ordered_json)?
    };
    if target.state == EntityTargetState::Existing && next_rel != target.write.rel_path {
        builder.rename_text_file(&target.write.rel_path, &next_rel, text)?;
    } else if !source.exists() || crate::io::read_utf8_no_bom(&source)? != text {
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
    if target.kind == EntityKind::Faction {
        let index_rel = "data/world/factions/factions.csv";
        let mut index = super::super::cache::csv::read_retained_csv(session, index_rel)?;
        if let Some(EntityLinkedRecord::Index { row_index, .. }) = &target.linked_record {
            let entries = crate::io::faction_index_entries(&boundary, &index)?;
            let entry = entries
                .iter()
                .find(|entry| entry.row_index == *row_index)
                .expect("loaded faction index entry");
            crate::parsers::update_faction_index_row(
                &mut index.rows[*row_index].data,
                entry,
                &next_id,
                &next_rel,
            );
        } else {
            if index.header.is_empty() {
                index.header = vec!["faction".into()];
            }
            let field = index
                .header
                .iter()
                .find(|field| field.eq_ignore_ascii_case("faction"))
                .or_else(|| {
                    index
                        .header
                        .iter()
                        .find(|field| field.eq_ignore_ascii_case("id"))
                })
                .unwrap_or(&index.header[0]);
            let mut row = serde_json::Map::new();
            if field.eq_ignore_ascii_case("id") {
                row.insert(field.clone(), Value::String(next_id.clone()));
                if let Some(file) = index
                    .header
                    .iter()
                    .find(|field| field.eq_ignore_ascii_case("file"))
                {
                    row.insert(file.clone(), Value::String(next_rel.clone()));
                }
            } else {
                row.insert(field.clone(), Value::String(next_rel.clone()));
            }
            index.rows.push(crate::models::CsvRow {
                data: row,
                is_comment: false,
            });
        }
        let text = render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?;
        builder.text_file(index_rel, Some(text))?;
    }
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
    edits: &[crate::models::SaveEdit],
    identities: &[crate::models::EntityIdentityChange],
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
    if crate::io::source_recreation_allowed(&target.write.root, &target.write.path) {
        return Ok(());
    }
    let current = crate::services::query_entity(session_id, target.kind, &target.id)?;
    if let Some(current) = current {
        *data = current.data;
        *target = current.target;
        *base_versions = current.base_versions;
        crate::domain::save_edits::apply_save_edits(data, edits);
        *ordered_json = Some(serde_json::to_string(&data)?);
    } else if target.state == crate::models::EntityTargetState::Existing {
        return Err(AppError::message("write.target_removed", "保存目标已删除"));
    }
    Ok(())
}

pub fn write_spec_request(payload: SpecSave) -> Result<WriteResult<Value>, AppError> {
    crate::services::require_entity_version_scope(
        &payload.session_id,
        payload.target.kind,
        &payload.target.id,
        &payload.base_versions,
    )?;
    let result = crate::services::save_entity_spec(
        &payload.session_id,
        &payload.target,
        payload.data,
        payload.json_write,
        payload.ordered_json.as_deref(),
    )?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::{
        models::{CsvSearchField, CsvTableKey, EntityKind, FileChangeReplayDirection},
        services::project,
        testutil::temp_dir,
    };
    use serde_json::json;

    #[test]
    fn spec_rename_updates_the_registered_row_and_preserves_a_comment_with_the_same_id() {
        for kind in [
            EntityKind::Ship,
            EntityKind::Weapon,
            EntityKind::System,
            EntityKind::Skill,
        ] {
            let definition =
                crate::domain::entity_definitions::entity_spec_definition(kind).unwrap();
            let table = definition.csv_table.unwrap();
            let root = temp_dir(&format!("identity_comment_{kind:?}"));
            std::fs::create_dir_all(root.join(definition.dir)).unwrap();
            let mut content = json!({"specClass":"beam"});
            if kind == EntityKind::Weapon {
                content["turretOffsets"] = json!([0, 0]);
                content["hardpointOffsets"] = json!([0, 0]);
            }
            content[definition.id_field] = "old".into();
            let source = root.join(definition.default_rel_path("old"));
            crate::io::write_utf8_no_bom(&source, &content.to_string()).unwrap();
            let csv = root.join(
                crate::services::project::definitions::table_definitions::csv_table_definition(
                    table,
                )
                .spec
                .rel_path,
            );
            let original = "a,id,name\n# retained note,old,Comment\nactive,old,Original\n";
            crate::io::write_utf8_no_bom(&csv, original).unwrap();
            let mut trace = project::PerformanceTrace::new("project.openSession");
            let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
            let info = crate::services::project::query::entity_targets::query_entity_edit_target(
                &manifest.session_id,
                kind,
                "old",
            )
            .unwrap();
            content[definition.id_field] = "next".into();
            let receipt = crate::services::write_transactions::commit_action(
                crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    target: info.target,
                    base_versions: info.base_versions,
                    data: content,
                    json_write: Default::default(),
                    ordered_json: None,
                }),
            )
            .unwrap();
            let saved = crate::io::read_csv_data(&csv).unwrap();
            assert_eq!(saved.header, ["a", "id", "name"]);
            assert_eq!(saved.rows[0].data["id"], "old");
            assert_eq!(saved.rows[0].data["a"], "# retained note");
            assert_eq!(saved.rows[1].data["id"], "next");
            assert_eq!(saved.rows[1].data["name"], "Original");
            assert!(matches!(&receipt.identity_changes[0].after.linked_record,
                Some(crate::models::EntityLinkedRecord::Csv { row_key, .. }) if row_key == &format!("{}:row:1", table.as_str())));
            let undo = crate::services::write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Undo,
                receipt.history.undo_stack[0].id,
                receipt.history.revision,
            )
            .unwrap();
            assert_eq!(
                crate::io::read_csv_data(&csv).unwrap().rows[1].data["id"],
                "old"
            );
            crate::services::write_transactions::replay(
                &manifest.session_id,
                &manifest.mod_root,
                FileChangeReplayDirection::Redo,
                undo.history.redo_stack[0].id,
                undo.history.revision,
            )
            .unwrap();
            assert_eq!(
                crate::io::read_csv_data(&csv).unwrap().rows[1].data["id"],
                "next"
            );
            project::close_project_session(manifest.session_id).unwrap();
            std::fs::remove_dir_all(root).unwrap();
        }
    }

    #[test]
    fn loaded_nested_target_renames_with_its_csv_row_and_replays_identity() {
        let root = temp_dir("identity_spec_csv");
        std::fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
        std::fs::write(
            root.join("data/hulls/nested/filename.ship"),
            r#"{"hullId":"old","hullName":"Loaded"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,custom\nold,Loaded,keep\nother,Other,value\n",
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "old",
        )
        .unwrap();
        let detail = crate::services::project::query::entities::query_entity(
            &manifest.session_id,
            EntityKind::Ship,
            "old",
        )
        .unwrap()
        .unwrap();
        let list = crate::services::project::query::entities::query_entity_list(
            &manifest.session_id,
            EntityKind::Ship,
        )
        .unwrap();
        assert_eq!(info.target, detail.target);
        assert_eq!(info.base_versions, detail.base_versions);
        assert_eq!(info.base_versions, list[0].base_versions);
        assert_eq!(info.base_versions.len(), 2);
        assert_eq!(
            info.target.write.rel_path,
            "data/hulls/nested/filename.ship"
        );
        let before = crate::services::project::query::csv_window::query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let result = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"new","hullName":"Saved"}),
                json_write: Default::default(),
                ordered_json: None,
            }),
        )
        .unwrap();
        assert!(!root.join("data/hulls/nested/filename.ship").exists());
        assert!(root.join("data/hulls/nested/new.ship").is_file());
        assert_eq!(result.changes.len(), 2);
        assert_eq!(result.identity_changes[0].after.id, "new");
        let current = crate::services::project::query::csv_window::query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Ships,
            0,
            20,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(before.rows[0].row_key, current.rows[0].row_key);
        assert_eq!(current.rows[0].data["id"], "new");
        assert_eq!(current.rows[0].data["custom"], "keep");
        assert_eq!(current.rows[1].data["id"], "other");
        let next = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "new",
        )
        .unwrap();
        assert_eq!(result.base_versions, next.base_versions);
        let undo = crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            result.history.undo_stack[0].id,
            result.history.revision,
        )
        .unwrap();
        assert_eq!(undo.identity_changes[0].after.id, "old");
        assert!(root.join("data/hulls/nested/filename.ship").is_file());
        crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undo.history.redo_stack[0].id,
            undo.history.revision,
        )
        .unwrap();
        assert!(root.join("data/hulls/nested/new.ship").is_file());
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_spec_import_uses_content_identity() {
        let root = temp_dir("identity_missing_import");
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "missing",
        )
        .unwrap();
        let result = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"imported"}),
                json_write: Default::default(),
                ordered_json: None,
            }),
        )
        .unwrap();
        assert_eq!(result.identity_changes[0].after.id, "imported");
        assert!(root.join("data/hulls/imported.ship").exists());
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_identity_save_preserves_source_and_updates_linked_row() {
        let root = temp_dir("text_identity_source");
        std::fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
        let old = root.join("data/hulls/nested/filename.ship");
        std::fs::write(&old, "{hullId:'old', # keep\n hullName:'Old'}\n").unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,custom\nold,Old,keep\n",
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let loaded = crate::services::file_editor::load_project_editable_file(
            Some(&manifest.session_id),
            &manifest.mod_root,
            old.to_string_lossy().to_string(),
        )
        .unwrap();
        assert_eq!(loaded.entity.as_ref().unwrap().target.id, "old");
        assert_eq!(loaded.base_versions.len(), 2);
        let text = "{hullId:'new', # keep\n hullName:'Edited', extra:{'_key':1}}\n";
        let saved = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveTextFile(crate::models::TextSave {
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: loaded.path,
                text: text.to_string(),
                base_versions: loaded.base_versions,
            }),
        )
        .unwrap();
        assert_eq!(saved.content.unwrap().value["text"], text);
        assert_eq!(
            std::fs::read_to_string(root.join("data/hulls/nested/new.ship")).unwrap(),
            text
        );
        assert!(!old.exists());
        assert_eq!(
            crate::io::read_csv_data(&root.join("data/hulls/ship_data.csv"))
                .unwrap()
                .rows[0]
                .data["id"],
            "new"
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn core_projectile_saves_to_mod_override_and_keeps_core_source() {
        let game = temp_dir("identity_core_projectile");
        let root = game.join("mods/demo");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::create_dir_all(game.join("starsector-core/data/weapons/proj/nested")).unwrap();
        let core = game.join("starsector-core/data/weapons/proj/nested/filename.proj");
        std::fs::write(&core, r#"{"id":"core","width":4}"#).unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest =
            project::open_project_session_traced(&root, Some(&game), &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Projectile,
            "core",
        )
        .unwrap();
        assert_eq!(
            info.target.source.as_ref().unwrap().source,
            crate::models::ResourceSource::Core
        );
        assert_eq!(
            info.target.source.as_ref().unwrap().rel_path,
            "data/weapons/proj/nested/filename.proj"
        );
        assert_eq!(info.target.write.rel_path, "data/weapons/proj/core.proj");
        assert_eq!(info.base_versions[0].fingerprint, None);
        let saved = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"id":"core","width":8}),
                json_write: Default::default(),
                ordered_json: None,
            }),
        )
        .unwrap();
        assert_eq!(crate::io::read_json_file(&core).unwrap()["width"], 4);
        assert_eq!(
            crate::io::read_json_file(&root.join("data/weapons/proj/core.proj")).unwrap()["width"],
            8
        );
        let next = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Projectile,
            "core",
        )
        .unwrap();
        assert_eq!(saved.base_versions, next.base_versions);
        assert_eq!(
            next.target.state,
            crate::models::EntityTargetState::Existing
        );
        let undone = crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack[0].id,
            saved.history.revision,
        )
        .unwrap();
        let restored = crate::services::project::query::entities::query_entity(
            &manifest.session_id,
            EntityKind::Projectile,
            "core",
        )
        .unwrap()
        .unwrap();
        assert_eq!(restored.data["width"], 4);
        assert_eq!(
            restored.target.source.unwrap().source,
            crate::models::ResourceSource::Core
        );
        assert_eq!(
            restored.target.state,
            crate::models::EntityTargetState::Create
        );
        crate::services::write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Redo,
            undone.history.redo_stack[0].id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(
            crate::services::project::query::entities::query_entity(
                &manifest.session_id,
                EntityKind::Projectile,
                "core"
            )
            .unwrap()
            .unwrap()
            .data["width"],
            8
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(game).unwrap();
    }

    #[test]
    fn linked_csv_version_conflict_keeps_loaded_spec_and_history() {
        let root = temp_dir("identity_csv_conflict");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let file = root.join("data/hulls/demo.ship");
        std::fs::write(&file, r#"{"hullId":"demo"}"#).unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "demo",
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name\ndemo,External\n",
        )
        .unwrap();
        let failed = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: info.target,
                base_versions: info.base_versions,
                data: json!({"hullId":"next"}),
                json_write: Default::default(),
                ordered_json: None,
            }),
        )
        .unwrap_err();
        assert_eq!(failed.code(), "write.version_conflict");
        assert_eq!(crate::io::read_json_file(&file).unwrap()["hullId"], "demo");
        assert!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn spec_save_requires_the_complete_loaded_version_scope() {
        let root = temp_dir("identity_required_scope");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/demo.ship");
        std::fs::write(&path, r#"{"hullId":"demo"}"#).unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "demo",
        )
        .unwrap();
        for versions in [
            vec![],
            vec![info.base_versions[0].clone()],
            vec![info.base_versions[1].clone()],
        ] {
            let error = crate::services::write_transactions::commit_action(
                crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    target: info.target.clone(),
                    base_versions: versions,
                    data: json!({"hullId":"next"}),
                    json_write: Default::default(),
                    ordered_json: None,
                }),
            )
            .unwrap_err();
            assert_eq!(error.code(), "write.version_scope_missing");
            assert_eq!(crate::io::read_json_file(&path).unwrap()["hullId"], "demo");
        }
        assert!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .is_empty()
        );
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn text_identity_normalization_changes_only_the_root_id_value() {
        let root = temp_dir("text_identity_normalized");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/demo.ship");
        std::fs::write(&path, "{hullId:'demo'}").unwrap();
        std::fs::write(root.join("data/hulls/ship_data.csv"), "id,name\ndemo,Old\n").unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Ship,
            "demo",
        )
        .unwrap();
        let text = "{hullId:' next ', # keep\n extra:{hullId:' untouched '}}\n";
        let saved = crate::services::write_transactions::commit_action(
            crate::models::SaveAction::SaveTextFile(crate::models::TextSave {
                session_id: Some(manifest.session_id.clone()),
                mod_root: manifest.mod_root.clone(),
                path: path.to_string_lossy().to_string(),
                text: text.to_string(),
                base_versions: info.base_versions,
            }),
        )
        .unwrap();
        let expected = "{hullId:\"next\", # keep\n extra:{hullId:' untouched '}}\n";
        assert_eq!(saved.content.unwrap().value["text"], expected);
        assert_eq!(
            std::fs::read_to_string(root.join("data/hulls/next.ship")).unwrap(),
            expected
        );
        assert_eq!(saved.identity_changes[0].after.id, "next");
        project::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
