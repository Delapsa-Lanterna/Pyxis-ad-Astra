use crate::models::file_content::{JsonDocument, JsonOriginalFormat, Kind, Node};
use crate::models::file_value::{Error, Text, Value};
use itoa::Buffer;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write;
use std::ops::Range;
use zmij::Buffer as ZmijBuffer;

/// Borrows the exact source value while layout belongs to the current write.
#[derive(Clone, Copy)]
pub struct JsonWriteSource<'a> {
    source: &'a str,
    value: &'a Value,
    nodes: &'a [Node],
    root: usize,
}
impl<'a> JsonWriteSource<'a> {
    pub fn new(source: &'a str, value: &'a Value, layout: &'a JsonOriginalFormat) -> Self {
        Self {
            source,
            value,
            nodes: &layout.nodes,
            root: layout.root,
        }
    }
    fn node_values(&self) -> Vec<Option<&'a Value>> {
        let mut result = vec![None; self.nodes.len()];
        let mut stack = vec![(self.root, self.value)];
        while let Some((id, value)) = stack.pop() {
            result[id] = Some(value);
            match (&self.nodes[id].kind, value) {
                (Kind::Object(members), Value::Object(fields)) => stack.extend(
                    members
                        .iter()
                        .zip(fields)
                        .map(|(member, (_, child))| (member.value, child)),
                ),
                (Kind::Array { elements, .. }, Value::Array(values)) => {
                    stack.extend(elements.iter().copied().zip(values))
                }
                _ => {}
            }
        }
        result
    }
}
impl<'a> From<&'a JsonDocument> for JsonWriteSource<'a> {
    fn from(document: &'a JsonDocument) -> Self {
        Self {
            source: &document.source,
            value: &document.value,
            nodes: &document.nodes,
            root: document.root,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::models::file_content::{
        ChildFormats, JsonTarget, JsonWrite, OutputFormat, SaveLayout,
    };
    use crate::models::file_value::{Text, Value};
    use crate::parsers::alex_json;
    use crate::parsers::game;
    fn saved(source: &str, next: &str) -> String {
        let source = game::read_json(source.as_bytes()).unwrap();
        let request = JsonWrite {
            content: alex_json::parse(next).unwrap(),
            target: JsonTarget::source(Vec::new()),
            layout: SaveLayout::PreserveStructure,
        };
        source.write(&request).unwrap().text.to_string()
    }
    fn array_edit(source: &str, next: &str, origins: &[Option<usize>]) -> String {
        let source = game::read_json(source.as_bytes()).unwrap();
        let mut content = source.content.clone();
        content.set(
            "items",
            alex_json::parse(&format!("{{items:{next}}}"))
                .unwrap()
                .get("items")
                .unwrap()
                .clone(),
        );
        let mut target = JsonTarget::source(Vec::new());
        target.children = Some(ChildFormats::Object(vec![(
            Text::new("items"),
            JsonTarget {
                source: Some(vec![Text::new("items")]),
                output: OutputFormat::Value,
                children: Some(ChildFormats::Array(
                    origins
                        .iter()
                        .map(|origin| {
                            origin.map_or_else(
                                || JsonTarget::generated(OutputFormat::Value),
                                |index| {
                                    JsonTarget::source(vec![
                                        Text::new("items"),
                                        Text::new(index.to_string()),
                                    ])
                                },
                            )
                        })
                        .collect(),
                )),
            },
        )]));
        source
            .write(&JsonWrite {
                content,
                target,
                layout: SaveLayout::PreserveStructure,
            })
            .unwrap()
            .text
            .to_string()
    }
    #[test]
    fn root_identity_replacement_keeps_other_text_ranges() {
        let source = "{id:'before', nested:{id:'child'}, amount:.5f} # tail";
        assert_eq!(
            saved(source, "{id:'after',nested:{id:'child'},amount:.5f}"),
            "{id:\"after\", nested:{id:'child'}, amount:.5f} # tail"
        );
    }
    #[test]
    fn changes_one_value_and_keeps_comments_key_order_and_tail() {
        let source = "{\r\n  # section\r\n  z: 'before', # inline\r\n  a: 2,\r\n}\r\ntail text";
        let actual = saved(source, "{z:'after',a:2}");
        assert_eq!(actual, source.replace("'before'", "\"after\""));
    }
    #[test]
    fn semantic_noop_keeps_every_byte() {
        let source = "{z:'before', a:2,} # tail\r\n";
        assert_eq!(saved(source, "{z:'before',a:2}"), source);
    }
    #[test]
    fn appends_new_fields_in_submitted_order() {
        let actual = saved("{\n  z:1\n}\n", "{z:1,b:2,a:3}");
        assert!(actual.find("\"b\":2").unwrap() < actual.find("\"a\":3").unwrap());
        assert_eq!(
            alex_json::parse(&actual).unwrap(),
            alex_json::parse("{z:1,b:2,a:3}").unwrap()
        );
    }
    #[test]
    fn new_nested_object_uses_submitted_key_order() {
        let actual = saved("{z:1}", "{z:1,nested:{b:2,a:3}}");
        assert!(actual.contains("\"nested\":{\"b\":2,\"a\":3}"));
    }
    #[test]
    fn removes_field_and_inline_comment_but_keeps_standalone_comment() {
        let actual = saved(
            "{\n  # section\n  remove:1, # inline\n  keep:2\n}\n",
            "{keep:2}",
        );
        assert!(actual.contains("# section"));
        assert!(!actual.contains("# inline"));
        assert!(!actual.contains("remove:"));
    }
    #[test]
    fn standalone_comment_between_field_and_separator_survives_deletion() {
        let actual = saved(
            "{\n  remove:1 # inline\n  # standalone\n  ,\n  keep:2\n}",
            "{keep:2}",
        );
        assert!(actual.contains("# standalone"));
        assert!(!actual.contains("# inline"));
    }
    #[test]
    fn array_deletions_keep_only_standalone_comments_and_preserve_line_endings() {
        let actual = array_edit(
            "{ items:[\r\n  # section\r\n  'a', # inline\r\n  'b',\r\n],tail:true }",
            "[]",
            &[],
        );
        assert!(actual.contains("# section\r\n"));
        assert!(!actual.contains("# inline"));
        assert_eq!(
            actual.bytes().filter(|v| *v == b'\n').count(),
            actual.matches("\r\n").count()
        );
        assert!(actual.contains("tail:true"));
    }
    #[test]
    fn appends_first_item_to_empty_multiline_array() {
        let actual = array_edit("{\n  items:[\n  ]\n}", "[{id:'new'}]", &[None]);
        assert_eq!(actual, "{\n  items:[\n    {\"id\":\"new\"}\n  ]\n}");
    }
    #[test]
    fn array_insertions_and_deletions_preserve_retained_entry_text() {
        for (next, origins) in [
            ("['x','a','b','c']", vec![None, Some(0), Some(1), Some(2)]),
            ("['a','x','b','c']", vec![Some(0), None, Some(1), Some(2)]),
            ("['a','b','c','x']", vec![Some(0), Some(1), Some(2), None]),
            ("['b','c']", vec![Some(1), Some(2)]),
            ("['a','c']", vec![Some(0), Some(2)]),
            ("['a','b']", vec![Some(0), Some(1)]),
            ("[]", Vec::new()),
        ] {
            let actual = array_edit("{items:['a', 'b', 'c']}", next, &origins);
            for index in origins.into_iter().flatten() {
                let name = ['a', 'b', 'c'][index];
                assert!(actual.contains(&format!("'{name}'")), "{actual}");
            }
        }
    }
    #[test]
    fn reordered_items_keep_inline_comments_in_layout_slots() {
        let source = "{items:[\n  {id:'a'}, # first\n  # fixed\n  {id:'b'}\n]}";
        let actual = array_edit(source, "[{id:'b'},{id:'a'}]", &[Some(1), Some(0)]);
        assert!(actual.find("{id:'b'}").unwrap() < actual.find("# first").unwrap());
        assert!(actual.find("# fixed").unwrap() < actual.find("{id:'a'}").unwrap());
    }
    #[test]
    fn changed_nested_array_item_keeps_unmodified_fields() {
        let source = "{items:[{id:'a',slots:['A']},{id:'b',slots:['B']}],tail:true}";
        let actual = array_edit(
            source,
            "[{id:'next',slots:['A']},{id:'b',slots:['B']},{id:'c',slots:[]}]",
            &[Some(0), Some(1), None],
        );
        assert!(actual.contains("id:\"next\",slots:['A']"));
        assert!(actual.contains("id:'b',slots:['B']"));
        assert!(actual.contains("tail:true"));
        let Value::Object(_) = alex_json::parse(&actual).unwrap() else {
            panic!("saved root object")
        };
    }

    #[test]
    fn expanded_objects_keep_each_unmodified_numeric_spelling() {
        let fields = (0..1024)
            .map(|index| format!("k{index}:1e0"))
            .collect::<Vec<_>>()
            .join(",");
        let source = game::read_json(format!("{{{fields}}}").as_bytes()).unwrap();
        let mut content = source.content.clone();
        content.set("k512", Value::Integer(2));
        let actual = source
            .write(&JsonWrite {
                content,
                target: JsonTarget::source(Vec::new()),
                layout: SaveLayout::Expanded,
            })
            .unwrap();
        assert_eq!(actual.text.matches(": 1e0").count(), 1023);
        assert!(actual.text.contains("\"k512\": 2"));
        assert_eq!(actual.content.get("k511"), Some(&Value::Float(1.0)));
        assert_eq!(actual.content.get("k512"), Some(&Value::Integer(2)));
    }
}

#[derive(Clone, Debug, Default)]
pub enum ResolvedFormat {
    #[default]
    Natural,
    Integer,
    Float,
    Source {
        node: usize,
        format: Box<ResolvedFormat>,
    },
    Elements(Vec<ResolvedFormat>),
    Object(BTreeMap<Text, ResolvedFormat>),
}
impl ResolvedFormat {
    fn field(&self, key: &Text) -> &Self {
        match self {
            Self::Object(fields) => fields.get(key).unwrap_or(&Self::Natural),
            _ => &Self::Natural,
        }
    }
    fn element(&self, index: usize) -> &Self {
        match self {
            Self::Elements(values) => values.get(index).unwrap_or(&Self::Natural),
            _ => &Self::Natural,
        }
    }
}

static NEEDS_ESCAPE: [bool; 256] = {
    let mut table = [false; 256];
    let mut byte = 0;
    while byte < 32 {
        table[byte] = true;
        byte += 1;
    }
    table[b'"' as usize] = true;
    table[b'\\' as usize] = true;
    table
};

fn zero_byte(word: u64) -> bool {
    word.wrapping_sub(0x0101_0101_0101_0101) & !word & 0x8080_8080_8080_8080 != 0
}
fn escape_offset(bytes: &[u8]) -> Option<usize> {
    let (blocks, tail) = bytes.as_chunks::<8>();
    for (i, block) in blocks.iter().enumerate() {
        let word = u64::from_ne_bytes(*block);
        // A zero lane identifies a control byte, quote, or backslash.
        if zero_byte(word & 0xe0e0_e0e0_e0e0_e0e0)
            || zero_byte(word ^ 0x2222_2222_2222_2222)
            || zero_byte(word ^ 0x5c5c_5c5c_5c5c_5c5c)
        {
            return block
                .iter()
                .position(|b| NEEDS_ESCAPE[*b as usize])
                .map(|offset| i * 8 + offset);
        }
    }
    tail.iter()
        .position(|b| NEEDS_ESCAPE[*b as usize])
        .map(|offset| bytes.len() - tail.len() + offset)
}

#[inline]
pub fn quote(text: &Text, out: &mut String) {
    out.push('"');
    if let Some(s) = text.as_str() {
        let mut remaining = s;
        // Escapes are ASCII boundaries; ordinary UTF-8 is copied in complete slices.
        while let Some(i) = escape_offset(remaining.as_bytes()) {
            out.push_str(&remaining[..i]);
            let b = remaining.as_bytes()[i];
            match b {
                b'"' => out.push_str("\\u0022"),
                b'\\' => out.push_str("\\\\"),
                b'\n' => out.push_str("\\n"),
                b'\r' => out.push_str("\\r"),
                b'\t' => out.push_str("\\t"),
                8 => out.push_str("\\b"),
                12 => out.push_str("\\f"),
                b => write!(out, "\\u{b:04x}").expect("String writing is infallible"),
            }
            remaining = &remaining[i + 1..];
        }
        out.push_str(remaining);
    } else {
        for u in text.units() {
            match u {
                34 => out.push_str("\\u0022"),
                92 => out.push_str("\\\\"),
                0..=31 | 0xd800..=0xdfff => out.push_str(&format!("\\u{u:04x}")),
                u => out.push(char::from_u32(u as u32).expect("ordinary UTF-16 unit")),
            }
        }
    }
    out.push('"');
}

fn numeric(value: &Value, format: &ResolvedFormat, out: &mut String) -> Result<(), Error> {
    // The caller owns conversion policy; the format is its write instruction.
    match (value, format) {
        (Value::Integer(_), ResolvedFormat::Float) | (Value::Float(_), ResolvedFormat::Integer) => {
            return Err(Error::output(
                "numeric type differs from the caller's target format",
            ));
        }
        (Value::Integer(n), _) => out.push_str(Buffer::new().format(*n)),
        (Value::Float(n), _) => {
            if n.is_nan() {
                return Err(Error::output("NaN has no numeric game literal"));
            }
            if *n == f64::INFINITY {
                out.push_str("1e309");
            } else if *n == f64::NEG_INFINITY {
                out.push_str("-1e309");
            } else {
                let mut buffer = ZmijBuffer::new();
                let s = if *n == 0.0 {
                    "0.0"
                } else {
                    buffer.format_finite(*n)
                };
                out.push_str(s);
                if !s.contains(['.', 'e', 'E']) {
                    out.push_str(".0");
                }
            }
        }
        _ => return Err(Error::output("numeric output requires a numeric value")),
    }
    Ok(())
}
fn indentation(out: &mut String, depth: usize) {
    for _ in 0..depth {
        out.push_str("  ");
    }
}
fn generate(
    value: &Value,
    format: &ResolvedFormat,
    pretty: bool,
    depth: usize,
    out: &mut String,
) -> Result<(), Error> {
    if matches!(format, ResolvedFormat::Integer | ResolvedFormat::Float) {
        return numeric(value, format, out);
    }
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Integer(_) | Value::Float(_) => numeric(value, format, out)?,
        Value::Text(t) => quote(t, out),
        Value::Array(values) => {
            out.push('[');
            for (i, v) in values.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                if pretty {
                    out.push('\n');
                    indentation(out, depth + 1);
                }
                generate(v, format.element(i), pretty, depth + 1, out)?;
            }
            if pretty && !values.is_empty() {
                out.push('\n');
                indentation(out, depth);
            }
            out.push(']');
        }
        Value::Object(fields) => {
            out.push('{');
            for (i, (key, v)) in fields.iter().enumerate() {
                if matches!(v,Value::Float(n) if !n.is_finite()) {
                    return Err(Error::output(
                        "object member cannot contain a non-finite numeric value",
                    ));
                }
                if i > 0 {
                    out.push(',');
                }
                if pretty {
                    out.push('\n');
                    indentation(out, depth + 1);
                }
                quote(key, out);
                out.push(':');
                if pretty {
                    out.push(' ');
                }
                generate(v, format.field(key), pretty, depth + 1, out)?;
            }
            if pretty && !fields.is_empty() {
                out.push('\n');
                indentation(out, depth);
            }
            out.push('}');
        }
    }
    Ok(())
}
pub fn write_json(value: &Value, format: &ResolvedFormat) -> Result<String, Error> {
    if !matches!(value, Value::Object(_)) {
        return Err(Error::output("game JSON root must be an object"));
    }
    let mut out = String::with_capacity(128);
    generate(value, format, true, 0, &mut out)?;
    Ok(out)
}
/// Expands containers while retaining source spelling for every unchanged scalar.
pub fn expand_json(
    doc: JsonWriteSource<'_>,
    next: &Value,
    format: &ResolvedFormat,
) -> Result<String, Error> {
    fn write<'a>(
        source: (JsonWriteSource<'a>, &[Option<&'a Value>]),
        mut id: Option<usize>,
        mut old: Option<&'a Value>,
        next: &Value,
        mut format: &ResolvedFormat,
        depth: usize,
        out: &mut String,
    ) -> Result<(), Error> {
        let (doc, values) = source;
        if let ResolvedFormat::Source {
            node,
            format: nested,
        } = format
        {
            id = Some(*node);
            old = values[*node];
            format = nested;
        }
        match next {
            Value::Object(fields) => {
                let members = id.and_then(|id| match &doc.nodes[id].kind {
                    Kind::Object(members) => Some(members),
                    _ => None,
                });
                let mut source_fields = None;
                out.push('{');
                for (index, (key, value)) in fields.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push('\n');
                    indentation(out, depth + 1);
                    quote(key, out);
                    out.push_str(": ");
                    // Unchanged order needs no index; changed order builds one once.
                    let member = members.and_then(|members| {
                        if let Some(member) = members.get(index).filter(|member| member.key == *key)
                        {
                            return Some(member.value);
                        }
                        source_fields
                            .get_or_insert_with(|| {
                                members
                                    .iter()
                                    .map(|member| (&member.key, member.value))
                                    .collect::<HashMap<_, _>>()
                            })
                            .get(key)
                            .copied()
                    });
                    let before = member.and_then(|id| values[id]);
                    write(
                        source,
                        member,
                        before,
                        value,
                        format.field(key),
                        depth + 1,
                        out,
                    )?;
                }
                if !fields.is_empty() {
                    out.push('\n');
                    indentation(out, depth);
                }
                out.push('}');
            }
            Value::Array(items) => {
                let elements = id.and_then(|id| match &doc.nodes[id].kind {
                    Kind::Array { elements, .. } => Some(elements),
                    _ => None,
                });
                let before = match old {
                    Some(Value::Array(v)) => Some(v),
                    _ => None,
                };
                out.push('[');
                for (index, value) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push('\n');
                    indentation(out, depth + 1);
                    write(
                        source,
                        elements.and_then(|v| v.get(index)).copied(),
                        before.and_then(|v| v.get(index)),
                        value,
                        format.element(index),
                        depth + 1,
                        out,
                    )?;
                }
                if !items.is_empty() {
                    out.push('\n');
                    indentation(out, depth);
                }
                out.push(']');
            }
            _ if old == Some(next) && matches!(format, ResolvedFormat::Natural) && id.is_some() => {
                let node = &doc.nodes[id.expect("source scalar")];
                if node.span.is_empty() {
                    out.push_str("null");
                } else {
                    out.push_str(&doc.source[node.span.clone()]);
                }
            }
            _ => generate(next, format, false, depth, out)?,
        }
        Ok(())
    }
    let values = doc.node_values();
    let mut out = String::with_capacity(doc.source.len());
    write(
        (doc, &values),
        Some(doc.root),
        Some(doc.value),
        next,
        format,
        0,
        &mut out,
    )?;
    Ok(out)
}

