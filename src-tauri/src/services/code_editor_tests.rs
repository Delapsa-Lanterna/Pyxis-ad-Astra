use super::{enqueue_in, finish, lanes, publish, release_window};
use crate::models::code_editor::{CodeEditorFile, CodeEditorFileResult};
use std::io::Error as IoError;
use std::sync::Arc;
use std::thread;
use tauri::Error as TauriError;
use tauri::ipc::Channel;

fn file(path: &str) -> CodeEditorFile {
    CodeEditorFile {
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
        vec![CodeEditorFileResult {
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
