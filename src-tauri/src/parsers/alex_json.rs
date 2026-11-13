use crate::models::file_content::{JsonDocument, JsonOriginalFormat, Kind, Member, Node};
use crate::models::file_value::{Error, Text, Value};
use crate::parsers::game::number;
use std::collections::HashSet;
use std::ops::Range;
use std::sync::Arc;

#[cfg(test)]
mod tests {
    use crate::models::file_content::ReadFailure;
    use crate::parsers::game;
    use std::iter;
    use std::str;
    use std::sync::Arc;

    use super::{JsonDocument, parse};
    use crate::models::file_value::{Text, Value};
    use std::fs;
    use std::path::Path;

    fn read(bytes: &[u8]) -> Result<Value, ReadFailure> {
        game::read_json(bytes).map(|source| source.content)
    }
    fn field(source: &str, key: &str) -> Value {
        parse(source).unwrap().get(key).unwrap().clone()
    }
    fn text(value: &str) -> Value {
        Value::Text(Text::new(value))
    }

    #[test]
    fn errors_locate_original_text_with_comments_crlf_and_utf16_columns() {
        for eol in ["\n", "\r\n"] {
            let source = format!("{{# note{eol}\"😀\":1,\"😀\":2}}");
            let error = parse(&source).unwrap_err();
            assert_eq!(error.line, 2);
            assert_eq!(error.column, 14);
        }
    }
    #[test]
    fn parses_crlf_pretty_json() {
        let value = parse("{\r\n  id: 'sample',\r\n  name: 'Example'\r\n}").unwrap();
        assert_eq!(value.get("id"), Some(&text("sample")));
        assert_eq!(value.get("name"), Some(&text("Example")));
    }
    #[test]
    fn parses_crlf_four_field_mod_info() {
        let value = parse(
            "{\r\nid:'sample',\r\nname:'Example',\r\nversion:'4.0',\r\ngameVersion:'0.98a'\r\n}",
        )
        .unwrap();
        assert_eq!(value.get("version"), Some(&text("4.0")));
        assert_eq!(value.get("gameVersion"), Some(&text("0.98a")));
    }
    #[test]
    fn trailing_comma_and_semicolon_tolerated() {
        for source in [
            "{a:1,}",
            "{a:1;}",
            "{a:[1,2,]}",
            "{a:[1;2;]}",
            "{a:[1,],b:{c:2}}",
        ] {
            assert!(parse(source).is_ok(), "{source}");
        }
    }
    #[test]
    fn semicolon_is_an_item_separator() {
        assert_eq!(field("{a:1;b:2}", "b"), Value::Integer(2));
    }
    #[test]
    fn unquoted_keys_and_values() {
        assert_eq!(field("{id:sample,tag:long-tag,odd:1f}", "odd"), text("1f"));
        assert_eq!(field("{id:sample,tag:long-tag}", "tag"), text("long-tag"));
    }
    #[test]
    fn unquoted_word_keeps_inner_spaces() {
        assert_eq!(field("{name: Example Name}", "name"), text("Example Name"));
    }
    #[test]
    fn boolean_words_are_case_insensitive() {
        for (word, value) in [
            ("true", true),
            ("TRUE", true),
            ("True", true),
            ("false", false),
            ("FALSE", false),
        ] {
            assert_eq!(
                field(&format!("{{enabled:{word}}}"), "enabled"),
                Value::Bool(value)
            );
        }
    }
    #[test]
    fn duplicate_key_is_an_error() {
        assert_eq!(parse("{a:1,a:2}").unwrap_err().code, "json.duplicate_key");
    }
    #[test]
    fn duplicate_keys_are_rejected_across_the_small_object_boundary() {
        for count in [1, 7, 8, 9, 16] {
            let fields = (0..count)
                .map(|index| format!("k{index}:1"))
                .collect::<Vec<_>>()
                .join(",");
            let source = format!("{{{fields},k0:2}}");
            let error = parse(&source).unwrap_err();
            assert_eq!(error.code, "json.duplicate_key");
            assert_eq!(
                JsonDocument::layout_shared(&Arc::from(source)).unwrap_err(),
                error
            );
        }
    }
    #[test]
    fn borrowed_words_preserve_spaces_and_removed_carriage_returns() {
        for (source, expected) in [
            ("{value:  two words   }", "two words"),
            ("{value:t\rwo wor\rds}", "two words"),
            ("{value:汉 字}", "汉 字"),
            ("{value:word# comment\n}", "word"),
        ] {
            let value = game::read_json(source.as_bytes()).unwrap();
            assert_eq!(value.content.get("value"), Some(&text(expected)));
            assert_eq!(parse(source).unwrap(), value.content);
        }
    }
    #[test]
    fn trailing_garbage_after_root_is_ignored() {
        assert_eq!(field("{a:1} ignored tail } []", "a"), Value::Integer(1));
    }
    #[test]
    fn root_must_be_an_object() {
        for source in ["[1,2]", "'text'", "123", ""] {
            assert!(
                parse(source)
                    .unwrap_err()
                    .message
                    .contains("must begin with '{'")
            );
        }
    }
    #[test]
    fn hash_comments_are_stripped_and_in_string_hash_survives() {
        assert_eq!(field("{\n# note\na:1 # tail\n}", "a"), Value::Integer(1));
        assert_eq!(
            field("{url:\"http://example#part\"}", "url"),
            text("http://example#part")
        );
    }
    #[test]
    fn hash_strip_ignores_backslash_escapes() {
        assert!(parse("{a:\"x\\\" # tail\",b:2}").is_err());
    }
    #[test]
    fn hash_strip_flips_quote_state_inside_comment() {
        assert_eq!(field("# \"note\n{a:1} # \" tail\n", "a"), Value::Integer(1));
    }
    #[test]
    fn carriage_returns_are_dropped_before_tokener() {
        assert_eq!(field("{a:\"x\ry\"}", "a"), text("xy"));
    }
    #[test]
    fn paren_array_delimiters() {
        assert_eq!(
            field("{items:('a','b')}", "items"),
            Value::Array(vec![text("a"), text("b")])
        );
        assert!(parse("{items:(1,2)}").is_err());
        assert!(parse("{items:[1,'a')}").is_err());
    }
    #[test]
    fn array_null_slots() {
        assert_eq!(
            field("{items:[1,,2]}", "items"),
            Value::Array(vec![Value::Integer(1), Value::Null, Value::Integer(2)])
        );
        assert_eq!(
            field("{items:[,]}", "items"),
            Value::Array(vec![Value::Null])
        );
    }
    #[test]
    fn delimiter_at_word_start_is_missing_value() {
        for source in ["{,}", "{a:,}", "{items:[,}"] {
            assert!(parse(source).is_err(), "{source}");
        }
    }
    #[test]
    fn illegal_escape_is_an_error() {
        assert!(
            parse(r#"{a:"x\qy"}"#)
                .unwrap_err()
                .message
                .contains("Illegal escape")
        );
    }
    #[test]
    fn literal_newline_inside_string_is_unterminated() {
        assert!(
            parse("{a:\"x\ny\"}")
                .unwrap_err()
                .message
                .contains("Unterminated string")
        );
    }
    #[test]
    fn unquoted_number_forms_match_game() {
        let value = parse("{a:007,b:-0,c:.5,d:+5,e:1E2,f:0x1F,g:0X10}").unwrap();
        for (key, expected) in [
            ("a", Value::Integer(7)),
            ("b", Value::Integer(0)),
            ("c", Value::Float(0.5)),
            ("d", Value::Integer(5)),
            ("e", Value::Float(100.0)),
            ("f", Value::Integer(31)),
            ("g", Value::Integer(16)),
        ] {
            assert_eq!(value.get(key), Some(&expected));
        }
    }
    #[test]
    fn hex_fall_through_to_decimal_path() {
        for word in ["0x1234567890", "0xzz"] {
            assert_eq!(field(&format!("{{a:{word}}}"), "a"), text(word));
        }
    }
    #[test]
    fn non_finite_number_is_an_error() {
        assert!(
            parse("{a:1e309}")
                .unwrap_err()
                .message
                .contains("non-finite")
        );
        assert_eq!(
            field("{a:[1e309]}", "a"),
            Value::Array(vec![Value::Float(f64::INFINITY)])
        );
    }
    #[test]
    fn floating_suffixes_follow_the_game_numeric_branch() {
        for (word, value) in [
            (".625f", 0.625),
            (".0F", 0.0),
            ("2e1d", 20.0),
            ("-3.5D", -3.5),
            ("0x1.5p3", 10.5),
        ] {
            assert_eq!(field(&format!("{{a:{word}}}"), "a"), Value::Float(value));
        }
        for word in ["1f", "0.625ff"] {
            assert_eq!(field(&format!("{{a:{word}}}"), "a"), text(word));
        }
        assert_eq!(field("{a:'0.625f'}", "a"), text("0.625f"));
        assert!(parse("{a:1e309f}").is_err());
    }
    #[test]
    fn arrow_and_bare_equals_key_separators() {
        assert_eq!(field("{a=>1,b=2}", "a"), Value::Integer(1));
        assert_eq!(field("{a=>1,b=2}", "b"), Value::Integer(2));
    }
    #[test]
    fn single_quoted_strings() {
        assert_eq!(field("{'name':'one\\'two'}", "name"), text("one'two"));
    }
    #[test]
    fn unicode_escapes() {
        assert_eq!(field(r#"{a:"\u0041\u00e9"}"#, "a"), text("Aé"));
    }
    #[test]
    fn unicode_surrogate_pairs_match_game_json() {
        assert_eq!(field(r#"{a:"\uD83D\uDE80"}"#, "a"), text("🚀"));
        assert_eq!(
            field(r#"{a:"\uD800"}"#, "a"),
            Value::Text(Text::Utf16(vec![0xd800]))
        );
    }
    #[test]
    fn backslash_terminates_unquoted_words() {
        assert_eq!(
            parse(r#"{a:one\two}"#).unwrap_err().code,
            "parse.json_syntax"
        );
    }
    #[test]
    fn eof_error_messages_match_game() {
        assert!(
            parse("{a:1")
                .unwrap_err()
                .message
                .contains("Expected a ',' or '}'")
        );
        assert!(
            parse("{")
                .unwrap_err()
                .message
                .contains("must end with '}'")
        );
    }
    #[test]
    fn leading_whitespace_before_root() {
        assert_eq!(field(" \r\n{a:1}\n", "a"), Value::Integer(1));
    }
    #[test]
    fn collected_json_fixtures_have_identical_value_and_document_reads() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/json");
        let mut count = 0;
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            let bytes = fs::read(&path).unwrap();
            let value =
                read(&bytes).unwrap_or_else(|error| panic!("{}: {}", path.display(), error.error));
            let document = JsonDocument::parse(str::from_utf8(&bytes).unwrap()).unwrap();
            assert!(value.same_content_order(&document.value));
            let layout =
                JsonDocument::layout_shared(&Arc::from(str::from_utf8(&bytes).unwrap())).unwrap();
            assert_eq!(layout.root, document.root);
            assert_eq!(
                serde_json::to_value(&layout.nodes).unwrap(),
                serde_json::to_value(&document.nodes).unwrap()
            );
            count += 1;
        }
        assert_eq!(count, 21);
    }
    #[test]
    fn layout_only_retains_compound_keys_and_reports_the_original_error() {
        let source = r#"{[{n:1.0},2]:[3,4],{x:[5,6]}:{y:7},plain:8}"#;
        let document = JsonDocument::parse(source).unwrap();
        let layout = JsonDocument::layout_shared(&Arc::from(source)).unwrap();
        assert_eq!(
            serde_json::to_value(layout.nodes).unwrap(),
            serde_json::to_value(document.nodes).unwrap()
        );
        for source in ["{a:1,a:2}", "{a:1e309}", r#"{a:"\q"}"#] {
            assert_eq!(
                JsonDocument::layout_shared(&Arc::from(source)).unwrap_err(),
                parse(source).unwrap_err()
            );
        }
    }
    #[test]
    fn large_utf8_file_keeps_a_character_crossing_the_mebibyte_boundary() {
        let mut source = "{text:'".to_owned();
        source.extend(iter::repeat_n('x', 1024 * 1024 - source.len() - 1));
        source.push_str("汉字',tail:7}");
        let value = read(source.as_bytes()).unwrap();
        assert!(
            value.get("text").unwrap() == &text(&format!("{}汉字", "x".repeat(1024 * 1024 - 8)))
        );
        assert_eq!(value.get("tail"), Some(&Value::Integer(7)));
    }
}

impl JsonDocument {
    #[cfg(test)]
    pub fn parse(text: &str) -> Result<Self, Error> {
        Self::parse_shared(Arc::from(text.strip_prefix('\u{feff}').unwrap_or(text)))
    }
    #[cfg(test)]
    pub(crate) fn parse_shared(source: Arc<str>) -> Result<Self, Error> {
        let mut parser = Parser::<true>::new(&source, Some(source.clone()));
        let (value, root) = parser.object()?;
        let nodes = parser.nodes;
        Ok(Self {
            source,
            value,
            nodes,
            root,
        })
    }
    pub(crate) fn layout_shared(source: &Arc<str>) -> Result<JsonOriginalFormat, Error> {
        let mut parser = Parser::<true, false>::new(source, Some(source.clone()));
        let (_, root) = parser.object()?;
        Ok(JsonOriginalFormat {
            root,
            nodes: parser.nodes,
        })
    }
}

#[cfg(test)]
pub fn parse(text: &str) -> Result<Value, Error> {
    Parser::<false>::new(text.strip_prefix('\u{feff}').unwrap_or(text), None)
        .object()
        .map(|v| v.0)
}
pub fn parse_shared(source: &Arc<str>) -> Result<Value, Error> {
    Parser::<false>::new(source, Some(source.clone()))
        .object()
        .map(|value| value.0)
}

struct Lexer<'a> {
    source: &'a str,
    pos: usize,
    quoted: bool,
    comment: bool,
    back: bool,
    last: char,
    span: Range<usize>,
}
impl<'a> Lexer<'a> {
    fn new(source: &'a str) -> Self {
        Self {
            source,
            pos: 0,
            quoted: false,
            comment: false,
            back: false,
            last: '\0',
            span: 0..0,
        }
    }
    fn next(&mut self) -> char {
        if self.back {
            self.back = false;
            return self.last;
        }
        while self.pos < self.source.len() {
            let start = self.pos;
            let byte = self.source.as_bytes()[start];
            let ch = if byte < 128 {
                byte as char
            } else {
                self.source[start..]
                    .chars()
                    .next()
                    .expect("character boundary")
            };
            self.pos += ch.len_utf8();
            // The file loader removes CR before the comment state machine.
            if ch == '\r' {
                continue;
            }
            if ch == '"' {
                self.quoted = !self.quoted;
            }
            if ch == '\n' {
                self.quoted = false;
                self.comment = false;
            } else if ch == '#' && !self.quoted {
                self.comment = true;
                continue;
            } else if self.comment {
                continue;
            }
            self.span = start..self.pos;
            self.last = ch;
            return ch;
        }
        self.span = self.source.len()..self.source.len();
        self.last = '\0';
        '\0'
    }
    fn clean(&mut self) -> char {
        loop {
            // Horizontal whitespace cannot change the comment or quote state.
            if !self.back {
                while self.pos < self.source.len()
                    && matches!(self.source.as_bytes()[self.pos], b' ' | b'\t')
                {
                    self.pos += 1;
                }
            }
            let ch = self.next();
            if ch == '\0' || ch > ' ' {
                return ch;
            }
        }
    }
    fn back(&mut self) {
        self.back = true;
    }
}

struct Parser<'a, const LAYOUT: bool, const VALUES: bool = true> {
    source: &'a str,
    shared: Option<Arc<str>>,
    lexer: Lexer<'a>,
    nodes: Vec<Node>,
}
#[derive(Clone, Copy)]
enum Stage {
    Key,
    Colon,
    ObjectValue,
    ObjectEnd,
    ArrayFirst,
    ArrayValue,
    ArrayEnd,
}
enum Container {
    Object {
        fields: Vec<(Text, Value)>,
        members: Vec<Member>,
        seen: HashSet<Text>,
        key: Option<(Option<Text>, Range<usize>)>,
        last_member: Option<usize>,
    },
    Array {
        values: Vec<Value>,
        elements: Vec<usize>,
        separators: Vec<Range<usize>>,
    },
}
struct Frame {
    start: usize,
    key_nodes: usize,
    close: char,
    stage: Stage,
    content: Container,
    retain_value: bool,
}
impl Frame {
    fn new(open: char, start: usize, retain_value: bool) -> Self {
        if open == '{' {
            Self {
                retain_value,
                start,
                key_nodes: 0,
                close: '}',
                stage: Stage::Key,
                content: Container::Object {
                    fields: Vec::new(),
                    members: Vec::new(),
                    seen: HashSet::new(),
                    key: None,
                    last_member: None,
                },
            }
        } else {
            Self {
                retain_value,
                start,
                key_nodes: 0,
                close: if open == '[' { ']' } else { ')' },
                stage: Stage::ArrayFirst,
                content: Container::Array {
                    values: Vec::new(),
                    elements: Vec::new(),
                    separators: Vec::new(),
                },
            }
        }
    }
}
impl<'a, const LAYOUT: bool, const VALUES: bool> Parser<'a, LAYOUT, VALUES> {
    fn new(source: &'a str, shared: Option<Arc<str>>) -> Self {
        Self {
            source,
            shared,
            lexer: Lexer::new(source),
            nodes: Vec::new(),
        }
    }
    fn error(&self, code: &'static str, message: &str) -> Error {
        let cursor = if self.lexer.back {
            self.lexer.span.start
        } else {
            self.lexer.span.end
        };
        Error::at(code, message, self.source, cursor)
    }
    fn syntax(&self, message: &str) -> Error {
        self.error("parse.json_syntax", message)
    }
    fn record(&mut self, start: usize, end: usize, kind: Kind) -> usize {
        if LAYOUT {
            let id = self.nodes.len();
            self.nodes.push(Node {
                span: start..end,
                kind,
            });
            id
        } else {
            0
        }
    }
    fn string(&mut self, quote: char) -> Result<Text, Error> {
        let start = self.lexer.span.end;
        let mut last_end = start;
        let mut units: Option<Vec<u16>> = None;
        loop {
            let ch = self.lexer.next();
            if self.lexer.span.start > last_end && units.is_none() {
                units = Some(self.source[start..last_end].encode_utf16().collect());
            }
            if ch == quote {
                if let Some(units) = units {
                    return Ok(Text::from_units(units));
                }
                let span = start..self.lexer.span.start;
                return Ok(if let Some(shared) = &self.shared {
                    Text::Source(shared.clone(), span)
                } else {
                    Text::new(&self.source[span])
                });
            }
            if ch == '\0' || ch == '\n' {
                return Err(self.syntax("Unterminated string"));
            }
            if ch == '\\' {
                let out = units
                    .get_or_insert_with(|| self.source[start..last_end].encode_utf16().collect());
                match self.lexer.next() {
                    '"' => out.push(34),
                    '\'' => out.push(39),
                    '/' => out.push(47),
                    '\\' => out.push(92),
                    'b' => out.push(8),
                    't' => out.push(9),
                    'n' => out.push(10),
                    'f' => out.push(12),
                    'r' => out.push(13),
                    'u' => {
                        let mut raw = String::with_capacity(4);
                        for _ in 0..4 {
                            let c = self.lexer.next();
                            if c == '\0' {
                                return Err(self.syntax("Illegal escape."));
                            }
                            raw.push(c);
                        }
                        let n = number::integer(&raw, 16, i32::MIN as i64, i32::MAX as i64)
                            .ok_or_else(|| self.syntax("Illegal escape."))?;
                        out.push(n as u16);
                    }
                    _ => return Err(self.syntax("Illegal escape.")),
                }
            } else if let Some(out) = &mut units {
                let mut buffer = [0u16; 2];
                out.extend_from_slice(ch.encode_utf16(&mut buffer));
            }
            last_end = self.lexer.span.end;
        }
    }
    fn scalar(&mut self) -> Result<(Value, usize), Error> {
        let ch = self.lexer.clean();
        let start = self.lexer.span.start;
        match ch {
            '\0' => Err(self.syntax("Missing value")),
            quote @ ('"' | '\'') => {
                let text = self.string(quote)?;
                let node = self.record(start, self.lexer.span.end, Kind::Scalar);
                Ok((Value::Text(text), node))
            }
            first => {
                let mut changed: Option<String> = None;
                let mut last_end = start;
                let mut c = first;
                let mut end = start;
                loop {
                    if c < ' '
                        || matches!(
                            c,
                            ',' | ':' | '}' | ']' | '/' | '\\' | '"' | '[' | '{' | ';' | '=' | '#'
                        )
                    {
                        self.lexer.back();
                        break;
                    }
                    // Most words are contiguous source slices; CR removal needs a buffer.
                    if self.lexer.span.start != last_end && changed.is_none() {
                        changed = Some(self.source[start..last_end].to_owned());
                    }
                    if let Some(word) = &mut changed {
                        word.push(c);
                    }
                    last_end = self.lexer.span.end;
                    if c > ' ' {
                        end = self.lexer.span.end;
                    }
                    c = self.lexer.next();
                }
                let raw = changed.as_deref().unwrap_or(&self.source[start..last_end]);
                let word = raw.trim_matches(|c: char| c <= ' ');
                if word.is_empty() {
                    return Err(self.syntax("Missing value"));
                }
                let value = number::word_value(word).unwrap_or_else(|| {
                    let text = match (&self.shared, &changed) {
                        (Some(source), None) => Text::Source(source.clone(), start..end),
                        _ => Text::new(word),
                    };
                    Value::Text(text)
                });
                let node = self.record(start, end, Kind::Scalar);
                Ok((value, node))
            }
        }
    }
    fn object(&mut self) -> Result<(Value, usize), Error> {
        if self.lexer.clean() != '{' {
            return Err(self.syntax("A JSONObject text must begin with '{'"));
        }
        let mut frames = vec![Frame::new('{', self.lexer.span.start, VALUES)];
        let mut completed: Option<(Value, usize, Range<usize>)> = None;
        loop {
            if let Some((value, node, span)) = completed.take() {
                let Some(frame) = frames.last_mut() else {
                    return Ok((value, node));
                };
                match &mut frame.content {
                    Container::Object {
                        fields,
                        members,
                        seen,
                        key,
                        last_member,
                    } => {
                        if matches!(frame.stage, Stage::Key) {
                            // Key syntax contributes its final text and span, not value-layout nodes.
                            if LAYOUT {
                                self.nodes.truncate(frame.key_nodes);
                            }
                            *key = Some((number::key(value), span));
                            frame.stage = Stage::Colon;
                        } else {
                            let (key, key_span) = key.take().expect("member key parsed");
                            *last_member = None;
                            if let Some(key) = key {
                                if matches!(&value,Value::Float(n) if !n.is_finite()) {
                                    return Err(
                                        self.syntax("JSON does not allow non-finite numbers.")
                                    );
                                }
                                // Bound linear checks; small objects avoid a separate hash table.
                                let count = if LAYOUT { members.len() } else { fields.len() };
                                let duplicate = if count < 8 {
                                    if LAYOUT {
                                        members.iter().any(|member| member.key == key)
                                    } else {
                                        fields.iter().any(|(name, _)| *name == key)
                                    }
                                } else {
                                    if seen.is_empty() {
                                        if LAYOUT {
                                            seen.extend(
                                                members.iter().map(|member| member.key.clone()),
                                            );
                                        } else {
                                            seen.extend(
                                                fields.iter().map(|(name, _)| name.clone()),
                                            );
                                        }
                                    }
                                    !seen.insert(key.clone())
                                };
                                if duplicate {
                                    return Err(self.error("json.duplicate_key", "Duplicate key"));
                                }
                                if LAYOUT {
                                    *last_member = Some(members.len());
                                    members.push(Member {
                                        key: key.clone(),
                                        key_span,
                                        value: node,
                                        separator: None,
                                    });
                                }
                                if frame.retain_value {
                                    fields.push((key, value));
                                }
                            }
                            frame.stage = Stage::ObjectEnd;
                        }
                    }
                    Container::Array {
                        values, elements, ..
                    } => {
                        if frame.retain_value {
                            values.push(value);
                        }
                        if LAYOUT {
                            elements.push(node);
                        }
                        frame.stage = Stage::ArrayEnd;
                    }
                }
            }
            let frame = frames.last_mut().expect("active container");
            let mut finish = false;
            let mut need_value = false;
            match frame.stage {
                Stage::Key => match self.lexer.clean() {
                    '\0' => return Err(self.syntax("A JSONObject text must end with '}'")),
                    '}' => finish = true,
                    _ => {
                        self.lexer.back();
                        frame.key_nodes = self.nodes.len();
                        need_value = true;
                    }
                },
                Stage::Colon => {
                    match self.lexer.clean() {
                        ':' => {}
                        '=' => {
                            if self.lexer.next() != '>' {
                                self.lexer.back();
                            }
                        }
                        _ => return Err(self.syntax("Expected a ':' after a key")),
                    }
                    frame.stage = Stage::ObjectValue;
                }
                Stage::ObjectValue => need_value = true,
                Stage::ObjectEnd => {
                    let ch = self.lexer.clean();
                    if let Container::Object {
                        members,
                        last_member: Some(i),
                        ..
                    } = &mut frame.content
                        && matches!(ch, ',' | ';')
                    {
                        members[*i].separator = Some(self.lexer.span.clone());
                    }
                    match ch {
                        ',' | ';' => {
                            if self.lexer.clean() == '}' {
                                finish = true;
                            } else {
                                self.lexer.back();
                                frame.stage = Stage::Key;
                            }
                        }
                        '}' => finish = true,
                        _ => return Err(self.syntax("Expected a ',' or '}'")),
                    }
                }
                Stage::ArrayFirst => {
                    if self.lexer.clean() == ']' {
                        finish = true;
                    } else {
                        self.lexer.back();
                        frame.stage = Stage::ArrayValue;
                    }
                }
                Stage::ArrayValue => {
                    if self.lexer.clean() == ',' {
                        let at = self.lexer.span.start;
                        self.lexer.back();
                        completed = Some((Value::Null, self.record(at, at, Kind::Scalar), at..at));
                    } else {
                        self.lexer.back();
                        need_value = true;
                    }
                }
                Stage::ArrayEnd => match self.lexer.clean() {
                    ',' | ';' => {
                        if LAYOUT && let Container::Array { separators, .. } = &mut frame.content {
                            separators.push(self.lexer.span.clone());
                        }
                        if self.lexer.clean() == ']' {
                            finish = true;
                        } else {
                            self.lexer.back();
                            frame.stage = Stage::ArrayValue;
                        }
                    }
                    ch if ch == frame.close => finish = true,
                    _ => return Err(self.syntax("Expected a ',' or ']'")),
                },
            }
            if need_value {
                let ch = self.lexer.clean();
                let start = self.lexer.span.start;
                if matches!(ch, '{' | '[' | '(') {
                    // Compound keys need complete values even when only layout is requested.
                    let retain = frame.retain_value || matches!(frame.stage, Stage::Key);
                    frames.push(Frame::new(ch, start, retain));
                } else {
                    self.lexer.back();
                    let (value, node) = self.scalar()?;
                    let end = if LAYOUT {
                        self.nodes[node].span.end
                    } else {
                        self.lexer.span.end
                    };
                    completed = Some((value, node, start..end));
                }
            }
            if finish {
                let frame = frames.pop().expect("finished container");
                let (value, kind) = match frame.content {
                    Container::Object {
                        fields, members, ..
                    } => (Value::Object(fields), Kind::Object(members)),
                    Container::Array {
                        values,
                        elements,
                        separators,
                    } => (
                        Value::Array(values),
                        Kind::Array {
                            elements,
                            separators,
                        },
                    ),
                };
                let span = frame.start..self.lexer.span.end;
                let node = self.record(span.start, span.end, kind);
                completed = Some((value, node, span));
            }
        }
    }
}
