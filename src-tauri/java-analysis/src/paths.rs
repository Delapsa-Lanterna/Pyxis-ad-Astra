use crate::{Result, invalid};
use serde::Serialize;
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPaths {
    pub root: PathBuf,
    pub dependencies: PathBuf,
    pub workspaces: PathBuf,
    pub logs: PathBuf,
}

impl AnalysisPaths {
    pub fn new(config_root: &Path) -> Self {
        let root = config_root.join("java-analysis");
        Self {
            dependencies: root.join("dependencies"),
            workspaces: root.join("workspaces"),
            logs: root.join("logs"),
            root,
        }
    }
}

pub fn java_path(path: &Path) -> PathBuf {
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(unc) = value.strip_prefix("\\\\?\\UNC\\") {
            return PathBuf::from(format!("\\\\{unc}"));
        }
        if let Some(drive) = value.strip_prefix("\\\\?\\") {
            return PathBuf::from(drive);
        }
    }
    path.to_path_buf()
}

pub(crate) fn relative(value: &str) -> Result<PathBuf> {
    let path = Path::new(value);
    if value.is_empty()
        || value.contains(['\\', ':'])
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
    {
        return Err(invalid(format!("Invalid package path: {value}")));
    }
    Ok(path.to_path_buf())
}
