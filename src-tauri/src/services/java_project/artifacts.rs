use super::{JavaProject, unavailable};
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::java_project::JavaArtifact;
use crate::models::java_project::JavaProjectSettings;
use crate::models::windows_path_key;
use crate::services::system_open;
use serde_json::json;
use std::fs;
use std::path::Path;

pub(super) fn primary_jar(settings: &JavaProjectSettings, game_jars: &[String]) -> Option<String> {
    settings
        .primary_jar
        .clone()
        .or_else(|| (game_jars.len() == 1).then(|| game_jars[0].clone()))
}
pub(super) fn deploy_targets(settings: &JavaProjectSettings, game_jars: &[String]) -> Vec<String> {
    let mut targets = Vec::new();
    for path in game_jars.iter().chain(settings.primary_jar.iter()) {
        if !targets
            .iter()
            .any(|target: &String| windows_path_key(target) == windows_path_key(path))
        {
            targets.push(path.clone());
        }
    }
    targets
}
pub(super) fn artifact(entry: &JavaProject, id: &str) -> AppResult<JavaArtifact> {
    let artifact = entry
        .state
        .lock()
        .map_err(unavailable)?
        .stored
        .build
        .as_ref()
        .and_then(|build| build.artifacts.iter().find(|item| item.id == id))
        .cloned()
        .ok_or_else(|| AppError::message("java_project.artifact", "构建产物已变化，请重新选择"))?;
    if io::file_version(Path::new(&artifact.path))?
        .fingerprint
        .as_ref()
        != Some(&artifact.fingerprint)
    {
        return Err(AppError::message(
            "java_project.artifact_changed",
            "产物已被修改，请重新构建或选择",
        ));
    }
    Ok(artifact)
}
pub(super) fn locate(entry: &JavaProject, id: &str) -> AppResult<()> {
    system_open::open_path(Path::new(&artifact(entry, id)?.path))
}
pub(super) fn release(entry: &JavaProject, id: &str) -> AppResult<()> {
    let directory = entry
        .file
        .parent()
        .expect("project configuration directory")
        .join(format!("build-{id}"));
    if directory.is_dir()
        && let Err(error) = fs::remove_dir_all(&directory)
    {
        diagnostics::fault(
            "java_project.artifact_cleanup_failed",
            error,
            json!({"sessionId":entry.session,"artifactId":id,"path":directory}),
        );
    }
    Ok(())
}
