use super::file_value::{Error, Text, Value};
use serde::{Deserialize, Serialize};
use std::ops::Range;
use std::sync::Arc;

#[derive(Debug)]
pub struct ReadFailure {
    pub text: String,
    pub error: Error,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Member {
    pub key: Text,
    pub key_span: Range<usize>,
    pub value: usize,
    pub separator: Option<Range<usize>>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum Kind {
    Scalar,
    Object(Vec<Member>),
    Array {
        elements: Vec<usize>,
        separators: Vec<Range<usize>>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Node {
    pub span: Range<usize>,
    pub kind: Kind,
}

#[derive(Clone, Debug)]
pub struct JsonDocument {
    pub source: Arc<str>,
    pub value: Value,
    pub nodes: Vec<Node>,
    pub root: usize,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecordKind {
    Data,
    Comment,
    Blank,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Record {
    pub kind: RecordKind,
    pub cells: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CsvContent {
    pub header: Vec<String>,
    pub records: Vec<Record>,
}
#[derive(Clone, Debug)]
pub struct RecordLayout {
    pub span: Range<usize>,
    pub cells: Vec<Range<usize>>,
}
#[derive(Clone, Debug)]
pub struct CsvDocument {
    pub source: Arc<str>,
    pub content: CsvContent,
    pub header: Range<usize>,
    pub records: Vec<RecordLayout>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonSource {
    pub text: Arc<str>,
    pub content: Value,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SaveLayout {
    PreserveStructure,
    Expanded,
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    #[default]
    Value,
    Integer,
    Float,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", content = "items", rename_all = "camelCase")]
pub enum ChildFormats {
    Object(Vec<(Text, JsonTarget)>),
    Array(Vec<JsonTarget>),
}

/// Source paths identify spelling; the accompanying complete value owns the data.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonTarget {
    pub source: Option<Vec<Text>>,
    pub output: OutputFormat,
    pub children: Option<ChildFormats>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonWrite {
    pub content: Value,
    pub target: JsonTarget,
    pub layout: SaveLayout,
}

/// The wire product carries exact typed data and the source that defines its format.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonFileContent {
    pub content: Value,
    pub source: String,
    pub original: JsonOriginalFormat,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct JsonOriginalFormat {
    pub root: usize,
    pub nodes: Vec<Node>,
}

#[derive(Clone, Debug)]
pub struct CsvSource {
    pub document: CsvDocument,
}

#[derive(Clone, Debug)]
pub struct CsvWrite {
    pub content: CsvContent,
    pub origins: Vec<Option<usize>>,
    pub columns: Vec<Option<usize>>,
    pub layout: SaveLayout,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PreparedValue {
    pub value: Value,
    pub target: JsonTarget,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum DraftEdit {
    Replace {
        path: Vec<Text>,
        value: PreparedValue,
    },
    ArraySplice {
        path: Vec<Text>,
        index: usize,
        delete: usize,
        insert: Vec<PreparedValue>,
    },
    ObjectSplice {
        path: Vec<Text>,
        index: usize,
        delete: usize,
        insert: Vec<(Text, PreparedValue)>,
    },
    Reorder {
        path: Vec<Text>,
        order: Vec<usize>,
    },
}
