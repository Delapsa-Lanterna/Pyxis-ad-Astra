use super::read_versioned_bytes;
use crate::errors::{AppError, AppResult};
use crate::models::FileVersion;
use crate::models::file_content::CsvSource;
use crate::parsers::game;
#[cfg(test)]
use crate::test_support::work_counts;
#[cfg(test)]
use std::cell::Cell;
use std::path::Path;

#[cfg(test)]
thread_local! { static CSV_WORK: Cell<(usize,usize,usize)> = const { Cell::new((0,0,0)) }; }
#[cfg(test)]
pub(crate) fn take_csv_work() -> (usize, usize, usize) {
    CSV_WORK.with(|work| work.replace((0, 0, 0)))
}
#[cfg(test)]
pub(crate) fn record_csv_row_copies(count: usize) {
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads, parses, copies + count));
    });
}
#[cfg(test)]
pub(crate) fn record_csv_disk_read(path: &Path) {
    work_counts::record("read", path);
    if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
    {
        CSV_WORK.with(|work| {
            let (reads, parses, copies) = work.get();
            work.set((reads + 1, parses, copies));
        });
    }
}
pub fn read_csv_data(path: &Path) -> AppResult<CsvSource> {
    read_versioned_csv(path).map(|(_, source)| source)
}
pub fn read_versioned_csv(path: &Path) -> AppResult<(FileVersion, CsvSource)> {
    let (version, bytes) = read_versioned_bytes(path)?;
    parse_csv_data(&version.path, &bytes).map(|source| (version, source))
}
pub fn parse_csv_data(path: &str, bytes: &[u8]) -> AppResult<CsvSource> {
    #[cfg(test)]
    record_csv_parse(Path::new(path));
    game::read_csv(bytes).map_err(|error| {
        AppError::context(format!("读取 CSV 失败：{path}"), AppError::from(error)).at_path(path)
    })
}
#[cfg(test)]
pub(crate) fn record_csv_parse(path: &Path) {
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads, parses + 1, copies));
    });
    work_counts::record("parse", path);
}
#[cfg(test)]
pub fn parse_csv_text(path: &str, text: &str) -> AppResult<CsvSource> {
    parse_csv_data(path, text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::test_support::TestWorkspace;

    #[test]
    fn read_csv_data_reports_missing_file() {
        let root = TestWorkspace::new("missing_csv");
        assert!(read_csv_data(&root.join("missing/table.csv")).is_err());
        root.close().unwrap();
    }

    #[test]
    fn parse_csv_text_reads_headers_and_rows_like_the_game_parser() {
        let text = "id,name\nxy,Ruler\n";
        let table = parse_csv_text("test.csv", text).expect("parsed");
        assert_eq!(
            table.document.content.header,
            vec!["id".to_string(), "name".to_string()]
        );
        assert_eq!(table.document.content.records.len(), 1);
        assert_eq!(table.document.content.records[0].cells[1], "Ruler");
    }
}
