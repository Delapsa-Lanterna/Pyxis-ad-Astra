use crate::{
    domain::misc_config::{MISC_CONFIG_FILES, misc_config_path},
    errors::{AppError, AppResult},
    io::{
        FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, acquire_root_write_lock,
        read_versioned_json,
    },
    models::{
        FileVersion, MiscConfigEntry, MiscConfigFile, MiscConfigKind, MiscConfigRead,
        MiscConfigState, MiscConfigWrite, WriteResult,
    },
};
use serde_json::Value;
use std::path::{Path, PathBuf};

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
        composition: Default::default(),
        kind,
        path: path.to_string_lossy().into(),
        rel_path: misc_config_path(kind).into(),
        data,
        base_versions: vec![version],
    }))
}

pub fn query_project_misc_config(payload: MiscConfigRead) -> AppResult<Option<MiscConfigFile>> {
    let mut file = query_misc_config_file(&payload.mod_root, payload.kind)?;
    if let Some(file) = &mut file {
        file.composition =
            crate::services::project::composition_for_session(&payload.session_id, &file.rel_path)?;
    }
    Ok(file)
}

pub fn prepare_misc_save(
    input: &mut MiscConfigWrite,
    edits: &[crate::models::SaveEdit],
) -> AppResult<()> {
    let MiscConfigWrite {
        mod_root,
        kind,
        data,
        base_versions: versions,
        ordered_json: ordered,
        ..
    } = input;
    if let Some(current) = query_misc_config_file(mod_root, *kind)? {
        *data = current.data;
        *versions = current.base_versions;
        crate::domain::save_edits::apply_save_edits(data, edits);
        *ordered = serde_json::to_string(data)?;
    }
    Ok(())
}

pub fn write_misc_request(
    payload: crate::models::MiscConfigWrite,
) -> Result<WriteResult<Value>, AppError> {
    let root = crate::services::project::current_projection(&payload.session_id)?
        .manifest
        .starsector_root;
    let root = root
        .as_deref()
        .filter(|root| Path::new(root).join("starsector-core").is_dir())
        .map(crate::services::project::core_dir)
        .transpose()?;
    let result = crate::services::misc_config::save_misc_config(payload, root.as_deref())?;
    Ok(result)
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
pub fn save_misc_config(
    payload: MiscConfigWrite,
    _core_root: Option<&Path>,
) -> AppResult<WriteResult<Value>> {
    let path = target_path(&payload.mod_root, payload.kind)?;
    require_version(&path, &payload.base_versions)?;
    validate_misc_config(payload.kind, &payload.data).map_err(|error| error.at_path(&path))?;
    let composition = crate::services::project::composition_for_session(
        &payload.session_id,
        misc_config_path(payload.kind),
    )?;
    let effective =
        crate::domain::json_composition::compose_game_json(&composition, &payload.data)?;
    crate::domain::schema::validate_field(
        config_schema(payload.kind),
        &effective,
        misc_config_path(payload.kind),
        !composition.layers.is_empty(),
    )
    .map_err(|error| error.at_path(&path))?;
    if payload.kind == MiscConfigKind::Sounds {
        validate_sound_indices(&effective).map_err(|error| error.at_path(&path))?;
    }
    let mut json = JsonWriteBatch::new(payload.json_write);
    let text = json.render(&path, &payload.data, Some(&payload.ordered_json))?;
    json.finish()?;
    let mut builder = FileChangeSetBuilder::new(Path::new(&payload.mod_root))?;
    builder.text_file(misc_config_path(payload.kind), Some(text))?;
    Ok(WriteResult::from_content(
        builder.apply()?,
        crate::models::WriteContentTarget::Json {
            origin: crate::models::JsonDocumentOrigin::MiscConfig { file: payload.kind },
        },
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
    &crate::parsers::bundled_schema(crate::domain::misc_config::misc_config_schema_id(kind))["root"]
}

fn validate_sound_indices(data: &Value) -> AppResult<()> {
    for (name, group) in data.as_object().expect("validated sounds") {
        if name == "music" || !group.is_object() {
            continue;
        }
        let length = group["sounds"]
            .as_array()
            .expect("complete sound group")
            .len();
        for (rule, value) in group.as_object().expect("sound group") {
            if rule == "sounds" {
                continue;
            }
            if let Some(indices) = value["sounds"].as_array()
                && indices.iter().any(|index| {
                    index.as_f64().unwrap_or_else(|| {
                        index
                            .as_str()
                            .expect("numeric index text")
                            .parse()
                            .expect("validated numeric index")
                    }) >= length as f64
                })
            {
                return Err(AppError::message(
                    "config.shape_invalid",
                    format!("音频索引超出 sounds 列表范围：{name}/{rule}/sounds"),
                ));
            }
        }
    }
    Ok(())
}
