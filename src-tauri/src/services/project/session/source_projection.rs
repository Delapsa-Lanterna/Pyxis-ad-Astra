use super::super::{model::ProjectSession, sources::SourceReader};
use crate::errors::AppResult;
use serde_json::Value;
use std::{collections::BTreeSet, path::Path};

pub(in crate::services::project) fn sources_from_projection(
    session: &ProjectSession,
) -> AppResult<SourceReader> {
    let mut sources = SourceReader::for_projection(Path::new(&session.manifest.mod_root))?;
    for (key, table) in &session.csv_tables {
        let Some(table_key) = crate::models::CsvTableKey::from_key(key) else {
            continue;
        };
        let path = &table.path;
        let Some(version) = session.source_versions.get(path) else {
            continue;
        };
        let summary = &session.manifest.table_summaries[&table_key];
        let count = session.manifest.table_entity_summaries[&table_key];
        sources.retain_csv_summary(path, version, &summary.header, count);
    }
    Ok(sources)
}

pub(in crate::services::project) fn retain_projection_sources(
    sources: &mut SourceReader,
    session: &ProjectSession,
    changed: &[&str],
) {
    let mut retain = |path: &str, value: &Value| {
        if changed
            .iter()
            .any(|changed| crate::io::relative_path_contains(changed, path))
        {
            return;
        }
        if let Some(version) = session.source_versions.get(path) {
            sources.retain_json(path, version, value);
        }
    };
    for records in [
        &session.ship_files,
        &session.weapon_specs,
        &session.projectile_specs,
        &session.system_files,
        &session.skill_files,
        &session.faction_files,
    ] {
        for record in records
            .values()
            .filter(|record| record.location.source == crate::models::ResourceSource::Mod)
        {
            retain(&record.location.rel_path, &record.data);
        }
    }
    for file in session.variant_files.iter() {
        retain(&file.rel_path, &file.data);
    }
    for file in session.skin_files.iter() {
        retain(&file.rel_path, &file.data);
    }
}

pub(in crate::services::project) fn capture_project_versions(
    sources: &mut SourceReader,
) -> AppResult<()> {
    let mut paths = vec![
        sources.path("mod_info.json")?,
        sources.path("data/world/factions/factions.csv")?,
        sources.path("data/missions/mission_list.csv")?,
    ];
    for table in super::super::model::csv_table_specs() {
        paths.push(sources.path(table.rel_path)?);
    }
    for directory in [
        "data/world",
        "data/hulls",
        "data/weapons",
        "data/variants",
        "data/shipsystems",
        "data/characters/skills",
        "data/missions",
    ] {
        for path in sources.files(directory)? {
            let extension = path
                .extension()
                .and_then(|part| part.to_str())
                .unwrap_or("");
            if directory == "data/missions"
                || [
                    "faction", "ship", "skin", "wpn", "proj", "variant", "system", "skill",
                ]
                .iter()
                .any(|part| extension.eq_ignore_ascii_case(part))
            {
                paths.push(path);
            }
        }
    }
    for path in paths {
        let key = sources.key(&path);
        if let std::collections::btree_map::Entry::Vacant(entry) = sources.versions.entry(key) {
            entry.insert(crate::io::file_version(&path)?);
        }
    }
    let missions = sources.path("data/missions")?;
    if missions.is_dir() {
        for entry in std::fs::read_dir(&missions)? {
            let path = entry?.path();
            crate::io::validate_walk_entry(&path, "mission directory")?;
            if path.is_dir() {
                let key = sources.key(&path);
                sources
                    .versions
                    .insert(key, sources.directory_version(&path)?);
            }
        }
    }
    sources.discard_outdated_records();
    Ok(())
}

pub(in crate::services::project) fn capture_projection_versions(
    sources: &mut SourceReader,
    paths: &[&str],
) -> AppResult<()> {
    sources.capture_changed_versions(paths)?;
    let mut directories = BTreeSet::new();
    for relative in paths {
        if let Some(mission) = relative
            .strip_prefix("data/missions/")
            .and_then(|suffix| suffix.split('/').next())
            .filter(|name| *name != "mission_list.csv")
        {
            let directory = sources.path(&format!("data/missions/{mission}"))?;
            if directory.is_dir() {
                for file in sources.files(&format!("data/missions/{mission}"))? {
                    let key = sources.key(&file);
                    if let std::collections::btree_map::Entry::Vacant(entry) =
                        sources.versions.entry(key)
                    {
                        entry.insert(crate::io::file_version(&file)?);
                    }
                }
                directories.insert(directory);
            }
        }
    }
    for directory in directories {
        sources.versions.insert(
            sources.key(&directory),
            sources.directory_version(&directory)?,
        );
    }
    Ok(())
}
