use super::{
    current_project_manifest, lock_ready_session, lock_registry, registered_manifests,
    session_handle, source_versions,
};
use crate::errors::{AppError, AppResult};
use crate::io::FsRootBoundary;
use crate::models::{
    CommittedSessionUpdate, EntityEditTarget, InvalidatedResourceScope, ResourceSource,
    SessionContentUpdate, WriteResult,
};
use crate::services::project::invalidation;
use crate::services::project::sources::core;
use crate::{io, models};
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
    let mut candidates = handles
        .iter()
        .map(|handle| Ok(lock_ready_session(handle)?.clone()))
        .collect::<AppResult<Vec<_>>>()?;
    let mut result = WriteResult::from_changes(Vec::new());
    let Some(first) = candidates.first() else {
        return Ok(result);
    };
    let boundary = FsRootBoundary::new(Path::new(root), "source root")?;
    let mut reader = source_versions::source_reader_for_session(first)?;
    let mut requested = paths.to_vec();
    if rescan {
        requested.extend(
            ["mod_info.json", "data", "graphics"]
                .map(|path| Path::new(root).join(path).to_string_lossy().into_owned()),
        );
        requested.extend(candidates.iter().flat_map(|candidate| {
            candidate
                .source_versions
                .values()
                .map(|version| version.path.clone())
        }));
    }
    let mut relative = requested
        .iter()
        .map(|path| boundary.resolve_changed_path_to_relative(path, "source change"))
        .collect::<AppResult<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect::<Vec<_>>();
    relative.sort_by_cached_key(|path| models::windows_path_key(path));
    relative
        .dedup_by(|left, right| models::windows_path_key(left) == models::windows_path_key(right));
    let mut scopes: Vec<InvalidatedResourceScope> = Vec::new();
    for relative in relative {
        if scopes
            .last()
            .is_some_and(|parent| io::relative_path_contains(&parent.rel_path, &relative))
        {
            continue;
        }
        let path = boundary.resolve_relative(&relative, "source change")?;
        let directory = path.is_dir();
        let changed = rescan || directory || {
            let version = reader.stage_version(&path)?;
            candidates.iter().any(|candidate| {
                (!path.exists()
                    && candidate.source_versions.keys().any(|known| {
                        known != &relative && io::relative_path_contains(&relative, known)
                    }))
                    || candidate
                        .source_versions
                        .get(&relative)
                        .and_then(|version| version.fingerprint.as_ref())
                        != version.fingerprint.as_ref()
            })
        };
        if changed {
            if directory {
                reader.files(&relative)?;
            }
            scopes.push(InvalidatedResourceScope {
                source: ResourceSource::Mod,
                rel_path: relative,
            });
        }
    }
    if scopes.is_empty() && core_sources.is_empty() {
        return Ok(result);
    }
    reader.invalidate_paths(
        &scopes
            .iter()
            .map(|scope| scope.rel_path.as_str())
            .collect::<Vec<_>>(),
    );
    scopes.extend_from_slice(core_sources);
    for candidate in &mut candidates {
        let mut update = invalidation::refresh_sources_from(candidate, &scopes, &mut reader)?;
        update.session |= !core_sources.is_empty();
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
