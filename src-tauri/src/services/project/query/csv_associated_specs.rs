use super::entity_targets::describe_entity_target;
use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, read_versioned_bytes},
    models::*,
};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

type FileReads = BTreeMap<String, (FileVersion, Result<Value, String>)>;
#[cfg(test)]
#[path = "csv_associated_specs_tests.rs"]
mod tests;

fn read_file(location: &EntityFileLocation, reads: &mut FileReads) -> AppResult<()> {
    if reads.contains_key(&windows_path_key(&location.path)) {
        return Ok(());
    }
    let boundary = FsRootBoundary::new(Path::new(&location.root), "associated source")?;
    let path = boundary.resolve_relative_target(&location.rel_path, "associated file")?;
    let (version, value) = if path.exists() {
        let (version, bytes) = read_versioned_bytes(&path)?;
        let value = crate::io::decode_text(&path, &bytes)
            .and_then(|text| {
                #[cfg(test)]
                crate::test_support::work_counts::record("parse", &path);
                crate::parsers::parse_starsector_json(&text)
            })
            .map_err(|error| error.to_string());
        (version, value)
    } else {
        (crate::io::file_version(&path)?, Err("文件不存在".into()))
    };
    reads.insert(windows_path_key(&location.path), (version, value));
    Ok(())
}

fn file(
    location: EntityFileLocation,
    id: &str,
    field: &str,
    reads: &mut FileReads,
) -> AppResult<AssociatedSpecFile> {
    read_file(&location, reads)?;
    let (version, value) = &reads[&windows_path_key(&location.path)];
    let problem = match value {
        Ok(value)
            if value.is_object()
                && crate::models::file_content_id(value, field, Path::new(&location.path))
                    == id =>
        {
            None
        }
        Ok(_) => Some(format!("文件内容或 ID 与 {id} 不符")),
        Err(problem) => Some(problem.clone()),
    };
    Ok(AssociatedSpecFile {
        location,
        version: version.clone(),
        problem,
    })
}

