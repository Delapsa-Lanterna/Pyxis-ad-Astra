use crate::errors::{AppError, AppResult};
use crate::parsers::parse_starsector_json;
use serde_json::Value;
use std::cmp::Reverse;
use std::collections::BTreeSet;
use std::ops::Range;

#[derive(Debug)]
pub enum PreserveResult {
    Preserved(String),
    NeedsRewrite(&'static str),
}

pub fn replace_root_string(source: &str, field: &str, replacement: &str) -> AppResult<String> {
    parse_starsector_json(source)?;
    let node = Scanner::new(source)
        .parse_root()
        .ok_or_else(|| AppError::message("text.identity_range", "无法定位身份字段文本范围"))?;
    let NodeKind::Object(members) = node.kind else {
        unreachable!("parsed root is an object")
    };
    let member = members
        .iter()
        .find(|member| member.key == field)
        .ok_or_else(|| AppError::message("spec.id_missing", format!("缺少身份字段: {field}")))?;
    let mut text = source.to_string();
    text.replace_range(
        member.value.span.clone(),
        &serde_json::to_string(replacement)?,
    );
    Ok(text)
}

#[cfg(test)]
mod identity_tests {
    use super::*;

    #[test]
    fn root_identity_replacement_keeps_other_text_ranges() {
        let source =
            "{ # hullId: ignored\n hullId: 'old', nested: {hullId:'other'}, array:[{id:'old'}]}\n";
        let next = replace_root_string(source, "hullId", "new").unwrap();
        assert_eq!(
            next,
            "{ # hullId: ignored\n hullId: \"new\", nested: {hullId:'other'}, array:[{id:'old'}]}\n"
        );
        assert!(replace_root_string("{hullId:", "hullId", "new").is_err());
    }
}

#[derive(Clone, Debug)]
struct Member {
    key: String,
    key_span: Range<usize>,
    value: Node,
    separator: Option<Range<usize>>,
}

#[derive(Clone, Debug)]
enum NodeKind {
    Object(Vec<Member>),
    Array {
        elements: Vec<Node>,
        separators: Vec<Range<usize>>,
    },
    Scalar,
}

#[derive(Clone, Debug)]
struct Node {
    span: Range<usize>,
    kind: NodeKind,
}

#[derive(Clone)]
struct Edit {
    span: Range<usize>,
    text: String,
}

struct Scanner<'a> {
    source: &'a str,
    visible: Vec<(char, usize)>,
    position: usize,
}

impl<'a> Scanner<'a> {
    fn new(source: &'a str) -> Self {
        let mut visible = Vec::new();
        let mut in_comment = false;
        let mut in_string = false;
        for (offset, ch) in source.char_indices() {
            if ch == '"' {
                in_string = !in_string;
            }
            if ch == '\n' || ch == '\r' {
                in_comment = false;
                in_string = false;
                if ch == '\n' {
                    visible.push((ch, offset));
                }
            } else if ch == '#' && !in_string {
                in_comment = true;
            } else if !in_comment {
                visible.push((ch, offset));
            }
        }
        Self {
            source,
            visible,
            position: 0,
        }
    }

    fn skip_space(&mut self) {
        while self.peek().is_some_and(|ch| ch <= ' ') {
            self.position += 1;
        }
    }

    fn peek(&self) -> Option<char> {
        self.visible.get(self.position).map(|(ch, _)| *ch)
    }

    fn offset(&self) -> usize {
        self.visible
            .get(self.position)
            .map_or(self.source.len(), |(_, offset)| *offset)
    }

    fn previous_end(&self) -> usize {
        self.visible
            .get(self.position.saturating_sub(1))
            .map_or(0, |(ch, offset)| offset + ch.len_utf8())
    }

    fn take(&mut self) -> Option<char> {
        let ch = self.peek()?;
        self.position += 1;
        Some(ch)
    }

    fn parse_root(&mut self) -> Option<Node> {
        self.skip_space();
        let node = self.parse_value()?;
        matches!(node.kind, NodeKind::Object(_)).then_some(node)
    }

