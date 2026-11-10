use crate::domain::entity_definitions;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::file_content::JsonSource;
use crate::models::file_value::Value;
use crate::models::{
    AssociatedSpecChange, AssociatedSpecFile, AssociatedSpecPreparation, CsvTableKey,
    EntityFileLocation, FileVersion, ResourceSource, windows_path_key,
};
use crate::parsers::game;
use crate::services::project::query::entity_targets::describe_entity_target;
use crate::services::project::session::{lock_ready_session, session_handle};
use crate::services::project::sources::{SourceReader, core, documents};
#[cfg(test)]
use crate::test_support::work_counts;
use std::collections::BTreeMap;
use std::iter;
use std::path::Path;
use std::slice;
use std::sync::Arc;

#[cfg(test)]
#[path = "associated_spec_preparation_tests.rs"]
mod tests;
type Reads = BTreeMap<String, (FileVersion, Result<Arc<JsonSource>, String>)>;
fn identifier(source: &JsonSource, field: &str, path: &Path) -> String {
    source
        .content
        .get(field)
        .and_then(|value| {
            if let Value::Text(value) = value {
                value.as_str()
            } else {
                None
            }
        })
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            path.file_stem()
                .expect("file name")
                .to_string_lossy()
                .into_owned()
        })
}
fn read_once(location: &EntityFileLocation, reads: &mut Reads) -> AppResult<()> {
    let key = windows_path_key(&location.path);
    if reads.contains_key(&key) {
        return Ok(());
    }
    let path = FsRootBoundary::new(Path::new(&location.root), "associated root")?
        .resolve_relative_target(&location.rel_path, "associated file")?;
    let record = if path.exists() {
        let (version, bytes) = io::read_versioned_bytes(&path)?;
        #[cfg(test)]
        work_counts::record("parse", &path);
        (
            version,
            game::read_json(&bytes)
                .map(Arc::new)
                .map_err(|error| error.error.to_string()),
        )
    } else {
        (io::file_version(&path)?, Err("文件不存在".into()))
    };
    reads.insert(key, record);
    Ok(())
}
fn describe(
    location: EntityFileLocation,
    id: &str,
    field: &str,
    reads: &mut Reads,
) -> AppResult<AssociatedSpecFile> {
    read_once(&location, reads)?;
    let (version, source) = &reads[&windows_path_key(&location.path)];
    let problem = match source {
        Ok(source) if identifier(source, field, Path::new(&location.path)) == id => None,
        Ok(_) => Some(format!("文件内容 ID 与 {id} 不符")),
        Err(error) => Some(error.clone()),
    };
    Ok(AssociatedSpecFile {
        location,
        version: version.clone(),
        problem,
    })
}
fn location(root: &str, relative: String) -> EntityFileLocation {
    EntityFileLocation {
        reference: None,
        source: ResourceSource::Mod,
        path: Path::new(root)
            .join(&relative)
            .to_string_lossy()
            .into_owned(),
        root: root.into(),
        rel_path: relative,
    }
}
pub fn prepare_csv_associated_specs(
    session_id: &str,
    table: CsvTableKey,
    changes: &[AssociatedSpecChange],
) -> AppResult<Vec<AssociatedSpecPreparation>> {
    let definition = entity_definitions::associated_spec_definition(table)
        .ok_or_else(|| AppError::message("table.no_associated_spec", "该表没有关联规格"))?;
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let root = session.manifest.mod_root.clone();
    let mut reader = SourceReader::for_session(Path::new(&root))?;
    let known = session
        .spec_records(definition.entity_kind)
        .expect("associated records")
        .values()
        .map(|record| (windows_path_key(&record.location.path), record.id.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut reads = Reads::new();
    let mut local = BTreeMap::new();
    for directory in definition.source_dirs() {
        for path in reader.files(directory)?.into_iter().filter(|path| {
            path.extension().and_then(|v| v.to_str()) == Some(definition.extension_without_dot())
        }) {
            let file = location(&root, reader.key(&path));
            let id = if let Some(id) = known.get(&windows_path_key(&file.path)) {
                Some(id.clone())
            } else {
                read_once(&file, &mut reads)?;
                reads[&windows_path_key(&file.path)]
                    .1
                    .as_ref()
                    .ok()
                    .map(|source| identifier(source, definition.id_field, &path))
            };
            if let Some(id) = id {
                local.insert(id, file);
            }
        }
    }
    let needs_core = changes.iter().any(|change| match change {
        AssociatedSpecChange::Rename { previous_id, .. } => {
            !local.contains_key(previous_id)
                && !session
                    .spec_records(definition.entity_kind)
                    .expect("associated records")
                    .contains_key(previous_id)
                && session
                    .reference_spec(definition.entity_kind, previous_id)
                    .is_none()
        }
        _ => false,
    });
    let mut core_records = BTreeMap::new();
    if needs_core && let Some(game) = &session.manifest.starsector_root {
        let root = core::core_dir(game)?;
        let mut reader = SourceReader::new(&root)?;
        core_records = documents::load_spec_records_from(
            &mut reader,
            definition.source_dirs(),
            definition.extension_without_dot(),
            definition.id_field,
            ResourceSource::Core,
        )?;
        for record in core_records.values() {
            reads.insert(
                windows_path_key(&record.location.path),
                (
                    reader.versions[&record.location.rel_path].clone(),
                    Ok(record.document.clone()),
                ),
            );
        }
    }
    changes
        .iter()
        .map(|change| {
            let id = match change {
                AssociatedSpecChange::Rename { previous_id, .. } => previous_id,
                _ => change.id(),
            };
            let info = describe_entity_target(&mut session, definition.entity_kind, id)?;
            let original = if matches!(change, AssociatedSpecChange::Rename { .. }) {
                let original = local
                    .get(id)
                    .cloned()
                    .or_else(|| info.target.source.clone())
                    .or_else(|| core_records.get(id).map(|record| record.location.clone()))
                    .unwrap_or_else(|| location(&root, definition.default_rel_path(id)));
                Some(describe(original, id, definition.id_field, &mut reads)?)
            } else {
                None
            };
            let relative = original
                .as_ref()
                .filter(|source| source.location.source == ResourceSource::Mod)
                .map(|source| {
                    io::forward_slash_path(
                        &Path::new(&source.location.rel_path).with_file_name(format!(
                            "{}{}",
                            change.id(),
                            definition.extension
                        )),
                    )
                })
                .unwrap_or_else(|| definition.default_rel_path(change.id()));
            let destination = local
                .get(change.id())
                .cloned()
                .unwrap_or_else(|| location(&root, relative));
            let destination = describe(destination, change.id(), definition.id_field, &mut reads)?;
            let mut versions = info.base_versions;
            for file in original
                .iter()
                .filter(|file| file.location.source == ResourceSource::Mod)
                .chain(iter::once(&destination))
            {
                versions.retain(|version| {
                    windows_path_key(&version.path) != windows_path_key(&file.version.path)
                });
                versions.push(file.version.clone());
            }
            Ok(AssociatedSpecPreparation {
                target: info.target,
                base_versions: versions,
                original,
                destination,
            })
        })
        .collect()
}
pub(in crate::services::project) fn verify_associated_spec_file(
    file: &AssociatedSpecFile,
) -> AppResult<()> {
    let path = FsRootBoundary::new(Path::new(&file.location.root), "associated source")?
        .resolve_relative_target(&file.location.rel_path, "associated file")?;
    if !io::same_physical_path(&path, Path::new(&file.location.path))
        || !io::same_physical_path(&path, Path::new(&file.version.path))
    {
        return Err(AppError::message(
            "spec.target_changed",
            "关联文件路径已变化",
        ));
    }
    io::verify_versions(&file.location.root, slice::from_ref(&file.version))
}
