use crate::models::file_content::{
    CsvContent, CsvDocument, ReadFailure, Record, RecordKind, RecordLayout,
};
use crate::models::file_value::Error;
use crate::parsers::game::text::decode_game;
use std::mem;
use std::ops::Range;
use std::sync::Arc;

fn header(text: &str) -> Vec<String> {
    let raw = text.replace('\r', "");
    let mut fields = raw.split(',').collect::<Vec<_>>();
    if raw.contains(',') {
        while fields.last() == Some(&"") {
            fields.pop();
        }
    }
    fields
        .into_iter()
        .map(|s| {
            let s = s.trim_matches(|c: char| c <= ' ');
            let s = s.strip_prefix('"').unwrap_or(s);
            let s = s.strip_suffix('"').unwrap_or(s);
            s.replace("\"\"", "\"")
        })
        .collect()
}

fn parse<const LAYOUT: bool, const GAME: bool>(
    source: &str,
) -> Result<(CsvContent, Range<usize>, Vec<RecordLayout>), Error> {
    let Some(end) = source.find('\n') else {
        return Ok((
            CsvContent {
                header: header(source),
                records: Vec::new(),
            },
            0..source.len(),
            Vec::new(),
        ));
    };
    let fields = header(&source[..end]);
    let mut records = Vec::new();
    let mut layouts = Vec::new();
    let bytes = source.as_bytes();
    let mut pos = end + 1;
    let mut row_start = pos;
    let mut cell_start = pos;
    let mut cells = Vec::new();
    let mut spans = Vec::new();
    let mut cell = String::new();
    let mut quote = false;
    let mut quote_start = pos;
    let mut started = false;
    let mut comment = false;
    while pos < source.len() {
        let start = pos;
        let byte = bytes[pos];
        let ch = if byte < 128 {
            byte as char
        } else {
            source[pos..].chars().next().expect("character")
        };
        pos += ch.len_utf8();
        if ch == '\r' && (GAME || bytes.get(pos) == Some(&b'\n')) {
            continue;
        }
        if !started {
            cell_start = row_start;
            comment = ch == '#';
            started = true;
            if ch == '\n' {
                records.push(Record {
                    kind: RecordKind::Blank,
                    cells: Vec::new(),
                });
                if LAYOUT {
                    layouts.push(RecordLayout {
                        span: row_start..pos,
                        cells: Vec::new(),
                    });
                }
                started = false;
                row_start = pos;
                continue;
            }
        }
        if ch == '"' {
            let mut look = pos;
            if GAME {
                while bytes.get(look) == Some(&b'\r') {
                    look += 1;
                }
            }
            if bytes.get(look) == Some(&b'"') {
                cell.push('"');
                pos = look + 1;
            } else {
                quote = !quote;
                if quote {
                    quote_start = start;
                }
            }
        } else if (ch == ',' || ch == '\n') && !quote {
            cells.push(mem::take(&mut cell));
            if LAYOUT {
                let end = if ch == '\n' {
                    cell_start + source[cell_start..start].trim_end_matches('\r').len()
                } else {
                    start
                };
                spans.push(cell_start..end);
            }
            if ch == ',' {
                cell_start = pos;
            } else {
                records.push(Record {
                    kind: if comment {
                        RecordKind::Comment
                    } else {
                        RecordKind::Data
                    },
                    cells: mem::take(&mut cells),
                });
                if LAYOUT {
                    layouts.push(RecordLayout {
                        span: row_start..pos,
                        cells: mem::take(&mut spans),
                    });
                }
                started = false;
                row_start = pos;
            }
        } else {
            cell.push(ch);
        }
    }
    if quote {
        return Err(Error::at(
            "parse.csv_unterminated_quote",
            "mismatched quotes in the string",
            source,
            quote_start,
        ));
    }
    if started {
        cells.push(cell);
        if LAYOUT {
            spans.push(cell_start..cell_start + source[cell_start..].trim_end_matches('\r').len());
        }
        records.push(Record {
            kind: if comment {
                RecordKind::Comment
            } else {
                RecordKind::Data
            },
            cells,
        });
        if LAYOUT {
            layouts.push(RecordLayout {
                span: row_start..source.len(),
                cells: spans,
            });
        }
    }
    Ok((
        CsvContent {
            header: fields,
            records,
        },
        0..end + 1,
        layouts,
    ))
}
pub fn read_csv(bytes: &[u8]) -> Result<CsvContent, ReadFailure> {
    let text = decode_game(bytes);
    parse::<false, true>(&text)
        .map(|r| r.0)
        .map_err(|error| ReadFailure {
            text: text.into_owned(),
            error,
        })
}
impl CsvDocument {
    pub fn read(bytes: &[u8]) -> Result<Self, ReadFailure> {
        let source: Arc<str> = Arc::from(decode_game(bytes).as_ref());
        let (content, header, records) =
            parse::<true, true>(&source).map_err(|error| ReadFailure {
                text: source.to_string(),
                error,
            })?;
        Ok(Self {
            source,
            content,
            header,
            records,
        })
    }
}

