use super::text;
use crate::models::file_content::ReadFailure;
use crate::models::file_content::{
    ChildFormats, CsvDocument, CsvSource, CsvWrite, JsonDocument, JsonFileContent,
    JsonOriginalFormat, JsonSource, JsonTarget, JsonWrite, Kind, OutputFormat, SaveLayout,
};
use crate::models::file_value::{Error, Text, Value};
use crate::parsers::alex_csv as csv;
use crate::parsers::alex_json as json;
use crate::parsers::json_writer::{self as layout, JsonWriteSource, ResolvedFormat};
use std::collections::HashMap;
use std::sync::Arc;

struct SourceIndex<'a> {
    document: &'a JsonOriginalFormat,
    objects: HashMap<usize, HashMap<&'a Text, usize>>,
}
impl<'a> SourceIndex<'a> {
    fn new(document: &'a JsonOriginalFormat) -> Self {
        Self {
            document,
            objects: HashMap::new(),
        }
    }
    fn locate(&mut self, path: &[Text]) -> Option<usize> {
        let mut id = self.document.root;
        for part in path {
            id = match &self.document.nodes[id].kind {
                Kind::Object(members) => *self
                    .objects
                    .entry(id)
                    .or_insert_with(|| {
                        members
                            .iter()
                            .map(|member| (&member.key, member.value))
                            .collect()
                    })
                    .get(part)?,
                Kind::Array { elements, .. } => {
                    *elements.get(part.as_str()?.parse::<usize>().ok()?)?
                }
                Kind::Scalar => return None,
            };
        }
        Some(id)
    }
}

impl JsonTarget {
    pub fn source(path: Vec<Text>) -> Self {
        Self {
            source: Some(path),
            output: OutputFormat::Value,
            children: None,
        }
    }

    pub fn generated(output: OutputFormat) -> Self {
        Self {
            source: None,
            output,
            children: None,
        }
    }

    pub fn materialize(&mut self, value: &Value) {
        if self.children.is_some() {
            return;
        }
        let child = |part: Text| {
            self.source.as_ref().map_or_else(
                || Self::generated(OutputFormat::Value),
                |path| {
                    let mut path = path.clone();
                    path.push(part);
                    Self::source(path)
                },
            )
        };
        self.children = match value {
            Value::Object(fields) => Some(ChildFormats::Object(
                fields
                    .iter()
                    .map(|(key, _)| (key.clone(), child(key.clone())))
                    .collect(),
            )),
            Value::Array(items) => Some(ChildFormats::Array(
                (0..items.len())
                    .map(|index| child(Text::new(index.to_string())))
                    .collect(),
            )),
            _ => None,
        };
    }

    fn format(&self, index: &mut Option<SourceIndex<'_>>) -> Result<ResolvedFormat, Error> {
        let format = match &self.children {
            Some(ChildFormats::Object(fields)) => ResolvedFormat::Object(
                fields
                    .iter()
                    .map(|(key, child)| Ok((key.clone(), child.format(index)?)))
                    .collect::<Result<_, Error>>()?,
            ),
            Some(ChildFormats::Array(items)) => ResolvedFormat::Elements(
                items
                    .iter()
                    .map(|child| child.format(index))
                    .collect::<Result<_, _>>()?,
            ),
            None => match self.output {
                OutputFormat::Value => ResolvedFormat::Natural,
                OutputFormat::Integer => ResolvedFormat::Integer,
                OutputFormat::Float => ResolvedFormat::Float,
            },
        };
        match (&self.source, index) {
            (Some(path), Some(index)) => {
                let node = index
                    .locate(path)
                    .ok_or_else(|| Error::output("source path is absent from this document"))?;
                Ok(ResolvedFormat::Source {
                    node,
                    format: Box::new(format),
                })
            }
            _ => Ok(format),
        }
    }
}

impl From<&JsonSource> for JsonFileContent {
    fn from(source: &JsonSource) -> Self {
        let original = JsonDocument::layout_shared(&source.text)
            .expect("source already parsed with the shared grammar");
        Self {
            content: source.content.clone(),
            source: source.text.to_string(),
            original,
        }
    }
}

/// Decodes game bytes into exact JSON content and its shared source, retaining text on failure.
pub fn read_json(bytes: &[u8]) -> Result<JsonSource, ReadFailure> {
    let source: Arc<str> = Arc::from(text::decode_game(bytes).as_ref());
    let content = json::parse_shared(&source).map_err(|error| ReadFailure {
        text: source.to_string(),
        error,
    })?;
    Ok(JsonSource {
        text: source,
        content,
    })
}

impl JsonSource {
    pub fn write(&self, request: &JsonWrite) -> Result<Self, Error> {
        // Release the input layout and resolved formats before parsing the output.
        let output = {
            let original = JsonDocument::layout_shared(&self.text)?;
            let format = request
                .target
                .format(&mut Some(SourceIndex::new(&original)))?;
            let document = JsonWriteSource::new(&self.text, &self.content, &original);
            match request.layout {
                SaveLayout::PreserveStructure => {
                    layout::preserve_json(document, &request.content, &format)?
                }
                SaveLayout::Expanded => layout::expand_json(document, &request.content, &format)?,
            }
        };
        Self::accept_output(&output, &request.content)
    }

    pub fn create(request: &JsonWrite) -> Result<Self, Error> {
        let output = layout::write_json(&request.content, &request.target.format(&mut None)?)?;
        Self::accept_output(&output, &request.content)
    }

    fn accept_output(output: &str, expected: &Value) -> Result<Self, Error> {
        let actual = read_json(output.as_bytes()).map_err(|failure| failure.error)?;
        if !actual.content.same_content_order(expected) {
            return Err(Error::output(
                "generated content differs from the submitted typed content",
            ));
        }
        Ok(actual)
    }
}

/// Decodes game bytes into complete CSV content and layout, retaining text on failure.
pub fn read_csv(bytes: &[u8]) -> Result<CsvSource, ReadFailure> {
    CsvDocument::read(bytes).map(|document| CsvSource { document })
}

impl CsvSource {
    pub fn write(&self, request: &CsvWrite) -> Result<Self, Error> {
        let output = csv::write_mapped(
            &self.document,
            &request.content,
            &request.origins,
            &request.columns,
            matches!(request.layout, SaveLayout::PreserveStructure),
        )?;
        let actual = read_csv(output.as_bytes()).map_err(|failure| failure.error)?;
        if actual.document.content != request.content {
            return Err(Error::output(
                "generated CSV differs from the submitted physical records",
            ));
        }
        Ok(actual)
    }
}