    fn parse_value(&mut self) -> Option<Node> {
        self.skip_space();
        let start = self.offset();
        match self.peek()? {
            '{' => self.parse_object(start),
            '[' | '(' => self.parse_array(start),
            '"' | '\'' => {
                self.parse_string()?;
                Some(Node {
                    span: start..self.previous_end(),
                    kind: NodeKind::Scalar,
                })
            }
            _ => {
                let first = self.position;
                while let Some(ch) = self.peek() {
                    if ch < ' '
                        || matches!(
                            ch,
                            ',' | ':' | '}' | ']' | '/' | '"' | '[' | '{' | ';' | '=' | '#'
                        )
                    {
                        break;
                    }
                    self.position += 1;
                }
                if first == self.position {
                    return None;
                }
                while self.position > first && self.visible[self.position - 1].0 <= ' ' {
                    self.position -= 1;
                }
                let end = self.previous_end();
                if end <= start {
                    return None;
                }
                Some(Node {
                    span: start..end,
                    kind: NodeKind::Scalar,
                })
            }
        }
    }

    fn parse_string(&mut self) -> Option<()> {
        let quote = self.take()?;
        loop {
            match self.take()? {
                '\\' => {
                    self.take()?;
                }
                ch if ch == quote => return Some(()),
                '\n' => return None,
                _ => {}
            }
        }
    }

    fn parse_object(&mut self, start: usize) -> Option<Node> {
        self.take()?;
        let mut members = Vec::new();
        loop {
            self.skip_space();
            if self.peek() == Some('}') {
                self.take();
                return Some(Node {
                    span: start..self.previous_end(),
                    kind: NodeKind::Object(members),
                });
            }
            let key_start = self.offset();
            let key_start_index = self.position;
            if matches!(self.peek(), Some('"' | '\'')) {
                self.parse_string()?;
            } else {
                while self.peek().is_some_and(|ch| {
                    ch > ' ' && !matches!(ch, ':' | '=' | ',' | '}' | '{' | '[' | '"' | '\'')
                }) {
                    self.position += 1;
                }
                while self.peek().is_some_and(|ch| ch != ':' && ch != '=') {
                    if self.peek() == Some('}') {
                        return None;
                    }
                    self.position += 1;
                }
            }
            if self.position == key_start_index {
                return None;
            }
            let key_end = self.previous_end();
            let raw_key = self.source.get(key_start..key_end)?;
            let parsed_key = parse_starsector_json(&format!("{{{raw_key}:0}}")).ok()?;
            let key = parsed_key.as_object()?.keys().next()?.clone();
            self.skip_space();
            match self.take()? {
                ':' => {}
                '=' => {
                    if self.peek() == Some('>') {
                        self.take();
                    }
                }
                _ => return None,
            }
            let value = self.parse_value()?;
            self.skip_space();
            let separator = if matches!(self.peek(), Some(',' | ';')) {
                let separator_start = self.offset();
                self.take();
                Some(separator_start..self.previous_end())
            } else {
                None
            };
            if separator.is_none() && self.peek() != Some('}') {
                return None;
            }
            members.push(Member {
                key,
                key_span: key_start..key_end,
                value,
                separator,
            });
        }
    }

    fn parse_array(&mut self, start: usize) -> Option<Node> {
        let close = if self.take()? == '[' { ']' } else { ')' };
        let mut elements = Vec::new();
        let mut separators = Vec::new();
        loop {
            self.skip_space();
            if self.peek() == Some(close) {
                self.take();
                return Some(Node {
                    span: start..self.previous_end(),
                    kind: NodeKind::Array {
                        elements,
                        separators,
                    },
                });
            }
            elements.push(self.parse_value()?);
            self.skip_space();
            match self.peek()? {
                ',' | ';' => {
                    let separator_start = self.offset();
                    self.take();
                    separators.push(separator_start..self.previous_end());
                }
                ch if ch == close => {}
                _ => return None,
            }
        }
    }
}