fn cell(value: &str, out: &mut String, force: bool) {
    if !value.is_empty() && value.bytes().all(|b| b == b'"') {
        out.push_str(&value.replace('"', "\"\""));
        return;
    }
    if force || value.contains([',', '"', '\n', '\r']) {
        out.push('"');
        out.push_str(&value.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(value);
    }
}
fn record(value: &Record, width: usize, eol: &str, out: &mut String) {
    let begin = out.len();
    match value.kind {
        RecordKind::Blank => {
            for _ in 1..width.max(2) {
                out.push(',');
            }
        }
        RecordKind::Data | RecordKind::Comment => {
            let width = if value.kind == RecordKind::Comment {
                value.cells.len().max(1)
            } else {
                width.min(value.cells.len())
            };
            for i in 0..width {
                if i > 0 {
                    out.push(',');
                }
                let text = value.cells.get(i).map(String::as_str).unwrap_or("");
                if i == 0 && value.kind == RecordKind::Comment {
                    out.push('#');
                    cell(text.strip_prefix('#').unwrap_or(text), out, false);
                } else {
                    cell(text, out, i == 0 && text.starts_with('#'));
                }
            }
            if out.len() == begin {
                out.push(',');
            }
        }
    }
    out.push_str(eol);
}
fn write_header(header: &[String], eol: &str, out: &mut String) {
    if header.is_empty() {
        out.push(',');
    }
    for (i, value) in header.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push('"');
        out.push_str(&value.replace('"', "\"\""));
        out.push('"');
    }
    out.push_str(eol);
}
fn representable(content: &CsvContent) -> Result<(), Error> {
    if content.header.iter().any(|s| s.contains([',', '\n', '\r'])) {
        return Err(Error::output(
            "CSV header splitting cannot represent this column name",
        ));
    }
    if content
        .records
        .iter()
        .flat_map(|r| &r.cells)
        .any(|s| s.contains('\r'))
    {
        return Err(Error::output(
            "CSV file loading removes CR; this cell cannot be represented exactly",
        ));
    }
    Ok(())
}
pub fn write_csv(content: &CsvContent) -> Result<String, Error> {
    representable(content)?;
    let mut out = String::new();
    write_header(&content.header, "\n", &mut out);
    for row in &content.records {
        record(row, content.header.len(), "\n", &mut out);
    }
    Ok(out)
}

