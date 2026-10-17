use crate::{
    errors::{AppError, AppResult},
    models::{
        FileChangeRecord, FileChangeReplayDirection, FileHistoryEntrySummary, FileHistorySnapshot,
    },
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{LazyLock, Mutex},
};

#[derive(Default)]
struct HistoryState {
    revision: u64,
    undo: Vec<HistoryEntry>,
    redo: Vec<HistoryEntry>,
}

#[derive(Clone)]
pub(crate) struct HistoryEntry {
    pub(crate) identity_changes: Vec<crate::models::EntityIdentityChange>,
    pub(crate) summary: FileHistoryEntrySummary,
    pub(crate) changes: Vec<FileChangeRecord>,
}

static HISTORIES: LazyLock<Mutex<BTreeMap<String, HistoryState>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static HISTORY_LIMIT: LazyLock<Mutex<usize>> =
    LazyLock::new(|| Mutex::new(crate::models::AppSettings::default().file_history_limit as usize));

pub fn release_history(root: &str) -> AppResult<()> {
    let root = root.to_lowercase();
    lock_histories()?.remove(&root);
    Ok(())
}

pub fn set_history_limit(limit: usize) -> AppResult<()> {
    *HISTORY_LIMIT.lock().map_err(|_| history_error())? = limit;
    for history in lock_histories()?.values_mut() {
        if history.undo.len() > limit {
            trim_history(history, limit);
            history.revision += 1;
        }
    }
    Ok(())
}

fn snapshot(history: &HistoryState) -> FileHistorySnapshot {
    FileHistorySnapshot {
        revision: history.revision,
        undo_stack: history
            .undo
            .iter()
            .map(|entry| entry.summary.clone())
            .collect(),
        redo_stack: history
            .redo
            .iter()
            .map(|entry| entry.summary.clone())
            .collect(),
    }
}

fn trim_history(history: &mut HistoryState, limit: usize) {
    let remove = history.undo.len().saturating_sub(limit);
    history.undo.drain(..remove);
}

fn history_limit() -> AppResult<usize> {
    HISTORY_LIMIT
        .lock()
        .map(|limit| *limit)
        .map_err(|_| history_error())
}
fn lock_histories() -> AppResult<std::sync::MutexGuard<'static, BTreeMap<String, HistoryState>>> {
    HISTORIES.lock().map_err(|_| history_error())
}
fn history_error() -> AppError {
    AppError::message("history.lock_poisoned", "file history lock poisoned")
}

pub(crate) fn record(
    root: &str,
    changes: &[FileChangeRecord],
    identities: &[crate::models::EntityIdentityChange],
    label: &str,
) -> AppResult<FileHistorySnapshot> {
    let mut histories = lock_histories()?;
    let history = histories.entry(root.to_string()).or_default();
    if !changes.is_empty() {
        history.revision += 1;
        history.undo.push(HistoryEntry {
            identity_changes: identities.to_vec(),
            summary: FileHistoryEntrySummary {
                id: history.revision,
                label: label.to_string(),
                timestamp: chrono::Utc::now().timestamp_millis(),
                paths: changes
                    .iter()
                    .flat_map(|change| [change.before_path.clone(), change.after_path.clone()])
                    .collect::<std::collections::BTreeSet<_>>()
                    .into_iter()
                    .collect(),
            },
            changes: history_changes(changes),
        });
        history.redo.clear();
        trim_history(history, history_limit()?);
    }
    Ok(snapshot(history))
}

pub(crate) fn query(root: &str) -> AppResult<FileHistorySnapshot> {
    Ok(lock_histories()?
        .get(root)
        .map(snapshot)
        .unwrap_or_default())
}

pub(crate) fn clear(root: &str) -> AppResult<FileHistorySnapshot> {
    let mut histories = lock_histories()?;
    let history = histories.entry(root.to_string()).or_default();
    history.revision += 1;
    history.undo.clear();
    history.redo.clear();
    Ok(snapshot(history))
}

pub(crate) fn prepare_replay(
    root: &str,
    direction: FileChangeReplayDirection,
    entry_id: u64,
    revision: u64,
) -> AppResult<HistoryEntry> {
    let histories = lock_histories()?;
    let history = histories.get(root).ok_or_else(history_conflict)?;
    let stack = match direction {
        FileChangeReplayDirection::Undo => &history.undo,
        FileChangeReplayDirection::Redo => &history.redo,
    };
    stack
        .last()
        .filter(|entry| entry.summary.id == entry_id && history.revision == revision)
        .cloned()
        .ok_or_else(history_conflict)
}

pub(crate) fn accept_replay(
    root: &str,
    direction: FileChangeReplayDirection,
    entry: HistoryEntry,
) -> AppResult<FileHistorySnapshot> {
    let mut histories = lock_histories()?;
    let history = histories
        .get_mut(root)
        .expect("queued history remains registered");
    match direction {
        FileChangeReplayDirection::Undo => {
            history.undo.pop();
            history.redo.push(entry);
        }
        FileChangeReplayDirection::Redo => {
            history.redo.pop();
            history.undo.push(entry);
        }
    }
    history.revision += 1;
    trim_history(history, history_limit()?);
    Ok(snapshot(history))
}

