use super::entity_write::content;
use super::entity_write::faction_index;
use crate::domain::entity_identity;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::file_content::{JsonFileContent, JsonSource};
use crate::models::{
    EntityIdentityChange, EntityKind, EntityLinkedRecord, EntityTargetState, IndexedConfigContent,
    IndexedConfigDelete, IndexedConfigEntityRefresh, IndexedConfigSave, WriteContentTarget,
    WriteResult,
};
use crate::services::project::query::{entity_targets, json_layers};
use crate::services::project::session::{
    csv_tables, csv_writes::CsvTableDraft, lock_session, session_handle,
};
use crate::services::project::sources::project_csv;
use crate::services::project::write::entity_write::replace_paths;
use serde_json::{Value, json};
use std::path::Path;

pub fn save_faction_entity(input: IndexedConfigSave) -> AppResult<WriteResult<Value>> {
    let IndexedConfigContent::Faction { document } = input.content else {
        unreachable!("faction content")
    };
    let next = entity_identity::validate_entity_id(&input.next_id, "无效势力 ID")?;
    let before = entity_targets::query_entity_edit_target(
        &input.session_id,
        EntityKind::Faction,
        input.previous_id.as_deref().unwrap_or(next),
    )?
    .target;
    if input.previous_id.is_none() && before.state == EntityTargetState::Existing {
        return Err(AppError::EntityTargetExists {
            target: Box::new(before),
        });
    }
    if input.previous_id.is_some() && before.source.is_none() && before.linked_record.is_none() {
        return Err(AppError::message(
            "config.index_row_missing",
            format!("势力索引不存在: {}", before.id),
        ));
    }
    let intent = entity_targets::query_entity_identity_intent(&input.session_id, &before, next)?;
    let mut after = before.clone();
    after.id = next.into();
    after.state = EntityTargetState::Existing;
    after.write = if input.json_write.keep_filename && before.state == EntityTargetState::Existing {
        before.write.clone()
    } else {
        intent.next_write
    };
    let source = if Path::new(&before.write.path).is_file() {
        Some(io::read_json_file(Path::new(&before.write.path))?)
    } else {
        None
    };
    let actual = match source {
        Some(source) => source.write(&document)?,
        None => JsonSource::create(&document)?,
    };
    let value = actual.content.to_json()?;
    let handle = session_handle(&input.session_id)?;
    let index = {
        let mut session = lock_session(&handle)?;
        let composition = json_layers::json_composition(&session, &after.write.rel_path)?;
        content::validate_entity_content_in(
            &session,
            EntityKind::Faction,
            &before.write.rel_path,
            &value,
            input.json_write.replaces(&before.write.rel_path),
            Some(&composition),
        )?;
        faction_index::prepare(
            &mut session,
            &before,
            next,
            &after.write.rel_path,
            &input.index_row,
        )?
    };
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    if before.state == EntityTargetState::Existing && before.write.rel_path != after.write.rel_path
    {
        builder.rename_text_file(
            &before.write.rel_path,
            &after.write.rel_path,
            actual.text.to_string(),
        )?;
    } else {
        builder.text_file(&after.write.rel_path, Some(actual.text.to_string()))?;
    }
    let csv = if index.row_index.is_some() {
        faction_index::stage(&index.table, &mut builder)?
    } else {
        index.table.source.clone()
    };
    replace_paths::stage_replace_paths(&mut builder, &input.json_write)?;
    after.source = Some(after.write.clone());
    after.linked_record = index.row_index.map(|row_index| EntityLinkedRecord::Index {
        path: "data/world/factions/factions.csv".into(),
        row_index,
    });
    let content = serde_json::to_value(IndexedConfigEntityRefresh {
        entity_id: next.into(),
        index_path: "data/world/factions/factions.csv".into(),
        index_header: index.table.header.clone(),
        index_rows: project_csv(&csv, Path::new("data/world/factions/factions.csv")).rows,
        entity_data: json!({"file":value}),
        document: Some(JsonFileContent::from(&actual)),
    })?;
    let mut result = WriteResult::from_content(
        builder.apply()?,
        WriteContentTarget::Json {
            origin: (&after).into(),
        },
        content,
    );
    if index.row_index.is_some() {
        let mut session = lock_session(&handle)?;
        index
            .table
            .accept_named(&mut session, "faction-index", csv)?;
    }
    result
        .identity_changes
        .push(EntityIdentityChange { before, after });
    Ok(result)
}
pub fn delete_faction(input: &IndexedConfigDelete) -> AppResult<WriteResult<Value>> {
    let target = entity_targets::query_entity_edit_target(
        &input.session_id,
        EntityKind::Faction,
        &input.id,
    )?
    .target;
    if target.linked_record.is_none() {
        return Err(AppError::message(
            "config.index_row_missing",
            format!("势力索引不存在: {}", target.id),
        ));
    }
    let handle = session_handle(&input.session_id)?;
    let mut session = lock_session(&handle)?;
    csv_tables::ensure_session_table_rows(&mut session, "faction-index")?;
    let mut index = CsvTableDraft::read_named(&session, "faction-index")?;
    drop(session);
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    let actual = if let Some(EntityLinkedRecord::Index { row_index, .. }) = target.linked_record {
        index.rows.remove(row_index);
        Some(faction_index::stage(&index, &mut builder)?)
    } else {
        None
    };
    if input.delete_target || actual.is_none() {
        builder.text_file(&target.write.rel_path, None)?;
    }
    let result = WriteResult::from_changes(builder.apply()?).with_content(
        WriteContentTarget::Json {
            origin: (&target).into(),
        },
        Value::Null,
    );
    if let Some(actual) = actual {
        let mut session = lock_session(&handle)?;
        index.accept_named(&mut session, "faction-index", actual)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::services::project_sync::release_project_session;

    use super::*;

    #[cfg(test)]
    use crate::models::SaveAction;
    use crate::models::{IndexedConfigDelete, IndexedConfigKind, IndexedConfigSave};
    use crate::services::project;
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    #[cfg(test)]
    use crate::services::project::query::entity_targets;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::project_save;
    use serde_json::json;
    #[cfg(test)]
    use std::fs;

    #[test]
    fn indexed_actual_target_keeps_columns_positions_versions_and_deletion_scope() {
        let root = project_workspace("faction_actual_index_target");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        fs::create_dir_all(root.join("data/custom/nested")).unwrap();
        let index = root.join("data/world/factions/factions.csv");
        fs::write(
            &index,
            "id,file,note\n#comment,,first\nloaded,data/custom/nested/filename.faction,keep\n",
        )
        .unwrap();
        fs::write(
            root.join("data/custom/nested/filename.faction"),
            r#"{"id":"loaded","displayName":"Loaded"}"#,
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Faction,
            "loaded",
        )
        .unwrap();
        assert_eq!(
            info.target.write.rel_path,
            "data/custom/nested/filename.faction"
        );
        assert_eq!(info.base_versions.len(), 2);
        assert!(
            info.base_versions
                .iter()
                .all(|version| version.fingerprint.is_some())
        );
        let saved = project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
                IndexedConfigSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: info.base_versions,
                    previous_id: Some("loaded".into()),
                    next_id: "next".into(),
                    index_row: Default::default(),
    content: file_formats::indexed_content(IndexedConfigKind::Faction, &(json!({"file":{
                        "id":"next","displayName":"Saved","displayNameWithArticle":"a Saved",
                        "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
                        "knownShips":{},"knownFighters":{},"knownWeapons":{},
                        "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                            "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}
                    }}))),
                    json_write: Default::default(),
                },
            ))
            .unwrap();
        let next = entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Faction,
            "next",
        )
        .unwrap();
        assert_eq!(saved.base_versions, next.base_versions);
        assert_eq!(
            next.target.write.rel_path,
            "data/custom/nested/next.faction"
        );
        let contents = file_formats::read_csv_table(&index).unwrap();
        assert_eq!(contents.header, ["id", "file", "note"]);
        assert_eq!(contents.rows[0].data["id"], "#comment");
        assert_eq!(contents.rows[1].data["id"], "next");
        assert_eq!(
            contents.rows[1].data["file"],
            "data/custom/nested/next.faction"
        );
        assert_eq!(contents.rows[1].data["note"], "keep");
        let result = project_save::execute_save_action(SaveAction::DeleteIndexedConfigEntity(
            IndexedConfigDelete {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: next.base_versions,
                kind: IndexedConfigKind::Faction,
                id: "next".into(),
                delete_target: true,
            },
        ))
        .unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(!root.join("data/custom/nested/next.faction").exists());
        assert_eq!(file_formats::read_csv_table(&index).unwrap().rows.len(), 1);
        release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
