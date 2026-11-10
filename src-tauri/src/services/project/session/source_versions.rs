use super::super::model::{self, ProjectSession};
use super::super::sources::SourceReader;
use crate::errors::AppResult;
use crate::io;
use crate::models::CsvTableKey;
use crate::models::file_content::JsonSource;
use std::fs;
use std::path::Path;
use std::sync::Arc;

pub(in crate::services::project) fn source_reader_for_session(
    session: &ProjectSession,
) -> AppResult<SourceReader> {
    let mut reader = SourceReader::for_session(Path::new(&session.manifest.mod_root))?;
    reader.versions = (*session.source_versions).clone();
    reader.scopes = (*session.source_scopes).clone();
    reader.stamps = (*session.source_stamps).clone();
    for (key, table) in &session.csv_tables {
        if let (Some(kind), Some(version)) = (
            CsvTableKey::from_key(key),
            session.source_versions.get(&table.path),
        ) {
            reader.retain_csv_summary(
                &table.path,
                version,
                &table.header,
                session.manifest.table_entity_summaries[&kind],
            );
        }
        if let Some(source) = &table.source {
            reader
                .csv_sources
                .insert(table.path.clone(), source.clone());
        }
    }
    retain_session_sources(&mut reader, session, &[]);
    Ok(reader)
}
pub(in crate::services::project) fn retain_session_sources(
    reader: &mut SourceReader,
    session: &ProjectSession,
    changed: &[&str],
) {
    let mut retain = |relative: &str, source: Arc<JsonSource>| {
        if changed
            .iter()
            .any(|scope| io::relative_path_contains(scope, relative))
        {
            return;
        }
        if let Some(version) = session.source_versions.get(relative) {
            reader.retain_json(relative, version, source);
        }
    };
    for (relative, source) in session.documents.iter() {
        retain(relative, source.clone());
    }
}
pub(in crate::services::project) fn capture_project_versions(
    reader: &mut SourceReader,
) -> AppResult<()> {
    let mut paths = vec![
        "mod_info.json",
        "data/world/factions/factions.csv",
        "data/missions/mission_list.csv",
    ];
    paths.extend(model::csv_table_specs().iter().map(|spec| spec.rel_path));
    for relative in paths {
        if !reader.versions.contains_key(relative) {
            reader.stage_version(&reader.path(relative)?)?;
        }
    }
    for path in reader.files("data/missions")? {
        if !reader.versions.contains_key(&reader.key(&path)) {
            reader.stage_version(&path)?;
        }
    }
    let missions = reader.path("data/missions")?;
    if missions.is_dir() {
        for entry in fs::read_dir(&missions)? {
            let entry = entry?;
            io::validate_walk_entry(&entry.path(), "mission directory")?;
            if entry.file_type()?.is_dir() {
                reader.versions.insert(
                    reader.key(&entry.path()),
                    reader.directory_version(&entry.path())?,
                );
            }
        }
    }
    reader.discard_outdated_records();
    Ok(())
}
pub(in crate::services::project) fn capture_changed_versions(
    reader: &mut SourceReader,
    paths: &[&str],
) -> AppResult<()> {
    reader.capture_changed_versions(paths)?;
    for relative in paths {
        if let Some(mission) = relative
            .strip_prefix("data/missions/")
            .and_then(|path| path.split('/').next())
            .filter(|name| *name != "mission_list.csv")
        {
            let directory = format!("data/missions/{mission}");
            let path = reader.path(&directory)?;
            if path.is_dir() {
                reader.capture_changed_versions(&[&directory])?;
            }
        }
    }
    Ok(())
}
