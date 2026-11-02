use crate::errors::AppResult;
use crate::io::FsRootBoundary;
use crate::models::{ProjectManifest, SessionModScope};
use crate::services::project::{
    PerformanceTrace, configure_persistent_index_cache, open_project_session_traced,
};
use crate::services::{app_settings, project};
use crate::{app_data_dir, diagnostics};
use serde_json::json;
use std::path::Path;
use tauri::AppHandle;

pub fn open_project_session_with_root(
    app_handle: AppHandle,
    mod_root: String,
    starsector_root: Option<String>,
) -> AppResult<ProjectManifest> {
    if let Ok(app_data_dir) = app_data_dir::data_directory(app_handle.clone())
        && let Err(error) = configure_persistent_index_cache(&app_data_dir)
    {
        diagnostics::failure(
            "cache.index_configuration_failed",
            error,
            json!({"modRoot":mod_root,"directory":app_data_dir}),
        );
    }
    let mut trace = PerformanceTrace::new("project.openSession");
    let mod_root_boundary = FsRootBoundary::new(Path::new(&mod_root), "mod root")?;
    let mod_root_path = mod_root_boundary.root();
    let starsector_root = project::resolve_core_root(
        app_settings::starsector_root()?.as_deref(),
        starsector_root.as_deref(),
        Some(mod_root_path),
    )?;
    open_project_session_traced(mod_root_path, starsector_root.as_deref(), &mut trace)
}

pub fn ensure_session_mod_scope(scope: &impl SessionModScope) -> AppResult<()> {
    if let Some(session_id) = scope.session_id() {
        project::ensure_project_session_mod_root(session_id, scope.mod_root())?;
    }
    Ok(())
}