/// Updates source spans and accepts the result only when the game parser
/// produces exactly the requested value. Ambiguous syntax is a caller-visible
/// request for confirmation before a normalized rewrite.
pub fn preserve_json_text(
    source: &str,
    next: &Value,
    ordered_json: Option<&str>,
) -> AppResult<PreserveResult> {
    let original = parse_starsector_json(source)?;
    if original == *next {
        return Ok(PreserveResult::Preserved(source.to_string()));
    }
    let mut scanner = Scanner::new(source);
    let Some(root) = scanner.parse_root() else {
        return Ok(PreserveResult::NeedsRewrite("无法定位 JSON 对象"));
    };
    let ordered = ordered_json.and_then(|text| Scanner::new(text).parse_root());
    let mut edits = Vec::new();
    if collect_edits(
        source,
        &root,
        &original,
        next,
        ordered.as_ref(),
        ordered_json,
        &mut edits,
    )
    .is_none()
    {
        return Ok(PreserveResult::NeedsRewrite("无法安全定位全部字段"));
    }
    edits.sort_by_key(|edit| Reverse(edit.span.start));
    let mut output = source.to_string();
    let mut previous_start = source.len();
    for edit in edits {
        if edit.span.end > previous_start
            || !source.is_char_boundary(edit.span.start)
            || !source.is_char_boundary(edit.span.end)
        {
            return Ok(PreserveResult::NeedsRewrite("字段位置存在交叠"));
        }
        previous_start = edit.span.start;
        output.replace_range(edit.span, &edit.text);
    }
    if parse_starsector_json(&output).ok().as_ref() != Some(next) {
        return Ok(PreserveResult::NeedsRewrite("原文更新后的数据核验失败"));
    }
    Ok(PreserveResult::Preserved(output))
}

pub fn json_root_tail(source: &str) -> Option<&str> {
    let scanner = Scanner::new(source);
    let mut started = false;
    let mut depth = 0usize;
    let mut quote = None;
    let mut escaped = false;
    for (ch, offset) in scanner.visible {
        if let Some(active) = quote {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == active {
                quote = None;
            }
            continue;
        }
        if matches!(ch, '"' | '\'') {
            quote = Some(ch);
            continue;
        }
        if !started {
            if ch <= ' ' {
                continue;
            }
            if ch != '{' {
                return None;
            }
            started = true;
            depth = 1;
            continue;
        }
        if matches!(ch, '{' | '[' | '(') {
            depth += 1;
        } else if matches!(ch, '}' | ']' | ')') {
            depth = depth.checked_sub(1)?;
            if depth == 0 {
                return source.get(offset + ch.len_utf8()..);
            }
        }
    }
    None
}