pub fn prepare_csv_associated_specs(
    session_id: &str,
    table: CsvTableKey,
    changes: &[AssociatedSpecChange],
) -> AppResult<Vec<AssociatedSpecPreparation>> {
    let handle = super::super::session::session_handle(session_id)?;
    let mut session = super::super::session::lock_ready_session(&handle)?;
    let definition = crate::domain::entity_definitions::associated_spec_definition(table)
        .ok_or_else(|| AppError::message("table.no_associated_spec", "该表没有关联规格"))?;
    let root = session.manifest.mod_root.clone();
    let mut reads = FileReads::new();
    let mut local = BTreeMap::new();
    let known: BTreeMap<_, _> = session
        .spec_records(definition.entity_kind)
        .expect("associated format")
        .values()
        .map(|record| (windows_path_key(&record.location.path), record.id.clone()))
        .collect();
    let mut sources = super::super::sources::SourceReader::for_projection(Path::new(&root))?;
    for path in sources.files(definition.dir)?.into_iter().filter(|path| {
        path.extension().and_then(|ext| ext.to_str()) == Some(definition.extension_without_dot())
    }) {
        let location = EntityFileLocation {
            root: root.clone(),
            rel_path: sources.key(&path),
            path: path.to_string_lossy().into(),
            source: ResourceSource::Mod,
            reference: None,
        };
        let id = if let Some(id) = known.get(&windows_path_key(&location.path)) {
            Some(id.clone())
        } else {
            read_file(&location, &mut reads)?;
            reads[&windows_path_key(&location.path)]
                .1
                .as_ref()
                .ok()
                .filter(|value| value.is_object())
                .map(|value| crate::models::file_content_id(value, definition.id_field, &path))
        };
        if let Some(id) = id {
            local.insert(id, location);
        }
    }
    let core = if changes.iter().any(|change| match change {
        AssociatedSpecChange::Rename { previous_id, .. } => {
            !local.contains_key(previous_id)
                && !session
                    .spec_records(definition.entity_kind)
                    .expect("associated format")
                    .contains_key(previous_id)
                && session
                    .reference_spec(definition.entity_kind, previous_id)
                    .is_none()
        }
        _ => false,
    }) {
        session
            .manifest
            .starsector_root
            .as_ref()
            .map(|game| {
                let root = super::super::sources::core::core_dir(game)?;
                let mut reader = super::super::sources::SourceReader::new(&root)?;
                let records = super::super::sources::documents::load_spec_records_from(
                    &mut reader,
                    definition.dir,
                    definition.extension_without_dot(),
                    definition.id_field,
                    ResourceSource::Core,
                )?;
                for record in records.values() {
                    reads.insert(
                        windows_path_key(&record.location.path),
                        (
                            reader.versions[&record.location.rel_path].clone(),
                            Ok(record.data.clone()),
                        ),
                    );
                }
                Ok::<_, AppError>(records)
            })
            .transpose()?
            .unwrap_or_default()
    } else {
        BTreeMap::new()
    };
    changes
        .iter()
        .map(|change| {
            let id = match change {
                AssociatedSpecChange::Rename { previous_id, .. } => previous_id,
                _ => change.id(),
            };
            let info = describe_entity_target(&mut session, definition.entity_kind, id)?;
            let target = info.target;
            let original = if matches!(change, AssociatedSpecChange::Rename { .. }) {
                let fallback = EntityFileLocation {
                    path: Path::new(&root)
                        .join(definition.default_rel_path(id))
                        .to_string_lossy()
                        .into(),
                    root: root.clone(),
                    rel_path: definition.default_rel_path(id),
                    source: ResourceSource::Mod,
                    reference: None,
                };
                local
                    .get(id)
                    .cloned()
                    .or_else(|| target.source.clone())
                    .or_else(|| core.get(id).map(|record| record.location.clone()))
                    .or(Some(fallback))
                    .map(|location| file(location, id, definition.id_field, &mut reads))
                    .transpose()?
            } else {
                None
            };
            let relative = if let Some(source) = &original {
                if source.location.source == ResourceSource::Mod {
                    crate::io::forward_slash_path(
                        &Path::new(&source.location.rel_path).with_file_name(format!(
                            "{}{}",
                            change.id(),
                            definition.extension
                        )),
                    )
                } else {
                    definition.default_rel_path(change.id())
                }
            } else {
                definition.default_rel_path(change.id())
            };
            let destination =
                local
                    .get(change.id())
                    .cloned()
                    .unwrap_or_else(|| EntityFileLocation {
                        path: Path::new(&root).join(&relative).to_string_lossy().into(),
                        root: root.clone(),
                        rel_path: relative,
                        source: ResourceSource::Mod,
                        reference: None,
                    });
            let destination = file(destination, change.id(), definition.id_field, &mut reads)?;
            let mut base_versions = info.base_versions;
            for file in original
                .iter()
                .filter(|file| file.location.source == ResourceSource::Mod)
                .chain(std::iter::once(&destination))
            {
                base_versions.retain(|version| {
                    windows_path_key(&version.path) != windows_path_key(&file.version.path)
                });
                base_versions.push(file.version.clone());
            }
            Ok(AssociatedSpecPreparation {
                target,
                base_versions,
                original,
                destination,
            })
        })
        .collect()
}

pub(in crate::services::project) fn verify_file(file: &AssociatedSpecFile) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(&file.location.root), "associated source")?;
    let path = boundary.resolve_relative_target(&file.location.rel_path, "associated file")?;
    if !crate::io::same_physical_path(&path, Path::new(&file.location.path))
        || !crate::io::same_physical_path(&path, Path::new(&file.version.path))
    {
        return Err(AppError::message(
            "spec.target_changed",
            "关联文件路径已变化",
        ));
    }
    crate::io::verify_versions(&file.location.root, std::slice::from_ref(&file.version))
}