fn history_changes(changes: &[FileChangeRecord]) -> Vec<FileChangeRecord> {
    let mut normalized = Vec::new();
    for change in changes {
        if changes.iter().any(|parent| {
            matches!(parent.kind, crate::models::FileChangeKind::Directory)
                && parent.after_path != change.after_path
                && Path::new(&change.after_path).starts_with(&parent.after_path)
        }) {
            continue;
        }
        let mut combined = change.clone();
        if matches!(combined.kind, crate::models::FileChangeKind::Directory)
            && combined.after_exists
        {
            for child in changes {
                if matches!(child.kind, crate::models::FileChangeKind::File)
                    && let Ok(relative) =
                        Path::new(&child.after_path).strip_prefix(&combined.after_path)
                {
                    let relative = crate::io::forward_slash_path(relative);
                    combined
                        .after_files
                        .retain(|file| file.rel_path != relative);
                    if child.after_exists {
                        combined.after_files.push(crate::models::FileSnapshot {
                            rel_path: relative,
                            text: child.after_text.clone(),
                            data_base64: child.after_data_base64.clone(),
                        });
                    }
                }
            }
            combined
                .after_files
                .sort_by(|left, right| left.rel_path.cmp(&right.rel_path));
        }
        normalized.push(combined);
    }
    normalized
}

fn history_conflict() -> AppError {
    AppError::message("history.version_conflict", "文件历史已更新，请重新确认回放")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recorded_writes_replay_and_clear_through_the_history_owner() {
        let directory = crate::testutil::temp_dir("history_owner");
        let root = directory.to_string_lossy().to_lowercase();
        let change =
            crate::io::build_text_change(&directory.join("entry.txt"), Some("saved".into()))
                .unwrap();
        let saved = record(&root, &[change], &[], "save entry").unwrap();
        assert_eq!(saved.undo_stack.len(), 1);
        assert_eq!(saved.undo_stack[0].label, "save entry");
        let prepared = prepare_replay(
            &root,
            FileChangeReplayDirection::Undo,
            saved.undo_stack[0].id,
            saved.revision,
        )
        .unwrap();
        let undone = accept_replay(&root, FileChangeReplayDirection::Undo, prepared).unwrap();
        assert!(undone.undo_stack.is_empty());
        assert_eq!(undone.redo_stack.len(), 1);
        let unchanged = record(&root, &[], &[], "unchanged").unwrap();
        assert_eq!(unchanged.revision, undone.revision);
        assert_eq!(unchanged.redo_stack[0].id, undone.redo_stack[0].id);
        let prepared = prepare_replay(
            &root,
            FileChangeReplayDirection::Redo,
            undone.redo_stack[0].id,
            undone.revision,
        )
        .unwrap();
        let redone = accept_replay(&root, FileChangeReplayDirection::Redo, prepared).unwrap();
        assert_eq!(redone.undo_stack.len(), 1);
        assert!(redone.redo_stack.is_empty());
        let cleared = clear(&root).unwrap();
        assert_eq!(cleared.revision, redone.revision + 1);
        assert!(cleared.undo_stack.is_empty());
        assert!(query(&root).unwrap().redo_stack.is_empty());
        release_history(&root).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn stale_replay_credentials_preserve_the_current_history() {
        let directory = crate::testutil::temp_dir("history_owner_stale");
        let root = directory.to_string_lossy().to_lowercase();
        let change =
            crate::io::build_text_change(&directory.join("entry.txt"), Some("saved".into()))
                .unwrap();
        let saved = record(&root, &[change], &[], "save entry").unwrap();
        for (id, revision) in [
            (saved.undo_stack[0].id + 1, saved.revision),
            (saved.undo_stack[0].id, saved.revision + 1),
        ] {
            assert_eq!(
                prepare_replay(&root, FileChangeReplayDirection::Undo, id, revision)
                    .err()
                    .unwrap()
                    .code(),
                "history.version_conflict"
            );
        }
        assert_eq!(query(&root).unwrap().revision, saved.revision);
        assert_eq!(
            query(&root).unwrap().undo_stack[0].id,
            saved.undo_stack[0].id
        );
        release_history(&root).unwrap();
        std::fs::remove_dir_all(directory).unwrap();
    }

    fn entry(id: u64) -> HistoryEntry {
        HistoryEntry {
            identity_changes: vec![],
            changes: vec![],
            summary: FileHistoryEntrySummary {
                id,
                label: format!("save {id}"),
                timestamp: id as i64,
                paths: vec![],
            },
        }
    }

    #[test]
    fn shrinking_retains_latest_undo_and_all_redo_per_root() {
        let mut first = HistoryState {
            revision: 4,
            undo: vec![entry(1), entry(2), entry(3)],
            redo: vec![entry(4)],
        };
        let second = HistoryState {
            revision: 1,
            undo: vec![entry(1)],
            redo: vec![],
        };
        trim_history(&mut first, 1);
        assert_eq!(snapshot(&first).undo_stack[0].id, 3);
        assert_eq!(snapshot(&first).redo_stack[0].id, 4);
        assert_eq!(snapshot(&second).undo_stack[0].id, 1);
        trim_history(&mut first, 1000);
        assert_eq!(first.undo.len(), 1);
    }
}
