//! Java analysis requests and results; all locations belong to one analysis revision.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(untagged)]
pub enum AnalysisResult {
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
