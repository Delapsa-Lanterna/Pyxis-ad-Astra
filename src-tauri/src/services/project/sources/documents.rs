use crate::services::project::model::LoadedSpecRecord;
use crate::{
    errors::AppResult,
    io::forward_slash_path,
    models::{EntityFileLocation, ResourceSource},
};
use std::{collections::BTreeMap, path::Path};

pub(crate) fn load_spec_records(
    root: &Path,
    directory: &str,
    extension: &str,
    id_field: &str,
    source: ResourceSource,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut sources = super::super::sources::SourceReader::new(root)?;
    load_spec_records_from(&mut sources, directory, extension, id_field, source)
}

pub(in crate::services::project) fn load_spec_records_from(
    sources: &mut super::super::sources::SourceReader,
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
        if let Some(id) = data.get(id_field).and_then(serde_json::Value::as_str) {
            let id = id.to_string();
            let rel_path = forward_slash_path(
                path.strip_prefix(&root)
                    .expect("loaded spec belongs to its root"),
            );
            records.insert(
                id.clone(),
                LoadedSpecRecord {
                    id,
                    location: EntityFileLocation {
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
