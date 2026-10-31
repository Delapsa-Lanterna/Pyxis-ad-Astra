use crate::{
    app_data_dir,
    errors::AppResult,
    io::FsRootBoundary,
    models::ProjectManifest,
    services::project::{
        PerformanceTrace, configure_persistent_index_cache, open_project_session_traced,
    },
};
use std::path::Path;
pub fn open_project_session_with_root(
    app_handle: tauri::AppHandle,
    mod_root: String,
    starsector_root: Option<String>,
) -> AppResult<ProjectManifest> {
    if let Ok(app_data_dir) = app_data_dir::data_directory(app_handle.clone())
        && let Err(error) = configure_persistent_index_cache(&app_data_dir)
    {
        crate::diagnostics::record(format!("persistent index cache configure failed: {error}"));
    }
    let mut trace = PerformanceTrace::new("project.openSession");
    let mod_root_boundary = FsRootBoundary::new(Path::new(&mod_root), "mod root")?;
    let mod_root_path = mod_root_boundary.root();
    let starsector_root = super::project::resolve_core_root(
        super::app_settings::starsector_root()?.as_deref(),
        starsector_root.as_deref(),
        Some(mod_root_path),
    )?;
    open_project_session_traced(mod_root_path, starsector_root.as_deref(), &mut trace)
}

pub fn release_project_session(session_id: String) -> AppResult<()> {
    let revision = super::project::reference_revision();
    super::project::close_project_session(session_id.clone())?;
    if revision != super::project::reference_revision() {
        let delivery = super::project::reference_sources().and_then(|snapshot| {
            super::project_sync::publish_references(snapshot, super::project::reference_updates()?)
        });
        if let Err(error) = delivery {
            crate::diagnostics::record(format!("reference close delivery: {error}"));
        }
    }
    super::windows::release_session(&session_id)
}

pub fn ensure_session_mod_scope(scope: &impl crate::models::SessionModScope) -> AppResult<()> {
    if let Some(session_id) = scope.session_id() {
        super::project::ensure_project_session_mod_root(session_id, scope.mod_root())?;
    }
    Ok(())
}
