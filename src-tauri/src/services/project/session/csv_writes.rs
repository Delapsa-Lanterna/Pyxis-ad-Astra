use super::super::model::{ProjectSession, SessionCsvRow};
use super::super::sources::project_csv;
use super::csv_tables;
use crate::errors::{AppError, AppResult};
use crate::models::CsvTableKey;
use crate::models::file_content::{CsvContent, Record, RecordKind};
use crate::models::file_content::{CsvSource, CsvWrite, SaveLayout};
use std::collections::HashMap;
#[cfg(test)]
use std::mem;
use std::path::Path;
use std::sync::Arc;
#[cfg(test)]
use std::{cell::RefCell, collections::BTreeMap};
#[cfg(test)]
thread_local! { static RENDERS: RefCell<BTreeMap<CsvTableKey,usize>> = const { RefCell::new(BTreeMap::new()) }; }
#[cfg(test)]
pub(crate) fn take_render_counts() -> BTreeMap<CsvTableKey, usize> {
    RENDERS.with(|counts| mem::take(&mut *counts.borrow_mut()))
}

#[derive(Clone)]
pub(in crate::services::project) struct CsvTableDraft {
    pub header: Vec<String>,
    pub rows: Vec<SessionCsvRow>,
    pub next_row_seq: u64,
    pub source: Arc<CsvSource>,
    #[cfg(test)]
    pub table: Option<CsvTableKey>,
}
impl CsvTableDraft {
    pub fn read(session: &ProjectSession, table: CsvTableKey) -> AppResult<Self> {
        Self::read_named(session, table.as_str())
    }
    pub fn read_named(session: &ProjectSession, key: &str) -> AppResult<Self> {
        let state = csv_tables::session_table(session, key)?;
        let rows = csv_tables::loaded_csv_rows(state, key)?.to_vec();
        let source = match &state.source {
            Some(source) => source.clone(),
            None => csv_tables::empty_csv_source(&state.header)?,
        };
        Ok(Self {
            header: state.header.clone(),
            rows,
            next_row_seq: state.next_row_seq,
            source,
            #[cfg(test)]
            table: CsvTableKey::from_key(key),
        })
    }
    pub fn request(&self, layout: SaveLayout) -> AppResult<CsvWrite> {
        let previous = &self.source.document.content;
        let mut source_columns = HashMap::<&str, Vec<usize>>::new();
        for (index, key) in previous.header.iter().enumerate() {
            source_columns.entry(key).or_default().push(index);
        }
        let mut occurrences = HashMap::<&str, usize>::new();
        let columns = self
            .header
            .iter()
            .map(|column| {
                let occurrence = occurrences.entry(column).or_default();
                let source = source_columns
                    .get(column.as_str())
                    .and_then(|indices| indices.get(*occurrence))
                    .copied();
                *occurrence += 1;
                source
            })
            .collect::<Vec<_>>();
        // Duplicate headers expose their last cell as the business value.
        let target_columns = self
            .header
            .iter()
            .enumerate()
            .map(|(index, key)| (key.as_str(), index))
            .collect::<HashMap<_, _>>();
        let header_changed = self.header != previous.header;
        let mut records = Vec::with_capacity(self.rows.len());
        for row in &self.rows {
            let before = row.source_row.map(|index| &previous.records[index]);
            if before.is_some_and(|record| record.kind == RecordKind::Blank) && row.data.is_empty()
            {
                records.push(Record {
                    kind: RecordKind::Blank,
                    cells: Vec::new(),
                });
                continue;
            }
            // Comment records keep their physical columns when the data header moves.
            let fixed_comment =
                row.is_comment && before.is_some_and(|record| record.kind == RecordKind::Comment);
            let header = if fixed_comment {
                &previous.header
            } else {
                &self.header
            };
            let mut cells = if let Some(before) = before {
                before.cells.clone()
            } else {
                vec![String::new(); self.header.len()]
            };
            if header_changed && !fixed_comment {
                cells = columns
                    .iter()
                    .map(|index| {
                        index
                            .and_then(|index| before.and_then(|row| row.cells.get(index)))
                            .cloned()
                            .unwrap_or_default()
                    })
                    .collect();
                if let Some(before) = before {
                    cells.extend(before.cells.iter().skip(previous.header.len()).cloned());
                }
            }
            for (index, key) in header.iter().enumerate() {
                let last = if fixed_comment {
                    *source_columns[key.as_str()]
                        .last()
                        .expect("source header occurrence")
                } else {
                    target_columns[key.as_str()]
                };
                if last != index {
                    continue;
                }
                if let Some(value) = row.data.get(key) {
                    let value = value.as_str().ok_or_else(|| {
                        AppError::message(
                            "csv.cell_requires_text",
                            format!("CSV 字段 {key} 必须交付目标文字"),
                        )
                    })?;
                    let prior = before.and_then(|row| {
                        source_columns
                            .get(key.as_str())
                            .and_then(|indices| indices.last())
                            .and_then(|index| row.cells.get(*index))
                    });
                    if prior.map(String::as_str) != Some(value) || before.is_none() {
                        cells.resize(cells.len().max(index + 1), String::new());
                        cells[index] = value.into();
                    }
                }
            }
            let kind = if row.is_comment {
                RecordKind::Comment
            } else {
                RecordKind::Data
            };
            records.push(Record { kind, cells });
        }
        Ok(CsvWrite {
            content: CsvContent {
                header: self.header.clone(),
                records,
            },
            origins: self.rows.iter().map(|row| row.source_row).collect(),
            columns,
            layout,
        })
    }
    pub fn output(&self, layout: SaveLayout) -> AppResult<Arc<CsvSource>> {
        #[cfg(test)]
        if let Some(table) = self.table {
            RENDERS.with(|counts| *counts.borrow_mut().entry(table).or_default() += 1);
        }
        self.source
            .write(&self.request(layout)?)
            .map(Arc::new)
            .map_err(Into::into)
    }
    pub fn accept(
        self,
        session: &mut ProjectSession,
        table: CsvTableKey,
        actual: Arc<CsvSource>,
    ) -> AppResult<()> {
        self.accept_named(session, table.as_str(), actual)
    }
    pub fn accept_named(
        self,
        session: &mut ProjectSession,
        key: &str,
        actual: Arc<CsvSource>,
    ) -> AppResult<()> {
        let projected = project_csv(
            &actual,
            Path::new(&session.manifest.mod_root)
                .join(&session.csv_tables[key].path)
                .as_path(),
        );
        let rows = projected
            .rows
            .into_iter()
            .zip(self.rows)
            .enumerate()
            .map(|(index, (row, identity))| SessionCsvRow {
                row_key: identity.row_key,
                data: row.data,
                is_comment: row.is_comment,
                source_row: Some(index),
            })
            .collect();
        let state = csv_tables::session_table_mut(session, key)?;
        state.header.clone_from(&actual.document.content.header);
        state.rows = Some(Arc::new(rows));
        state.row_index = None;
        state.next_row_seq = self.next_row_seq;
        state.source = Some(actual);
        state.missing_baseline = false;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use super::*;

    use crate::io::FileChangeSetBuilder;
    use crate::io::{read_utf8_no_bom, write_utf8_no_bom};
    use crate::parsers::game;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::session::build_project_session;
    use crate::services::project::session::csv_tables::ensure_registered_table_rows;
    use crate::services::project::test_support::project_workspace;
    use crate::test_support::TestWorkspace;
    use serde_json::json;
    #[cfg(test)]
    use std::collections::BTreeMap;
    use std::fs;
    #[cfg(windows)]
    #[cfg(test)]
    use std::fs::OpenOptions;
    #[cfg(windows)]
    #[cfg(test)]
    use std::os::windows::fs::OpenOptionsExt;

    #[test]
    fn duplicate_columns_follow_occurrences_and_keep_extra_cells_across_saves() {
        let source = Arc::new(
            game::read_csv(b"id,value,value\r\nentry,001,1.0,extra\r\n\r\n# fixed\r\n").unwrap(),
        );
        let rows = project_csv(&source, Path::new("fixture.csv"))
            .rows
            .into_iter()
            .enumerate()
            .map(|(index, row)| SessionCsvRow {
                row_key: format!("row:{index}"),
                data: row.data,
                is_comment: row.is_comment,
                source_row: Some(index),
            })
            .collect();
        let mut draft = CsvTableDraft {
            header: vec!["value".into(), "id".into(), "value".into()],
            rows,
            next_row_seq: 3,
            source,
            table: None,
        };
        draft.rows[0].data.insert("value".into(), "2.0".into());
        for layout in [SaveLayout::PreserveStructure, SaveLayout::Expanded] {
            let actual = draft.output(layout).unwrap();
            assert_eq!(
                actual.document.content.records[0].cells,
                ["001", "entry", "2.0", "extra"]
            );
            assert_eq!(actual.document.content.records[1].kind, RecordKind::Blank);
            assert_eq!(actual.document.content.records[2].kind, RecordKind::Comment);
        }
        let actual = draft.output(SaveLayout::PreserveStructure).unwrap();
        for (row, actual) in draft
            .rows
            .iter_mut()
            .zip(project_csv(&actual, Path::new("fixture.csv")).rows)
        {
            row.data = actual.data;
        }
        draft.source = actual;
        draft.rows[0].data.insert("value".into(), "3.0".into());
        let actual = draft.output(SaveLayout::PreserveStructure).unwrap();
        assert_eq!(
            actual.document.content.records[0].cells,
            ["001", "entry", "3.0", "extra"]
        );
    }

    fn fixture() -> (TestWorkspace, ProjectSession) {
        let root = project_workspace("csv_writes");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name,custom\n#note,Comment,007\nbase,Original,001\n",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("csv.staging");
        let mut session = build_project_session(&root, None, &mut trace).unwrap();
        ensure_registered_table_rows(&mut session, CsvTableKey::Ships).unwrap();
        (root, session)
    }

    #[test]
    fn successive_writes_accept_exact_text_and_keep_row_key_sequence() {
        let (root, mut session) = fixture();
        let path = root.join("data/hulls/ship_data.csv");
        for index in 0..2 {
            let before = serde_json::to_value(&session.csv_tables["ships"]).unwrap();
            let original = read_utf8_no_bom(&path).unwrap();
            let mut draft = CsvTableDraft::read(&session, CsvTableKey::Ships).unwrap();
            let next_key = format!("ships:row:{}", draft.next_row_seq);
            draft.rows.push(SessionCsvRow {
                source_row: None,
                row_key: next_key.clone(),
                data: json!({"id":format!("added{index}"),"name":"#Literal","custom":"009"})
                    .as_object()
                    .unwrap()
                    .clone(),
                is_comment: false,
            });
            draft.next_row_seq += 1;
            let mut builder = FileChangeSetBuilder::new(&root).unwrap();
            take_render_counts();
            let actual = draft.output(SaveLayout::PreserveStructure).unwrap();
            builder
                .text_file(
                    "data/hulls/ship_data.csv",
                    Some(actual.document.source.to_string()),
                )
                .unwrap();
            assert_eq!(read_utf8_no_bom(&path).unwrap(), original);
            assert_eq!(
                serde_json::to_value(&session.csv_tables["ships"]).unwrap(),
                before
            );
            let changes = builder.apply().unwrap();
            assert_eq!(
                serde_json::to_value(&session.csv_tables["ships"]).unwrap(),
                before
            );
            draft
                .accept(&mut session, CsvTableKey::Ships, actual)
                .unwrap();

            let state = &session.csv_tables["ships"];
            let rows = state.rows.as_ref().unwrap();
            assert_eq!(
                state.source.as_ref().unwrap().document.source.as_ref(),
                changes[0].after_text.as_deref().unwrap()
            );
            assert_eq!(
                state.source.as_ref().unwrap().document.source.as_ref(),
                &read_utf8_no_bom(&path).unwrap()
            );
            assert_eq!(state.header, ["id", "name", "custom"]);
            assert!(rows[0].is_comment);
            assert_eq!(rows[0].data["custom"], "007");
            assert_eq!(rows.last().unwrap().row_key, next_key);
            assert_eq!(state.next_row_seq, rows.len() as u64);
            assert_eq!(
                take_render_counts(),
                BTreeMap::from([(CsvTableKey::Ships, 1)])
            );
            let parsed = file_formats::read_csv_table(&path).unwrap();
            assert!(!parsed.rows.last().unwrap().is_comment);
            assert_eq!(parsed.rows.last().unwrap().data["name"], "#Literal");
        }
        root.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn failed_apply_keeps_formal_table_and_original_file() {
        let (root, session) = fixture();
        let path = root.join("data/hulls/ship_data.csv");
        let before = serde_json::to_value(&session.csv_tables["ships"]).unwrap();
        let original = read_utf8_no_bom(&path).unwrap();
        let mut draft = CsvTableDraft::read(&session, CsvTableKey::Ships).unwrap();
        draft.rows[1].data.insert("name".into(), "Changed".into());
        let mut builder = FileChangeSetBuilder::new(&root).unwrap();
        let actual = draft.output(SaveLayout::PreserveStructure).unwrap();
        builder
            .text_file(
                "data/hulls/ship_data.csv",
                Some(actual.document.source.to_string()),
            )
            .unwrap();
        let locked = OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let result = builder.apply();
        drop(locked);
        assert!(result.is_err());
        assert_eq!(read_utf8_no_bom(&path).unwrap(), original);
        assert_eq!(
            serde_json::to_value(&session.csv_tables["ships"]).unwrap(),
            before
        );
        drop(actual);
        root.close().unwrap();
    }
}
