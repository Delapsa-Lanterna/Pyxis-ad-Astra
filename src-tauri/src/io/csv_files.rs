use crate::{errors::AppResult, models::CsvTable};
use std::path::Path;

use super::read_text_bytes_no_bom;

#[cfg(test)]
thread_local! {
    static CSV_WORK: std::cell::Cell<(usize, usize, usize)> = const { std::cell::Cell::new((0, 0, 0)) };
}

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
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("csv"))
    {
        return;
    }
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads + 1, parses, copies));
    });
}

pub fn read_csv_data(path: &Path) -> AppResult<CsvTable> {
    if !path.exists() {
        return Ok(CsvTable {
            header: vec![],
            rows: vec![],
            path: path.to_string_lossy().to_string(),
        });
    }
    let bytes = read_text_bytes_no_bom(path)?;
    #[cfg(test)]
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads, parses + 1, copies));
    });
    crate::parsers::parse_csv_bytes(&path.to_string_lossy(), &bytes)
}

pub fn parse_csv_text(path_label: &str, text: &str) -> AppResult<CsvTable> {
    #[cfg(test)]
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads, parses + 1, copies));
    });
    crate::parsers::parse_csv_bytes(path_label, text.as_bytes())
}

pub fn parse_csv_data(path_label: &str, bytes: &[u8]) -> AppResult<CsvTable> {
    #[cfg(test)]
    CSV_WORK.with(|work| {
        let (reads, parses, copies) = work.get();
        work.set((reads, parses + 1, copies));
    });
    crate::parsers::parse_csv_bytes(
        path_label,
        bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes),
    )
}

pub fn read_versioned_csv(path: &Path) -> AppResult<(crate::models::FileVersion, CsvTable)> {
    if !path.exists() {
        return Ok((super::file_version(path)?, read_csv_data(path)?));
    }
    let (version, bytes) = super::read_versioned_bytes(path)?;
    let table = parse_csv_data(&version.path, &bytes)?;
    Ok((version, table))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn read_csv_data_returns_an_empty_table_for_missing_files() {
        let missing = std::path::Path::new("definitely/missing/table.csv");
        let table = read_csv_data(missing).expect("empty table");
        assert!(table.header.is_empty());
        assert!(table.rows.is_empty());
    }

    #[test]
    fn parse_csv_text_reads_headers_and_rows_like_the_game_parser() {
        let text = "id,name\nxy,Ruler\n";
        let table = parse_csv_text("test.csv", text).expect("parsed");
        assert_eq!(table.header, vec!["id".to_string(), "name".to_string()]);
        assert_eq!(table.rows.len(), 1);
        assert_eq!(
            table.rows[0]
                .data
                .get("name")
                .and_then(|value| value.as_str()),
            Some("Ruler")
        );
    }
}
