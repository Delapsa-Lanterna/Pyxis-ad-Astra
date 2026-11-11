use crate::errors::{AppError, AppResult};
use crate::models::code_editor::{CodeEditorDelivery, CodeEditorOpen};
use crate::models::{ManagedWindowInput, ManagedWindowRequest, WindowIdentity};
use crate::models::{TextFileOpen, TextFileOpenResult};
use crate::services::windows;
use crate::services::windows::OpenedWindow;
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use tauri::AppHandle;
use tauri::ipc::Channel;

#[derive(Default)]
struct Lane {
    tasks: VecDeque<Arc<OpenTask>>,
    channel: Option<Channel<CodeEditorDelivery>>,
}
pub struct OpenTask {
    delivery: CodeEditorDelivery,
    result: Mutex<Option<Vec<TextFileOpenResult>>>,
    changed: Condvar,
}
impl OpenTask {
    pub fn wait(&self) -> AppResult<Vec<TextFileOpenResult>> {
        let mut result = self.result.lock().map_err(|_| lock_error())?;
        while result.is_none() {
            result = self.changed.wait(result).map_err(|_| lock_error())?;
        }
        Ok(result
            .as_ref()
            .expect("file queue delivered a receipt")
            .clone())
    }
    fn complete(&self, result: Vec<TextFileOpenResult>) -> AppResult<()> {
        *self.result.lock().map_err(|_| lock_error())? = Some(result);
        self.changed.notify_all();
        Ok(())
    }
}
static LANES: LazyLock<Mutex<BTreeMap<String, Lane>>> = LazyLock::new(Default::default);
static OPENING: Mutex<()> = Mutex::new(());

pub(crate) fn open_window(
    app: &AppHandle,
    owner: &str,
    key: String,
    input: CodeEditorOpen,
) -> AppResult<(OpenedWindow, Arc<OpenTask>)> {
    // Window construction and queue admission share one receive order, including initial creation.
    let _opening = OPENING.lock().map_err(|_| lock_error())?;
    let opened = windows::register_window_request(
        app,
        owner,
        ManagedWindowRequest {
            identity: WindowIdentity::CodeEditor {
                session_id: input.session_id,
                mod_root: input.mod_root,
            },
            title: "代码编辑器".into(),
            input: ManagedWindowInput::CodeEditor,
            width: 1120.0,
            height: 780.0,
            min_width: 800.0,
            min_height: 520.0,
        },
    )?;
    let task = enqueue(&opened.label, key, input.files)?;
    Ok((opened, task))
}
fn lock_error() -> AppError {
    AppError::message("code_editor.queue_lock", "Code editor queue unavailable")
}
fn lanes() -> AppResult<MutexGuard<'static, BTreeMap<String, Lane>>> {
    LANES.lock().map_err(|_| lock_error())
}
fn publish(lane: &mut Lane) -> AppResult<()> {
    if let (Some(task), Some(channel)) = (lane.tasks.front(), &lane.channel)
        && let Err(error) = channel.send(task.delivery.clone())
    {
        let diagnostic =
            AppError::message("code_editor.delivery_failed", error.to_string()).diagnostic();
        for pending in lane.tasks.drain(..) {
            pending.complete(
                pending
                    .delivery
                    .files
                    .iter()
                    .map(|file| TextFileOpenResult {
                        path: file.path.clone(),
                        diagnostic: Some(diagnostic.clone()),
                    })
                    .collect(),
            )?;
        }
        lane.channel = None;
        return Err(error.into());
    }
    Ok(())
}
pub fn enqueue(label: &str, key: String, files: Vec<TextFileOpen>) -> AppResult<Arc<OpenTask>> {
    let mut lanes = lanes()?;
    windows::current_window_context(label)?;
    let lane = lanes.entry(label.into()).or_default();
    enqueue_in(lane, key, files)
}
fn enqueue_in(lane: &mut Lane, key: String, files: Vec<TextFileOpen>) -> AppResult<Arc<OpenTask>> {
    let task = Arc::new(OpenTask {
        delivery: CodeEditorDelivery { key, files },
        result: Mutex::new(None),
        changed: Condvar::new(),
    });
    lane.tasks.push_back(Arc::clone(&task));
    if lane.tasks.len() == 1 {
        publish(lane)?;
    }
    Ok(task)
}
pub fn subscribe(label: &str, channel: Channel<CodeEditorDelivery>) -> AppResult<()> {
    let mut lanes = lanes()?;
    if !matches!(
        windows::current_window_context(label)?.identity,
        WindowIdentity::CodeEditor { .. }
    ) {
        return Err(AppError::message(
            "code_editor.window_identity",
            "Code editor window required",
        ));
    }
    let lane = lanes.entry(label.into()).or_default();
    lane.channel = Some(channel);
    publish(lane)
}
pub fn finish(label: &str, key: &str, results: Vec<TextFileOpenResult>) -> AppResult<()> {
    let mut lanes = lanes()?;
    let lane = lanes
        .get_mut(label)
        .ok_or_else(|| AppError::message("code_editor.released", "Code editor queue released"))?;
    if !lane
        .tasks
        .front()
        .is_some_and(|task| task.delivery.key == key)
    {
        return Err(AppError::message(
            "code_editor.queue_owner",
            "File receipt belongs to another queue item",
        ));
    }
    let task = lane.tasks.pop_front().expect("queue front checked");
    task.complete(results)?;
    publish(lane)
}
pub fn release_window(label: &str) -> AppResult<()> {
    if let Some(lane) = lanes()?.remove(label) {
        for task in lane.tasks {
            let results = task
                .delivery
                .files
                .iter()
                .map(|file| TextFileOpenResult {
                    path: file.path.clone(),
                    diagnostic: Some(
                        AppError::message("code_editor.released", "Code editor window released")
                            .diagnostic(),
                    ),
                })
                .collect();
            task.complete(results)?;
        }
    }
    Ok(())
}

#[cfg(test)]
#[path = "code_editor_tests.rs"]
mod tests;

mod sources;
pub use sources::sources;
