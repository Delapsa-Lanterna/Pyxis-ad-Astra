#![cfg(test)]
use super::*;
use crate::io;
use crate::services::project::PerformanceTrace;
use crate::services::project::test_support::project_workspace;
use crate::services::{project, project_sync};
use std::sync::mpsc;
use std::sync::mpsc::RecvTimeoutError;
use std::time::Duration;
use std::{fs, thread};

#[test]
fn history_access_checks_scope_and_reads_pending_projection() {
    let workspace = project_workspace("history_access");
    let left = workspace.join("left");
    let right = workspace.join("right");
    fs::create_dir_all(&left).unwrap();
    fs::create_dir_all(&right).unwrap();
    let mut trace = PerformanceTrace::new("history.fixture");
    let first = project::open_project_session_traced(&left, None, &mut trace).unwrap();
    let second = project::open_project_session_traced(&right, None, &mut trace).unwrap();
    let path = left.join("entry.txt");
    fs::write(&path, "saved").unwrap();
    let change = io::build_text_change(&path, Some("next".into())).unwrap();
    let history = record_write(&first.mod_root, &[change], &[], "entry").unwrap();
    project::mark_session_pending(&first.session_id).unwrap();
    assert_eq!(
        query_file_history(&first.session_id, &first.mod_root)
            .unwrap()
            .revision,
        history.revision
    );
    for session in ["unknown", second.session_id.as_str()] {
        let expected = if session == "unknown" {
            "session.unknown"
        } else {
            "session.mod_root_mismatch"
        };
        assert_eq!(
            query_file_history(session, &first.mod_root)
                .unwrap_err()
                .code(),
            expected
        );
        assert_eq!(
            clear_file_history(session, &first.mod_root)
                .unwrap_err()
                .code(),
            expected
        );
    }
    let cleared = clear_file_history(&first.session_id, &first.mod_root).unwrap();
    assert_eq!(cleared.revision, history.revision + 1);
    assert!(cleared.undo_stack.is_empty() && cleared.redo_stack.is_empty());
    assert_eq!(fs::read_to_string(&path).unwrap(), "saved");
    project_sync::release_project_session(first.session_id).unwrap();
    project_sync::release_project_session(second.session_id).unwrap();
    workspace.close().unwrap();
}

#[test]
fn clearing_history_waits_for_the_root_transaction() {
    let root = project_workspace("history_clear_lease");
    let manifest = project::open_project_session_traced(
        &root,
        None,
        &mut PerformanceTrace::new("history.fixture"),
    )
    .unwrap();
    let path = root.join("entry.txt");
    fs::write(&path, "saved").unwrap();
    let lease = io::acquire_root_write_lock(&root).unwrap();
    let (started, waiting) = mpsc::channel();
    let (finished, result) = mpsc::channel();
    let session_id = manifest.session_id.clone();
    let mod_root = manifest.mod_root.clone();
    let worker = thread::spawn(move || {
        started.send(()).unwrap();
        finished
            .send(clear_file_history(&session_id, &mod_root))
            .unwrap();
    });
    waiting.recv().unwrap();
    let blocked = matches!(
        result.recv_timeout(Duration::from_millis(30)),
        Err(RecvTimeoutError::Timeout)
    );
    let saved = record_write(
        &manifest.mod_root,
        &[io::build_text_change(&path, Some("next".into())).unwrap()],
        &[],
        "entry",
    )
    .unwrap();
    drop(lease);
    let cleared = result
        .recv_timeout(Duration::from_secs(5))
        .unwrap()
        .unwrap();
    worker.join().unwrap();
    assert!(blocked);
    assert_eq!(cleared.revision, saved.revision + 1);
    assert!(cleared.undo_stack.is_empty());
    project_sync::release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}
