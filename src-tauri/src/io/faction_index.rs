use super::FsRootBoundary;
use crate::errors::AppResult;
#[cfg(test)]
use crate::io::read_csv_data;
use crate::models::{CsvTable, FactionIndexEntry};
use crate::parsers::parse_faction_index;
#[cfg(test)]
use std::cell::Cell;
#[cfg(test)]
use std::path::Path;

#[cfg(test)]
thread_local! { static INDEX_READS: Cell<usize> = const { Cell::new(0) }; }

#[cfg(test)]
pub(crate) fn take_faction_index_reads() -> usize {
    INDEX_READS.with(|count| count.replace(0))
}

#[cfg(test)]
pub(crate) fn record_faction_index_read() {
    INDEX_READS.with(|count| count.set(count.get() + 1));
}

#[cfg(test)]
pub fn read_faction_index(root: &Path) -> AppResult<Vec<FactionIndexEntry>> {
    #[cfg(test)]
    INDEX_READS.with(|count| count.set(count.get() + 1));
    let boundary = FsRootBoundary::new(root, "faction root")?;
    let table = read_csv_data(
        &boundary.resolve_relative("data/world/factions/factions.csv", "faction index")?,
    )?;
    faction_index_entries(&boundary, &table)
}

pub fn faction_index_entries(
    boundary: &FsRootBoundary,
    table: &CsvTable,
) -> AppResult<Vec<FactionIndexEntry>> {
    parse_faction_index(table)?
        .into_iter()
        .map(|row| {
            let reference = row.reference.replace('\\', "/");
            let file = if reference.ends_with(".faction") {
                reference
            } else {
                format!("{reference}.faction")
            };
            let relative = if file.contains('/') {
                file
            } else {
                format!("data/world/factions/{file}")
            };
            Ok(FactionIndexEntry {
                path: boundary.resolve_relative(&relative, "faction index target")?,
                row_index: row.row_index,
                id_column: row.id_column,
                file_column: row.file_column,
            })
        })
        .collect()
}