/// Row and column origins are supplied by the editing document, including duplicates.
pub fn write_mapped(
    doc: &CsvDocument,
    next: &CsvContent,
    rows: &[Option<usize>],
    columns: &[Option<usize>],
    original: bool,
) -> Result<String, Error> {
    representable(next)?;
    let eol = if original && doc.source.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut out = String::with_capacity(doc.source.len());
    if doc.content.header == next.header {
        out.push_str(&doc.source[doc.header.clone()]);
    } else {
        write_header(&next.header, eol, &mut out);
    }
    for (index, row) in next.records.iter().enumerate() {
        if !out.ends_with('\n') {
            out.push_str(eol);
        }
        let previous =
            rows[index].map(|origin| (&doc.content.records[origin], &doc.records[origin]));
        let identity_columns = columns
            .iter()
            .enumerate()
            .all(|(i, source)| *source == Some(i));
        if let Some((before, layout)) = previous
            && before == row
            && identity_columns
        {
            out.push_str(&doc.source[layout.span.clone()]);
            continue;
        }
        if row.kind == RecordKind::Blank {
            out.push_str(eol);
            continue;
        }
        for (column, value) in row.cells.iter().enumerate() {
            if column > 0 {
                out.push(',');
            }
            let origin = if row.kind == RecordKind::Comment {
                Some(column)
            } else if column < columns.len() {
                columns[column]
            } else {
                Some(doc.content.header.len() + column - next.header.len())
            };
            let raw = previous.and_then(|(before, layout)| {
                let origin = origin?;
                (before.kind == row.kind && before.cells.get(origin) == Some(value))
                    .then(|| layout.cells.get(origin))
                    .flatten()
            });
            if let Some(span) = raw {
                out.push_str(&doc.source[span.clone()]);
            } else if column == 0 && row.kind == RecordKind::Comment {
                out.push('#');
                cell(value.strip_prefix('#').unwrap_or(value), &mut out, false);
            } else {
                cell(value, &mut out, column == 0 && value.starts_with('#'));
            }
        }
        let ending = previous
            .map(|(_, layout)| {
                let end = layout
                    .cells
                    .last()
                    .map_or(layout.span.start, |span| span.end);
                &doc.source[end..layout.span.end]
            })
            .unwrap_or(eol);
        out.push_str(if original { ending } else { eol });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use crate::models::file_value::Error as AlexCsvError;

    use super::{CsvContent, CsvDocument, Record, RecordKind, read_csv, write_csv, write_mapped};
    use std::fs;
    use std::path::Path;
    fn read(text: &str) -> CsvContent {
        read_csv(text.as_bytes()).unwrap()
    }
    fn row(cells: &[&str]) -> Record {
        Record {
            kind: RecordKind::Data,
            cells: cells.iter().map(|v| (*v).into()).collect(),
        }
    }
    fn rendered(content: &CsvContent) -> CsvContent {
        read(&write_csv(content).unwrap())
    }

    fn preserve_csv(document: &CsvDocument, content: &CsvContent) -> Result<String, AlexCsvError> {
        write_mapped(
            document,
            content,
            &(0..content.records.len()).map(Some).collect::<Vec<_>>(),
            &(0..content.header.len()).map(Some).collect::<Vec<_>>(),
            true,
        )
    }

    #[test]
    fn comment_flags_follow_the_original_record_start_before_quote_parsing() {
        for (text, kind) in [
            ("#entry,x", RecordKind::Comment),
            ("\"#entry\",x", RecordKind::Data),
            (" #entry,x", RecordKind::Data),
        ] {
            let content = read(&format!("id,name\n{text}\n"));
            assert_eq!(content.records[0].kind, kind);
            assert_eq!(rendered(&content), content);
        }
    }
    #[test]
    fn save_preserves_visible_empty_rows_from_rows() {
        let content = read("id,name\n,\nentry,Name\n");
        assert_eq!(rendered(&content), content);
    }
    #[test]
    fn save_preserves_physical_blank_records() {
        let document = CsvDocument::read(b"id,name\n\nentry,Name\n").unwrap();
        assert_eq!(
            preserve_csv(&document, &document.content).unwrap(),
            "id,name\n\nentry,Name\n"
        );
    }
    #[test]
    fn read_tolerates_short_and_long_rows() {
        let content = read("id,name,notes\nsolo\nentry,Name,note,extra,more\n");
        assert_eq!(content.records[0].cells, ["solo"]);
        assert_eq!(
            content.records[1].cells,
            ["entry", "Name", "note", "extra", "more"]
        );
        assert_eq!(
            content.header.iter().zip(&content.records[1].cells).count(),
            3
        );
    }
    #[test]
    fn read_keeps_visible_empty_rows_and_distinguishes_empty_line_from_empty_cells() {
        let content = read("id,name,notes\na,A,note\n#section\n\n,,\nb,B,next\n");
        assert_eq!(content.records.len(), 5);
        assert_eq!(content.records[1].kind, RecordKind::Comment);
        assert_eq!(content.records[2].kind, RecordKind::Blank);
        assert!(content.records[2].cells.is_empty());
        assert_eq!(content.records[3].cells, ["", "", ""]);
    }
    #[test]
    fn read_preserves_blank_lines_inside_quoted_multiline_fields() {
        let content = read("id,text\r\nentry,\"first\r\n\r\nthird\"\r\n#note\r\n");
        assert_eq!(content.records.len(), 2);
        assert_eq!(content.records[0].cells[1], "first\n\nthird");
    }
    #[test]
    fn damaged_utf8_is_replaced_before_quote_parsing() {
        let content = read_csv(b"id,text\nentry,\"an \x93odd\x94 phrase, inside\"\n").unwrap();
        assert_eq!(
            content.records[0].cells,
            ["entry", "an \u{fffd}odd\u{fffd} phrase, inside"]
        );
    }
    #[test]
    fn read_keeps_hash_prefixed_data_rows_with_full_width() {
        let content = read("name,id,description\n#Disabled,entry,\"first\n\nthird\"\n#section\n");
        assert_eq!(content.records[0].kind, RecordKind::Comment);
        assert_eq!(
            content.records[0].cells,
            ["#Disabled", "entry", "first\n\nthird"]
        );
        assert_eq!(content.records[1].cells, ["#section"]);
    }
    #[test]
    fn read_keeps_hash_prefixed_short_rows_with_missing_keys() {
        let content = read("id,text,text2\n#one,\n#two,\"\"\n");
        assert_eq!(content.records[0].cells, ["#one", ""]);
        assert_eq!(content.records[1].cells, ["#two", "\""]);
    }
    #[test]
    fn read_rejects_unterminated_quoted_field_at_eof() {
        let failure = read_csv(b"id,text\nentry,\"unfinished\nvalue").unwrap_err();
        assert_eq!(failure.error.code, "parse.csv_unterminated_quote");
        assert_eq!(failure.error.line, 2);
        assert_eq!(failure.text, "id,text\nentry,\"unfinished\nvalue");
    }
    #[test]
    fn csv_error_keeps_physical_quote_line_and_column() {
        let failure = read_csv(b"id,text\nentry,\"first\n\nunfinished").unwrap_err();
        assert_eq!(failure.error.line, 2);
        assert_eq!(failure.error.column, 7);
    }
    #[test]
    fn read_parses_header_cells_with_trim_and_quote_stripping() {
        let content = read(" id , \"name\" ,\"a\"\"b\"\r\n1,2,3\r\n");
        assert_eq!(content.header, ["id", "name", "a\"b"]);
    }
    #[test]
    fn read_drops_trailing_empty_header_cells_like_java_split() {
        assert_eq!(read("id,name,,\nentry,Name\n").header, ["id", "name"]);
        assert_eq!(read("\nentry,Name\n").header, [""]);
    }
    #[test]
    fn read_treats_header_only_file_as_header_with_no_rows() {
        let content = read("id,name\r\n");
        assert_eq!(content.header, ["id", "name"]);
        assert!(content.records.is_empty());
    }
    #[test]
    fn read_treats_newline_less_file_as_header_row() {
        let content = read("id,name");
        assert_eq!(content.header, ["id", "name"]);
        assert!(content.records.is_empty());
    }
    #[test]
    fn read_flushes_last_row_without_trailing_newline() {
        assert_eq!(
            read("id,name\nentry,Name").records[0].cells,
            ["entry", "Name"]
        );
    }
    #[test]
    fn read_drops_lone_carriage_returns_like_game() {
        assert_eq!(
            read("id,name\nleft\rright,Name\n").records[0].cells,
            ["leftright", "Name"]
        );
    }
    #[test]
    fn read_toggles_quotes_across_delimiters_like_game() {
        assert_eq!(
            read("id,name\nleft\"middle,part\"right,Name\n").records[0].cells,
            ["leftmiddle,partright", "Name"]
        );
    }
    #[test]
    fn render_csv_text_writes_header_and_rows() {
        let content = CsvContent {
            header: vec!["id".into(), "name".into()],
            records: vec![row(&["entry", "Name"])],
        };
        assert_eq!(rendered(&content), content);
    }
    #[test]
    fn render_parse_round_trip_preserves_a_quote_only_cell() {
        let content = CsvContent {
            header: vec!["id".into(), "text".into()],
            records: vec![row(&["entry", "\""])],
        };
        assert_eq!(rendered(&content), content);
    }
    #[test]
    fn utf8_characters_are_decoded_before_replacement() {
        assert_eq!(read("id,name\nentry,铜\n").records[0].cells[1], "铜");
    }
    #[test]
    fn parse_render_parse_round_trip_is_semantic_identity_and_render_is_stable() {
        let content = CsvContent {
            header: vec!["id".into(), "name".into(), "description".into()],
            records: vec![
                row(&["entry", "Name, commas", "said \"hello\""]),
                row(&["#data", "Name", "first\n\nthird"]),
            ],
        };
        let first = write_csv(&content).unwrap();
        let actual = read(&first);
        assert_eq!(actual, content);
        assert_eq!(write_csv(&actual).unwrap(), first);
    }
    #[test]
    fn collected_real_csv_fixtures_keep_every_cell_through_replay() {
        let directory = Path::new(env!("CARGO_MANIFEST_DIR")).join("testdata/csv");
        let mut count = 0;
        for entry in fs::read_dir(directory).unwrap() {
            let path = entry.unwrap().path();
            let bytes = fs::read(&path).unwrap();
            let document = CsvDocument::read(&bytes).unwrap();
            let output = preserve_csv(&document, &document.content).unwrap();
            let actual = read(&output);
            assert_eq!(actual, document.content, "{}", path.display());
            assert_eq!(
                preserve_csv(&CsvDocument::read(output.as_bytes()).unwrap(), &actual).unwrap(),
                output
            );
            count += 1;
        }
        assert_eq!(count, 13);
    }

    #[test]
    fn save_preserves_empty_record_semantics() {
        let source = CsvDocument::read(b"id,name\n\nb,B\n").unwrap();
        let output = write_mapped(
            &source,
            &source.content,
            &[Some(0), Some(1)],
            &[Some(0), Some(1)],
            false,
        )
        .unwrap();
        let actual = CsvDocument::read(output.as_bytes()).unwrap();
        assert_eq!(actual.content.records.len(), 2);
        assert!(actual.content.records[0].cells.iter().all(String::is_empty));
        assert_eq!(actual.content.records[1].cells, ["b", "B"]);
    }
    #[test]
    fn malformed_utf8_is_replaced_without_changing_csv_quote_state() {
        let source = CsvDocument::read(b"id,text\na,\"A \x93quoted\x94 value\"\n").unwrap();
        assert_eq!(
            source.content.records[0].cells[1],
            "A \u{fffd}quoted\u{fffd} value"
        );
    }
    #[test]
    fn csv_error_keeps_physical_quote_line() {
        let failure = CsvDocument::read(b"id,text\na,\"line\n\nunfinished").unwrap_err();
        assert_eq!(failure.error.line, 2);
        assert_eq!(failure.text, "id,text\na,\"line\n\nunfinished");
    }
    #[test]
    fn game_read_discards_lone_carriage_returns() {
        let source = CsvDocument::read(b"id,name\r\na\rb,B\r\n").unwrap();
        assert_eq!(source.content.records[0].cells, ["ab", "B"]);
    }
    #[test]
    fn utf8_characters_are_decoded_before_parsing() {
        let source = CsvDocument::read("id,name\na,铜\n".as_bytes()).unwrap();
        assert_eq!(source.content.records[0].cells[1], "铜");
    }
}
