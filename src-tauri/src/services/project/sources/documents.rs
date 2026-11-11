use super::SourceReader;
use crate::errors::AppResult;
use crate::io::{self, FsRootBoundary};
use crate::models::file_content::JsonSource;
use crate::models::{self, EntityFileLocation, ResourceSource};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedSpecRecord {
    pub id: String,
    pub location: EntityFileLocation,
    pub data: Value,
    pub document: Arc<JsonSource>,
}
impl LoadedSpecRecord {
    fn read(
        reader: &mut SourceReader,
        path: &Path,
        id_field: &str,
        source: ResourceSource,
    ) -> AppResult<Self> {
        let document = reader.json_source(path)?;
        let data = document.content.to_json()?;
        let id = models::file_content_id(&data, id_field, path);
        Ok(Self {
            id,
            document,
            data,
            location: EntityFileLocation {
                reference: None,
                source,
                root: reader.root().to_string_lossy().into_owned(),
                rel_path: reader.key(path),
                path: path.to_string_lossy().into_owned(),
            },
        })
    }
}
pub(crate) fn load_spec_records(
    root: &Path,
    directory: &str,
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    load_spec_records_from(
        &mut SourceReader::new(root)?,
        &[directory],
        extension,
        id_field,
        source,
    )
}
pub(in crate::services::project) fn load_spec_records_from(
    reader: &mut SourceReader,
    directories: &[&str],
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    refresh_spec_records_from(
        reader,
        directories,
        extension,
        id_field,
        source,
        &BTreeMap::new(),
    )
}
pub(in crate::services::project) fn refresh_spec_records_from(
    reader: &mut SourceReader,
    directories: &[&str],
    extension: &str,
    id_field: &str,
    source: ResourceSource,
    previous: &BTreeMap<String, LoadedSpecRecord>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut paths = Vec::new();
    for directory in directories {
        paths.extend(reader.discover(directory, &[extension], true)?);
    }
    paths.sort();
    paths.dedup();
    let mut records = BTreeMap::new();
    let previous = previous
        .values()
        .map(|record| (record.location.rel_path.as_str(), record))
        .collect::<BTreeMap<_, _>>();
    for path in paths {
        let relative = reader.key(&path);
        let record = if let Some(record) = previous.get(relative.as_str()).filter(|_| {
            !reader
                .changed_paths()
                .iter()
                .any(|changed| io::relative_path_contains(changed, &relative))
        }) {
            (*record).clone()
        } else {
            LoadedSpecRecord::read(reader, &path, id_field, source)?
        };
        records.insert(record.id.clone(), record);
    }
    Ok(records)
}
pub(in crate::services::project) fn load_faction_files_from(
    reader: &mut SourceReader,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let root = reader.root().to_path_buf();
    let boundary = FsRootBoundary::new(&root, "faction source")?;
    let path = reader.path("data/world/factions/factions.csv")?;
    let index = reader.csv(&path)?;
    let mut records =
        load_spec_records_from(reader, &["data/world/factions"], "faction", "id", source)?;
    for entry in io::faction_index_entries(&boundary, &index)? {
        if entry.path.exists() {
            let record = LoadedSpecRecord::read(reader, &entry.path, "id", source)?;
            records.insert(record.id.clone(), record);
        } else {
            reader.stage_version(&entry.path)?;
        }
    }
    Ok(records)
}
