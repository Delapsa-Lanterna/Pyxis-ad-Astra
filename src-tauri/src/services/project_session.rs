use crate::{
    errors::AppResult,
    io::FsRootBoundary,
    models::ProjectManifest,
    services::{
        app_paths,
        project::{
            PerformanceTrace, configure_persistent_index_cache, open_project_session_traced,
        },
    },
};
use std::path::Path;
pub fn open_project_session_with_root(
    app_handle: tauri::AppHandle,
    mod_root: String,
    starsector_root: Option<String>,
) -> AppResult<ProjectManifest> {
    if let Ok(app_data_dir) = app_paths::app_data_dir(app_handle.clone())
        && let Err(error) = configure_persistent_index_cache(&app_data_dir)
    {
        crate::diagnostics::record(format!("persistent index cache configure failed: {error}"));
    }
    let mut trace = PerformanceTrace::new("project.openSession");
    let mod_root_boundary = FsRootBoundary::new(Path::new(&mod_root), "mod root")?;
    let mod_root_path = mod_root_boundary.root();
    let starsector_root = match starsector_root.as_deref() {
        Some(root) => Some(
            FsRootBoundary::new(Path::new(root), "starsector root")?
                .root()
                .to_path_buf(),
        ),
        None => crate::services::directory_opening::infer_starsector_root(mod_root_path),
    };
    open_project_session_traced(mod_root_path, starsector_root.as_deref(), &mut trace)
}

pub fn release_project_session(session_id: String) -> AppResult<()> {
    super::write_transactions::release_session_commits(&session_id)?;
    super::project::close_project_session(session_id.clone())?;
    super::windows::release_session(&session_id)
}
