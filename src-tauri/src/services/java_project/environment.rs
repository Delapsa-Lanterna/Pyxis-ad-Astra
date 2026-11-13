use crate::errors::AppResult;
use crate::services::{app_settings, project};
use std::path::Path;

pub fn automatic_java_path(session: Option<&str>, game: Option<&str>) -> AppResult<Option<String>> {
    let root = if let Some(session) = session {
        project::current_project_manifest(session)?.starsector_root
    } else {
        project::resolve_core_root(app_settings::starsector_root()?.as_deref(), game, None)?
            .map(|path| path.to_string_lossy().into_owned())
    };
    Ok(root.map(|root| {
        Path::new(&root)
            .join("jre/bin/java.exe")
            .to_string_lossy()
            .replace('\\', "/")
    }))
}

pub fn selected_java_path(session: &str) -> AppResult<Option<String>> {
    Ok(app_settings::java_executable()?.or(automatic_java_path(Some(session), None)?))
}
