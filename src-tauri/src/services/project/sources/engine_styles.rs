use crate::{errors::AppResult, models::FileVersion};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

pub(in crate::services::project) const ENGINE_STYLES_PATH: &str = "data/config/engine_styles.json";

pub(in crate::services::project) fn read_engine_styles(
    root: &Path,
) -> AppResult<(BTreeMap<String, Value>, FileVersion)> {
    let mut sources = super::SourceReader::new(root)?;
    let path = sources.path(ENGINE_STYLES_PATH)?;
    if !path.exists() {
        return Ok((BTreeMap::new(), crate::io::file_version(&path)?));
    }
    let value = sources.json(&path)?;
    let styles = value
        .as_object()
        .expect("source parser guarantees an object");
    Ok((
        styles
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        sources
            .versions
            .remove(ENGINE_STYLES_PATH)
            .expect("read source version"),
    ))
}
