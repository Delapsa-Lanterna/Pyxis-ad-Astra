use crate::protocol::AnalysisResult;
use reqwest::Error as HttpError;
use serde::{Deserialize, Serialize};
use serde_json::Error as JsonError;
use serde_json::Value;
use std::io::Error as IoError;
use std::result::Result as StdResult;
use zip::result::ZipError;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Java component operation cancelled")]
    Cancelled,
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error(transparent)]
    Json(#[from] JsonError),
    #[error(transparent)]
    Http(#[from] HttpError),
    #[error(transparent)]
    Zip(#[from] ZipError),
}
pub type Result<T> = StdResult<T, Error>;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "op", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum AnalysisRequest {
    Hello {
        id: Value,
    },
    Parse {
        id: Value,
        source: String,
        version: u64,
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
    },
    Open {
        id: Value,
        project: String,
        sources: Vec<String>,
        classpath: Vec<String>,
        java_home: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        language: Option<String>,
    },
    Update {
        id: Value,
        project: String,
        expected_revision: u64,
        files: Vec<FileChange>,
    },
    Configure {
        id: Value,
        project: String,
        expected_revision: u64,
        classpath: Vec<String>,
        java_home: String,
        language: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        sources: Option<Vec<String>>,
    },
    Analyze {
        id: Value,
        project: String,
        #[serde(default)]
        force_full: bool,
    },
    Query {
        id: Value,
        project: String,
        revision: u64,
        file: String,
        offset: u32,
    },
    Close {
        id: Value,
        project: String,
    },
    Shutdown {
        id: Value,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub action: FileChangeAction,
    pub file: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeAction {
    Add,
    Replace,
    Delete,
    Move,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResponse {
    pub id: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<AnalysisResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AnalysisError>,
    #[serde(default)]
    pub queue_wait_milliseconds: f64,
    #[serde(default)]
    pub request_milliseconds: f64,
    #[serde(default)]
    pub response_bytes: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisError {
    pub code: String,
    #[serde(rename = "type")]
    pub error_type: String,
    pub message: String,
    pub project: Option<String>,
    pub file: Option<String>,
    pub offset: Option<i32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Package {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub bytes: u64,
    pub sha256: String,
    pub artifacts: Vec<Artifact>,
    pub bundles: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Artifact {
    pub path: String,
    pub url: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PackageFile {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub bundles: Vec<String>,
    pub files: Vec<PackageFile>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Builtin {
    pub version: String,
    pub protocol: u32,
    pub java: u32,
    pub launcher: String,
    pub bundle: String,
    pub framework: String,
    pub dependencies: Manifest,
    pub files: Vec<PackageFile>,
}

impl Package {
    pub(crate) fn manifest(&self) -> Manifest {
        Manifest {
            version: self.version.clone(),
            protocol: self.protocol,
            java: self.java,
            bundles: self.bundles.clone(),
            files: self
                .artifacts
                .iter()
                .map(|file| PackageFile {
                    path: file.path.clone(),
                    bytes: file.bytes,
                    sha256: file.sha256.clone(),
                })
                .collect(),
        }
    }
}

#[cfg(test)]
mod protocol_tests {
    use super::AnalysisResponse;
    use super::{AnalysisRequest, FileChange, FileChangeAction};
    use crate::protocol::AnalysisResult;
    use serde_json::{Value, json};

    #[test]
    fn response_preserves_project_locations_and_error_context() {
        let response: AnalysisResponse = serde_json::from_value(json!({"id":"probe","result":{"project":"orbit","revision":3,"files":0,"parseBatches":2}})).unwrap();
        let Some(AnalysisResult::Project(project)) = response.result else {
            panic!("project snapshot");
        };
        assert_eq!(project.project, "orbit");
        assert_eq!(project.revision, 3);
        let error: AnalysisResponse = serde_json::from_value(json!({"id":7,"error":{"code":"engine.stale_document","type":"java.lang.IllegalArgumentException","message":"Document version must increase","project":"orbit","file":"Orbit.java","offset":5}})).unwrap();
        let error = error.error.unwrap();
        assert_eq!(error.code, "engine.stale_document");
        assert_eq!(error.file.as_deref(), Some("Orbit.java"));
        assert_eq!(error.offset, Some(5));
    }

    #[test]
    fn typed_file_change_uses_the_versioned_wire_contract() {
        let request = AnalysisRequest::Update {
            id: json!(7),
            project: "orbit".into(),
            expected_revision: 4,
            files: vec![FileChange {
                action: FileChangeAction::Move,
                file: "src/Orbit.java".into(),
                target: Some("src/ships/Orbit.java".into()),
                source: Some("class Orbit {}".into()),
                version: Some(3),
            }],
        };
        let wire: Value = serde_json::to_value(request).unwrap();
        assert_eq!(wire["op"], "update");
        assert_eq!(wire["expectedRevision"], 4);
        assert_eq!(wire["files"][0]["target"], "src/ships/Orbit.java");
        assert!(wire["files"][0].get("source").is_some());
        let delete = FileChange {
            action: FileChangeAction::Delete,
            file: "src/Orbit.java".into(),
            target: None,
            source: None,
            version: Some(4),
        };
        let wire = serde_json::to_value(delete).unwrap();
        assert!(wire.get("target").is_none());
        assert!(wire.get("source").is_none());
    }
}
