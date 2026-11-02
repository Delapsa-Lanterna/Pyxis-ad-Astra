use crate::errors::AppResult;
use crate::io::{FsRootBoundary, acquire_root_write_lock};
use crate::models::FileHistorySnapshot;
use crate::services::project::ensure_project_session_mod_root;
use std::path::Path;

mod records;
#[cfg(test)]
mod tests;

#[cfg(test)]
pub(crate) use records::snapshot_for_root;
pub(crate) use records::{accept_replay, prepare_replay, record_write};
pub use records::{release_root_history, set_history_limit};

pub fn query_file_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    ensure_project_session_mod_root(session_id, root)?;
    let root = FsRootBoundary::new(Path::new(root), "history root")?
        .root()
        .to_string_lossy()
        .into_owned();
    records::snapshot_for_root(&root)
}

pub fn clear_file_history(session_id: &str, root: &str) -> AppResult<FileHistorySnapshot> {
    let _lease = acquire_root_write_lock(Path::new(root))?;
    ensure_project_session_mod_root(session_id, root)?;
    let root = FsRootBoundary::new(Path::new(root), "write root")?
        .root()
        .to_string_lossy()
        .into_owned();
    records::clear_root_history(&root)
}
