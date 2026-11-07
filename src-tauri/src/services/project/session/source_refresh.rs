use super::{
    current_project_manifest, lock_ready_session, lock_registry, registered_manifests,
    session_handle, source_versions,
};
use crate::errors::{AppError, AppResult};
use crate::io::FsRootBoundary;
use crate::models::{
    CommittedSessionUpdate, EntityEditTarget, FileVersion, InvalidatedResourceScope,
    ResourceSource, SessionContentUpdate, WriteResult,
};
use crate::services::project::invalidation;
use crate::services::project::sources::core;
use crate::{io, models};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::Arc;

/// Refreshes authorized sources while retaining session and CSV row identities.
#[cfg(test)]
pub fn refresh_project_sources(
    session_id: &str,
    sources: Vec<InvalidatedResourceScope>,
) -> AppResult<SessionContentUpdate> {
    let mut result = refresh_root_sources(session_id, sources)?;
    Ok((*result
        .session_updates
        .remove(
            result
                .session_updates
                .iter()
                .position(|update| update.session_id == session_id)
                .expect("refreshed session"),
        )
        .content)
        .clone())
}

pub(crate) fn refresh_root_sources(
    session_id: &str,
    sources: Vec<InvalidatedResourceScope>,
) -> AppResult<WriteResult<()>> {
    let manifest = current_project_manifest(session_id)?;
    let manifests = registered_manifests(&manifest.mod_root, ResourceSource::Mod)?;
    let boundary = FsRootBoundary::new(Path::new(&manifest.mod_root), "mod root")?;
    let ids = manifests
        .iter()
        .map(|manifest| manifest.session_id.clone())
        .collect::<Vec<_>>();
    let paths = sources
        .iter()
        .filter(|source| source.source == ResourceSource::Mod)
        .map(|source| {
            boundary
                .resolve_relative(&source.rel_path, "refresh source")
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect::<AppResult<Vec<_>>>()?;
    if sources
        .iter()
        .any(|source| source.source == ResourceSource::Reference)
    {
        return Err(AppError::message(
            "reference.refresh_owner",
            "请在来源 Mod 中刷新引用内容",
        ));
    }
    let core_sources = sources
        .into_iter()
        .filter(|source| source.source == ResourceSource::Core)
        .collect::<Vec<_>>();
    if !core_sources.is_empty() {
        core::invalidate_core_sources(
            manifest.starsector_root.as_deref().ok_or_else(|| {
                AppError::message("resource.core_root_required", "Core root required")
            })?,
            &core_sources,
        )?;
    }
    refresh_candidates(&manifest.mod_root, &ids, &paths, false, &core_sources)
}

pub(crate) fn loaded_source_targets(session_id: &str) -> AppResult<Vec<EntityEditTarget>> {
    Ok(lock_ready_session(&session_handle(session_id)?)?
        .loaded_edit_targets
        .clone())
}
pub(crate) fn refresh_core_session(
    session_id: &str,
    sources: &[InvalidatedResourceScope],
) -> AppResult<SessionContentUpdate> {
    let handle = session_handle(session_id)?;
    let root = lock_ready_session(&handle)?.manifest.mod_root.clone();
    let result = refresh_candidates(&root, &[session_id.to_string()], &[], false, sources)?;
    Ok((*result
        .session_updates
        .into_iter()
        .next()
        .expect("refreshed Core session")
        .content)
        .clone())
}
pub(crate) fn refresh_mod_root_sources(
    root: &str,
    ids: &[String],
    paths: &[String],
    rescan: bool,
) -> AppResult<WriteResult<()>> {
    refresh_candidates(root, ids, paths, rescan, &[])
}

fn refresh_candidates(
    root: &str,
    ids: &[String],
    paths: &[String],
    rescan: bool,
    core_sources: &[InvalidatedResourceScope],
) -> AppResult<WriteResult<()>> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let handles = lock_registry()?
        .values()
        .filter(|handle| ids.contains(&handle.session_id))
        .cloned()
        .collect::<Vec<_>>();
    let mut result = WriteResult::from_changes(Vec::new());
    let Some(first) = handles.first() else {
        return Ok(result);
    };
    let first = lock_ready_session(first)?;
    let mut reader = source_versions::source_reader_for_session(&first)?;
    drop(first);
    let versions = handles
        .iter()
        .map(|handle| Ok(lock_ready_session(handle)?.source_versions.clone()))
        .collect::<AppResult<Vec<_>>>()?;
    let boundary = FsRootBoundary::new(Path::new(root), "source root")?;
    let mut requested = paths.to_vec();
    if rescan {
        requested.extend(
            ["mod_info.json", "data", "graphics"]
                .map(|path| Path::new(root).join(path).to_string_lossy().into_owned()),
        );
        requested.extend(
            versions
                .iter()
                .flat_map(|versions| versions.iter())
                .filter(|(key, _)| {
                    !["mod_info.json", "data", "graphics"]
                        .iter()
                        .any(|scope| io::relative_path_contains(scope, key))
                })
                .map(|(_, version)| version.path.clone()),
        );
    }
    let mut relative = requested
        .iter()
        .map(|path| boundary.resolve_changed_path_to_relative(path, "source change"))
        .collect::<AppResult<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    relative.sort_by_cached_key(|path| Path::new(&models::windows_path_key(path)).to_path_buf());
    relative.dedup_by(|left, right| {
        io::relative_path_contains(
            &models::windows_path_key(right),
            &models::windows_path_key(left),
        )
    });
    let mut scopes: Vec<InvalidatedResourceScope> = Vec::new();
    for relative in relative {
        let scope_count = scopes.len();
        let path = boundary.root().join(&relative);
        let directory = path.is_dir();
        // The first graphics rescan also covers removals before any image baseline existed.
        if rescan
            && relative == "graphics"
            && versions
                .iter()
                .any(|versions| !versions.contains_key(&relative))
        {
            scopes.push(InvalidatedResourceScope {
                source: ResourceSource::Mod,
                rel_path: relative.clone(),
            });
        }
        // Compare retained missing paths together with the files currently on disk.
        let changed = |key: &str, version: &FileVersion| {
            versions.iter().any(|versions| {
                let known = versions.get(key);
                (!rescan && known.is_none())
                    || known.and_then(|known| known.fingerprint.as_ref())
                        != version.fingerprint.as_ref()
            })
        };
        let checked = if directory {
            reader.stage_directory(&relative, changed)?
        } else {
            BTreeMap::new()
        };
        let mut files = checked.keys().cloned().collect::<Vec<_>>();
        if !path.is_file() {
            files.extend(
                versions
                    .iter()
                    .flat_map(|versions| versions.iter())
                    .filter(|(known, _)| {
                        **known != relative && io::relative_path_contains(&relative, known)
                    })
                    .map(|(_, version)| Path::new(&version.path).to_path_buf()),
            );
        }
        files.push(path.clone());
        files.sort();
        files.dedup();
        for file in &files {
            let version = match checked.get(file) {
                Some(version) => version.clone(),
                None if file.is_dir() => continue,
                None => reader.stage_version(file)?,
            };
            let key = reader.key(file);
            if changed(&key, &version) {
                scopes.push(InvalidatedResourceScope {
                    source: ResourceSource::Mod,
                    rel_path: key,
                });
            } else {
                reader.discard_staged_bytes(&key);
            }
        }
        if directory {
            let version = reader.directory_version(&path)?;
            let changed = versions.iter().any(|versions| {
                versions
                    .get(&relative)
                    .and_then(|known| known.fingerprint.as_ref())
                    != version.fingerprint.as_ref()
            });
            reader.versions.insert(relative.clone(), version);
            if !rescan && files.len() == 1 && scopes.len() == scope_count && changed {
                scopes.push(InvalidatedResourceScope {
                    source: ResourceSource::Mod,
                    rel_path: relative,
                });
            }
        }
    }
    if scopes.is_empty() && core_sources.is_empty() {
        return Ok(result);
    }
    let staged = reader.versions.clone();
    reader.invalidate_paths(
        &scopes
            .iter()
            .map(|scope| scope.rel_path.as_str())
            .collect::<Vec<_>>(),
    );
    // Preserve staged missing-file versions as well as retained file bytes.
    reader.versions.extend(staged);
    scopes.extend_from_slice(core_sources);
    let mut candidates = handles
        .iter()
        .map(|handle| Ok(lock_ready_session(handle)?.clone()))
        .collect::<AppResult<Vec<_>>>()?;
    for candidate in &mut candidates {
        let update = invalidation::refresh_sources_from(candidate, &scopes, &mut reader)?;
        result.invalidation.merge(update.clone());
        result.session_updates.push(CommittedSessionUpdate {
            session_id: candidate.manifest.session_id.clone(),
            mod_root: root.into(),
            content: Arc::new(SessionContentUpdate {
                manifest: candidate.manifest.clone(),
                invalidation: update,
            }),
        });
    }
    // Every candidate is complete before any same-root session publishes its next formal content.
    for (handle, candidate) in handles.iter().zip(candidates) {
        *lock_ready_session(handle)? = candidate;
    }
    reader.flush();
    Ok(result)
}
