use super::{enqueue_in, finish, lanes, publish, release_window, sources};
use crate::models::WindowIdentity;
use crate::models::{TextFileOpen, TextFileOpenResult};
use crate::services::project::PerformanceTrace;
use crate::services::{project, project_sync};
use crate::test_support::TestWorkspace;
use std::fs;
use std::io::Error as IoError;
use std::slice::from_ref;
use std::sync::Arc;
use std::thread;
use tauri::Error as TauriError;
use tauri::ipc::Channel;

#[test]
fn project_sources_describe_ready_references_without_starting_java() {
    let work = TestWorkspace::new("code_project_sources");
    let previous = project::reference_sources().unwrap();
    let mut sessions = Vec::new();
    for name in ["sample", "library"] {
        let path = work.join(name);
        fs::create_dir_all(path.join("src")).unwrap();
        fs::write(
            path.join("mod_info.json"),
            format!("{{\"id\":\"{name}\",\"name\":\"{name}\"}}"),
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("code.sources");
        let manifest = project::open_project_session_traced(&path, None, &mut trace).unwrap();
        sessions.push(manifest);
    }
    project::set_reference_sources(from_ref(&sessions[1].session_id)).unwrap();
    let identity = || WindowIdentity::CodeEditor {
        session_id: sessions[0].session_id.clone(),
        mod_root: sessions[0].mod_root.clone(),
    };
    let snapshot = sources(identity()).unwrap();
    assert_eq!(snapshot.sources.len(), 2);
    assert!(!snapshot.sources[0].read_only);
    assert!(snapshot.sources[1].read_only);
    assert_eq!(snapshot.sources[1].directory.as_deref(), Some("src"));
    assert_eq!(snapshot.analysis_roots.len(), 2);
    project::set_reference_sources(&Vec::new()).unwrap();
    assert_eq!(sources(identity()).unwrap().sources.len(), 1);
    for manifest in sessions {
        project_sync::release_project_session(&manifest.session_id).unwrap();
    }
    let previous_ids = previous
        .sources
        .into_iter()
        .map(|source| source.session_id)
        .collect::<Vec<_>>();
    project::set_reference_sources(&previous_ids).unwrap();
    work.close().unwrap();
}

fn file(path: &str) -> TextFileOpen {
    TextFileOpen {
        path: path.into(),
        line: None,
        column: None,
    }
}
#[test]
fn code_editor_queue_keeps_fifo_receipts_and_releases_pending_files() {
    let label = "code-editor-fifo-fixture";
    let first = enqueue_in(
        lanes().unwrap().entry(label.into()).or_default(),
        "first".into(),
        vec![file("A.java")],
    )
    .unwrap();
    let second = enqueue_in(
        lanes().unwrap().entry(label.into()).or_default(),
        "second".into(),
        vec![file("B.java")],
    )
    .unwrap();
    assert!(finish(label, "second", vec![]).is_err());
    let waiter = Arc::clone(&first);
    let waiting = thread::spawn(move || waiter.wait().unwrap());
    finish(
        label,
        "first",
        vec![TextFileOpenResult {
            path: "A.java".into(),
            diagnostic: None,
        }],
    )
    .unwrap();
    assert_eq!(waiting.join().unwrap()[0].path, "A.java");
    assert_eq!(
        lanes().unwrap()[label].tasks.front().unwrap().delivery.key,
        "second"
    );
    release_window(label).unwrap();
    let receipt = second.wait().unwrap();
    assert_eq!(receipt[0].path, "B.java");
    assert_eq!(
        receipt[0].diagnostic.as_ref().unwrap().code,
        "code_editor.released"
    );
    assert!(!lanes().unwrap().contains_key(label));
}

#[test]
fn code_editor_delivery_failure_completes_waiters_and_allows_resubscription() {
    let label = "code-editor-channel-fixture";
    let task = enqueue_in(
        lanes().unwrap().entry(label.into()).or_default(),
        "pending".into(),
        vec![file("Sample.java")],
    )
    .unwrap();
    {
        let mut lanes = lanes().unwrap();
        let lane = lanes.get_mut(label).unwrap();
        lane.channel = Some(Channel::new(|_| {
            Err(TauriError::Io(IoError::other("sample transport closed")))
        }));
        assert!(publish(lane).is_err());
        assert!(lane.tasks.is_empty());
        assert!(lane.channel.is_none());
    }
    assert_eq!(
        task.wait().unwrap()[0].diagnostic.as_ref().unwrap().code,
        "code_editor.delivery_failed"
    );
    release_window(label).unwrap();
}