fn collect_edits(
    source: &str,
    node: &Node,
    old: &Value,
    next: &Value,
    ordered: Option<&Node>,
    order_source: Option<&str>,
    edits: &mut Vec<Edit>,
) -> Option<()> {
    if old == next {
        return Some(());
    }
    match (&node.kind, old, next) {
        (NodeKind::Object(members), Value::Object(before), Value::Object(after)) => {
            let mut seen = BTreeSet::new();
            for (index, member) in members.iter().enumerate() {
                if !seen.insert(member.key.as_str()) {
                    return None;
                }
                match (before.get(&member.key), after.get(&member.key)) {
                    (Some(old_value), Some(new_value)) => {
                        let ordered_child = ordered.and_then(|node| match &node.kind {
                            NodeKind::Object(items) => items
                                .iter()
                                .find(|item| item.key == member.key)
                                .map(|item| &item.value),
                            _ => None,
                        });
                        collect_edits(
                            source,
                            &member.value,
                            old_value,
                            new_value,
                            ordered_child,
                            order_source,
                            edits,
                        )?;
                    }
                    (Some(_), None) => {
                        if let Some(separator) = &member.separator {
                            let value_end = member.value.span.end;
                            let same_line = !source[value_end..separator.start].contains('\n');
                            if same_line {
                                edits.push(Edit {
                                    span: member.key_span.start
                                        ..inline_comment_end(source, separator.end),
                                    text: String::new(),
                                });
                            } else {
                                edits.push(Edit {
                                    span: member.key_span.start
                                        ..inline_comment_end(source, value_end),
                                    text: String::new(),
                                });
                                edits.push(Edit {
                                    span: separator.clone(),
                                    text: String::new(),
                                });
                            }
                        } else if index > 0 {
                            let previous = members[index - 1].separator.as_ref()?;
                            edits.push(Edit {
                                span: previous.start..previous.end,
                                text: String::new(),
                            });
                            edits.push(Edit {
                                span: member.key_span.start
                                    ..inline_comment_end(source, member.value.span.end),
                                text: String::new(),
                            });
                        } else {
                            edits.push(Edit {
                                span: member.key_span.start
                                    ..inline_comment_end(source, member.value.span.end),
                                text: String::new(),
                            });
                        }
                    }
                    _ => return None,
                }
            }
            let mut additions: Vec<&String> = after
                .keys()
                .filter(|key| !before.contains_key(*key))
                .collect();
            if let Some(Node {
                kind: NodeKind::Object(ordered_members),
                ..
            }) = ordered
            {
                additions.sort_by_key(|key| {
                    ordered_members
                        .iter()
                        .position(|member| member.key == ***key)
                        .unwrap_or(usize::MAX)
                });
            }
            if !additions.is_empty() {
                if members
                    .iter()
                    .any(|member| !after.contains_key(&member.key))
                {
                    return None;
                }
                let close = node.span.end.checked_sub(1)?;
                let multiline = source[node.span.start..close].contains('\n');
                let separator = if members
                    .last()
                    .and_then(|member| member.separator.as_ref())
                    .is_some()
                {
                    ""
                } else {
                    ","
                };
                let entries = additions
                    .iter()
                    .map(|key| {
                        let value = after.get(*key)?;
                        let submitted = ordered.and_then(|node| match &node.kind {
                            NodeKind::Object(items) => items
                                .iter()
                                .find(|item| item.key == ***key)
                                .map(|item| &item.value),
                            _ => None,
                        });
                        Some(format!(
                            "{}: {}",
                            serde_json::to_string(key).ok()?,
                            submitted_value_text(order_source, submitted, value)?
                        ))
                    })
                    .collect::<Option<Vec<_>>>()?;
                if multiline {
                    let eol = if source.contains("\r\n") {
                        "\r\n"
                    } else {
                        "\n"
                    };
                    let indent = members
                        .first()
                        .map(|member| line_indent(source, member.key_span.start))
                        .unwrap_or_else(|| format!("{}  ", line_indent(source, close)));
                    if let Some(last) = members.last()
                        && !separator.is_empty()
                    {
                        edits.push(Edit {
                            span: last.value.span.end..last.value.span.end,
                            text: separator.to_string(),
                        });
                    }
                    let line_start = source[..close].rfind('\n').map_or(close, |index| index + 1);
                    if !source[line_start..close].trim().is_empty() {
                        return None;
                    }
                    edits.push(Edit {
                        span: line_start..line_start,
                        text: format!("{indent}{}{eol}", entries.join(&format!(",{eol}{indent}"))),
                    });
                } else {
                    edits.push(Edit {
                        span: close..close,
                        text: format!(
                            "{}{}",
                            if members.is_empty() { "" } else { separator },
                            entries.join(", ")
                        ),
                    });
                }
            }
            Some(())
        }
        (
            NodeKind::Array {
                elements,
                separators,
            },
            Value::Array(before),
            Value::Array(after),
        ) => {
            edits.push(Edit {
                span: node.span.clone(),
                text: render_array(
                    source,
                    node,
                    elements,
                    separators,
                    before,
                    after,
                    (ordered, order_source),
                )?,
            });
            Some(())
        }
        _ => {
            if source[node.span.clone()].contains('#') {
                return None;
            }
            edits.push(Edit {
                span: node.span.clone(),
                text: submitted_value_text(order_source, ordered, next)?,
            });
            Some(())
        }
    }
}

