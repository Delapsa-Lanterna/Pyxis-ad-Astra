use crate::domain::entity_identity::validate_entity_id;
use crate::domain::{save_edits, schema};
use crate::errors::{AppError, AppResult};
use crate::io::{
    FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock, read_csv_data,
};
use crate::models::{
    CsvRow, CsvTable, EntityData, EntityEditTarget, EntityFileLocation, EntityIdentityChange,
    EntityKind, EntityLinkedRecord, EntityTargetState, FileSnapshot, IndexedConfigDelete,
    IndexedConfigEntityRefresh, IndexedConfigKind, IndexedConfigSave, JsonDocumentOrigin,
    JsonWriteOptions, ModInfoSave, ResourceSource, SaveEdit, WriteContentTarget, WriteResult,
};
use crate::parsers::render_csv_text;
use crate::services::{config_entity, project};
use crate::{io, models, parsers, services};
use serde_json::{Map, Value};
use std::path::Path;

pub fn save_mod_info(
    mod_root: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    schema::validate_document(parsers::bundled_schema("mod-info"), &data)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(mod_root))?;
    let mut json = JsonWriteBatch::new(options);
    let target = builder.root().join("mod_info.json");
    let text = json.render(&target, &data, ordered_json)?;
    json.finish()?;
    if target.exists() && io::read_utf8_no_bom(&target)? == text {
        return Ok(WriteResult::from_content(
            Vec::new(),
            WriteContentTarget::Json {
                origin: JsonDocumentOrigin::ModInfo,
            },
            data,
        ));
    }
    builder.text_file("mod_info.json", Some(text))?;
    builder.apply().map(|changes| {
        WriteResult::from_content(
            changes,
            WriteContentTarget::Json {
                origin: JsonDocumentOrigin::ModInfo,
            },
            data,
        )
    })
}

const MISSION_INDEX: &str = "data/missions/mission_list.csv";
fn mission_row_id(row: &CsvRow) -> Option<&str> {
    if row.is_comment {
        return None;
    }
    row.data
        .get("mission")
        .and_then(Value::as_str)
        .map(str::trim)
}

pub struct MissionSaveInput<'a> {
    pub index: Option<CsvTable>,
    pub index_row: Map<String, Value>,
    pub entity_data: Value,
    pub json_write: JsonWriteOptions,
    pub ordered_json: Option<&'a str>,
}

