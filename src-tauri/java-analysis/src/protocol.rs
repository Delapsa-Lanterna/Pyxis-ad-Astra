//! Java analysis requests and results; all locations belong to one analysis revision.
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::BTreeMap;

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
    EditorUpdate {
        id: Value,
        project: String,
        expected_revision: u64,
        documents: Vec<DocumentEdit>,
    },
    Inspect {
        id: Value,
        project: String,
        revision: u64,
        file: String,
        offset: u32,
        purpose: String,
    },
    Shutdown {
        id: Value,
    },
    Assist {
        id: Value,
        project: String,
        revision: u64,
        file: String,
        offset: u32,
        purpose: String,
        name: Option<String>,
        #[serde(default)]
        choices: BTreeMap<String, String>,
    },
}

impl AnalysisRequest {
    pub fn operation(&self) -> &'static str {
        match self {
            Self::Hello { .. } => "hello",
            Self::Parse { .. } => "parse",
            Self::Open { .. } => "open",
            Self::Update { .. } => "update",
            Self::Configure { .. } => "configure",
            Self::Analyze { .. } => "analyze",
            Self::Query { .. } => "query",
            Self::Close { .. } => "close",
            Self::EditorUpdate { .. } => "editorUpdate",
            Self::Inspect { .. } => "inspect",
            Self::Shutdown { .. } => "shutdown",
            Self::Assist { .. } => "assist",
        }
    }

    pub fn id(&self) -> &Value {
        match self {
            Self::Hello { id }
            | Self::Parse { id, .. }
            | Self::Open { id, .. }
            | Self::Update { id, .. }
            | Self::Configure { id, .. }
            | Self::Analyze { id, .. }
            | Self::Query { id, .. }
            | Self::Close { id, .. }
            | Self::EditorUpdate { id, .. }
            | Self::Inspect { id, .. }
            | Self::Shutdown { id }
            | Self::Assist { id, .. } => id,
        }
    }

    pub fn project(&self) -> Option<&str> {
        match self {
            Self::Open { project, .. }
            | Self::Update { project, .. }
            | Self::Configure { project, .. }
            | Self::Analyze { project, .. }
            | Self::Query { project, .. }
            | Self::Close { project, .. }
            | Self::EditorUpdate { project, .. }
            | Self::Inspect { project, .. }
            | Self::Assist { project, .. } => Some(project),
            _ => None,
        }
    }

    pub fn context(&self) -> Value {
        let mut context =
            json!({"operation":self.operation(),"project":self.project(),"requestId":self.id()});
        match self {
            Self::Inspect { file, purpose, .. } | Self::Assist { file, purpose, .. } => {
                context["path"] = json!(file);
                context["purpose"] = json!(purpose);
            }
            Self::Parse { source, .. } => context["sourceBytes"] = json!(source.len()),
            Self::EditorUpdate { documents, .. } => {
                context["files"] = json!(documents.len());
                context["sourceBytes"] = json!(
                    documents
                        .iter()
                        .map(|file| file.source.as_ref().map_or(0, String::len)
                            + file.edits.iter().map(|edit| edit.text.len()).sum::<usize>())
                        .sum::<usize>()
                );
            }
            Self::Open {
                sources, classpath, ..
            }
            | Self::Configure {
                classpath,
                sources: Some(sources),
                ..
            } => {
                context["sourceRoots"] = json!(sources.len());
                context["jars"] = json!(classpath.len());
            }
            _ => {}
        }
        context
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentEdit {
    pub file: String,
    pub previous_file: Option<String>,
    pub version: u64,
    pub source: Option<String>,
    #[serde(default)]
    pub edits: Vec<TextEdit>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TextEdit {
    pub from: u32,
    pub to: u32,
    pub text: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Inspection {
    pub purpose: String,
    pub project: String,
    pub revision: u64,
    pub file: String,
    pub version: u64,
    pub source: Option<String>,
    pub binding: Option<Binding>,
    pub origin: Option<String>,
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
    #[serde(default)]
    pub outline: Vec<OutlineEntry>,
    #[serde(default)]
    pub locations: Vec<SourceLocation>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct OutlineEntry {
    pub name: String,
    pub kind: String,
    pub depth: u32,
    pub range: SourceRange,
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
#[serde(untagged)]
pub enum AnalysisResult {
    Assistance(Box<Assistance>),
    Inspection(Box<Inspection>),
    Hello(Handshake),
    Syntax(SyntaxResult),
    Query(Box<QueryResult>),
    Analysis(AnalysisSummary),
    Project(ProjectSnapshot),
    Released(ProjectRelease),
    Shutdown(ShutdownResult),
}

impl AnalysisResult {
    pub(crate) fn accepts(&self, operation: &str) -> bool {
        matches!(
            (self, operation),
            (Self::Hello(_), "hello")
                | (Self::Syntax(_), "parse")
                | (Self::Query(_), "query")
                | (Self::Analysis(_), "analyze")
                | (Self::Project(_), "open" | "update" | "configure")
                | (Self::Released(_), "close")
                | (Self::Shutdown(_), "shutdown")
                | (Self::Inspection(_), "inspect")
                | (Self::Assistance(_), "assist")
                | (Self::Project(_), "editorUpdate")
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Handshake {
    pub protocol: u32,
    pub engine: String,
    pub java: u32,
    pub workspace: String,
    pub pid: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assistance {
    pub assistance: bool,
    pub purpose: String,
    pub project: String,
    pub revision: u64,
    pub file: String,
    pub version: u64,
    #[serde(default)]
    pub candidates: Vec<Completion>,
    #[serde(default)]
    pub files: Vec<SourceEdit>,
    #[serde(default)]
    pub choices: Vec<ImportChoice>,
    #[serde(default)]
    pub conflicts: Vec<String>,
    pub argument: u32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Completion {
    pub label: String,
    pub text: String,
    pub detail: String,
    pub from: u32,
    pub to: u32,
    pub relevance: i32,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceEdit {
    pub file: String,
    pub version: u64,
    pub source: String,
    pub target: Option<String>,
    pub edits: Vec<TextEdit>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ImportChoice {
    pub name: String,
    pub candidates: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceRange {
    pub start: i32,
    pub end: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Diagnostic {
    pub id: i32,
    pub message: String,
    pub severity: String,
    pub start: i32,
    pub end: i32,
    pub line: i32,
    pub file: Option<String>,
    pub version: Option<u64>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SyntaxNode {
    pub id: u32,
    pub parent: i32,
    pub kind: String,
    pub start: i32,
    pub end: i32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SyntaxResult {
    pub version: u64,
    pub errors: u32,
    pub diagnostics: Vec<Diagnostic>,
    pub nodes: Vec<SyntaxNode>,
    pub comments: Vec<SourceRange>,
}

/// The value domain of a Java compilation constant.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ConstantValue {
    Boolean(bool),
    Integer(i64),
    Decimal(f64),
    Text(String),
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Binding {
    pub key: Option<String>,
    pub name: String,
    pub recovered: bool,
    pub kind: i32,
    pub modifiers: i32,
    pub owner: Option<String>,
    #[serde(rename = "type")]
    pub type_name: Option<String>,
    pub constructor: Option<bool>,
    pub parameters: Option<Vec<String>>,
    pub constant: Option<ConstantValue>,
    pub binary: Option<bool>,
    pub superclass: Option<String>,
    pub interfaces: Option<Vec<String>>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Argument {
    pub start: i32,
    pub end: i32,
    pub text: String,
    pub binding: Option<Binding>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SemanticNode {
    pub start: i32,
    pub end: i32,
    pub kind: String,
    pub binding: Option<Binding>,
    #[serde(rename = "type")]
    pub resolved_type: Option<Binding>,
    pub constant: Option<ConstantValue>,
    pub arguments: Vec<Argument>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SourceLocation {
    pub file: String,
    pub version: u64,
    pub range: SourceRange,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct QueryResult {
    pub project: String,
    pub revision: u64,
    pub version: u64,
    pub file: String,
    pub node: SemanticNode,
    pub call: Option<SemanticNode>,
    pub declarations: Vec<SourceLocation>,
    pub references: Vec<SourceLocation>,
    #[serde(flatten)]
    pub statistics: AnalysisStatistics,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct AnalysisStatistics {
    pub analysis_milliseconds: f64,
    pub reparsed_files: u32,
    pub invalidated_files: u32,
    pub incremental: bool,
    pub full_fallback_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub project: String,
    pub revision: u64,
    pub files: u32,
    pub parse_batches: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct BindingFailure {
    pub file: String,
    pub range: SourceRange,
    pub kind: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSummary {
    #[serde(flatten)]
    pub statistics: AnalysisStatistics,
    pub project: String,
    pub revision: u64,
    pub files: u32,
    pub errors: u32,
    pub diagnostics: Vec<Diagnostic>,
    pub binding_failures: Vec<BindingFailure>,
    pub parse_batches: u32,
    pub reference_index_builds: u32,
    pub heap_used_bytes: u64,
    pub heap_committed_bytes: u64,
    #[serde(default)]
    pub method: u32,
    #[serde(default)]
    pub method_resolved: u32,
    #[serde(default)]
    pub constructor: u32,
    #[serde(default)]
    pub constructor_resolved: u32,
    #[serde(default)]
    pub enum_constructor: u32,
    #[serde(default)]
    pub enum_constructor_resolved: u32,
    #[serde(default)]
    pub method_reference: u32,
    #[serde(default)]
    pub method_reference_resolved: u32,
    #[serde(default)]
    pub unresolved: u32,
    #[serde(default)]
    pub recovered: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProjectRelease {
    pub project: String,
    pub released: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ShutdownResult {
    pub closing: bool,
}

#[cfg(test)]
mod protocol_tests {
    use super::AnalysisResponse;
    use super::AnalysisResult;
    use super::{AnalysisRequest, FileChange, FileChangeAction};
    use serde_json::{Value, json};

    #[test]
    fn metadata_matches_the_wire_without_copying_source_into_diagnostics() {
        for value in [
            json!({"op":"hello","id":7}),
            json!({"op":"parse","id":7,"source":"private source","version":1}),
            json!({"op":"open","id":7,"project":"sample","sources":[],"classpath":[],"javaHome":"J:/runtime"}),
            json!({"op":"update","id":7,"project":"sample","expectedRevision":1,"files":[]}),
            json!({"op":"configure","id":7,"project":"sample","expectedRevision":1,"classpath":[],"javaHome":"J:/runtime","language":"17"}),
            json!({"op":"analyze","id":7,"project":"sample"}),
            json!({"op":"query","id":7,"project":"sample","revision":1,"file":"Sample.java","offset":0}),
            json!({"op":"inspect","id":7,"project":"sample","revision":1,"file":"Sample.java","offset":0,"purpose":"document"}),
            json!({"op":"assist","id":7,"project":"sample","revision":1,"file":"Sample.java","offset":0,"purpose":"complete"}),
            json!({"op":"editorUpdate","id":7,"project":"sample","expectedRevision":1,"documents":[{"file":"Sample.java","version":2,"source":"private source","edits":[]}]}),
            json!({"op":"close","id":7,"project":"sample"}),
            json!({"op":"shutdown","id":7}),
        ] {
            let request: AnalysisRequest = serde_json::from_value(value.clone()).unwrap();
            assert_eq!(request.operation(), value["op"].as_str().unwrap());
            assert_eq!(request.id(), &value["id"]);
            assert_eq!(request.project(), value["project"].as_str());
            assert!(!request.context().to_string().contains("private source"));
        }
    }

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
