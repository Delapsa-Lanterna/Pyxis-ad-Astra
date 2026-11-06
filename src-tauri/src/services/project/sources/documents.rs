use crate::errors::AppResult;
use crate::io::{self, FsRootBoundary, forward_slash_path};
use crate::models;
use crate::models::{EntityFileLocation, ResourceSource};
use crate::services::project::sources::SourceReader;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedSpecRecord {
    pub id: String,
    pub location: EntityFileLocation,
    pub data: Value,
}

pub(crate) fn load_spec_records(
    root: &Path,
    directory: &str,
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut sources = SourceReader::new(root)?;
    load_spec_records_from(&mut sources, &[directory], extension, id_field, source)
}

pub(in crate::services::project) fn load_spec_records_from(
    sources: &mut SourceReader,
    directories: &[&str],
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let root = sources.root().to_path_buf();
    let mut records = BTreeMap::new();
    let mut files = Vec::new();
    for directory in directories {
        files.extend(sources.walk(directory, extension)?);
    }
    files.sort_by(|left, right| left.0.cmp(&right.0));
    for (path, data) in files {
        {
            let id = models::file_content_id(&data, id_field, &path);
            let rel_path = forward_slash_path(
                path.strip_prefix(&root)
                    .expect("loaded spec belongs to its root"),
            );
            records.insert(
                id.clone(),
                LoadedSpecRecord {
                    id,
                    location: EntityFileLocation {
                        reference: None,
                        source,
                        root: root.to_string_lossy().to_string(),
                        rel_path,
                        path: path.to_string_lossy().to_string(),
                    },
                    data,
                },
            );
        }
    }
    Ok(records)
}

pub(in crate::services::project) fn load_faction_files_from(
    sources: &mut SourceReader,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mod_root = sources.root().to_path_buf();
    let boundary = FsRootBoundary::new(&mod_root, "faction root")?;
    let table = sources.csv(&sources.path("data/world/factions/factions.csv")?)?;
    let mut defs =
        load_spec_records_from(sources, &["data/world/factions"], "faction", "id", source)?;
    for entry in io::faction_index_entries(&boundary, &table)? {
        if !entry.path.exists() {
            sources
                .versions
                .insert(sources.key(&entry.path), io::file_version(&entry.path)?);
            continue;
        }
        let data = sources.json(&entry.path)?;
        let id = models::file_content_id(&data, "id", &entry.path);
        let rel_path = forward_slash_path(
            entry
                .path
                .strip_prefix(boundary.root())
                .expect("faction belongs to authorized root"),
        );
        defs.insert(
            id.clone(),
            LoadedSpecRecord {
                id,
                location: EntityFileLocation {
                    reference: None,
                    source,
                    root: boundary.root().to_string_lossy().to_string(),
                    rel_path,
                    path: entry.path.to_string_lossy().to_string(),
                },
                data,
            },
        );
    }
    Ok(defs)
}
