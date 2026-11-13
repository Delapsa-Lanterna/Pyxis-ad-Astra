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
    let files = WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            !entry.file_type().is_dir()
                || ![
                    "build", ".gradle", ".git", "src", "data", "graphics", "sounds", "jars",
                ]
                .contains(&entry.file_name().to_string_lossy().as_ref())
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| AppError::message("java_project.directory", error.to_string()))?;
    Ok(files
        .into_iter()
        .filter(|entry| entry.file_type().is_file())
        .filter(|entry| {
            let name = entry.file_name().to_string_lossy();
            name.ends_with(".gradle")
                || name.ends_with(".gradle.kts")
                || name.ends_with(".properties")
                || name.ends_with(".toml")
                || name == "gradlew.bat"
                || name == "gradle-wrapper.jar"
        })
        .map(|entry| io::forward_slash_path(entry.path()))
        .collect())
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
