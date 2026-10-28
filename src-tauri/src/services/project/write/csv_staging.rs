use super::super::{
    cache::csv::read_table_snapshot,
    model::{ProjectSession, SessionCsvRow},
};
use crate::{
    errors::AppResult, io::FileChangeSetBuilder, models::CsvTableKey, parsers::render_csv_text,
};

pub(super) struct CsvTableDraft {
    pub table: CsvTableKey,
    pub header: Vec<String>,
    pub rows: Vec<SessionCsvRow>,
    pub next_row_seq: u64,
}

pub(super) struct StagedCsvWrite {
    pub draft: CsvTableDraft,
    text: String,
}

#[cfg(test)]
thread_local! {
    static RENDER_COUNTS: std::cell::RefCell<std::collections::BTreeMap<CsvTableKey, usize>> =
        const { std::cell::RefCell::new(std::collections::BTreeMap::new()) };
}

#[cfg(test)]
pub(super) fn take_render_counts() -> std::collections::BTreeMap<CsvTableKey, usize> {
    RENDER_COUNTS.with(|counts| std::mem::take(&mut *counts.borrow_mut()))
}

impl CsvTableDraft {
    pub(super) fn read(session: &ProjectSession, table: CsvTableKey) -> AppResult<Self> {
        let (header, rows, next_row_seq) = read_table_snapshot(session, table)?;
        Ok(Self {
            table,
            header,
            rows,
            next_row_seq,
        })
    }

    pub(super) fn stage(
        self,
        session: &ProjectSession,
        builder: &mut FileChangeSetBuilder,
    ) -> AppResult<StagedCsvWrite> {
        let text = render_csv_text(
            &self.header,
            &self
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?;
        #[cfg(test)]
        RENDER_COUNTS.with(|counts| *counts.borrow_mut().entry(self.table).or_default() += 1);
        builder.text_file(
            &session.csv_tables[self.table.as_str()].path,
            Some(text.clone()),
        )?;
        Ok(StagedCsvWrite { draft: self, text })
    }
}

impl StagedCsvWrite {
    pub(super) fn accept(self, session: &mut ProjectSession) {
        let state = session
            .csv_tables
            .get_mut(self.draft.table.as_str())
            .expect("staged CSV table is registered");
        state.header = self.draft.header;
        state.rows = Some(self.draft.rows);
        state.row_index = None;
        state.next_row_seq = self.draft.next_row_seq;
        state.saved_text = Some(self.text);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::{
        io::{read_utf8_no_bom, write_utf8_no_bom},
        services::project::{
            PerformanceTrace, cache::ensure_registered_table_rows, session::build_project_session,
        },
        testutil::TestWorkspace,
    };
    use serde_json::json;
    use std::fs;

    fn fixture() -> (TestWorkspace, ProjectSession) {
        let root = project_workspace("csv_staging");
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
            let staged = draft.stage(&session, &mut builder).unwrap();
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
            staged.accept(&mut session);

            let state = &session.csv_tables["ships"];
            let rows = state.rows.as_ref().unwrap();
            assert_eq!(state.saved_text.as_ref(), changes[0].after_text.as_ref());
            assert_eq!(
                state.saved_text.as_ref().unwrap(),
                &read_utf8_no_bom(&path).unwrap()
            );
            assert_eq!(state.header, ["id", "name", "custom"]);
            assert!(rows[0].is_comment);
            assert_eq!(rows[0].data["custom"], "007");
            assert_eq!(rows.last().unwrap().row_key, next_key);
            assert_eq!(state.next_row_seq, rows.len() as u64);
            assert_eq!(
                take_render_counts(),
                std::collections::BTreeMap::from([(CsvTableKey::Ships, 1)])
            );
            let parsed = crate::io::read_csv_data(&path).unwrap();
            assert!(!parsed.rows.last().unwrap().is_comment);
            assert_eq!(parsed.rows.last().unwrap().data["name"], "#Literal");
        }
        root.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn failed_apply_keeps_formal_table_and_original_file() {
        use std::os::windows::fs::OpenOptionsExt;
        let (root, session) = fixture();
        let path = root.join("data/hulls/ship_data.csv");
        let before = serde_json::to_value(&session.csv_tables["ships"]).unwrap();
        let original = read_utf8_no_bom(&path).unwrap();
        let mut draft = CsvTableDraft::read(&session, CsvTableKey::Ships).unwrap();
        draft.rows[1].data.insert("name".into(), "Changed".into());
        let mut builder = FileChangeSetBuilder::new(&root).unwrap();
        let staged = draft.stage(&session, &mut builder).unwrap();
        let locked = fs::OpenOptions::new()
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
        drop(staged);
        root.close().unwrap();
    }
}
