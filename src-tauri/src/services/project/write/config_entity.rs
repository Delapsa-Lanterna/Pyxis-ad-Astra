use crate::domain::{entity_identity, save_edits, schema};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::JsonDocumentOrigin;
use crate::models::JsonSourceIdentity;
use crate::models::file_content::{JsonFileContent, JsonSource, SaveLayout};
use crate::models::{
    EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState, FileSnapshot,
    IndexedConfigContent, IndexedConfigDelete, IndexedConfigEntityRefresh, IndexedConfigKind,
    IndexedConfigSave, ModInfoSave, SaveEdit, WriteContentTarget, WriteResult,
};
use crate::parsers;
use crate::services::project::model::SessionCsvRow;
use crate::services::project::query::entity_targets;
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_session, session_handle,
};
use crate::services::project::sources::project_csv;
use crate::services::project::write::entity_write::replace_paths;
use crate::services::project::write::faction_identity;
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;

pub fn prepare_mod_save(input: &mut ModInfoSave, edits: &[SaveEdit]) -> AppResult<()> {
    if edits.is_empty() {
        return Ok(());
    }
    let path = Path::new(&input.mod_root).join("mod_info.json");
    if path.is_file() {
        let (version, source) = io::read_versioned_json(&path)?;
        input.document =
            save_edits::prepare_json_write(Arc::new(source), edits, input.document.layout)?;
        input.base_versions = vec![version];
    }
    Ok(())
}
pub fn prepare_indexed_request(
    input: &mut IndexedConfigSave,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    let kind = input.content.kind();
    for identity in identities {
        if identity.before.kind == kind.into()
            && input.previous_id.as_deref() == Some(&identity.before.id)
        {
            if input.next_id == identity.before.id {
                input.next_id.clone_from(&identity.after.id);
            }
            input.previous_id = Some(identity.after.id.clone());
        }
    }
    let snapshot = entity_targets::query_entity_edit_target(
        &input.session_id,
        kind.into(),
        input.previous_id.as_deref().unwrap_or(&input.next_id),
    )?;
    let path = if kind == IndexedConfigKind::Mission {
        Path::new(&snapshot.target.write.path).join("descriptor.json")
    } else {
        Path::new(&snapshot.target.write.path).to_path_buf()
    };
    if !edits.is_empty() && path.is_file() {
        let source = Arc::new(io::read_json_file(&path)?);
        let next = save_edits::prepare_json_write(source, edits, input.content.document().layout)?;
        match &mut input.content {
            IndexedConfigContent::Faction { document }
            | IndexedConfigContent::Mission { document, .. } => *document = next,
        }
    }
    input.base_versions = snapshot.base_versions;
    Ok(())
}
pub fn save_mod_info(input: &ModInfoSave) -> AppResult<WriteResult<Value>> {
    let path = Path::new(&input.mod_root).join("mod_info.json");
    let data = input.document.content.to_json()?;
    schema::validate_document(parsers::bundled_schema("mod-info"), &data)?;
    let source = path
        .is_file()
        .then(|| io::read_json_file(&path))
        .transpose()?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    let actual = io::stage_json_document(
        &mut builder,
        "mod_info.json",
        source.as_ref(),
        &input.document,
    )?;
    Ok(WriteResult::from_content(
        builder.apply()?,
        WriteContentTarget::Json {
            origin: JsonDocumentOrigin::ModInfo,
        },
        serde_json::to_value(JsonFileContent::from(&actual))?,
    ))
}
pub fn write_indexed_request(input: IndexedConfigSave) -> AppResult<WriteResult<Value>> {
    let kind = input.content.kind();
    entity_targets::require_entity_version_scope(
        &input.session_id,
        kind.into(),
        input.previous_id.as_deref().unwrap_or(&input.next_id),
        &input.base_versions,
    )?;
    match kind {
        IndexedConfigKind::Faction => faction_identity::save_faction_entity(input),
        IndexedConfigKind::Mission => save_mission(input),
    }
}
pub fn create_indexed_request(input: IndexedConfigSave) -> AppResult<WriteResult<Value>> {
    let target = entity_targets::query_entity_edit_target(
        &input.session_id,
        input.content.kind().into(),
        &input.next_id,
    )?
    .target;
    if target.state == EntityTargetState::Existing {
        return Err(AppError::EntityTargetExists {
            target: Box::new(target),
        });
    }
    write_indexed_request(input)
}
fn save_mission(input: IndexedConfigSave) -> AppResult<WriteResult<Value>> {
    let IndexedConfigContent::Mission { document, text } = input.content else {
        unreachable!("mission save content")
    };
    let next = entity_identity::validate_entity_id(&input.next_id, "无效战役 ID")?;
    let before = entity_targets::query_entity_edit_target(
        &input.session_id,
        EntityKind::Mission,
        input.previous_id.as_deref().unwrap_or(next),
    )?
    .target;
    let handle = session_handle(&input.session_id)?;
    let mut session = lock_session(&handle)?;
    csv_tables::ensure_session_table_rows(&mut session, "missions")?;
    let mut index = CsvTableDraft::read_named(&session, "missions")?;
    drop(session);
    let previous = input.previous_id.as_deref().unwrap_or(next);
    let position = index.rows.iter().position(|row| {
        !row.is_comment && row.data.get("mission").and_then(Value::as_str) == Some(previous)
    });
    if input.previous_id.is_some() && before.source.is_none() && position.is_none() {
        return Err(AppError::message(
            "config.index_row_missing",
            format!("战役索引不存在: {previous}"),
        ));
    }
    if index.rows.iter().enumerate().any(|(i, row)| {
        Some(i) != position
            && !row.is_comment
            && row.data.get("mission").and_then(Value::as_str) == Some(next)
    }) {
        return Err(AppError::message(
            "config.entity_exists",
            format!("战役已存在：{next}"),
        ));
    }
    let mut row = position
        .map(|index_position| index.rows[index_position].data.clone())
        .unwrap_or_default();
    row.extend(input.index_row);
    row.insert("mission".into(), Value::String(next.into()));
    for key in row.keys() {
        if !index.header.contains(key) {
            index.header.push(key.clone());
        }
    }
    let row_position = position.unwrap_or(index.rows.len());
    if let Some(position) = position {
        index.rows[position].data = row;
    } else {
        index.rows.push(SessionCsvRow {
            row_key: format!("missions:row:{}", index.next_row_seq),
            data: row,
            is_comment: false,
            source_row: None,
        });
        index.next_row_seq += 1;
    }
    let before_relative = before.write.rel_path.clone();
    let after_relative = format!("data/missions/{next}");
    let descriptor_path = Path::new(&input.mod_root)
        .join(&before_relative)
        .join("descriptor.json");
    let source = descriptor_path
        .is_file()
        .then(|| io::read_json_file(&descriptor_path))
        .transpose()?;
    let actual = match &source {
        Some(source) => source.write(&document)?,
        None => JsonSource::create(&document)?,
    };
    let csv = index.output(SaveLayout::PreserveStructure)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    builder.text_file(
        "data/missions/mission_list.csv",
        Some(csv.document.source.to_string()),
    )?;
    if before_relative != after_relative {
        let mut files = builder.directory_files(&before_relative)?;
        for (relative, content) in [
            ("descriptor.json", actual.text.to_string()),
            ("mission_text.txt", text.clone()),
        ] {
            files.retain(|file| file.rel_path != relative);
            files.push(FileSnapshot {
                rel_path: relative.into(),
                text: Some(content),
                data_base64: None,
            });
        }
        files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
        builder.rename_directory(&before_relative, &after_relative, files)?;
    } else {
        builder.text_file(
            format!("{after_relative}/descriptor.json"),
            Some(actual.text.to_string()),
        )?;
        builder.text_file(
            format!("{after_relative}/mission_text.txt"),
            Some(text.clone()),
        )?;
    }
    replace_paths::stage_replace_paths(&mut builder, &input.json_write)?;
    let mut after = before.clone();
    after.id = next.into();
    after.write = entity_targets::location(&input.mod_root, &after_relative);
    after.source = Some(after.write.clone());
    after.state = EntityTargetState::Existing;
    after.linked_record = Some(EntityLinkedRecord::Index {
        path: "data/missions/mission_list.csv".into(),
        row_index: row_position,
    });
    let value = serde_json::to_value(IndexedConfigEntityRefresh {
        entity_id: next.into(),
        index_path: "data/missions/mission_list.csv".into(),
        index_header: index.header.clone(),
        index_rows: project_csv(&csv, Path::new("data/missions/mission_list.csv")).rows,
        entity_data: json!({"descriptor":actual.content.to_json()?,"text":text}),
        document: Some(JsonFileContent::from(&actual)),
    })?;
    let mut result = WriteResult::from_content(
        builder.apply()?,
        WriteContentTarget::Json {
            origin: (&after).into(),
        },
        value,
    );
    {
        let mut session = lock_session(&handle)?;
        index.accept_named(&mut session, "missions", csv)?;
    }
    result
        .identity_changes
        .push(EntityIdentityChange { before, after });
    Ok(result)
}
pub fn delete_indexed_request(input: IndexedConfigDelete) -> AppResult<WriteResult<Value>> {
    entity_targets::require_entity_version_scope(
        &input.session_id,
        input.kind.into(),
        &input.id,
        &input.base_versions,
    )?;
    if input.kind == IndexedConfigKind::Faction {
        return faction_identity::delete_faction(&input);
    }
    let handle = session_handle(&input.session_id)?;
    let mut session = lock_session(&handle)?;
    csv_tables::ensure_session_table_rows(&mut session, "missions")?;
    let mut index = CsvTableDraft::read_named(&session, "missions")?;
    drop(session);
    let before = index.rows.len();
    index.rows.retain(|row| {
        row.is_comment || row.data.get("mission").and_then(Value::as_str) != Some(&input.id)
    });
    if before == index.rows.len() {
        return Err(AppError::message(
            "config.index_missing",
            format!("战役索引不存在: {}", input.id),
        ));
    }
    let actual = index.output(SaveLayout::PreserveStructure)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    builder.text_file(
        "data/missions/mission_list.csv",
        Some(actual.document.source.to_string()),
    )?;
    if input.delete_target {
        builder.delete_directory(format!("data/missions/{}", input.id))?;
    }
    let result = WriteResult::from_changes(builder.apply()?).with_content(
        WriteContentTarget::Json {
            origin: JsonDocumentOrigin::Entity {
                target: JsonSourceIdentity {
                    kind: EntityKind::Mission,
                    id: input.id,
                    rel_path: None,
                },
            },
        },
        Value::Null,
    );
    {
        let mut session = lock_session(&handle)?;
        index.accept_named(&mut session, "missions", actual)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    #[cfg(test)]
    use crate::io;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::models::IndexedConfigContent;
    use crate::models::ModInfoSave;
    use crate::models::file_content::SaveLayout;
    use crate::models::{
        FileChangeReplayDirection, IndexedConfigDelete, IndexedConfigKind, IndexedConfigSave,
        ProjectManifest, SaveAction,
    };
    use crate::services;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project::write::config_entity;
    use crate::services::project_sync::release_project_session;
    #[cfg(test)]
    use crate::services::write_transactions;
    use crate::services::{project, project_save};
    use crate::test_support::file_formats;
    use std::fs;

    use crate::errors::AppResult;
    use crate::models::file_content::JsonFileContent;
    use crate::models::{EntityKind, EntityLinkedRecord, JsonWriteOptions, WriteResult};
    use crate::test_support::file_formats::read_csv_table as read_csv_data;
    use serde_json::{Map, Value};
    use std::path::Path;
    const MISSION_INDEX: &str = "data/missions/mission_list.csv";
    fn save_mod_info(
        root: &str,
        data: &Value,
        options: JsonWriteOptions,
    ) -> AppResult<WriteResult<Value>> {
        with_session(root, |manifest| {
            let source = Path::new(root).join("mod_info.json");
            let mut document = if source.exists() {
                file_formats::json_write_from_source(&io::read_json_file(&source)?, data)
            } else {
                file_formats::json_write(data)
            };
            document.layout = if options.preserve_structure {
                SaveLayout::PreserveStructure
            } else {
                SaveLayout::Expanded
            };
            let actual = config_entity::save_mod_info(&ModInfoSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: manifest.base_versions.clone(),
                document,
                json_write: options,
            })?;
            let target = actual.content.as_ref().unwrap().target.clone();
            let value = serde_json::from_value::<JsonFileContent>(
                actual.content.as_ref().unwrap().value.clone(),
            )?
            .content
            .to_json()?;
            Ok(actual.with_content(target, value))
        })
    }

    struct IndexedSaveInput {
        index_row: Map<String, Value>,
        entity_data: Value,
        json_write: JsonWriteOptions,
    }

    fn with_session<T>(
        root: &str,
        action: impl FnOnce(&ProjectManifest) -> AppResult<T>,
    ) -> AppResult<T> {
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(Path::new(root), None, &mut trace)?;
        let result = action(&manifest);
        release_project_session(&manifest.session_id)?;
        result
    }

    fn save_indexed_config_with_json(
        root: &str,
        kind: IndexedConfigKind,
        previous: Option<&str>,
        next: &str,
        input: IndexedSaveInput,
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
            let mut content = file_formats::indexed_content(kind, &input.entity_data);
            let path = if kind == IndexedConfigKind::Faction {
                Path::new(&info.target.write.path).to_path_buf()
            } else {
                Path::new(&info.target.write.path).join("descriptor.json")
            };
            let data = if kind == IndexedConfigKind::Faction {
                input.entity_data["file"].clone()
            } else {
                input.entity_data["descriptor"].clone()
            };
            let mut document = if path.is_file() {
                file_formats::json_write_from_source(&io::read_json_file(&path)?, &data)
            } else {
                file_formats::json_write(&data)
            };
            document.layout = if input.json_write.preserve_structure {
                SaveLayout::PreserveStructure
            } else {
                SaveLayout::Expanded
            };
            match &mut content {
                IndexedConfigContent::Faction { document: target }
                | IndexedConfigContent::Mission {
                    document: target, ..
                } => *target = document,
            }
            project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
                IndexedConfigSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    previous_id: previous.map(str::to_string),
                    next_id: next.to_string(),
                    index_row: input.index_row,
                    content,
                    json_write: input.json_write,
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
                previous_id: Some("old".into()),
                next_id: "next".into(),
                index_row: Map::new(),
                content: file_formats::indexed_content(
                    IndexedConfigKind::Mission,
                    &(serde_json::json!({"descriptor":{"title":"Next"},"text":"Next"})),
                ),
                json_write: Default::default(),
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
        release_project_session(&manifest.session_id).unwrap();
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
                entity_data: serde_json::json!({"file":{
                    "displayName":"New","id":"demo","displayNameWithArticle":"a Demo",
                    "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
                    "knownShips":{},"knownFighters":{},"knownWeapons":{},
                    "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                        "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}
                }}),
                json_write: JsonWriteOptions {
                    replace_paths: Vec::new(),
                    keep_filename: false,
                    preserve_structure: true,
                },
            },
        )
        .unwrap();
        let text = read_utf8_no_bom(&dir.join("demo.faction")).unwrap();
        assert_eq!(result.changes.len(), 1);
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
            serde_json::json!({"file": {
                "id":"new","displayName":"New","displayNameWithArticle":"a New",
                "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
                "knownShips":{},"knownFighters":{},"knownWeapons":{},
                "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                    "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}
            }}),
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
            serde_json::json!({"file": {
                "id":"demo","displayName":"Demo","displayNameWithArticle":"a Demo",
                "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
                "knownShips":{},"knownFighters":{},"knownWeapons":{},
                "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                    "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}
            }}),
            false,
        )
        .unwrap();

        assert_eq!(
            read_utf8_no_bom(&dir.join("factions.csv")).unwrap(),
            "faction\ndata/world/factions/demo.faction\n"
        );
        assert_eq!(result.changes.len(), 1);
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
        let before = "{\n  # note\n  id: 'demo', name: 'Demo', version: '1', gameVersion: '1'\n}\n";
        write_utf8_no_bom(&path, before).unwrap();
        let result = save_mod_info(
            &root.to_string_lossy(),
            &serde_json::json!({"id":"demo","name":"Demo","version":"1","gameVersion":"1"}),
            JsonWriteOptions {
                replace_paths: Vec::new(),
                keep_filename: false,
                preserve_structure: true,
            },
        )
        .unwrap();
        assert!(result.changes.is_empty());
        assert_eq!(
            result.content.map(|content| content.value),
            Some(serde_json::json!({"id":"demo","name":"Demo","version":"1","gameVersion":"1"}))
        );
        assert_eq!(read_utf8_no_bom(&path).unwrap(), before);
        root.close().unwrap();
    }

    #[test]
    fn mod_info_receipt_matches_persisted_content() {
        let root = project_workspace("mod_info_receipt");
        let data = serde_json::json!({"id":"demo", "name":"Saved", "version":"1", "gameVersion":"1", "dependencies":[{"id":"dep"}]});
        let result =
            save_mod_info(&root.to_string_lossy(), &data, JsonWriteOptions::default()).unwrap();
        assert_eq!(
            result.content.map(|content| content.value),
            Some(file_formats::read_json_value(&root.join("mod_info.json")).unwrap())
        );
        root.close().unwrap();
    }
}