pub fn save_mission_with_json(
    root: &str,
    previous_id: Option<&str>,
    next_id: &str,
    input: MissionSaveInput<'_>,
) -> AppResult<WriteResult<Value>> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    let boundary = FsRootBoundary::new(Path::new(root), "mission root")?;
    let next_id = validate_entity_id(next_id, "无效战役 ID")?;
    if let Some(previous) = previous_id {
        validate_entity_id(previous, "无效战役 ID")?;
    }
    let mut index = match input.index {
        Some(index) => index,
        None => read_csv_data(&boundary.resolve_relative(MISSION_INDEX, "mission index")?)?,
    };
    if index.header.is_empty() {
        index.header.push("mission".to_string());
    }
    let previous_position = previous_id.and_then(|id| {
        index
            .rows
            .iter()
            .position(|row| mission_row_id(row) == Some(id))
    });
    if let Some(previous_id) = previous_id
        && previous_position.is_none()
    {
        return Err(AppError::message(
            "config.index_missing",
            format!("战役索引不存在: {}", previous_id),
        ));
    }
    if index
        .rows
        .iter()
        .any(|row| mission_row_id(row) == Some(next_id))
        && previous_id != Some(next_id)
    {
        return Err(AppError::message(
            "config.entity_exists",
            format!("战役已存在: {next_id}"),
        ));
    }
    let source_id = previous_id.unwrap_or(next_id);
    let before_rel = format!("data/missions/{source_id}");
    let after_rel = format!("data/missions/{next_id}");
    let source = boundary.resolve_relative(&before_rel, "mission source")?;
    let target = boundary.resolve_relative_target(&after_rel, "mission target")?;
    if target.exists()
        && previous_id != Some(next_id)
        && (previous_id.is_none() || !io::same_physical_path(&source, &target))
    {
        return Err(AppError::message(
            "config.target_exists",
            format!("战役目标已存在: {after_rel}"),
        ));
    }
    let mut row = previous_position
        .map(|position| index.rows[position].data.clone())
        .unwrap_or_default();
    row.extend(input.index_row);
    row.insert("mission".to_string(), Value::String(next_id.to_string()));
    for key in row.keys() {
        if !index.header.contains(key) {
            index.header.push(key.clone());
        }
    }
    let next_position = previous_position.unwrap_or(index.rows.len());
    if let Some(position) = previous_position {
        index.rows[position].data = row;
    } else {
        index.rows.push(CsvRow {
            data: row,
            is_comment: false,
        });
    }
    let descriptor = input.entity_data.get("descriptor").ok_or_else(|| {
        AppError::message(
            "config.missing_mission_descriptor",
            "missing mission descriptor data",
        )
    })?;
    let text = input
        .entity_data
        .get("text")
        .and_then(Value::as_str)
        .ok_or_else(|| {
            AppError::message("config.missing_mission_text", "missing mission text data")
        })?;
    let mut json = JsonWriteBatch::new(input.json_write);
    let rendered = json.render(
        &source.join("descriptor.json"),
        descriptor,
        input.ordered_json,
    )?;
    json.finish()?;
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        MISSION_INDEX,
        Some(render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?),
    )?;
    let rename = previous_id.is_some() && source_id != next_id;
    if rename {
        let mut files = builder.directory_files(&before_rel)?;
        for (relative, content) in [
            ("descriptor.json", rendered),
            ("mission_text.txt", text.to_string()),
        ] {
            files.retain(|file| file.rel_path != relative);
            files.push(FileSnapshot {
                rel_path: relative.to_string(),
                text: Some(content),
                data_base64: None,
            });
        }
        files.sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
        builder.rename_directory(&before_rel, &after_rel, files)?;
    } else {
        builder.text_file(format!("{after_rel}/descriptor.json"), Some(rendered))?;
        builder.text_file(
            format!("{after_rel}/mission_text.txt"),
            Some(text.to_string()),
        )?;
    }
    let changes = builder.apply()?;
    let root = boundary.root().to_string_lossy().to_string();
    let location = |rel: &str| EntityFileLocation {
        reference: None,
        source: ResourceSource::Mod,
        root: root.clone(),
        rel_path: rel.to_string(),
        path: boundary.root().join(rel).to_string_lossy().to_string(),
    };
    let before_location = location(&before_rel);
    let after_location = location(&after_rel);
    let before = EntityEditTarget {
        kind: EntityKind::Mission,
        id: source_id.to_string(),
        source: previous_id.map(|_| before_location.clone()),
        write: before_location,
        state: if previous_id.is_some() {
            EntityTargetState::Existing
        } else {
            EntityTargetState::Create
        },
        linked_record: previous_position.map(|row_index| EntityLinkedRecord::Index {
            path: MISSION_INDEX.to_string(),
            row_index,
        }),
    };
    let after = EntityEditTarget {
        kind: EntityKind::Mission,
        id: next_id.to_string(),
        source: Some(after_location.clone()),
        write: after_location,
        state: EntityTargetState::Existing,
        linked_record: Some(EntityLinkedRecord::Index {
            path: MISSION_INDEX.to_string(),
            row_index: next_position,
        }),
    };
    let mut result = WriteResult::from_content(
        changes,
        WriteContentTarget::Json {
            origin: (&after).into(),
        },
        serde_json::to_value(IndexedConfigEntityRefresh {
            entity_id: next_id.to_string(),
            index_path: MISSION_INDEX.to_string(),
            index_header: index.header,
            index_rows: index.rows,
            entity_data: input.entity_data,
        })?,
    );
    result
        .identity_changes
        .push(EntityIdentityChange { before, after });
    Ok(result)
}

pub fn create_mission_entity(
    root: &str,
    next_id: &str,
    index_row: Map<String, Value>,
    entity_data: Value,
) -> AppResult<WriteResult<Value>> {
    save_mission_with_json(
        root,
        None,
        next_id,
        MissionSaveInput {
            index: None,
            index_row,
            entity_data,
            json_write: Default::default(),
            ordered_json: None,
        },
    )
}

