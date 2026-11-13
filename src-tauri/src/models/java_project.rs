use crate::errors::{ErrorDiagnostic, ErrorLocation};
use crate::models::{FileVersion, SessionModScope};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JavaProjectSettings {
    pub build_mode: JavaBuildMode,
    pub sources: Option<Vec<String>>,
    pub libraries: Vec<String>,
    pub primary_jar: Option<String>,
    pub gradle: Option<String>,
    pub project: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JavaBuildMode {
    #[default]
    Manual,
    Gradle,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradleProject {
    pub path: String,
    pub sources: Vec<String>,
    pub resources: Vec<String>,
    pub libraries: Vec<String>,
    pub artifacts: Vec<String>,
    pub target: String,
    pub build_file: String,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradleModel {
    pub tasks: Vec<GradleTask>,
    pub outputs: Vec<String>,
    pub java_home: String,
    pub projects: Vec<GradleProject>,
    pub inputs_changed: bool,
    pub input_files: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaProjectSnapshot {
    pub revision: u64,
    pub mod_root: String,
    pub version: String,
    pub mode: String,
    pub settings: JavaProjectSettings,
    pub sources: Vec<String>,
    pub libraries: Vec<String>,
    pub game_jars: Vec<String>,
    pub artifacts: Vec<String>,
    pub tasks: Vec<GradleTask>,
    pub choices: Vec<String>,
    pub selected_project: Option<String>,
    pub source_count: usize,
    pub missing: Vec<String>,
    pub java_path: Option<String>,
    pub gradle: Option<JavaGradleInstallation>,
    pub gradle_error: Option<ErrorDiagnostic>,
    pub target: String,
    pub build_files: Vec<String>,
    pub stale: bool,
    pub configuration: String,
    pub primary_jar: Option<String>,
    pub deploy_targets: Vec<String>,
    pub active: bool,
    #[serde(flatten)]
    pub task_result: JavaTaskResult,
    pub configuration_error: Option<ErrorDiagnostic>,
    pub output: String,
    pub locations: Vec<ErrorLocation>,
    pub build: Option<JavaBuildResult>,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum JavaGradleSource {
    Wrapper,
    Selected,
    System,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaGradleInstallation {
    pub path: String,
    pub source: JavaGradleSource,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum JavaTaskPhase {
    #[default]
    Idle,
    Running,
    Succeeded,
    Cancelled,
    Failed,
    OfflineFailed,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JavaProjectOperation {
    Sync {
        online: bool,
    },
    Detect,
    Build {
        tasks: Vec<String>,
        arguments: Vec<String>,
        online: bool,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GradleTask {
    pub path: String,
    pub group: Option<String>,
    pub description: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaArtifact {
    pub id: String,
    pub path: String,
    pub bytes: u64,
    pub fingerprint: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaBuildResult {
    pub mode: JavaBuildMode,
    pub id: String,
    pub task: String,
    pub artifacts: Vec<JavaArtifact>,
    pub inputs_changed: bool,
    pub milliseconds: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDeploy {
    pub session_id: String,
    pub mod_root: String,
    pub artifact: String,
    pub target: String,
    pub base_versions: Vec<FileVersion>,
}
impl SessionModScope for JavaDeploy {
    fn session_id(&self) -> Option<&String> {
        Some(&self.session_id)
    }
    fn mod_root(&self) -> &str {
        &self.mod_root
    }
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaDeployPreview {
    pub source: JavaArtifact,
    pub request: JavaDeploy,
    pub target_bytes: u64,
    pub exists: bool,
}

#[derive(Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JavaProjectAction {
    Read,
    Refresh,
    Save {
        settings: JavaProjectSettings,
    },
    Sync {
        online: bool,
    },
    Detect,
    Cancel,
    Build {
        tasks: Vec<String>,
        arguments: Vec<String>,
        online: bool,
        configuration: String,
    },
    Locate {
        artifact: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaTaskResult {
    pub task_mode: JavaBuildMode,
    pub phase: JavaTaskPhase,
    pub operation: Option<JavaProjectOperation>,
    pub task_id: Option<String>,
    pub task: String,
    pub exit_code: Option<i32>,
    pub error: Option<ErrorDiagnostic>,
    pub log_path: Option<String>,
    pub milliseconds: f64,
}
