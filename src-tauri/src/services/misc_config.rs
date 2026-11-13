use crate::domain::misc_config::MISC_CONFIG_FILES;
use crate::domain::schema::ScalarKind;
use crate::domain::schema::ScalarRule;
use crate::domain::{json_composition, misc_config as definition, save_edits, schema};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::file_content::JsonFileContent;
use crate::models::file_value::Value as FileValue;
use crate::models::{
    FileVersion, JsonDocumentOrigin, MiscConfigEntry, MiscConfigFile, MiscConfigKind,
    MiscConfigRead, MiscConfigState, MiscConfigWrite, SaveEdit, WriteContentTarget, WriteResult,
};
use crate::parsers;
use crate::services::{query_json_composition, stage_replace_paths};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn target(root: &str, kind: MiscConfigKind) -> AppResult<PathBuf> {
    FsRootBoundary::new(Path::new(root), "config root")?
        .resolve_relative_target(definition::misc_config_path(kind), "config file")
}
fn require_version(path: &Path, versions: &[FileVersion]) -> AppResult<()> {
    if versions
        .iter()
        .any(|version| io::same_physical_path(Path::new(&version.path), path))
    {
        return Ok(());
    }
    Err(AppError::message("write.version_scope_missing", "配置文件缺少读取版本凭据").at_path(path))
}
fn config_schema(kind: MiscConfigKind) -> &'static Value {
    &parsers::bundled_schema(definition::misc_config_schema_id(kind))["root"]
}
pub(crate) fn validate_misc_config(kind: MiscConfigKind, data: &Value) -> AppResult<()> {
    definition::validate_misc_config(kind, data, config_schema(kind))
}
pub fn query_misc_config_files(root: &str) -> AppResult<Vec<MiscConfigEntry>> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let boundary = FsRootBoundary::new(Path::new(root), "config root")?;
    MISC_CONFIG_FILES
        .iter()
        .map(|kind| {
            let relative = definition::misc_config_path(*kind);
            let requested = boundary.root().join(relative);
            let resolved = boundary.resolve_relative_target(relative, "config file");
            let path = resolved.as_ref().unwrap_or(&requested).clone();
            let state = resolved.and_then(|path| {
                path.try_exists()
                    .map(|exists| {
                        if exists {
                            MiscConfigState::Present
                        } else {
                            MiscConfigState::Missing
                        }
                    })
                    .map_err(AppError::from)
            });
            let (state, error) = match state {
                Ok(state) => (state, None),
                Err(error) => (
                    MiscConfigState::Error,
                    Some(error.at_path(&path).diagnostic()),
                ),
            };
            Ok(MiscConfigEntry {
                kind: *kind,
                path: path.to_string_lossy().into_owned(),
                rel_path: definition::misc_config_path(*kind).into(),
                state,
                error,
            })
        })
        .collect()
}
pub fn query_misc_config_file(
    root: &str,
    kind: MiscConfigKind,
) -> AppResult<Option<MiscConfigFile>> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let path = target(root, kind)?;
    if !path.try_exists()? {
        return Ok(None);
    }
    let (version, source) = io::read_versioned_json(&path)?;
    let data = source.content.to_json()?;
    validate_misc_config(kind, &data).map_err(|error| error.at_path(&path))?;
    Ok(Some(MiscConfigFile {
        composition: Default::default(),
        kind,
        path: path.to_string_lossy().into_owned(),
        rel_path: definition::misc_config_path(kind).into(),
        data,
        document: JsonFileContent::from(&source),
        base_versions: vec![version],
    }))
}
pub fn query_project_misc_config(input: &MiscConfigRead) -> AppResult<Option<MiscConfigFile>> {
    let mut file = query_misc_config_file(&input.mod_root, input.kind)?;
    if let Some(file) = &mut file {
        file.composition = query_json_composition(&input.session_id, &file.rel_path)?;
    }
    Ok(file)
}
pub fn prepare_misc_save(input: &mut MiscConfigWrite, edits: &[SaveEdit]) -> AppResult<()> {
    if edits.is_empty() {
        return Ok(());
    }
    let path = target(&input.mod_root, input.kind)?;
    if !path.is_file() {
        return Ok(());
    }
    let (version, source) = io::read_versioned_json(&path)?;
    input.document =
        save_edits::prepare_json_write(Arc::new(source), edits, input.document.layout)?;
    input.base_versions = vec![version];
    Ok(())
}
pub fn write_misc_request(input: &MiscConfigWrite) -> AppResult<WriteResult<Value>> {
    save_misc_config(input, None)
}
pub fn save_misc_config(
    input: &MiscConfigWrite,
    _core: Option<&Path>,
) -> AppResult<WriteResult<Value>> {
    let path = target(&input.mod_root, input.kind)?;
    require_version(&path, &input.base_versions)?;
    let source = if path.is_file() {
        Some(io::read_json_file(&path)?)
    } else {
        None
    };
    let data = input.document.content.to_json()?;
    validate_misc_config(input.kind, &data).map_err(|error| error.at_path(&path))?;
    let relative = definition::misc_config_path(input.kind);
    let mut layers = query_json_composition(&input.session_id, relative)?;
    layers.replace |= input.json_write.replaces(relative);
    let effective = json_composition::compose_game_json(&layers, &data)?;
    schema::validate_field(
        config_schema(input.kind),
        &effective,
        relative,
        !layers.layers.is_empty() || layers.replace,
    )?;
    if input.kind == MiscConfigKind::Sounds {
        validate_sound_indices(&effective)?;
    }
    let mut builder = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    let actual = io::stage_json_document(&mut builder, relative, source.as_ref(), &input.document)?;
    stage_replace_paths(&mut builder, &input.json_write)?;
    let target = WriteContentTarget::Json {
        origin: JsonDocumentOrigin::MiscConfig { file: input.kind },
    };
    Ok(WriteResult::from_content(
        builder.apply()?,
        target,
        serde_json::to_value(JsonFileContent::from(&actual))?,
    ))
}
pub fn delete_misc_config(
    root: &str,
    kind: MiscConfigKind,
    versions: &[FileVersion],
) -> AppResult<WriteResult> {
    require_version(&target(root, kind)?, versions)?;
    let mut builder = FileChangeSetBuilder::new(Path::new(root))?;
    builder.text_file(definition::misc_config_path(kind), None)?;
    Ok(WriteResult::from_changes(builder.apply()?))
}
fn validate_sound_indices(data: &Value) -> AppResult<()> {
    let rule = ScalarRule {
        kind: ScalarKind::Integer,
        minimum: Some(0.0),
        maximum: None,
    };
    for (name, group) in data.as_object().expect("validated sound object") {
        if name == "music" || !group.is_object() {
            continue;
        }
        let length = group["sounds"].as_array().expect("sound sample list").len();
        for (key, value) in group.as_object().expect("sound group") {
            if key == "sounds" {
                continue;
            }
            if let Some(indices) = value["sounds"].as_array() {
                for index in indices {
                    let input = index
                        .as_str()
                        .map(str::to_owned)
                        .unwrap_or_else(|| index.to_string());
                    let prepared = rule.prepare(&input)?;
                    if let FileValue::Integer(index) = prepared.value
                        && index as usize >= length
                    {
                        return Err(AppError::message(
                            "config.shape_invalid",
                            format!("音频索引超出 sounds 列表范围：{name}/{key}/sounds"),
                        ));
                    }
                }
            }
        }
    }
    Ok(())
}