#[derive(Debug)]
struct Edit {
    span: Range<usize>,
    text: String,
}
struct Writer<'a> {
    doc: JsonWriteSource<'a>,
    values: &'a [Option<&'a Value>],
    edits: Vec<Edit>,
}

fn indent(source: &str, at: usize) -> &str {
    let start = source[..at].rfind('\n').map_or(0, |i| i + 1);
    let line = &source[start..at];
    let end = line
        .bytes()
        .take_while(|b| matches!(b, b' ' | b'\t'))
        .count();
    &line[..end]
}
fn inline_comment(source: &str, at: usize) -> Option<Range<usize>> {
    let end = source[at..].find('\n').map_or(source.len(), |i| at + i);
    let end = source[..end].strip_suffix('\r').map_or(end, str::len);
    let suffix = &source[at..end];
    let stripped = suffix.trim_start_matches([' ', '\t', '\r']);
    stripped.starts_with('#').then_some(at..end)
}
fn spacing(source: &str, after: usize, before: usize) -> String {
    let gap = &source[after..before];
    if gap.chars().all(char::is_whitespace) {
        gap.to_owned()
    } else {
        let last = gap.rfind('\n');
        last.map_or_else(|| " ".to_owned(), |i| format!("\n{}", &gap[i + 1..]))
    }
}