fn render_array(
    source: &str,
    node: &Node,
    elements: &[Node],
    separators: &[Range<usize>],
    before: &[Value],
    after: &[Value],
    submitted: (Option<&Node>, Option<&str>),
) -> Option<String> {
    let (ordered, order_source) = submitted;
    let mut matched = vec![None; after.len()];
    let mut used = vec![false; before.len()];
    for (next, value) in after.iter().enumerate() {
        if let Some(old) = before
            .iter()
            .enumerate()
            .position(|(i, old)| !used[i] && old == value)
        {
            matched[next] = Some(old);
            used[old] = true;
        }
    }
    let new_count = matched.iter().filter(|old| old.is_none()).count();
    if used.iter().filter(|used| !**used).count() > new_count && new_count > 0 {
        return None;
    }
    let mut available = used
        .iter()
        .enumerate()
        .filter_map(|(i, used)| (!used).then_some(i));
    for next in &mut matched {
        if next.is_none() {
            *next = available.next();
        }
    }

    let (open_end, close_start) = (node.span.start + 1, node.span.end - 1);
    let multiline = source[node.span.clone()].contains('\n');
    let indent = elements.first().map_or_else(
        || format!("{}  ", line_indent(source, node.span.start)),
        |element| line_indent(source, element.span.start),
    );
    let eol = if source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut prefixes = Vec::with_capacity(elements.len());
    let mut comments = Vec::with_capacity(elements.len());
    let mut gaps = Vec::with_capacity(elements.len() + 1);
    for (index, element) in elements.iter().enumerate() {
        let separator = separators.get(index);
        let leading = separator.map_or("", |separator| &source[element.span.end..separator.start]);
        if leading.contains('\n') {
            return None;
        }
        let start = separator.map_or(element.span.end, |separator| separator.end);
        let end = elements
            .get(index + 1)
            .map_or(close_start, |next| next.span.start);
        let after = &source[start..end];
        let line_end = after.find('\n').unwrap_or(after.len());
        let line = &after[..line_end];
        let comment = line
            .find('#')
            .filter(|index| line[..*index].trim().is_empty());
        prefixes.push(format!(
            "{leading}{}",
            if separator.is_none() {
                comment.map_or("", |i| &line[..i])
            } else {
                ""
            }
        ));
        comments.push(comment.map_or_else(String::new, |i| {
            if separator.is_some() {
                line.to_string()
            } else {
                line[i..].to_string()
            }
        }));
        gaps.push(if comment.is_some() {
            after[line_end..].to_string()
        } else {
            after.to_string()
        });
    }
    if elements.is_empty() {
        gaps.push(if !after.is_empty() && multiline {
            format!("{eol}{}", line_indent(source, node.span.start))
        } else {
            source[open_end..close_start].to_string()
        });
    }
    let prefix = elements.first().map_or_else(
        || {
            if !after.is_empty() && multiline {
                format!("{eol}{indent}")
            } else {
                String::new()
            }
        },
        |element| source[open_end..element.span.start].to_string(),
    );
    let ordered_elements = ordered.and_then(|node| match &node.kind {
        NodeKind::Array { elements, .. } => Some(elements.as_slice()),
        _ => None,
    });
    let delimiter = separators
        .first()
        .and_then(|span| source.get(span.clone()))
        .unwrap_or(",");
    if separators
        .iter()
        .any(|span| source.get(span.clone()) != Some(delimiter))
    {
        return None;
    }
    let trailing_comma = separators.len() == elements.len() && !elements.is_empty();
    let mut rendered = source[node.span.start..open_end].to_string();
    rendered.push_str(&prefix);
    if after.is_empty() {
        if elements.is_empty() {
            rendered.push_str(&gaps[0]);
        } else {
            for gap in &gaps {
                rendered.push_str(&standalone_comments(gap));
            }
        }
    } else {
        for (index, value) in after.iter().enumerate() {
            let raw = if let Some(old_index) = matched[index] {
                render_node(
                    source,
                    &elements[old_index],
                    &before[old_index],
                    value,
                    ordered_elements.and_then(|items| items.get(index)),
                    order_source,
                )?
            } else {
                submitted_value_text(
                    order_source,
                    ordered_elements.and_then(|items| items.get(index)),
                    value,
                )?
            };
            rendered.push_str(&raw);
            let old_index = matched[index];
            if let Some(old_index) = old_index {
                rendered.push_str(&prefixes[old_index]);
            }
            if index + 1 < after.len() || trailing_comma {
                rendered.push_str(delimiter);
            }
            if let Some(old_index) = old_index {
                rendered.push_str(&comments[old_index]);
            }
            if index + 1 < after.len() {
                rendered.push_str(
                    gaps.get(index)
                        .filter(|_| index + 1 < elements.len())
                        .map(String::as_str)
                        .unwrap_or(if multiline { "\n" } else { "" }),
                );
                if multiline && gaps.get(index).is_none_or(|_| index + 1 >= elements.len()) {
                    rendered.push_str(&indent);
                }
            } else {
                for gap in gaps
                    .iter()
                    .skip(index)
                    .take(elements.len().saturating_sub(after.len()))
                {
                    rendered.push_str(&standalone_comments(gap));
                }
                rendered.push_str(gaps.last().map(String::as_str).unwrap_or(if multiline {
                    eol
                } else {
                    ""
                }));
            }
        }
    }
    rendered.push_str(&source[close_start..node.span.end]);
    Some(rendered)
}