pub fn delete_mission_entity(
    root: &str,
    id: &str,
    delete_target: bool,
) -> AppResult<WriteResult<Value>> {
    let lease = acquire_root_write_lock(Path::new(root))?;
    validate_entity_id(id, "无效战役 ID")?;
    let boundary = FsRootBoundary::new(Path::new(root), "mission root")?;
    let mut index = read_csv_data(&boundary.resolve_relative(MISSION_INDEX, "mission index")?)?;
    let position = index
        .rows
        .iter()
        .position(|row| mission_row_id(row) == Some(id))
        .ok_or_else(|| {
            AppError::message("config.index_missing", format!("战役索引不存在: {id}"))
        })?;
    index.rows.remove(position);
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        MISSION_INDEX,
        Some(render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?),
    )?;
    if delete_target {
        builder.delete_directory(format!("data/missions/{id}"))?;
    }
    Ok(WriteResult::new(builder.apply()?, Vec::new(), None))
}

pub fn prepare_mod_save(input: &mut ModInfoSave, edits: &[SaveEdit]) -> AppResult<()> {
    let path = Path::new(&input.mod_root).join("mod_info.json");
    if io::source_recreation_allowed(&input.mod_root, &path.to_string_lossy()) {
        return Ok(());
    }
    let current = project::current_projection(&input.session_id)?.manifest;
    input.data = current.mod_info.unwrap_or_default();
    input.base_versions = current.base_versions;
    save_edits::apply_save_edits(&mut input.data, edits);
    input.ordered_json = Some(serde_json::to_string(&input.data)?);
    Ok(())
}

pub(crate) fn prepare_indexed_request(
    payload: &mut IndexedConfigSave,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> Result<(), AppError> {
    if payload
        .base_versions
        .iter()
        .any(|version| io::source_recreation_allowed(&payload.mod_root, &version.path))
    {
        return Ok(());
    }
    let current = config_entity::prepare_json_entity_save(
        &payload.session_id,
        payload.kind.into(),
        payload.previous_id.as_ref().unwrap_or(&payload.next_id),
        edits,
        identities,
    )?;
    payload.previous_id = Some(current.id);
    payload.base_versions = current.base_versions;
    payload.entity_data = current.data;
    if payload.kind == IndexedConfigKind::Faction {
        payload.next_id = models::file_content_id(
            &payload.entity_data["file"],
            "id",
            Path::new(&current.target.write.path),
        );
        payload.ordered_json = Some(serde_json::to_string(&payload.entity_data["file"])?);
    } else {
        payload.ordered_json = Some(serde_json::to_string(&payload.entity_data["descriptor"])?);
    }
    Ok(())
}

pub fn write_indexed_request(payload: IndexedConfigSave) -> Result<WriteResult<Value>, AppError> {
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        payload.previous_id.as_deref().unwrap_or(&payload.next_id),
        &payload.base_versions,
    )?;
    if payload.kind == IndexedConfigKind::Faction {
        let result = services::save_faction_entity(
            &payload.session_id,
            payload.previous_id.as_deref(),
            &payload.next_id,
            payload.entity_data,
            payload.json_write,
            payload.ordered_json.as_deref(),
        )?;
        return Ok(result);
    }
    let result = config_entity::save_mission_with_json(
        &payload.mod_root,
        payload.previous_id.as_deref(),
        &payload.next_id,
        MissionSaveInput {
            index: Some(services::read_project_csv(
                &payload.session_id,
                MISSION_INDEX,
            )?),
            index_row: payload.index_row,
            entity_data: payload.entity_data,
            json_write: payload.json_write,
            ordered_json: payload.ordered_json.as_deref(),
        },
    )?;
    Ok(result)
}

pub fn create_indexed_request(payload: IndexedConfigSave) -> Result<WriteResult<Value>, AppError> {
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        &payload.next_id,
        &payload.base_versions,
    )?;
    if payload.kind == IndexedConfigKind::Faction {
        let result = services::save_faction_entity(
            &payload.session_id,
            None,
            &payload.next_id,
            payload.entity_data,
            Default::default(),
            None,
        )?;
        return Ok(result);
    }
    let result = config_entity::create_mission_entity(
        &payload.mod_root,
        &payload.next_id,
        payload.index_row,
        payload.entity_data,
    )?;
    Ok(result)
}

