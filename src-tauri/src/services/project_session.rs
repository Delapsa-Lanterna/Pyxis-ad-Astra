use crate::errors::AppResult;
use crate::io::FsRootBoundary;
use crate::models::SessionModScope;
use crate::services::project::configure_persistent_index_cache;
use crate::services::{app_settings, project};
use crate::{app_data_dir, diagnostics};
use serde_json::json;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

pub fn resolve_project_session_roots(
    app_handle: &AppHandle,
    mod_root: &str,
    starsector_root: Option<&str>,
) -> AppResult<(PathBuf, Option<PathBuf>)> {
    if let Ok(app_data_dir) = app_data_dir::data_directory(app_handle)
        && let Err(error) = configure_persistent_index_cache(&app_data_dir)
    {
        diagnostics::failure(
            "cache.index_configuration_failed",
            error,
            json!({"modRoot":mod_root,"directory":app_data_dir}),
        );
    }
    let mod_root_boundary = FsRootBoundary::new(Path::new(&mod_root), "mod root")?;
    let mod_root_path = mod_root_boundary.root();
    let starsector_root = project::resolve_core_root(
        app_settings::starsector_root()?.as_deref(),
        starsector_root,
        Some(mod_root_path),
    )?;
    Ok((mod_root_path.to_path_buf(), starsector_root))
}

pub fn ensure_session_mod_scope(scope: &impl SessionModScope) -> AppResult<()> {
    if let Some(session_id) = scope.session_id() {
        project::ensure_project_session_mod_root(session_id, scope.mod_root())?;
    }
    Ok(())
}