fn render_node(
    source: &str,
    node: &Node,
    before: &Value,
    after: &Value,
    ordered: Option<&Node>,
    order_source: Option<&str>,
) -> Option<String> {
    let mut edits = Vec::new();
    collect_edits(
        source,
        node,
        before,
        after,
        ordered,
        order_source,
        &mut edits,
    )?;
    edits.sort_by_key(|edit| Reverse(edit.span.start));
    let mut rendered = source[node.span.clone()].to_string();
    for edit in edits {
        rendered.replace_range(
            edit.span.start - node.span.start..edit.span.end - node.span.start,
            &edit.text,
        );
    }
    Some(rendered)
}

fn standalone_comments(gap: &str) -> String {
    gap.split_inclusive('\n')
        .filter(|line| line.trim_start().starts_with('#'))
        .collect()
}

fn submitted_value_text(
    order_source: Option<&str>,
    ordered: Option<&Node>,
    value: &Value,
) -> Option<String> {
    if let (Some(source), Some(node)) = (order_source, ordered) {
        let raw = source.get(node.span.clone())?;
        if serde_json::from_str::<Value>(raw).ok().as_ref() == Some(value) {
            return Some(raw.to_string());
        }
    }
    serde_json::to_string(value).ok()
}

fn line_indent(source: &str, at: usize) -> String {
    let start = source[..at].rfind('\n').map_or(0, |index| index + 1);
    source[start..at]
        .chars()
        .take_while(|ch| matches!(ch, ' ' | '\t'))
        .collect()
}

