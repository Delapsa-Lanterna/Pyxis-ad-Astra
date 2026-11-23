use crate::domain::{entity_identity::nexerelin_faction_path, json_composition, schema};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::NexerelinWrite;
use crate::models::file_content::{
    CsvSource, CsvWrite, JsonFileContent, JsonSource, Record, RecordKind, SaveLayout,
};
use crate::parsers::{field_schema, game};
use crate::services::project::query::json_layers;
use crate::services::project::session::{lock_session, session_handle};
use std::path::Path;

const INDEX: &str = "data/config/exerelinFactionConfig/mod_factions.csv";

fn read_index(root: &Path) -> AppResult<Option<CsvSource>> {
    let path = FsRootBoundary::new(root, "Nexerelin")?
        .resolve_relative(INDEX, "Nexerelin faction index")?;
    path.try_exists()?
        .then(|| io::read_csv_data(&path))
        .transpose()
}

fn faction_column(index: &CsvSource) -> AppResult<usize> {
    index
        .document
        .content
        .header
        .iter()
        .position(|key| key == "faction")
        .ok_or_else(|| {
            AppError::message(
                "config.index_column_missing",
                "势力争霸登记表缺少 faction 列",
            )
        })
}

fn registered(record: &Record, column: usize, id: &str) -> bool {
    record.kind == RecordKind::Data && record.cells.get(column).is_some_and(|cell| cell == id)
}

fn inherited(session_id: &str, id: &str) -> AppResult<bool> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    let relative = "exerelin_config.json";
    let layers = json_layers::json_composition(&session, relative)?;
    let root = Path::new(&session.manifest.mod_root);
    let path =
        FsRootBoundary::new(root, "Nexerelin")?.resolve_relative(relative, "Nexerelin settings")?;
    let local = if path.try_exists()? {
        io::read_json_file(&path)?.content.to_json()?
    } else {
        serde_json::json!({})
    };
    let effective = json_composition::compose_game_json(&layers, &local)?;
    if effective["builtInFactions"]
        .as_array()
        .is_some_and(|ids| ids.iter().any(|item| item == id))
    {
        return Ok(true);
    }
    for reference in session.preceding_references()? {
        if let Some(index) = read_index(Path::new(&reference.identity.mod_root))? {
            let column = faction_column(&index)?;
            if index
                .document
                .content
                .records
                .iter()
                .any(|row| registered(row, column, id))
            {
                return Ok(true);
            }
        }
    }
    Ok(false)
}

fn stage_index(
    builder: &mut FileChangeSetBuilder,
    session: &str,
    previous: &str,
    next: Option<&str>,
) -> AppResult<()> {
    let index = match read_index(builder.root())? {
        Some(index) => index,
        None => game::read_csv(b"faction\n").map_err(|failure| failure.error)?,
    };
    let column = faction_column(&index)?;
    let source = &index.document.content;
    let has_next =
        next.is_some_and(|id| source.records.iter().any(|row| registered(row, column, id)));
    if Some(previous) == next && has_next {
        return Ok(());
    }
    let mut pending = match next {
        Some(id) if !has_next && !inherited(session, id)? => Some(id),
        _ => None,
    };
    let mut request = CsvWrite {
        content: source.clone(),
        origins: Vec::new(),
        columns: (0..source.header.len()).map(Some).collect(),
        layout: SaveLayout::PreserveStructure,
    };
    request.content.records.clear();
    for (i, row) in source.records.iter().enumerate() {
        let mut row = row.clone();
        if Some(previous) != next && registered(&row, column, previous) {
            let Some(id) = pending.take() else {
                continue;
            };
            row.cells[column] = id.into();
        }
        request.content.records.push(row);
        request.origins.push(Some(i));
    }
    if let Some(next) = pending {
        let mut cells = vec![String::new(); source.header.len()];
        cells[column] = next.into();
        request.content.records.push(Record {
            kind: RecordKind::Data,
            cells,
        });
        request.origins.push(None);
    }
    if request.content != *source {
        let actual = index.write(&request)?;
        builder.text_file(INDEX, Some(actual.document.source.to_string()))?;
    }
    Ok(())
}

pub(super) fn remove(builder: &mut FileChangeSetBuilder, session: &str, id: &str) -> AppResult<()> {
    builder.text_file(nexerelin_faction_path(id)?, None)?;
    stage_index(builder, session, id, None)
}

