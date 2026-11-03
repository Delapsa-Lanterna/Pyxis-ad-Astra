use crate::errors::{AppError, AppResult};
use crate::io::{
    FsRootBoundary, ensure_file_appendable, path_belongs_to_root, validate_safe_absolute_path,
};
use crate::models::LOG_FILE;
use std::fs;
use std::path::{Path, PathBuf};

pub(crate) fn prepare_log_directory(
    app_data_dir: &Path,
    directory: &str,
    workspace_roots: &[PathBuf],
) -> AppResult<PathBuf> {
    let requested = check_log_directory_boundary(app_data_dir, directory, workspace_roots)?;
    fs::create_dir_all(&requested).map_err(|error| {
        AppError::context(
            format!("创建日志目录失败 ({})", requested.display()),
            error.into(),
        )
    })?;
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical, workspace_roots)?;
    ensure_file_appendable(&canonical.join(LOG_FILE))?;
    Ok(canonical)
}

pub(crate) fn resolve_existing_log_directory(
    app_data_dir: &Path,
    directory: &str,
    workspace_roots: &[PathBuf],
) -> AppResult<PathBuf> {
    let requested = check_log_directory_boundary(app_data_dir, directory, workspace_roots)?;
    if !requested.is_dir() {
        return Err(AppError::message(
            "log.dir_unavailable",
            format!(
                "configured log directory is unavailable: {}",
                requested.display()
            ),
        ));
    }
    let canonical = FsRootBoundary::new(&requested, "log directory")?
        .root()
        .to_path_buf();
    reject_log_directory_boundary(app_data_dir, &canonical, workspace_roots)?;
    Ok(canonical)
}

fn check_log_directory_boundary(
    app_data_dir: &Path,
    directory: &str,
    workspace_roots: &[PathBuf],
) -> AppResult<PathBuf> {
    let requested = Path::new(directory);
    validate_safe_absolute_path(requested, "log directory")?;
    if requested
        .file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case(LOG_FILE))
    {
        return Err(AppError::message(
            "log.dir_is_log_file",
            format!("log directory must not include the log file name: {directory}"),
        ));
    }
    let existing_parent = requested
        .ancestors()
        .find(|candidate| candidate.exists())
        .ok_or_else(|| {
            AppError::message(
                "log.dir_no_existing_parent",
                format!("log directory has no existing parent: {directory}"),
            )
        })?;
    let parent_boundary = FsRootBoundary::new(existing_parent, "log directory")?;
    let suffix = requested.strip_prefix(existing_parent).map_err(|error| {
        AppError::message(
            "path.relative_failed",
            format!(
                "log directory cannot be related to existing parent ({}): {error}",
                requested.display()
            ),
        )
    })?;
    let canonical = parent_boundary.root().join(suffix);
    reject_log_directory_boundary(app_data_dir, &canonical, workspace_roots)?;
    Ok(requested.to_path_buf())
}

fn reject_log_directory_boundary(
    app_data_dir: &Path,
    canonical: &Path,
    workspace_roots: &[PathBuf],
) -> AppResult<()> {
    let app_data = FsRootBoundary::new(app_data_dir, "app data directory")?
        .root()
        .to_path_buf();
    if path_belongs_to_root(canonical, &app_data) {
        return Err(AppError::message(
            "log.dir_inside_app_data",
            format!(
                "custom log directory must not be inside app data: {}",
                canonical.display()
            ),
        ));
    }
    if canonical
        .ancestors()
        .any(|ancestor| ancestor.join("mod_info.json").is_file())
    {
        return Err(AppError::message(
            "log.dir_inside_mod",
            format!(
                "log directory must not be inside a Mod: {}",
                canonical.display()
            ),
        ));
    }
    for root in workspace_roots {
        if path_belongs_to_root(canonical, root) {
            return Err(AppError::message(
                "log.dir_inside_workspace",
                format!(
                    "log directory must not be inside a workspace directory: {}",
                    canonical.display()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::TestWorkspace;

    #[test]
    fn custom_log_directory_is_created_and_canonicalized() {
        let app_data = TestWorkspace::new("log_directory_create");
        let requested = app_data.outer().join("custom_logs");
        let canonical =
            prepare_log_directory(&app_data, &requested.to_string_lossy(), &[]).unwrap();
        assert_eq!(canonical, requested.canonicalize().unwrap());
        assert!(canonical.join(LOG_FILE).is_file());
        assert_eq!(
            resolve_existing_log_directory(&app_data, &requested.to_string_lossy(), &[]).unwrap(),
            canonical
        );
        app_data.close().unwrap();
    }

    #[test]
    fn custom_log_directory_rejects_mod_and_app_data_locations() {
        let app_data = TestWorkspace::new("log_directory_boundaries");
        let mod_root = app_data.outer().join("mod");
        fs::create_dir(&mod_root).unwrap();
        fs::write(mod_root.join("mod_info.json"), "{}").unwrap();
        for (directory, code) in [
            (mod_root.join("logs"), "log.dir_inside_mod"),
            (app_data.join("logs"), "log.dir_inside_app_data"),
        ] {
            assert_eq!(
                prepare_log_directory(&app_data, &directory.to_string_lossy(), &[])
                    .unwrap_err()
                    .code(),
                code
            );
            assert!(!directory.exists());
        }
        app_data.close().unwrap();
    }

    #[test]
    fn configured_custom_log_directory_does_not_recreate_a_missing_directory() {
        let app_data = TestWorkspace::new("log_directory_removed");
        let requested = app_data.outer().join("custom_logs");
        let canonical =
            prepare_log_directory(&app_data, &requested.to_string_lossy(), &[]).unwrap();
        fs::remove_dir_all(&canonical).unwrap();
        assert_eq!(
            resolve_existing_log_directory(&app_data, &canonical.to_string_lossy(), &[])
                .unwrap_err()
                .code(),
            "log.dir_unavailable"
        );
        assert!(!requested.exists());
        app_data.close().unwrap();
    }

    #[test]
    fn custom_log_directory_rejects_a_complete_log_file_path() {
        let app_data = TestWorkspace::new("log_directory_file");
        let requested = app_data.outer().join(LOG_FILE);
        assert_eq!(
            prepare_log_directory(&app_data, &requested.to_string_lossy(), &[])
                .unwrap_err()
                .code(),
            "log.dir_is_log_file"
        );
        assert!(!requested.exists());
        app_data.close().unwrap();
    }

    #[test]
    fn directory_checks_consume_captured_workspace_roots() {
        let app_data = TestWorkspace::new("log_directory_captured_roots");
        let tracked = app_data.outer().join("tracked");
        let unrelated = app_data.outer().join("unrelated");
        fs::create_dir(&tracked).unwrap();
        fs::create_dir(&unrelated).unwrap();
        let roots = vec![tracked.canonicalize().unwrap()];
        let requested = tracked.join("future/logs");
        assert_eq!(
            prepare_log_directory(&app_data, &requested.to_string_lossy(), &roots)
                .unwrap_err()
                .code(),
            "log.dir_inside_workspace"
        );
        assert!(!tracked.join("future").exists());
        fs::create_dir_all(&requested).unwrap();
        assert_eq!(
            resolve_existing_log_directory(&app_data, &requested.to_string_lossy(), &roots)
                .unwrap_err()
                .code(),
            "log.dir_inside_workspace"
        );
        assert_eq!(
            prepare_log_directory(&app_data, &unrelated.to_string_lossy(), &roots).unwrap(),
            unrelated.canonicalize().unwrap()
        );
        app_data.close().unwrap();
    }
}