fn inline_comment_end(source: &str, after_value: usize) -> usize {
    let line_end = source[after_value..]
        .find('\n')
        .map_or(source.len(), |offset| after_value + offset);
    let suffix = &source[after_value..line_end];
    if suffix.trim_start().starts_with('#') {
        line_end
    } else {
        after_value
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn preserved(source: &str, value: Value, order: &str) -> String {
        match preserve_json_text(source, &value, Some(order)).unwrap() {
            PreserveResult::Preserved(text) => text,
            PreserveResult::NeedsRewrite(reason) => panic!("unexpected rewrite: {reason}"),
        }
    }

    #[test]
    fn changes_one_value_and_keeps_comments_key_order_and_tail() {
        let source = "{\r\n  # section\r\n  z: 'old', # inline\r\n  a: 2,\r\n}\r\ntrailing text";
        let text = preserved(source, json!({"z":"new","a":2}), r#"{"z":"new","a":2}"#);
        assert!(text.contains("# section\r\n  z: \"new\", # inline"));
        assert!(text.contains("a: 2,"));
        assert!(text.ends_with("}\r\ntrailing text"));
    }

    #[test]
    fn semantic_noop_keeps_every_byte() {
        let source = "{z:'old', a:2,} # tail\r\n";
        assert_eq!(
            preserved(source, json!({"z":"old","a":2}), r#"{"z":"old","a":2}"#),
            source
        );
    }

    #[test]
    fn appends_new_fields_in_submitted_order() {
        let source = "{\n  z: 1\n}\n";
        let text = preserved(source, json!({"z":1,"b":2,"a":3}), r#"{"z":1,"b":2,"a":3}"#);
        assert!(text.find("\"b\": 2").unwrap() < text.find("\"a\": 3").unwrap());
        assert_eq!(
            parse_starsector_json(&text).unwrap(),
            json!({"z":1,"b":2,"a":3})
        );
    }

    #[test]
    fn new_nested_object_uses_submitted_key_order() {
        let source = "{z:1}";
        let text = preserved(
            source,
            json!({"z":1,"nested":{"b":2,"a":3}}),
            r#"{"z":1,"nested":{"b":2,"a":3}}"#,
        );
        assert!(text.contains("\"nested\": {\"b\":2,\"a\":3}"));
    }

    #[test]
    fn removes_field_and_inline_comment_but_keeps_standalone_comment() {
        let source = "{\n  # keep\n  remove: 1, # drop\n  keep: 2\n}\n";
        let text = preserved(source, json!({"keep":2}), r#"{"keep":2}"#);
        assert!(text.contains("# keep"));
        assert!(!text.contains("# drop"));
        assert!(!text.contains("remove:"));
    }

    #[test]
    fn standalone_comment_between_field_and_separator_survives_deletion() {
        let source = "{\n  remove: 1 # inline\n  # standalone\n  ,\n  keep: 2\n}";
        let text = preserved(source, json!({"keep":2}), r#"{"keep":2}"#);
        assert!(text.contains("# standalone"));
        assert!(!text.contains("# inline"));
    }

    #[test]
    fn array_deletions_keep_only_standalone_comments_and_preserve_line_endings() {
        let source = "{ items: [\r\n  # keep\r\n  { id: 'a' }, # remove\r\n  { id: 'b' },\r\n], tail: true }";
        let mut value = parse_starsector_json(source).unwrap();
        value["items"] = json!([]);
        let text = preserved(source, value, r#"{"items":[],"tail":true}"#);
        assert!(text.contains("[\r\n  # keep\r\n  ]"), "{text:?}");
        assert!(text.contains("tail: true"));
        assert!(!text.contains("# remove"));
    }

    #[test]
    fn appends_first_item_to_empty_multiline_array() {
        let source = "{\n  groups: [\n  ]\n}";
        let text = preserved(
            source,
            json!({"groups":[{"id":"new"}]}),
            r#"{"groups":[{"id":"new"}]}"#,
        );
        assert_eq!(text, "{\n  groups: [\n    {\"id\":\"new\"}\n  ]\n}");
    }

    #[test]
    fn array_insertions_and_deletions_preserve_retained_entry_text() {
        let source = "{ items: ['a', 'b', 'c'] }";
        let cases: &[&[&str]] = &[
            &["x", "a", "b", "c"],
            &["a", "x", "b", "c"],
            &["a", "b", "c", "x"],
            &["b", "c"],
            &["a", "c"],
            &["a", "b"],
            &[],
        ];
        for ids in cases {
            let mut value = parse_starsector_json(source).unwrap();
            value["items"] = json!(ids);
            let order = serde_json::to_string(&value).unwrap();
            let text = preserved(source, value, &order);
            for id in ["a", "b", "c"] {
                if ids.contains(&id) {
                    assert!(text.contains(&format!("'{id}'")), "{text}");
                }
            }
        }
    }

    #[test]
    fn reordered_items_carry_inline_comments_and_keep_standalone_comments_in_place() {
        let source = "{ items: [\n  { id: 'a' }, # item a\n  # fixed position\n  { id: 'b' }\n] }";
        let mut value = parse_starsector_json(source).unwrap();
        value["items"].as_array_mut().unwrap().swap(0, 1);
        let text = preserved(source, value, r#"{"items":[{"id":"b"},{"id":"a"}]}"#);
        assert!(text.find("{ id: 'b' }").unwrap() < text.find("# item a").unwrap());
        assert!(text.find("# fixed position").unwrap() < text.find("{ id: 'a' }").unwrap());
    }

    #[test]
    fn changed_nested_array_item_keeps_unmodified_fields() {
        let source = "{\n  groups: [\n    { id: 'a', slots: ['A'] },\n    { id: 'b', slots: ['B'] }\n  ],\n  tail: true\n}";
        let mut value = parse_starsector_json(source).unwrap();
        value["groups"][0]["id"] = json!("updated");
        value["groups"]
            .as_array_mut()
            .unwrap()
            .push(json!({"id":"c","slots":[]}));
        let text = preserved(
            source,
            value,
            r#"{"groups":[{"id":"updated","slots":["A"]},{"id":"b","slots":["B"]},{"id":"c","slots":[]}],"tail":true}"#,
        );
        assert!(text.contains("id: \"updated\", slots: ['A']"));
        assert!(text.contains("id: 'b', slots: ['B']"));
        assert!(text.contains("tail: true"));
    }
}