pub(super) fn stage(
    builder: &mut FileChangeSetBuilder,
    session: &str,
    previous: &str,
    next: &str,
    edit: Option<&NexerelinWrite>,
) -> AppResult<Option<JsonFileContent>> {
    if edit.is_none() && previous == next {
        return Ok(None);
    }
    let relative = nexerelin_faction_path(previous)?;
    let path = FsRootBoundary::new(builder.root(), "Nexerelin")?
        .resolve_relative(&relative, "Nexerelin faction")?;
    let source = path
        .try_exists()?
        .then(|| io::read_json_file(&path))
        .transpose()?;
    let actual = if let Some(edit) = edit {
        if source.as_ref().map(|file| file.text.as_ref()) != edit.original.as_deref() {
            return Err(AppError::message(
                "write.version_conflict",
                "势力争霸配置已变更，请载入外部版本",
            )
            .at_path(&path));
        }
        let Some(document) = &edit.document else {
            remove(builder, session, previous)?;
            return Ok(None);
        };
        let value = document.content.to_json()?;
        schema::validate_field(
            &field_schema::bundled_schema("nexerelin-faction")["root"],
            &value,
            "nexerelin",
            false,
        )?;
        match &source {
            Some(file) if file.content == document.content => file.clone(),
            Some(file) => file.write(document)?,
            None => JsonSource::create(document)?,
        }
    } else if let Some(file) = &source {
        file.clone()
    } else {
        return Ok(None);
    };
    let destination = nexerelin_faction_path(next)?;
    if relative != destination && source.is_some() {
        builder.rename_text_file(&relative, &destination, actual.text.to_string())?;
    } else {
        if relative != destination
            && FsRootBoundary::new(builder.root(), "Nexerelin")?
                .resolve_relative(&destination, "Nexerelin faction")?
                .try_exists()?
        {
            return Err(AppError::message(
                "config.entity_exists",
                format!("势力争霸配置已存在：{destination}"),
            ));
        }
        builder.text_file(&destination, Some(actual.text.to_string()))?;
    }
    stage_index(builder, session, previous, Some(next))?;
    Ok(Some(JsonFileContent::from(&actual)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        EntityKind, FileChangeReplayDirection, IndexedConfigContent, IndexedConfigSave, SaveAction,
    };
    use crate::services::project::PerformanceTrace;
    use crate::services::project::query::entity_targets;
    use crate::services::project::test_support::project_workspace;
    use crate::services::{file_history, project, project_save, project_sync, write_transactions};
    use crate::test_support::file_formats::{json_write, read_json_value};
    use serde_json::json;
    use std::fs;

    #[test]
    fn faction_save_registers_once_and_replays_both_files() {
        let root = project_workspace("nexerelin_faction");
        let primary = root.join("data/world/factions/alpha.faction");
        fs::create_dir_all(primary.parent().unwrap()).unwrap();
        let base = json!({"id":"alpha","displayName":"Alpha","displayNameWithArticle":"Alpha",
            "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
            "names":{},"portraits":{},"knownShips":{},"knownFighters":{},"knownWeapons":{},
            "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,"shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}});
        fs::write(&primary, base.to_string()).unwrap();
        let companion = root.join(nexerelin_faction_path("alpha").unwrap());
        let index = root.join(INDEX);
        fs::create_dir_all(index.parent().unwrap()).unwrap();
        let other = root.join(nexerelin_faction_path("beta").unwrap());
        let index_before = "note,faction\r\n# comment,\r\nkeep,beta\r\n";
        fs::write(&index, index_before).unwrap();
        fs::write(&other, "{# retained\n}").unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("nexerelin.open"),
        )
        .unwrap();
        let session = &manifest.session_id;
        let save = |previous: &str, next: &str, data: Option<NexerelinWrite>| {
            let mut main = base.clone();
            main["id"] = json!(next);
            let snapshot =
                entity_targets::query_entity_edit_target(session, EntityKind::Faction, previous)
                    .unwrap();
            project_save::execute_save_action(SaveAction::SaveIndexedConfigEntity(
                IndexedConfigSave {
                    session_id: session.clone(),
                    mod_root: manifest.mod_root.clone(),
                    base_versions: snapshot.base_versions,
                    previous_id: Some(previous.into()),
                    next_id: next.into(),
                    index_row: Default::default(),
                    content: IndexedConfigContent::Faction {
                        document: json_write(&main),
                        nexerelin: data,
                    },
                    json_write: Default::default(),
                },
            ))
        };
        let edit = |original: Option<String>, value| {
            Some(NexerelinWrite {
                original,
                document: Some(json_write(&value)),
            })
        };
        let initial = json!({"startRelationships":{"beta":-0.3},"unknown":[1,2]});
        let created = save("alpha", "alpha", edit(None, initial.clone())).unwrap();
        assert_eq!(created.changes.len(), 2);
        assert_eq!(read_json_value(&companion).unwrap(), initial);
        assert_eq!(fs::read_to_string(&primary).unwrap(), base.to_string());
        let registered = fs::read_to_string(&index).unwrap();
        assert!(registered.starts_with(index_before));
        assert_eq!(
            registered.lines().filter(|line| *line == ",alpha").count(),
            1
        );
        for direction in [
            FileChangeReplayDirection::Undo,
            FileChangeReplayDirection::Redo,
        ] {
            let history = file_history::query_file_history(session, &manifest.mod_root).unwrap();
            let undo = matches!(direction, FileChangeReplayDirection::Undo);
            let entries = if undo {
                &history.undo_stack
            } else {
                &history.redo_stack
            };
            assert_eq!(entries.len(), 1);
            assert_eq!(entries[0].paths.len(), 2);
            write_transactions::replay(
                session,
                &manifest.mod_root,
                direction,
                entries[0].id,
                history.revision,
            )
            .unwrap();
            assert_eq!(companion.exists(), !undo);
            assert_eq!(
                fs::read_to_string(&index).unwrap(),
                if undo { index_before } else { &registered }
            );
        }
        let original = fs::read_to_string(&companion).unwrap();
        let invalid = save(
            "alpha",
            "alpha",
            edit(Some(original.clone()), json!({"playableFaction":[]})),
        );
        assert!(invalid.is_err());
        let updated = json!({"playableFaction":false,"unknown":[1,2]});
        assert_eq!(
            save(
                "alpha",
                "alpha",
                edit(Some(original.clone()), updated.clone())
            )
            .unwrap()
            .changes
            .len(),
            1
        );
        assert!(save("alpha", "alpha", edit(Some(original), initial)).is_err());
        assert_eq!(read_json_value(&companion).unwrap(), updated);
        fs::write(root.join(nexerelin_faction_path("occupied").unwrap()), "{}").unwrap();
        assert!(save("alpha", "occupied", None).is_err());
        assert_eq!(read_json_value(&companion).unwrap(), updated);
        save("alpha", "next", None).unwrap();
        assert!(!companion.exists());
        assert_eq!(
            read_json_value(&root.join(nexerelin_faction_path("next").unwrap())).unwrap(),
            updated
        );
        assert_eq!(
            fs::read_to_string(&index).unwrap(),
            registered.replace(",alpha", ",next")
        );
        assert_eq!(fs::read_to_string(other).unwrap(), "{# retained\n}");
        let renamed = root.join(nexerelin_faction_path("next").unwrap());
        let removal = NexerelinWrite {
            original: Some(fs::read_to_string(&renamed).unwrap()),
            document: None,
        };
        assert_eq!(
            save("next", "next", Some(removal)).unwrap().changes.len(),
            2
        );
        assert!(!renamed.exists());
        assert_eq!(fs::read_to_string(&index).unwrap(), index_before);
        project_sync::release_project_session(session).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn first_registration_creates_missing_index_and_respects_builtin_factions() {
        let root = project_workspace("nexerelin_registration");
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("nexerelin.open"),
        )
        .unwrap();
        let stage_config = |id: &str| {
            let mut builder = FileChangeSetBuilder::new(&root).unwrap();
            stage(
                &mut builder,
                &manifest.session_id,
                id,
                id,
                Some(&NexerelinWrite {
                    original: None,
                    document: Some(json_write(&json!({"playableFaction": true}))),
                }),
            )
            .unwrap();
            builder.apply().unwrap()
        };
        fs::write(
            root.join("exerelin_config.json"),
            r#"{"builtInFactions":["builtin"]}"#,
        )
        .unwrap();
        assert_eq!(stage_config("builtin").len(), 1);
        assert!(!root.join(INDEX).exists());
        assert_eq!(stage_config("local").len(), 2);
        assert_eq!(
            fs::read_to_string(root.join(INDEX))
                .unwrap()
                .lines()
                .collect::<Vec<_>>(),
            ["faction", "local"]
        );
        project_sync::release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