pub fn delete_indexed_request(
    payload: IndexedConfigDelete,
) -> Result<WriteResult<Value>, AppError> {
    services::require_entity_version_scope(
        &payload.session_id,
        payload.kind.into(),
        &payload.id,
        &payload.base_versions,
    )?;
    if payload.kind == IndexedConfigKind::Faction {
        let result = services::delete_faction_entity(
            &payload.session_id,
            &payload.id,
            payload.delete_target,
        )?;
        return Ok(result);
    }
    let result = config_entity::delete_mission_entity(
        &payload.mod_root,
        &payload.id,
        payload.delete_target,
    )?;
    Ok(result)
}

pub fn prepare_json_entity_save(
    session_id: &str,
    kind: EntityKind,
    source_id: &str,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> Result<EntityData, AppError> {
    let mut id = source_id.to_string();
    for identity in identities {
        if identity.before.kind == kind && identity.before.id == id {
            id = identity.after.id.clone();
        }
    }
    let mut current = services::query_entity(session_id, kind, &id)?
        .ok_or_else(|| AppError::message("write.target_removed", "保存目标已删除"))?;
    if kind == EntityKind::Faction {
        current.data = serde_json::json!({"file": current.data});
    }
    save_edits::apply_save_edits(&mut current.data, edits);
    Ok(current)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::io;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::models::{
        FileChangeReplayDirection, IndexedConfigDelete, IndexedConfigKind, IndexedConfigSave,
        ProjectManifest, SaveAction,
    };
    use crate::services;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::write_transactions;
    use crate::services::{project, project_save};
    use std::fs;

    struct IndexedSaveInput<'a> {
        index_row: Map<String, Value>,
        entity_data: Value,
        json_write: JsonWriteOptions,
        ordered_json: Option<&'a str>,
    }

    fn with_session<T>(
        root: &str,
        action: impl FnOnce(&ProjectManifest) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(Path::new(root), None, &mut trace)?;
        let result = action(&manifest);
        project::close_project_session(manifest.session_id)?;
        result
    }

    fn save_indexed_config_with_json(
        root: &str,
        kind: IndexedConfigKind,
        previous: Option<&str>,
        next: &str,
        input: IndexedSaveInput<'_>,
    ) -> AppResult<WriteResult<Value>> {
        with_session(root, |manifest| {
            let entity_kind = if kind == IndexedConfigKind::Faction {
                EntityKind::Faction
            } else {
                EntityKind::Mission
            };
            let info = services::query_entity_edit_target(
                &manifest.session_id,
                entity_kind,
                previous.unwrap_or(next),
            )?;
            project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
                IndexedConfigSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    kind,
                    previous_id: previous.map(str::to_string),
                    next_id: next.to_string(),
                    index_row: input.index_row,
                    entity_data: input.entity_data,
                    json_write: input.json_write,
                    ordered_json: input.ordered_json.map(str::to_string),
                },
            ))
        })
    }

    fn save_indexed_config_entity(
        root: &str,
        kind: IndexedConfigKind,
        previous: Option<&str>,
        next: &str,
        index_row: Map<String, Value>,
        entity_data: Value,
        _delete_previous_target: bool,
    ) -> AppResult<WriteResult<Value>> {
        save_indexed_config_with_json(
            root,
            kind,
            previous,
            next,
            IndexedSaveInput {
                index_row,
                entity_data,
                json_write: Default::default(),
                ordered_json: None,
            },
        )
    }

    fn delete_indexed_config_entity(
        root: &str,
        kind: IndexedConfigKind,
        id: &str,
        delete_target: bool,
    ) -> AppResult<WriteResult<Value>> {
        with_session(root, |manifest| {
            let entity_kind = if kind == IndexedConfigKind::Faction {
                EntityKind::Faction
            } else {
                EntityKind::Mission
            };
            let info = services::query_entity_edit_target(&manifest.session_id, entity_kind, id)?;
            project_save::execute_save_action(SaveAction::DeleteIndexedConfigEntity(
                IndexedConfigDelete {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    kind,
                    id: id.to_string(),
                    delete_target,
                },
            ))
        })
    }

    #[test]
    fn mission_index_ownership_skips_comments_during_read_save_delete_and_replay() {
        let root = project_workspace("mission_comment_identity");
        let index = root.join(MISSION_INDEX);
        fs::create_dir_all(root.join("data/missions/old")).unwrap();
        write_utf8_no_bom(
            &index,
            "a,mission,note\n# old note,old,kept\n# next note,next,kept too\nactive,old,business\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/old/descriptor.json"),
            "{title:'Old'}",
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/old/mission_text.txt"), "Old").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, "old")
                .unwrap();
        assert!(matches!(
            info.target.linked_record,
            Some(EntityLinkedRecord::Index { row_index: 2, .. })
        ));
        let saved = project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
            IndexedConfigSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: info.base_versions,
                kind: IndexedConfigKind::Mission,
                previous_id: Some("old".into()),
                next_id: "next".into(),
                index_row: Map::new(),
                entity_data: serde_json::json!({"descriptor":{"title":"Next"},"text":"Next"}),
                json_write: Default::default(),
                ordered_json: None,
            },
        ))
        .unwrap();
        let rows = read_csv_data(&index).unwrap().rows;
        assert_eq!(rows[0].data["mission"], "old");
        assert_eq!(rows[1].data["mission"], "next");
        assert_eq!(rows[2].data["mission"], "next");
        assert_eq!(rows[2].data["note"], "business");
        let next =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, "next")
                .unwrap();
        let deleted = project_save::execute_save_action(SaveAction::DeleteIndexedConfigEntity(
            IndexedConfigDelete {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: next.base_versions,
                kind: IndexedConfigKind::Mission,
                id: "next".into(),
                delete_target: true,
            },
        ))
        .unwrap();
        let rows = read_csv_data(&index).unwrap().rows;
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].data["a"], "# old note");
        assert_eq!(rows[1].data["a"], "# next note");
        let undone = write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            deleted.history.undo_stack.last().unwrap().id,
            deleted.history.revision,
        )
        .unwrap();
        assert_eq!(
            read_csv_data(&index).unwrap().rows[2].data["mission"],
            "next"
        );
        write_transactions::replay(
            &manifest.session_id,
            &manifest.mod_root,
            FileChangeReplayDirection::Undo,
            saved.history.undo_stack.last().unwrap().id,
            undone.history.revision,
        )
        .unwrap();
        assert_eq!(
            read_csv_data(&index).unwrap().rows[2].data["mission"],
            "old"
        );
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn faction_save_preserves_spec_comments_and_order() {
        let root = project_workspace("indexed_faction_preserves_json");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            "{\n  # note\n  displayName: 'Old',\n  id: 'demo'\n}\n",
        )
        .unwrap();
        let result = save_indexed_config_with_json(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            IndexedSaveInput {
                index_row: Map::new(),
                entity_data: serde_json::json!({"file":{"displayName":"New","id":"demo"}}),
                json_write: JsonWriteOptions {
                    keep_filename: false,
                    preserve_original_json: true,
                    confirmed_sources: Vec::new(),
                },
                ordered_json: Some(r#"{"displayName":"New","id":"demo"}"#),
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join("demo.faction")).unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(text.contains("# note"));
        assert!(text.find("displayName").unwrap() < text.find("id:").unwrap());
        root.close().unwrap();
    }

    #[test]
    fn faction_save_can_rename_file_and_index_with_undo_redo() {
        let root = project_workspace("indexed_faction_rename");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/old.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("old.faction"), r#"{"id":"old"}"#).unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new", "displayName": "New"}}),
            true,
        )
        .unwrap();

        assert!(!dir.join("old.faction").exists());
        assert!(dir.join("new.faction").exists());
        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/new.faction\n"
        );

        let replay = io::acquire_root_write_lock(&root).unwrap();
        replay
            .apply_changes(&result.changes, FileChangeReplayDirection::Undo)
            .unwrap();
        assert!(dir.join("old.faction").exists());
        assert!(!dir.join("new.faction").exists());

        replay
            .apply_changes(&result.changes, FileChangeReplayDirection::Redo)
            .unwrap();
        let new_text = read_utf8_no_bom(&dir.join("new.faction")).unwrap();
        assert!(new_text.contains("\"id\": \"new\""));
        root.close().unwrap();
    }

    #[test]
    fn faction_save_keeps_single_column_game_format_on_same_id_save() {
        let root = project_workspace("indexed_faction_same_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\ndata/world/factions/demo.faction\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            r#"{"id":"demo","displayName":"Demo"}"#,
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/demo.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("demo"),
            "demo",
            index_row,
            serde_json::json!({"file": {"id": "demo", "displayName": "Demo"}}),
            false,
        )
        .unwrap();

        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/demo.faction\n"
        );
        assert_eq!(result.changes.len(), 2);
        root.close().unwrap();
    }

    #[test]
    fn indexed_entity_rejects_duplicate_id() {
        let root = project_workspace("indexed_duplicate_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\r\ndata/world/factions/new.faction\r\n",
        )
        .unwrap();

        let mut index_row = Map::new();
        index_row.insert(
            "faction".to_string(),
            Value::String("data/world/factions/new.faction".to_string()),
        );
        let result = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("old"),
            "new",
            index_row,
            serde_json::json!({"file": {"id": "new"}}),
            false,
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn indexed_entity_save_requires_previous_index_row() {
        let root = project_workspace("indexed_missing_previous");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/factions.csv"),
            "id,file\r\n",
        )
        .unwrap();

        let error = save_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Faction,
            Some("missing"),
            "next",
            {
                let mut row = Map::new();
                row.insert("id".to_string(), Value::String("next".to_string()));
                row
            },
            serde_json::json!({"file": {"id": "next"}}),
            false,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("势力索引不存在: missing"));
        root.close().unwrap();
    }

    #[test]
    fn indexed_entity_delete_requires_index_row() {
        let root = project_workspace("indexed_delete_missing");
        fs::create_dir_all(root.join("data/missions")).unwrap();
        write_utf8_no_bom(&root.join("data/missions/mission_list.csv"), "mission\r\n").unwrap();

        let error = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "missing",
            false,
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("战役索引不存在: missing"));
        root.close().unwrap();
    }

    #[test]
    fn mission_delete_expands_directory_invalidation_paths() {
        let root = project_workspace("mission_delete_expands_invalidation_paths");
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/mission_list.csv"),
            "mission\r\ndemo\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/missions/demo/descriptor.json"),
            r#"{"title":"Demo"}"#,
        )
        .unwrap();
        write_utf8_no_bom(&root.join("data/missions/demo/mission_text.txt"), "Demo").unwrap();

        let result = delete_indexed_config_entity(
            &root.to_string_lossy(),
            IndexedConfigKind::Mission,
            "demo",
            true,
        )
        .unwrap();

        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/descriptor.json")
        }));
        assert!(result.invalidation.paths.iter().any(|path| {
            path.replace('\\', "/")
                .ends_with("data/missions/demo/mission_text.txt")
        }));
        root.close().unwrap();
    }

    #[test]
    fn mod_info_save_keeps_source_when_semantics_are_unchanged() {
        let root = project_workspace("save_mod_info_preserve");
        let path = root.join("mod_info.json");
        write_utf8_no_bom(&path, "{\n  # note\n  id: 'demo'\n}\n").unwrap();
        let result = save_mod_info(
            &root.to_string_lossy(),
            serde_json::json!({"id":"demo"}),
            JsonWriteOptions {
                keep_filename: false,
                preserve_original_json: true,
                confirmed_sources: Vec::new(),
            },
            Some(r#"{"id":"demo"}"#),
        )
        .unwrap();
        assert!(result.changes.is_empty());
        assert_eq!(
            result.content.map(|content| content.value),
            Some(serde_json::json!({"id":"demo"}))
        );
        assert_eq!(
            read_utf8_no_bom(&path).unwrap(),
            "{\n  # note\n  id: 'demo'\n}\n"
        );
        root.close().unwrap();
    }

    #[test]
    fn mod_info_receipt_matches_persisted_content() {
        let root = project_workspace("mod_info_receipt");
        let data = serde_json::json!({"id":"demo", "name":"Saved", "dependencies":[{"id":"dep"}]});
        let result = save_mod_info(
            &root.to_string_lossy(),
            data,
            JsonWriteOptions::default(),
            None,
        )
        .unwrap();
        assert_eq!(
            result.content.map(|content| content.value),
            Some(io::read_json_file(&root.join("mod_info.json")).unwrap())
        );
        root.close().unwrap();
    }
}
