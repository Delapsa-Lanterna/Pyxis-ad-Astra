use crate::{
    domain::misc_config::{MISC_CONFIG_FILES, misc_config_path},
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_versioned_json,
    },
    models::{
        FileVersion, MiscConfigEntry, MiscConfigFile, MiscConfigKind, MiscConfigState,
        MiscConfigWrite, WriteResult,
    },
};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::LazyLock,
};

pub fn query_misc_config_files(mod_root: &str) -> AppResult<Vec<MiscConfigEntry>> {
    let _lease = acquire_root_write_lock(Path::new(mod_root))?;
    Ok(MISC_CONFIG_FILES
        .iter()
        .map(|&kind| {
            let checked = target_path(mod_root, kind).and_then(|path| {
                path.try_exists()
                    .map_err(|error| AppError::from(error).at_path(&path))
            });
            MiscConfigEntry {
                kind,
                path: Path::new(mod_root)
                    .join(misc_config_path(kind))
                    .to_string_lossy()
                    .into(),
                rel_path: misc_config_path(kind).into(),
                state: match &checked {
                    Ok(true) => MiscConfigState::Present,
                    Ok(false) => MiscConfigState::Missing,
                    Err(_) => MiscConfigState::Error,
                },
                error: checked.err().map(|error| error.diagnostic()),
            }
        })
        .collect())
}
pub fn query_misc_config_file(
    mod_root: &str,
    kind: MiscConfigKind,
) -> AppResult<Option<MiscConfigFile>> {
    let _lease = acquire_root_write_lock(Path::new(mod_root))?;
    let path = target_path(mod_root, kind)?;
    if !path
        .try_exists()
        .map_err(|error| AppError::from(error).at_path(&path))?
    {
        return Ok(None);
    }
    let (version, data) = read_versioned_json(&path)?;
    validate_misc_config(kind, &data).map_err(|error| error.at_path(&path))?;
    Ok(Some(MiscConfigFile {
        kind,
        path: path.to_string_lossy().into(),
        rel_path: misc_config_path(kind).into(),
        data,
        base_versions: vec![version],
    }))
}
fn target_path(mod_root: &str, kind: MiscConfigKind) -> AppResult<PathBuf> {
    FsRootBoundary::new(Path::new(mod_root), "misc config root")?
        .resolve_relative_target(misc_config_path(kind), "misc config file")
}
fn require_version(path: &Path, versions: &[FileVersion]) -> AppResult<()> {
    if !versions
        .iter()
        .any(|version| crate::io::same_physical_path(Path::new(&version.path), path))
    {
        return Err(AppError::message(
            "write.version_scope_missing",
            "misc config file version is required",
        )
        .at_path(path));
    }
    Ok(())
}
pub fn save_misc_config(payload: MiscConfigWrite) -> AppResult<WriteResult<Value>> {
    let path = target_path(&payload.mod_root, payload.kind)?;
    require_version(&path, &payload.base_versions)?;
    validate_misc_config(payload.kind, &payload.data).map_err(|error| error.at_path(&path))?;
    let mut json = JsonWriteBatch::new(payload.json_write);
    let text = json.render(&path, &payload.data, Some(&payload.ordered_json))?;
    json.finish()?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&payload.mod_root))?;
    builder.text_file(misc_config_path(payload.kind), Some(text))?;
    Ok(WriteResult::from_refreshed_entity(
        builder.apply()?,
        payload.data,
    ))
}
pub fn delete_misc_config(
    mod_root: &str,
    kind: MiscConfigKind,
    versions: &[FileVersion],
) -> AppResult<WriteResult> {
    require_version(&target_path(mod_root, kind)?, versions)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(mod_root))?;
    builder.text_file(misc_config_path(kind), None)?;
    Ok(WriteResult::from_changes(builder.apply()?))
}

pub(crate) fn validate_misc_config(kind: MiscConfigKind, data: &Value) -> AppResult<()> {
    crate::domain::misc_config::validate_misc_config(kind, data, config_schema(kind))
}

fn config_schema(kind: MiscConfigKind) -> &'static Value {
    static SCHEMAS: LazyLock<[Value; 5]> = LazyLock::new(|| {
        [
            include_str!("../../../schemas/engine-styles.schema.json"),
            include_str!("../../../schemas/hull-styles.schema.json"),
            include_str!("../../../schemas/sounds.schema.json"),
            include_str!("../../../schemas/game-settings.schema.json"),
            include_str!("../../../schemas/strings.schema.json"),
        ]
        .map(|text| {
            crate::parsers::parse_persisted_json::<Value>(text)
                .expect("bundled field schema is valid JSON")
        })
    });
    let index = match kind {
        MiscConfigKind::EngineStyles => 0,
        MiscConfigKind::HullStyles => 1,
        MiscConfigKind::Sounds => 2,
        MiscConfigKind::Settings => 3,
        MiscConfigKind::Strings => 4,
    };
    &SCHEMAS[index]["root"]
}