impl Writer<'_> {
    fn source_children(&self, node: usize, format: &ResolvedFormat) -> ResolvedFormat {
        if let ResolvedFormat::Source { node, format } = format {
            return self.source_children(*node, format);
        }
        if !matches!(format, ResolvedFormat::Natural) {
            return format.clone();
        }
        let child = |node| ResolvedFormat::Source {
            node,
            format: Box::new(ResolvedFormat::Natural),
        };
        match &self.doc.nodes[node].kind {
            Kind::Object(fields) => ResolvedFormat::Object(
                fields
                    .iter()
                    .map(|field| (field.key.clone(), child(field.value)))
                    .collect(),
            ),
            Kind::Array { elements, .. } => {
                ResolvedFormat::Elements(elements.iter().map(|node| child(*node)).collect())
            }
            Kind::Scalar => ResolvedFormat::Natural,
        }
    }
    fn render(&self, value: &Value, format: &ResolvedFormat) -> Result<String, Error> {
        if let ResolvedFormat::Source { node, format } = format {
            if matches!(value, Value::Array(_) | Value::Object(_)) {
                return self.render(value, &self.source_children(*node, format));
            }
            return self.fragment(
                *node,
                self.values[*node].expect("source value"),
                value,
                format,
            );
        }
        let mut out = String::new();
        match value {
            Value::Object(fields) => {
                out.push('{');
                for (index, (key, value)) in fields.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    quote(key, &mut out);
                    out.push(':');
                    out.push_str(&self.render(value, format.field(key))?);
                }
                out.push('}');
            }
            Value::Array(items) => {
                out.push('[');
                for (index, value) in items.iter().enumerate() {
                    if index > 0 {
                        out.push(',');
                    }
                    out.push_str(&self.render(value, format.element(index))?);
                }
                out.push(']');
            }
            _ => generate(value, format, false, 0, &mut out)?,
        }
        Ok(out)
    }
    fn fragment(
        &self,
        id: usize,
        before: &Value,
        after: &Value,
        format: &ResolvedFormat,
    ) -> Result<String, Error> {
        let range = self.doc.nodes[id].span.clone();
        let mut writer = Writer {
            doc: self.doc,
            values: self.values,
            edits: Vec::new(),
        };
        writer.node(id, before, after, format)?;
        writer.edits.sort_by_key(|e| (e.span.start, e.span.end));
        let mut out = String::new();
        let mut cursor = range.start;
        for edit in writer.edits {
            out.push_str(&self.doc.source[cursor..edit.span.start]);
            out.push_str(&edit.text);
            cursor = edit.span.end;
        }
        out.push_str(&self.doc.source[cursor..range.end]);
        Ok(out)
    }
    fn replace(&mut self, span: Range<usize>, text: String) {
        self.edits.push(Edit { span, text });
    }
    fn remove(&mut self, node: usize, key: Option<Range<usize>>, separator: Option<Range<usize>>) {
        let value = &self.doc.nodes[node];
        self.replace(
            key.map_or(value.span.start, |s| s.start)..value.span.end,
            String::new(),
        );
        if let Some(comment) = inline_comment(self.doc.source, value.span.end) {
            self.replace(comment, String::new());
        }
        if let Some(separator) = separator {
            if let Some(comment) = inline_comment(self.doc.source, separator.end) {
                self.replace(comment, String::new());
            }
            self.replace(separator, String::new());
        }
    }
    fn new_parts(
        &mut self,
        node: &Node,
        first: Option<usize>,
        survivor: Option<(usize, Option<Range<usize>>)>,
        items: &[String],
    ) -> Result<(), Error> {
        if items.is_empty() {
            return Ok(());
        }
        let source = self.doc.source;
        let close = node.span.end - 1;
        let opening = node.span.start + 1;
        let pair = match &node.kind {
            Kind::Object(members) => members.windows(2).find_map(|pair| {
                pair[0]
                    .separator
                    .clone()
                    .map(|separator| (separator, pair[1].key_span.start))
            }),
            Kind::Array {
                elements,
                separators,
            } => separators
                .first()
                .zip(elements.get(1))
                .map(|(separator, next)| (separator.clone(), self.doc.nodes[*next].span.start)),
            Kind::Scalar => None,
        };
        let separator = match &node.kind {
            Kind::Object(members) => members.first().and_then(|m| m.separator.as_ref()),
            Kind::Array { separators, .. } => separators.first(),
            Kind::Scalar => None,
        }
        .map_or(",", |span| &source[span.clone()]);
        let gap = pair.map_or_else(
            || first.map_or_else(|| " ".to_owned(), |at| spacing(source, opening, at)),
            |(separator, next)| spacing(source, separator.end, next),
        );
        let multiline = first.is_some_and(|at| source[opening..at].contains('\n'))
            || first.is_none() && source[opening..close].contains('\n')
            || gap.contains('\n');
        if multiline {
            if let Some((end, None)) = survivor {
                self.replace(end..end, separator.to_owned());
            }
            let eol = if gap.contains("\r\n")
                || !gap.contains('\n') && source[node.span.clone()].contains("\r\n")
            {
                "\r\n"
            } else {
                "\n"
            };
            let item_indent = gap.rsplit_once('\n').map_or_else(
                || {
                    first.map_or_else(
                        || format!("{}  ", indent(source, node.span.start)),
                        |at| indent(source, at).to_owned(),
                    )
                },
                |(_, tail)| tail.to_owned(),
            );
            let line_start = source[..close].rfind('\n').map_or(close, |i| i + 1);
            let clean_close = source[line_start..close]
                .chars()
                .all(|c| matches!(c, ' ' | '\t' | '\r'));
            let (at, prefix, suffix) = if clean_close {
                (line_start, String::new(), String::new())
            } else {
                (
                    close,
                    eol.to_owned(),
                    indent(source, node.span.start).to_owned(),
                )
            };
            let text = format!(
                "{prefix}{item_indent}{}{eol}{suffix}",
                items.join(&format!("{separator}{eol}{item_indent}"))
            );
            self.replace(at..at, text);
        } else {
            let joined = items.join(&format!("{separator}{gap}"));
            match survivor {
                Some((_, Some(existing))) => {
                    self.replace(existing.end..existing.end, format!("{gap}{joined}"))
                }
                Some((end, None)) => self.replace(end..end, format!("{separator}{gap}{joined}")),
                None => self.replace(close..close, joined),
            }
        }
        Ok(())
    }
    fn node(
        &mut self,
        id: usize,
        before: &Value,
        after: &Value,
        format: &ResolvedFormat,
    ) -> Result<(), Error> {
        let node = &self.doc.nodes[id];
        let source = self.doc.source;
        if let ResolvedFormat::Source {
            node: origin,
            format,
        } = format
        {
            let original = self.values[*origin].expect("source value belongs to this document");
            if *origin == id {
                return self.node(id, original, after, format);
            }
            if matches!(
                (&node.kind, after),
                (Kind::Object(_), Value::Object(_)) | (Kind::Array { .. }, Value::Array(_))
            ) {
                return self.node(id, before, after, &self.source_children(*origin, format));
            }
            let fragment = self.fragment(*origin, original, after, format)?;
            self.replace(node.span.clone(), fragment);
            return Ok(());
        }
        if before.same_content_order(after) && matches!(format, ResolvedFormat::Natural) {
            return Ok(());
        }
        match (&node.kind, before, after) {
            (Kind::Object(members), Value::Object(old), Value::Object(next)) => {
                let original = old.iter().map(|(k, v)| (k, v)).collect::<BTreeMap<_, _>>();
                let source_members = members
                    .iter()
                    .map(|member| (&member.key, member))
                    .collect::<BTreeMap<_, _>>();
                let final_values = next.iter().map(|(k, v)| (k, v)).collect::<BTreeMap<_, _>>();
                let slots = members
                    .iter()
                    .filter(|member| final_values.contains_key(&member.key))
                    .collect::<Vec<_>>();
                for member in members
                    .iter()
                    .filter(|member| !final_values.contains_key(&member.key))
                {
                    self.remove(
                        member.value,
                        Some(member.key_span.clone()),
                        member.separator.clone(),
                    );
                }
                let connector = members
                    .first()
                    .map(|m| &source[m.key_span.end..self.doc.nodes[m.value].span.start])
                    .filter(|s| !s.contains(['#', '\n', '\r']))
                    .unwrap_or(": ");
                let mut slot_index = 0;
                let mut additions: Vec<String> = Vec::new();
                for (key, value) in next {
                    if matches!(value, Value::Float(n) if !n.is_finite()) {
                        return Err(Error::output(
                            "object member cannot contain non-finite numeric value",
                        ));
                    }
                    if let Some(from) = source_members.get(key) {
                        let slot = slots[slot_index];
                        if !additions.is_empty() {
                            let start = slot.key_span.start;
                            let position = members
                                .iter()
                                .position(|member| member.value == slot.value)
                                .expect("retained layout member");
                            let after = position
                                .checked_sub(1)
                                .and_then(|index| members[index].separator.as_ref())
                                .map_or(node.span.start + 1, |span| span.end);
                            let gap = spacing(source, after, start);
                            let delimiter = members
                                .iter()
                                .find_map(|m| m.separator.as_ref())
                                .map_or(",", |span| &source[span.clone()]);
                            self.replace(
                                start..start,
                                format!(
                                    "{}{delimiter}{gap}",
                                    additions.join(&format!("{delimiter}{gap}"))
                                ),
                            );
                            additions.clear();
                        }
                        if slot.key != *key {
                            self.replace(
                                slot.key_span.clone(),
                                source[from.key_span.clone()].into(),
                            );
                        }
                        if slot.value == from.value {
                            self.node(slot.value, original[key], value, format.field(key))?;
                        } else {
                            let requested = format.field(key);
                            let bound = match requested {
                                ResolvedFormat::Source { .. } => requested.clone(),
                                _ => ResolvedFormat::Source {
                                    node: from.value,
                                    format: Box::new(requested.clone()),
                                },
                            };
                            self.node(slot.value, original[&slot.key], value, &bound)?;
                        }
                        slot_index += 1;
                    } else {
                        let mut text = String::new();
                        quote(key, &mut text);
                        text.push_str(connector);
                        text.push_str(&self.render(value, format.field(key))?);
                        additions.push(text);
                    }
                }
                let survivor = slots
                    .last()
                    .map(|m| (self.doc.nodes[m.value].span.end, m.separator.clone()));
                self.new_parts(
                    node,
                    members.first().map(|m| m.key_span.start),
                    survivor,
                    &additions,
                )?;
            }
            (
                Kind::Array {
                    elements,
                    separators,
                },
                Value::Array(old),
                Value::Array(next),
            ) => {
                let mut prefix = 0;
                if old.len() != next.len() {
                    while prefix < old.len().min(next.len()) && old[prefix] == next[prefix] {
                        prefix += 1;
                    }
                }
                let mut suffix = 0;
                if old.len() != next.len() {
                    while suffix < old.len().min(next.len()) - prefix
                        && old[old.len() - 1 - suffix] == next[next.len() - 1 - suffix]
                    {
                        suffix += 1;
                    }
                }
                let old_middle = old.len() - prefix - suffix;
                let new_middle = next.len() - prefix - suffix;
                let shared = old_middle.min(new_middle);
                for i in 0..prefix {
                    self.node(elements[i], &old[i], &next[i], format.element(i))?;
                }
                for j in 0..shared {
                    let i = prefix + j;
                    self.node(elements[i], &old[i], &next[i], format.element(i))?;
                }
                for j in 0..suffix {
                    let i = old.len() - suffix + j;
                    let n = next.len() - suffix + j;
                    self.node(elements[i], &old[i], &next[n], format.element(n))?;
                }
                for (i, id) in elements
                    .iter()
                    .enumerate()
                    .take(old.len() - suffix)
                    .skip(prefix + shared)
                {
                    self.remove(*id, None, separators.get(i).cloned());
                }
                if new_middle > old_middle {
                    let added = next[prefix + shared..next.len() - suffix]
                        .iter()
                        .enumerate()
                        .map(|(i, v)| self.render(v, format.element(prefix + shared + i)))
                        .collect::<Result<Vec<_>, _>>()?;
                    if suffix > 0 {
                        let at = self.doc.nodes[elements[old.len() - suffix]].span.start;
                        let gap = if old.len() - suffix > 0 {
                            let previous = old.len() - suffix - 1;
                            let after = separators
                                .get(previous)
                                .map_or(self.doc.nodes[elements[previous]].span.end, |s| s.end);
                            spacing(source, after, at)
                        } else {
                            let opening = node.span.start + 1;
                            spacing(source, opening, at)
                        };
                        let delimiter = separators.first().map_or(",", |s| &source[s.clone()]);
                        self.replace(
                            at..at,
                            format!(
                                "{}{delimiter}{gap}",
                                added.join(&format!("{delimiter}{gap}"))
                            ),
                        );
                    } else {
                        let survivor = elements
                            .iter()
                            .enumerate()
                            .take(prefix + shared)
                            .next_back()
                            .map(|(i, id)| {
                                (self.doc.nodes[*id].span.end, separators.get(i).cloned())
                            });
                        self.new_parts(
                            node,
                            elements.first().map(|i| self.doc.nodes[*i].span.start),
                            survivor,
                            &added,
                        )?;
                    }
                }
            }
            _ => self.replace(node.span.clone(), self.render(after, format)?),
        }
        Ok(())
    }
}

