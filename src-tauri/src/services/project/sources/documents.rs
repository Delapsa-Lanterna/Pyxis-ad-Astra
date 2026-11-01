use crate::errors::AppResult;
use crate::io::forward_slash_path;
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
    load_spec_records_from(&mut sources, directory, extension, id_field, source)
}

pub(in crate::services::project) fn load_spec_records_from(
    sources: &mut SourceReader,
    directory: &str,
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let root = sources.root().to_path_buf();
    let mut records = BTreeMap::new();
    let mut files = sources.walk(directory, extension)?;
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
