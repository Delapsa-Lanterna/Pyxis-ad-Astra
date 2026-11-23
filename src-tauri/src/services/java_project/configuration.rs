use super::JavaProject;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::java_project::{
    GradleModel, JavaBuildResult, JavaProjectSettings, JavaTaskResult,
};
use crate::models::{FileVersion, ProjectManifest};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::Path;
use walkdir::WalkDir;

#[derive(Clone, Default, Deserialize, Serialize)]
pub(super) struct StoredProject {
    pub settings: JavaProjectSettings,
    pub model: Option<GradleModel>,
    pub fingerprint: String,
    pub build: Option<JavaBuildResult>,
    pub build_versions: Vec<FileVersion>,
    pub build_configuration: String,
    pub last_task: Option<JavaTaskResult>,
}
pub(super) fn paths(root: &str, values: &[String]) -> AppResult<Vec<String>> {
    let boundary = FsRootBoundary::new(Path::new(root), "Java project")?;
    values
        .iter()
        .map(|value| {
            let path = Path::new(value);
            let path = if path.is_absolute() {
                boundary.resolve_absolute(path, "Project input")?
            } else {
                boundary.resolve_relative(value, "Project input")?
            };
            Ok(io::forward_slash_path(&path))
        })
        .collect()
}
pub(super) fn build_files(root: &str) -> AppResult<Vec<String>> {
    WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            entry.depth() == 0
                || !entry.file_type().is_dir()
                || !excluded_directory(&entry.file_name().to_string_lossy())
        })
        .filter_map(|entry| match entry {
            Ok(entry)
                if entry.file_type().is_file()
                    && is_build_file(&entry.file_name().to_string_lossy()) =>
            {
                Some(Ok(io::forward_slash_path(entry.path())))
            }
            Ok(_) => None,
            Err(error) => Some(Err(AppError::message(
                "java_project.directory",
                error.to_string(),
            ))),
        })
        .collect()
}
fn excluded_directory(name: &str) -> bool {
    [
        "build", ".gradle", ".git", "src", "data", "graphics", "sounds", "jars",
    ]
    .contains(&name.to_ascii_lowercase().as_str())
}
fn is_build_file(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    let name = lower.as_str();
    name.ends_with(".gradle")
        || name.ends_with(".gradle.kts")
        || name.ends_with(".properties")
        || name.ends_with(".toml")
        || name == "gradlew.bat"
        || name == "gradle-wrapper.jar"
}
pub(super) fn build_directory(relative: &Path) -> bool {
    !relative
        .iter()
        .any(|part| excluded_directory(&part.to_string_lossy()))
}
pub(super) fn build_path(relative: &Path) -> bool {
    relative
        .file_name()
        .is_some_and(|name| is_build_file(&name.to_string_lossy()))
        && relative.parent().is_none_or(build_directory)
}
pub(super) fn fingerprint(
    manifest: &ProjectManifest,
    java: &Option<String>,
    settings: &JavaProjectSettings,
    files: &[String],
) -> AppResult<String> {
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&(java, settings, &manifest.mod_info))?);
    for file in files {
        hash.update(file.as_bytes());
        hash.update(fs::read(file)?);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub(super) fn persist(entry: &JavaProject, stored: &StoredProject) -> AppResult<()> {
    fs::create_dir_all(entry.file.parent().expect("configuration file parent"))?;
    io::write_utf8_no_bom(&entry.file, &serde_json::to_string_pretty(stored)?)
}