pub fn preserve_json(
    doc: JsonWriteSource<'_>,
    next: &Value,
    format: &ResolvedFormat,
) -> Result<String, Error> {
    if !matches!(next, Value::Object(_)) {
        return Err(Error::output("game JSON root must be an object"));
    }
    if doc.value.same_content_order(next) && matches!(format, ResolvedFormat::Natural) {
        return Ok(doc.source.to_string());
    }
    let values = doc.node_values();
    let mut writer = Writer {
        doc,
        values: &values,
        edits: Vec::new(),
    };
    writer.node(doc.root, doc.value, next, format)?;
    writer.edits.sort_by_key(|e| (e.span.start, e.span.end));
    let capacity = doc.source.len() + writer.edits.iter().map(|e| e.text.len()).sum::<usize>();
    let mut out = String::with_capacity(capacity);
    let mut cursor = 0;
    for edit in writer.edits {
        if edit.span.start < cursor {
            if edit.text.is_empty() && edit.span.end <= cursor {
                continue;
            }
            if edit.text.is_empty() {
                cursor = edit.span.end;
                continue;
            }
            return Err(Error::output("conflicting structure ranges"));
        }
        out.push_str(&doc.source[cursor..edit.span.start]);
        out.push_str(&edit.text);
        cursor = edit.span.end;
    }
    out.push_str(&doc.source[cursor..]);
    Ok(out)
}
