use crate::errors::{AppError, AppResult, ErrorDiagnostic};
use crate::io::RootWriteLock;
use crate::models::{
    CommittedSessionUpdate, CommittedWriteEvent, EntityIdentityChange, FileVersion,
    ProjectSyncDelivery, ReferenceSources, SourceSyncState, WriteResult, windows_path_key,
};
use crate::services::clear_session_media;
#[cfg(test)]
use crate::services::source_watch::SourceChangeBatch;
use crate::services::{file_history, java_analysis, project, windows};
#[cfg(test)]
use crate::test_support::TestWorkspace;
use crate::{diagnostics, io};
use serde::Serialize;
use serde_json::json;
#[cfg(test)]
use source_changes::{SOURCE_WATCHES, consume_core_batch, consume_source_batch};
#[cfg(test)]
use source_changes::{begin_source_watch, retain_source_watch};
pub use source_changes::{
    configure_source_watch, open_project_session, retry_source_watch, set_window_core_subscription,
};
use source_changes::{publish_source_status, release_source_watch};
use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard};
use std::time::Instant;
use tauri::ipc::Channel;

#[derive(Default)]
struct Progress {
    identities: Vec<EntityIdentityChange>,
    versions: Vec<FileVersion>,
    blocked: Option<ErrorDiagnostic>,
    abandoned: bool,
    confirmation: Option<SourceConfirmation>,
}
struct SourceConfirmation {
    paths: Vec<String>,
    accepted: Option<bool>,
    responder: Option<String>,
}
pub struct SaveTask {
    id: String,
    owner: String,
    root: String,
    submitted_root: String,
    session_id: Option<String>,
}
struct QueuedSave {
    task: Arc<SaveTask>,
    progress: Progress,
}
#[derive(Clone)]
struct SaveWindow {
    root: Option<String>,
    core_root: Option<String>,
    channel: Channel<ProjectSyncDelivery>,
}
impl SaveWindow {
    fn belongs_to(&self, root: &str) -> bool {
        self.root
            .as_ref()
            .is_none_or(|owned| windows_path_key(owned) == windows_path_key(root))
    }
}
#[derive(Default)]
struct ProjectSaves {
    source_states: BTreeMap<String, ProjectSyncDelivery>,
    references: ReferenceSources,
    windows: BTreeMap<String, SaveWindow>,
    roots: BTreeMap<String, VecDeque<QueuedSave>>,
}
impl ProjectSaves {
    fn registered_root(&self, root: &str) -> String {
        let requested = windows_path_key(root);
        self.roots
            .iter()
            .find(|(key, queue)| {
                **key == requested
                    || queue
                        .iter()
                        .any(|entry| entry.task.submitted_root == requested)
            })
            .map(|(key, _)| key.clone())
            .unwrap_or(requested)
    }
    fn offer_confirmation(&mut self, task: &SaveTask) -> AppResult<()> {
        let Some(confirmation) = self.progress(task).confirmation.as_ref() else {
            return Ok(());
        };
        if confirmation.accepted.is_some() || confirmation.responder.is_some() {
            return Ok(());
        }
        let paths = confirmation.paths.clone();
        let selected = self
            .windows
            .get_key_value(&task.owner)
            .or_else(|| {
                self.windows
                    .iter()
                    .find(|(_, window)| window.belongs_to(&task.root))
            })
            .map(|(label, window)| (label.clone(), window.channel.clone()));
        if let Some((label, channel)) = selected {
            channel.send(ProjectSyncDelivery::Missing {
                request_id: task.id.clone(),
                paths,
            })?;
            self.progress(task)
                .confirmation
                .as_mut()
                .expect("current save holds its confirmation")
                .responder = Some(label);
        }
        Ok(())
    }
    fn progress(&mut self, task: &SaveTask) -> &mut Progress {
        &mut self
            .roots
            .get_mut(&task.root)
            .expect("active save owns its root queue")
            .iter_mut()
            .find(|entry| entry.task.id == task.id)
            .expect("active save is queued")
            .progress
    }
    fn finish(&mut self, root: &str) {
        let queue = self
            .roots
            .get_mut(root)
            .expect("completed save owns its queue");
        queue.pop_front();
        if queue.is_empty() {
            self.roots.remove(root);
            self.notify(root, false);
        }
        SAVES.1.notify_all();
    }
    fn notify(&self, root: &str, waiting: bool) {
        for window in self
            .windows
            .values()
            .filter(|window| window.belongs_to(root))
        {
            if let Err(error) = window.channel.send(ProjectSyncDelivery::Waiting {
                mod_root: root.to_string(),
                waiting,
            }) {
                diagnostics::failure(
                    "save.queue_notification_failed",
                    error,
                    json!({"modRoot":root,"waiting":waiting}),
                );
            }
        }
    }
    fn block(&mut self, task: &SaveTask, diagnostic: ErrorDiagnostic) {
        self.progress(task).blocked = Some(diagnostic.clone());
        for window in self
            .windows
            .values()
            .filter(|window| window.belongs_to(&task.root))
        {
            if let Err(error) = window.channel.send(ProjectSyncDelivery::Blocked {
                request_id: task.id.clone(),
                mod_root: task.root.clone(),
                session_id: task.session_id.clone(),
                diagnostic: diagnostic.clone(),
            }) {
                diagnostics::failure(
                    "save.blocked_notification_failed",
                    error,
                    json!({"requestId":task.id,"modRoot":task.root,"sessionId":task.session_id,"blockedCode":diagnostic.code}),
                );
            }
        }
        SAVES.1.notify_all();
    }
}
mod source_changes;

static SAVES: LazyLock<(Mutex<ProjectSaves>, Condvar)> = LazyLock::new(Default::default);
fn saves() -> AppResult<MutexGuard<'static, ProjectSaves>> {
    SAVES
        .0
        .lock()
        .map_err(|_| AppError::message("write.queue_poisoned", "保存队列不可用"))
}
fn wait_changed(
    guard: MutexGuard<'static, ProjectSaves>,
) -> AppResult<MutexGuard<'static, ProjectSaves>> {
    SAVES
        .1
        .wait(guard)
        .map_err(|_| AppError::message("write.queue_poisoned", "保存队列不可用"))
}
fn root_key(root: &str) -> AppResult<String> {
    Ok(windows_path_key(
        &io::canonical_path(Path::new(root), "save root")?.to_string_lossy(),
    ))
}
fn task(id: &str) -> AppResult<Arc<SaveTask>> {
    saves()?
        .roots
        .values()
        .flatten()
        .find(|entry| entry.task.id == id)
        .map(|entry| entry.task.clone())
        .ok_or_else(|| AppError::message("write.request_unknown", "保存请求已结束"))
}
pub fn register(
    label: &str,
    root: Option<String>,
    channel: Channel<ProjectSyncDelivery>,
) -> AppResult<()> {
    let mut saves = saves()?;
    let window = SaveWindow {
        root,
        core_root: None,
        channel,
    };
    window.channel.send(ProjectSyncDelivery::References {
        snapshot: saves.references.clone(),
        event: None,
    })?;
    for (root, delivery) in &saves.source_states {
        if window.belongs_to(root) {
            window.channel.send(delivery.clone())?;
        }
    }
    for root in saves.roots.keys().filter(|root| window.belongs_to(root)) {
        window.channel.send(ProjectSyncDelivery::Waiting {
            mod_root: root.clone(),
            waiting: true,
        })?;
    }
    saves.windows.insert(label.to_string(), window);
    let confirmations = saves
        .roots
        .values()
        .flatten()
        .filter(|entry| entry.progress.confirmation.is_some())
        .map(|entry| entry.task.clone())
        .collect::<Vec<_>>();
    for task in confirmations {
        saves.offer_confirmation(&task)?;
    }
    Ok(())
}
/// Registration fixes receive order before blocking workers start.
pub fn enqueue(
    label: &str,
    request_id: String,
    root: &str,
    session_id: Option<&str>,
) -> AppResult<Arc<SaveTask>> {
    if !windows::accepts_save(label, session_id)? {
        return Err(AppError::message(
            "write.scope_closing",
            "所属窗口或项目正在关闭",
        ));
    }
    let task = Arc::new(SaveTask {
        id: request_id,
        owner: label.to_string(),
        root: root_key(root)?,
        submitted_root: windows_path_key(root),
        session_id: session_id.map(str::to_string),
    });
    let mut saves = saves()?;
    let queue = saves.roots.entry(task.root.clone()).or_default();
    let progress = Progress::default();
    let first = queue.is_empty();
    queue.push_back(QueuedSave {
        task: task.clone(),
        progress,
    });
    if first {
        saves.notify(&task.root, true);
    }
    Ok(task)
}
/// The project queue owns execution; subscribers receive results without holding the queue.
pub fn execute_queued<T: Serialize>(
    task: Arc<SaveTask>,
    event_root: &str,
    session_id: Option<&str>,
    reason: &str,
    mut action: impl FnMut(&[EntityIdentityChange], &[FileVersion]) -> AppResult<WriteResult<T>>,
) -> AppResult<WriteResult<T>> {
    let queued = Instant::now();
    let (identities, versions) = {
        let mut saves = saves()?;
        while saves.roots[&task.root]
            .front()
            .expect("queued save is registered")
            .task
            .id
            != task.id
        {
            saves = wait_changed(saves)?;
        }
        if saves.progress(&task).abandoned {
            saves.finish(&task.root);
            return Err(AppError::message("write.abandoned", "所属项目保存已结束"));
        }
        let progress = saves.progress(&task);
        (progress.identities.clone(), progress.versions.clone())
    };
    let started = Instant::now();
    let recovery = task.clone();
    let result = io::with_write_retry(
        Path::new(event_root),
        move |error| wait_retry(&recovery, error),
        || loop {
            match action(&identities, &versions) {
                Err(AppError::SaveSourcesMissing { paths }) => {
                    confirm_sources(&task, paths.clone())?;
                    io::accept_source_recreation(&task.root, paths)?;
                }
                result => break result,
            }
        },
    );
    diagnostics::debug("project.queue_read", || {
        format!(
            "requestId={} waitMs={} runMs={}",
            task.id,
            started.duration_since(queued).as_millis(),
            started.elapsed().as_millis()
        )
    });
    let mut saves = saves()?;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            saves.finish(&task.root);
            return Err(error);
        }
    };
    for entry in saves
        .roots
        .get_mut(&task.root)
        .expect("written save remains queued")
    {
        entry
            .progress
            .identities
            .extend(result.identity_changes.iter().cloned());
        for version in &result.base_versions {
            entry
                .progress
                .versions
                .retain(|old| windows_path_key(&old.path) != windows_path_key(&version.path));
            entry.progress.versions.push(version.clone());
        }
    }
    let event = serde_json::to_value(CommittedWriteEvent {
        origin_window_label: &task.owner,
        mod_root: event_root,
        session_id,
        reason,
        result: &result,
    })?;
    for window in saves.windows.values().filter(|window| {
        window.belongs_to(&task.root) && (reason != "refresh" || !result.session_updates.is_empty())
    }) {
        if let Err(error) = window.channel.send(ProjectSyncDelivery::Saved {
            request_id: task.id.clone(),
            event: event.clone(),
        }) {
            diagnostics::failure(
                "save.result_delivery_failed",
                error,
                json!({"requestId":task.id,"modRoot":task.root,"sessionId":task.session_id}),
            );
        }
    }
    saves.finish(&task.root);
    Ok(result)
}

pub fn publish_references(
    snapshot: ReferenceSources,
    updates: Vec<CommittedSessionUpdate>,
) -> AppResult<()> {
    let mut result = WriteResult::<()>::from_changes(Vec::new());
    result.session_updates = updates;
    let event = serde_json::to_value(CommittedWriteEvent {
        origin_window_label: "main",
        mod_root: "",
        session_id: None,
        reason: "refresh",
        result: &result,
    })?;
    let mut saves = saves()?;
    if snapshot.revision < saves.references.revision {
        return Ok(());
    }
    saves.references = snapshot.clone();
    for window in saves.windows.values() {
        if let Err(error) = window.channel.send(ProjectSyncDelivery::References {
            snapshot: snapshot.clone(),
            event: Some(event.clone()),
        }) {
            diagnostics::failure(
                "references.notification_failed",
                error,
                json!({"revision":snapshot.revision}),
            );
        }
    }
    drop(saves);
    java_analysis::refresh_registered_references()?;
    Ok(())
}

fn wait_retry(task: &SaveTask, error: &AppError) -> AppResult<()> {
    let mut saves = saves()?;
    saves.block(task, error.diagnostic());
    while saves.progress(task).blocked.is_some() && !saves.progress(task).abandoned {
        saves = wait_changed(saves)?;
    }
    if saves.progress(task).abandoned {
        return Err(AppError::message(
            "write.recovery_abandoned",
            "用户已放弃恢复保存前内容",
        ));
    }
    Ok(())
}
pub fn prepare_versions(
    root: &str,
    captured: &mut [FileVersion],
    versions: &[FileVersion],
    identities: &[EntityIdentityChange],
) -> AppResult<RootWriteLock> {
    let lease = io::acquire_root_write_lock(Path::new(root))?;
    for identity in identities {
        for version in captured.iter_mut() {
            if windows_path_key(&version.path) == windows_path_key(&identity.before.write.path) {
                version.path = identity.after.write.path.clone();
            }
        }
    }
    for captured in captured.iter_mut() {
        if let Some(current) = versions
            .iter()
            .find(|version| windows_path_key(&version.path) == windows_path_key(&captured.path))
        {
            *captured = current.clone();
        }
    }
    let mut missing = Vec::new();
    for version in captured.iter_mut() {
        let path = Path::new(&version.path);
        if version.fingerprint.is_some()
            && !path
                .try_exists()
                .map_err(|error| AppError::from(error).at_path(path))?
            && !io::source_recreation_allowed(root, &version.path)
        {
            missing.push(version.path.clone());
        }
    }
    if !missing.is_empty() {
        return Err(AppError::SaveSourcesMissing { paths: missing });
    }
    io::verify_versions(root, captured)?;
    Ok(lease)
}

fn confirm_sources(task: &SaveTask, paths: Vec<String>) -> AppResult<()> {
    let mut saves = saves()?;
    saves.progress(task).confirmation = Some(SourceConfirmation {
        paths: paths.clone(),
        accepted: None,
        responder: None,
    });
    saves.offer_confirmation(task)?;
    loop {
        if saves.progress(task).abandoned {
            return Err(AppError::message("write.abandoned", "所属项目保存已结束"));
        }
        if let Some(accepted) = saves
            .progress(task)
            .confirmation
            .as_ref()
            .and_then(|confirmation| confirmation.accepted)
        {
            saves.progress(task).confirmation = None;
            return if accepted {
                Ok(())
            } else {
                Err(AppError::message("write.cancelled", "已取消重建缺失来源"))
            };
        }
        saves = wait_changed(saves)?;
    }
}

pub fn resolve_sources(
    label: &str,
    request_id: &str,
    paths: &[String],
    accepted: bool,
) -> AppResult<()> {
    let task = task(request_id)?;
    let mut saves = saves()?;
    if let Some(confirmation) = &mut saves.progress(&task).confirmation
        && confirmation.paths == paths
    {
        if confirmation.responder.as_deref() != Some(label) {
            return Err(AppError::message(
                "write.confirmation_owner",
                "来源确认不属于当前请求窗口",
            ));
        }
        confirmation.accepted = Some(accepted);
    }
    SAVES.1.notify_all();
    Ok(())
}
pub fn retry(request_id: &str) -> AppResult<()> {
    let task = task(request_id)?;
    let mut saves = saves()?;
    saves.progress(&task).blocked = None;
    saves.notify(&task.root, true);
    SAVES.1.notify_all();
    Ok(())
}

pub fn abandon(roots: &[String]) -> AppResult<()> {
    let mut saves = saves()?;
    let keys = roots
        .iter()
        .map(|root| saves.registered_root(root))
        .collect::<Vec<_>>();
    for (root, queue) in &mut saves.roots {
        if keys.contains(root) {
            for entry in queue {
                entry.progress.abandoned = true;
            }
        }
    }
    SAVES.1.notify_all();
    Ok(())
}
pub fn wait_projects(roots: &[String]) -> Result<(), ErrorDiagnostic> {
    let mut saves = saves().map_err(|error| error.diagnostic())?;
    let roots = roots
        .iter()
        .map(|root| saves.registered_root(root))
        .collect::<Vec<_>>();
    loop {
        let matching = saves
            .roots
            .iter()
            .filter(|(root, _)| roots.contains(root))
            .collect::<Vec<_>>();
        if matching.is_empty() {
            return Ok(());
        }
        for (_, queue) in matching {
            if let Some(entry) = queue.front()
                && !entry.progress.abandoned
                && let Some(error) = entry.progress.blocked.as_ref()
            {
                return Err(error.clone());
            }
        }
        saves = wait_changed(saves).map_err(|error| error.diagnostic())?;
    }
}
pub fn release_window(label: &str) -> AppResult<()> {
    release_source_watch(&format!("core-window:{label}"))?;
    let mut saves = saves()?;
    saves.windows.remove(label);
    let mut confirmations = Vec::new();
    for entry in saves.roots.values_mut().flatten() {
        if let Some(confirmation) = &mut entry.progress.confirmation
            && confirmation.responder.as_deref() == Some(label)
        {
            confirmation.responder = None;
            confirmations.push(entry.task.clone());
        }
    }
    for task in confirmations {
        saves.offer_confirmation(&task)?;
    }
    SAVES.1.notify_all();
    Ok(())
}

#[cfg(test)]
fn execute<T: Serialize>(
    label: &str,
    request_id: String,
    root: &str,
    session_id: Option<&str>,
    reason: &str,
    action: impl FnMut(&[EntityIdentityChange], &[FileVersion]) -> AppResult<WriteResult<T>>,
) -> AppResult<WriteResult<T>> {
    execute_queued(
        enqueue(label, request_id, root, session_id)?,
        root,
        session_id,
        reason,
        action,
    )
}

pub fn release_project_session(session_id: String) -> AppResult<()> {
    java_analysis::close_registered_session(&session_id)?;
    release_source_watch(&format!("core:{session_id}"))?;
    release_source_watch(&session_id)?;
    let revision = project::reference_revision();
    if let Some(root) = project::unregister_project_session(&session_id)? {
        publish_source_status(&root, SourceSyncState::Released, None)?;
        file_history::release_root_history(&root)?;
    }
    clear_session_media(&session_id);
    project::reference_sources_changed(Some(&session_id))?;
    if revision != project::reference_revision() {
        let delivery = project::reference_sources()
            .and_then(|snapshot| publish_references(snapshot, project::reference_updates()?));
        if let Err(error) = delivery {
            diagnostics::failure(
                "references.close_notification_failed",
                error,
                json!({"sessionId":session_id,"previousRevision":revision}),
            );
        }
    }
    windows::release_session(&session_id)
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::services::file_history::query_file_history;
    use crate::services::project_sync::release_project_session;

    use super::*;
    #[cfg(test)]
    use crate::models::*;
    #[cfg(test)]
    use crate::models::{EntityKind, JointEditSnapshot, SaveAction, TextSave};
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::{project_workspace, release_workspace};
    #[cfg(test)]
    use crate::services::{
        file_history, project, project_save, text_file_editing, write_transactions,
    };
    use crate::test_support::work_counts;
    use crate::test_support::{self, SOURCE_WATCH_TEST_QUEUE as TEST_QUEUE};
    #[cfg(test)]
    use crate::{io, services};
    use serde_json::Value;
    #[cfg(test)]
    use std::cell::Cell;
    #[cfg(test)]
    use std::collections::BTreeSet;
    use std::fs;
    use std::io::ErrorKind;
    use std::sync::mpsc;
    use std::sync::mpsc::Receiver;
    use std::time::Duration;
    #[cfg(test)]
    use std::{slice, thread};
    use tauri::Error;
    use tauri::ipc::InvokeResponseBody;

    #[test]
    fn source_watch_status_publishes_changes_and_replays_the_current_snapshot() {
        let serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("source_status_changes");
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("source.status"),
        )
        .unwrap();
        let first = window("source-status-first");
        publish_source_status(&manifest.mod_root, SourceSyncState::Watching, None).unwrap();
        publish_source_status(&manifest.mod_root, SourceSyncState::Watching, None).unwrap();
        let owned = |delivery: &Value| {
            delivery["kind"] == "sourceStatus" && delivery["root"] == manifest.mod_root
        };
        assert_eq!(first.try_iter().filter(owned).count(), 1);
        let second = window("source-status-second");
        assert_eq!(second.try_iter().filter(owned).count(), 1);
        publish_source_status(
            &manifest.mod_root,
            SourceSyncState::Failed,
            Some(AppError::message("source.failure", "actual failure").diagnostic()),
        )
        .unwrap();
        publish_source_status(&manifest.mod_root, SourceSyncState::Watching, None).unwrap();
        assert_eq!(first.try_iter().filter(owned).count(), 2);
        publish_source_status(&manifest.mod_root, SourceSyncState::Released, None).unwrap();
        release_window("source-status-first").unwrap();
        release_window("source-status-second").unwrap();
        release_project_session(manifest.session_id.clone()).unwrap();
        root.close().unwrap();
        drop(serial);
    }

    #[test]
    fn source_watch_following_batch_enters_the_root_queue_while_current_batch_waits() {
        let serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("review_following_batch");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        fs::write(&path, "id,name\nreview,Initial\n").unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("review.queue"),
        )
        .unwrap();
        let blocker = enqueue(
            "review-queue",
            "review-blocker".into(),
            &manifest.mod_root,
            Some(&manifest.session_id),
        )
        .unwrap();
        fs::write(&path, "id,name\nreview,First\n").unwrap();
        source_changes::enqueue_source_batch(SourceChangeBatch {
            root: manifest.mod_root.clone(),
            paths: [path.clone()].into(),
            ..Default::default()
        });
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(5) {
            if saves().unwrap().roots[&blocker.root].len() >= 2
                && source_changes::source_batch_running(&manifest.mod_root)
            {
                break;
            }
            thread::sleep(Duration::from_millis(10));
        }
        fs::write(&path, "id,name\nreview,Following\n").unwrap();
        source_changes::enqueue_source_batch(SourceChangeBatch {
            root: manifest.mod_root.clone(),
            paths: [path].into(),
            ..Default::default()
        });
        let queued = saves().unwrap().roots[&blocker.root].len();
        execute_queued(
            blocker,
            &manifest.mod_root,
            Some(&manifest.session_id),
            "save",
            |_, _| Ok(WriteResult::<()>::from_changes(Vec::new())),
        )
        .unwrap();
        source_changes::wait_source_batches(&manifest.mod_root).unwrap();
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
        drop(serial);
        assert_eq!(
            queued, 3,
            "save, executing source batch and merged following batch are queued"
        );
    }

    #[test]
    fn source_watch_review_core_subscription_replays_its_existing_failure_to_a_scoped_window() {
        if test_support::isolated_test() {
            return;
        }
        let serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let root = project_workspace("review_core_status_replay");
        let core = root.join("starsector-core");
        fs::create_dir_all(&core).unwrap();
        let subscription = begin_source_watch(&core).unwrap();
        let actual_root = subscription.root().to_string();
        retain_source_watch(
            "review-core-existing".into(),
            subscription,
            ResourceSource::Core,
        )
        .unwrap();
        let receiver = window("review-core-replay");
        saves()
            .unwrap()
            .windows
            .get_mut("review-core-replay")
            .unwrap()
            .root = Some(root.join("mod").to_string_lossy().into_owned());
        publish_source_status(
            &actual_root,
            SourceSyncState::Failed,
            Some(AppError::message("source.watch_failed", "review existing failure").diagnostic()),
        )
        .unwrap();
        set_window_core_subscription("review-core-replay", Some(&root.to_string_lossy())).unwrap();
        let failures = receiver
            .try_iter()
            .filter(|delivery| {
                delivery["kind"] == "sourceStatus"
                    && delivery["state"] == "failed"
                    && windows_path_key(delivery["root"].as_str().unwrap())
                        == windows_path_key(&actual_root)
            })
            .count();
        release_window("review-core-replay").unwrap();
        release_source_watch("review-core-existing").unwrap();
        root.close().unwrap();
        drop(serial);
        assert_eq!(failures, 1);
    }

    #[test]
    fn source_watch_review_source_kind_follows_registered_root_role() {
        let serial = TEST_QUEUE.lock().unwrap();
        let work = project_workspace("review_source_role");
        let root = work.join("starsector-core");
        fs::create_dir_all(&root).unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("review.role"),
        )
        .unwrap();
        let receiver = window("review-source-role");
        publish_source_status(
            &manifest.mod_root,
            SourceSyncState::Failed,
            Some(AppError::message("source.watch_failed", "review role failure").diagnostic()),
        )
        .unwrap();
        let source = receiver
            .try_iter()
            .find(|delivery| {
                delivery["kind"] == "sourceStatus"
                    && windows_path_key(delivery["root"].as_str().unwrap())
                        == windows_path_key(&manifest.mod_root)
            })
            .unwrap()["source"]
            .clone();
        release_project_session(manifest.session_id).unwrap();
        release_window("review-source-role").unwrap();
        work.close().unwrap();
        drop(serial);
        assert_eq!(source, "mod");
    }

    #[test]
    fn source_watch_review_manual_refresh_updates_every_same_root_session() {
        let serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("review_manual_sessions");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        fs::write(&path, "id,name\nreview,Original\n").unwrap();
        let first = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("review.first"),
        )
        .unwrap();
        let second = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("review.second"),
        )
        .unwrap();
        for manifest in [&first, &second] {
            services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
        }
        fs::write(&path, "id,name\nreview,Updated\n").unwrap();
        let result = project_save::execute_typed_save::<Value>(SaveAction::RefreshProjectSources(
            SourceRefresh {
                session_id: first.session_id.clone(),
                sources: vec![InvalidatedResourceScope {
                    source: ResourceSource::Mod,
                    rel_path: "data/hulls/ship_data.csv".into(),
                }],
            },
        ))
        .unwrap();
        let names = [&first, &second].map(|manifest| {
            services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap()
            .rows[0]
                .data["name"]
                .clone()
        });
        release_project_session(first.session_id).unwrap();
        release_project_session(second.session_id).unwrap();
        root.close().unwrap();
        drop(serial);
        assert_eq!(
            (result.session_updates.len(), names),
            (2, [json!("Updated"), json!("Updated")])
        );
    }

    #[test]
    fn source_watch_review_core_listener_failure_remains_failed_after_content_delivery() {
        let serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("review_core_status");
        let path = root.join("starsector-core/graphics/review.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "image").unwrap();
        let receiver = window("review-core-status");
        saves()
            .unwrap()
            .windows
            .get_mut("review-core-status")
            .unwrap()
            .core_root = Some(root.to_string_lossy().into_owned());
        consume_source_batch(SourceChangeBatch {
            root: root.join("starsector-core").to_string_lossy().into_owned(),
            paths: [path].into(),
            diagnostic: Some(
                AppError::message("source.watch_failed", "review listener failure").diagnostic(),
            ),
            ..Default::default()
        });
        let deliveries = receiver
            .try_iter()
            .filter(|delivery| {
                delivery["kind"] == "sourceStatus"
                    && windows_path_key(delivery["root"].as_str().unwrap())
                        == windows_path_key(&root.join("starsector-core").to_string_lossy())
            })
            .collect::<Vec<_>>();
        let final_state = deliveries.last().unwrap()["state"].clone();
        release_window("review-core-status").unwrap();
        root.close().unwrap();
        drop(serial);
        assert_eq!(final_state, "failed");
    }

    #[test]
    fn source_watch_review_failed_core_receiver_preserves_other_window_delivery() {
        let serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("review_core_receivers");
        let path = root.join("starsector-core/graphics/review.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "image").unwrap();
        drop(window("review-core-a-broken"));
        let receiver = window("review-core-b-live");
        for label in ["review-core-a-broken", "review-core-b-live"] {
            saves().unwrap().windows.get_mut(label).unwrap().core_root =
                Some(root.to_string_lossy().into_owned());
        }
        let result = consume_core_batch(&SourceChangeBatch {
            root: root.join("starsector-core").to_string_lossy().into_owned(),
            paths: [path].into(),
            ..Default::default()
        });
        let delivered = receiver
            .try_iter()
            .filter(|delivery| delivery["kind"] == "coreChanged")
            .count();
        release_window("review-core-a-broken").unwrap();
        release_window("review-core-b-live").unwrap();
        root.close().unwrap();
        drop(serial);
        assert_eq!((result.is_ok(), delivered), (true, 1));
    }

    #[test]
    fn source_watch_core_mods_progress_independently_and_keep_mod_priority() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let work = project_workspace("core_mod_fanout").with_cleanup(release_watched_workspace);
        let game = work.join("game");
        let core = game.join("starsector-core");
        let path = core.join("data/weapons/proj/shared.proj");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"id":"shared","damage":1}"#).unwrap();
        let mut manifests = Vec::new();
        for index in 0..2 {
            let root = game.join(format!("mods/sample{index}"));
            fs::create_dir_all(root.join("data/weapons/proj")).unwrap();
            if index == 0 {
                fs::write(
                    root.join("data/weapons/proj/shared.proj"),
                    r#"{"id":"shared","damage":3}"#,
                )
                .unwrap();
            }
            let subscription = begin_source_watch(&core).unwrap();
            let manifest = project::open_project_session_traced(
                &root,
                Some(&game),
                &mut PerformanceTrace::new("core.fanout"),
            )
            .unwrap();
            retain_source_watch(
                format!("core:{}", manifest.session_id),
                subscription,
                ResourceSource::Core,
            )
            .unwrap();
            manifests.push(manifest);
        }
        source_changes::wait_source_batches(&core.to_string_lossy()).unwrap();
        let receiver = window("core-watch-first");
        let lease = io::acquire_root_write_lock(Path::new(&manifests[0].mod_root)).unwrap();
        fs::write(&path, r#"{"id":"shared","damage":2}"#).unwrap();
        loop {
            let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
            // Independent progress is established while the first root remains leased.
            if delivery["kind"] == "saved"
                && delivery["event"]["sessionId"] == manifests[1].session_id
            {
                break;
            }
        }
        assert_eq!(
            services::query_entity(&manifests[1].session_id, EntityKind::Projectile, "shared")
                .unwrap()
                .unwrap()
                .data["damage"],
            2
        );
        drop(lease);
        loop {
            let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
            if delivery["kind"] == "saved"
                && delivery["event"]["sessionId"] == manifests[0].session_id
            {
                break;
            }
        }
        assert_eq!(
            services::query_entity(&manifests[0].session_id, EntityKind::Projectile, "shared")
                .unwrap()
                .unwrap()
                .data["damage"],
            3
        );
        for manifest in manifests {
            release_project_session(manifest.session_id).unwrap();
        }
        release_window("core-watch-first").unwrap();
        work.close().unwrap();
    }

    #[test]
    fn source_watch_shared_core_root_rescans_updates_and_releases() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        let work = project_workspace("shared_core_queue").with_cleanup(release_watched_workspace);
        let game = work.join("game");
        let core = game.join("starsector-core");
        let mod_root = game.join("mods/sample");
        let path = core.join("data/weapons/proj/shared.proj");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::create_dir_all(&mod_root).unwrap();
        fs::write(&path, r#"{"id":"shared","damage":1}"#).unwrap();
        let mut manifests = Vec::new();
        for root in [&core, &core, &mod_root] {
            let subscription = begin_source_watch(root).unwrap();
            let core_subscription = begin_source_watch(&core).unwrap();
            let manifest = project::open_project_session_traced(
                root,
                Some(&game),
                &mut PerformanceTrace::new("source.sharedCore"),
            )
            .unwrap();
            retain_source_watch(
                manifest.session_id.clone(),
                subscription,
                ResourceSource::Mod,
            )
            .unwrap();
            retain_source_watch(
                format!("core:{}", manifest.session_id),
                core_subscription,
                ResourceSource::Core,
            )
            .unwrap();
            manifests.push(manifest);
        }
        let owner = format!("watch:{}", windows_path_key(&work.to_string_lossy()));
        let receiver = window(&owner);
        configure_source_watch(true).unwrap();
        source_changes::wait_source_batches(&core.to_string_lossy()).unwrap();
        source_changes::wait_source_batches(&manifests[2].mod_root).unwrap();
        receiver.try_iter().for_each(drop);
        for damage in [2, 3] {
            let reads = work_counts::count("read", &path);
            fs::write(&path, format!(r#"{{"id":"shared","damage":{damage}}}"#)).unwrap();
            let mut updated = BTreeSet::new();
            while updated.len() < manifests.len() {
                let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
                if delivery["kind"] == "saved" {
                    for update in delivery["event"]["result"]["sessionUpdates"]
                        .as_array()
                        .unwrap()
                    {
                        updated.insert(update["sessionId"].as_str().unwrap().to_string());
                    }
                }
            }
            source_changes::wait_source_batches(&manifests[0].mod_root).unwrap();
            assert_eq!(work_counts::count("read", &path) - reads, 1);
            for manifest in &manifests {
                assert_eq!(
                    services::query_entity(&manifest.session_id, EntityKind::Projectile, "shared")
                        .unwrap()
                        .unwrap()
                        .data["damage"],
                    damage
                );
                assert_project_idle(&manifest.mod_root);
            }
            wait_projects(
                &manifests
                    .iter()
                    .map(|manifest| manifest.mod_root.clone())
                    .collect::<Vec<_>>(),
            )
            .unwrap();
        }
        configure_source_watch(false).unwrap();
        for manifest in manifests {
            release_project_session(manifest.session_id).unwrap();
        }
        release_window(&owner).unwrap();
        work.close().unwrap();
    }

    #[test]
    fn source_watch_failed_core_batch_releases_its_queued_task() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let work = project_workspace("failed_core_queue").with_cleanup(release_watched_workspace);
        let core = work.join("starsector-core");
        fs::create_dir_all(&core).unwrap();
        let manifest = project::open_project_session_traced(
            &core,
            Some(&work),
            &mut PerformanceTrace::new("source.failedCore"),
        )
        .unwrap();
        let owner = format!("watch:{}", windows_path_key(&work.to_string_lossy()));
        let receiver = window(&owner);
        let lease = io::acquire_root_write_lock(Path::new(&manifest.mod_root)).unwrap();
        source_changes::enqueue_source_batch(SourceChangeBatch {
            root: manifest.mod_root.clone(),
            rescan: true,
            ..Default::default()
        });
        fs::rename(&core, work.join("moved-core")).unwrap();
        drop(lease);
        loop {
            let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
            if delivery["kind"] == "sourceStatus" && delivery["state"] == "failed" {
                break;
            }
        }
        source_changes::wait_source_batches(&manifest.mod_root).unwrap();
        wait_projects(slice::from_ref(&manifest.mod_root)).unwrap();
        assert_project_idle(&manifest.mod_root);
        release_project_session(manifest.session_id).unwrap();
        release_window(&owner).unwrap();
        work.close().unwrap();
    }

    fn release_watched_workspace(root: &Path) -> Vec<String> {
        let mut errors = release_workspace(root);
        for label in ["core-watch-first", "core-watch-second"] {
            if let Err(error) = release_window(label) {
                errors.push(error.to_string());
            }
        }
        if let Err(error) = release_window(&format!(
            "watch:{}",
            windows_path_key(&root.to_string_lossy())
        )) {
            errors.push(error.to_string());
        }
        errors
    }
    #[test]
    fn source_watch_core_notifies_windows_without_mods_and_releases_each_subscription() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let root = project_workspace("core_windows").with_cleanup(release_watched_workspace);
        let graphics = root.join("starsector-core/graphics");
        fs::create_dir_all(&graphics).unwrap();
        fs::write(graphics.join("before.png"), "first").unwrap();
        let first = window("core-watch-first");
        let second = window("core-watch-second");
        set_window_core_subscription("core-watch-first", Some(&root.to_string_lossy())).unwrap();
        set_window_core_subscription("core-watch-second", Some(&root.to_string_lossy())).unwrap();
        assert_eq!(
            services::scan_core_graphics(&root.to_string_lossy()).unwrap(),
            vec!["graphics/before.png"]
        );
        fs::remove_file(graphics.join("before.png")).unwrap();
        fs::write(graphics.join("after.png"), "second").unwrap();
        for receiver in [&first, &second] {
            loop {
                let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
                if delivery["kind"] == "coreChanged" {
                    break;
                }
            }
        }
        assert_eq!(
            services::scan_core_graphics(&root.to_string_lossy()).unwrap(),
            vec!["graphics/after.png"]
        );
        retry_source_watch(
            "core-watch-first",
            &root.join("starsector-core").to_string_lossy(),
        )
        .unwrap();
        loop {
            let delivery = second.recv_timeout(Duration::from_secs(15)).unwrap();
            assert_ne!(
                delivery["kind"], "coreChanged",
                "unchanged rescan retains completed Core products"
            );
            if delivery["kind"] == "sourceStatus" && delivery["state"] == "watching" {
                break;
            }
        }
        release_window("core-watch-first").unwrap();
        assert!(
            !SOURCE_WATCHES
                .lock()
                .unwrap()
                .contains_key("core-window:core-watch-first")
        );
        assert!(
            SOURCE_WATCHES
                .lock()
                .unwrap()
                .contains_key("core-window:core-watch-second")
        );
        release_window("core-watch-second").unwrap();
        assert!(
            !SOURCE_WATCHES
                .lock()
                .unwrap()
                .contains_key("core-window:core-watch-second")
        );
        root.close().unwrap();
    }
    #[test]
    fn source_watch_reopens_existing_mods_and_catches_up_after_settings_enable() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let root = project_workspace("source_watch_settings_catchup")
            .with_cleanup(release_watched_workspace);
        let path = root.join("data/hulls/ship_data.csv");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "id,name\nsample,Before\n").unwrap();
        let subscription = begin_source_watch(&root).unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("source.settings"),
        )
        .unwrap();
        retain_source_watch(
            manifest.session_id.clone(),
            subscription,
            ResourceSource::Mod,
        )
        .unwrap();
        let owner = format!("watch:{}", windows_path_key(&root.to_string_lossy()));
        let receiver = window(&owner);
        services::query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
            &[],
        )
        .unwrap();
        source_changes::wait_source_batches(&manifest.mod_root).unwrap();
        receiver.try_iter().for_each(drop);

        configure_source_watch(false).unwrap();
        assert!(
            SOURCE_WATCHES
                .lock()
                .unwrap()
                .contains_key(&manifest.session_id)
        );
        assert_eq!(
            retry_source_watch(&owner, &manifest.mod_root)
                .unwrap_err()
                .code(),
            "source.watch_disabled"
        );
        fs::write(&path, "id,name\nsample,After\n").unwrap();
        thread::sleep(Duration::from_millis(100));
        let disabled = receiver.try_iter().collect::<Vec<_>>();
        assert!(disabled.iter().all(|delivery| delivery["kind"] != "saved"));
        assert_eq!(
            disabled
                .iter()
                .filter(|delivery| delivery["state"] == "released")
                .count(),
            2
        );

        configure_source_watch(true).unwrap();
        let event = loop {
            let delivery = receiver.recv_timeout(Duration::from_secs(15)).unwrap();
            if delivery["kind"] == "saved" && delivery["event"]["reason"] == "refresh" {
                break delivery["event"].clone();
            }
        };
        assert_eq!(
            event["result"]["sessionUpdates"].as_array().unwrap().len(),
            1
        );
        assert_eq!(
            services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                1,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap()
            .rows[0]
                .data["name"],
            "After"
        );

        release_project_session(manifest.session_id).unwrap();
        release_window(&owner).unwrap();
        configure_source_watch(false).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_watch_reports_failure_and_explicit_retry_progress() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let root = project_workspace("source_retry_status").with_cleanup(release_watched_workspace);
        let path = root.join("mod_info.json");
        fs::write(&path, r#"{"id":"sample","name":"Sample"}"#).unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("source.retry"),
        )
        .unwrap();
        let owner = format!("watch:{}", windows_path_key(&root.to_string_lossy()));
        let receive = window(&owner);
        fs::write(&path, "{").unwrap();
        consume_source_batch(SourceChangeBatch {
            root: manifest.mod_root.clone(),
            paths: [path.clone()].into(),
            ..Default::default()
        });
        assert!(
            receive
                .try_iter()
                .any(|delivery| delivery["state"] == "failed")
        );
        fs::write(&path, r#"{"id":"sample","name":"Recovered"}"#).unwrap();
        let subscription = begin_source_watch(&root).unwrap();
        retain_source_watch(
            manifest.session_id.clone(),
            subscription,
            ResourceSource::Mod,
        )
        .unwrap();
        retry_source_watch(&owner, &manifest.mod_root).unwrap();
        assert_eq!(
            receive.recv_timeout(Duration::from_secs(15)).unwrap()["state"],
            "scanning"
        );
        loop {
            let delivery = receive.recv_timeout(Duration::from_secs(15)).unwrap();
            if delivery["kind"] == "sourceStatus" && delivery["state"] == "watching" {
                break;
            }
        }
        assert_eq!(
            project::current_project_manifest(&manifest.session_id)
                .unwrap()
                .mod_info
                .unwrap()["name"],
            "Recovered"
        );
        release_project_session(manifest.session_id).unwrap();
        release_window(&owner).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_watch_updates_same_root_sessions_once_and_deduplicates_accepted_bytes() {
        if test_support::isolated_test() {
            return;
        }
        let _serial = TEST_QUEUE.lock().unwrap();
        configure_source_watch(true).unwrap();
        let root = project_workspace("watched_sessions").with_cleanup(release_watched_workspace);
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let path = root.join("data/hulls/ship_data.csv");
        fs::write(&path, "id,name\nsample,Initial\n").unwrap();
        let first_watch = begin_source_watch(&root).unwrap();
        let first = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("watch.first"),
        )
        .unwrap();
        retain_source_watch(first.session_id.clone(), first_watch, ResourceSource::Mod).unwrap();
        let second_watch = begin_source_watch(&root).unwrap();
        let second = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("watch.second"),
        )
        .unwrap();
        retain_source_watch(second.session_id.clone(), second_watch, ResourceSource::Mod).unwrap();
        let owner = format!("watch:{}", windows_path_key(&root.to_string_lossy()));
        let receive = window(&owner);
        thread::sleep(Duration::from_millis(100));
        source_changes::wait_source_batches(&first.mod_root).unwrap();
        receive.try_iter().for_each(drop);
        fs::write(&path, "id,name\nsample,Updated\n").unwrap();
        let event = loop {
            let delivery = receive.recv_timeout(Duration::from_secs(15)).unwrap();
            assert!(delivery["kind"] != "sourceStatus" || delivery["state"] != "scanning");
            if delivery["kind"] == "saved" && delivery["event"]["modRoot"] == first.mod_root {
                break delivery["event"].clone();
            }
        };
        assert_eq!(event["reason"], "refresh");
        assert_eq!(
            event["result"]["sessionUpdates"].as_array().unwrap().len(),
            2
        );
        assert_eq!(event["result"]["changes"].as_array().unwrap().len(), 0);
        for manifest in [&first, &second] {
            let index = services::query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                2,
                None,
                CsvSearchField::IdName,
                &[],
            )
            .unwrap();
            assert_eq!(index.rows[0].data["name"], "Updated");
            assert_eq!(
                query_file_history(&manifest.session_id, &manifest.mod_root)
                    .unwrap()
                    .undo_stack
                    .len(),
                0
            );
        }
        consume_source_batch(SourceChangeBatch {
            root: first.mod_root.clone(),
            paths: [path].into(),
            ..Default::default()
        });
        assert!(
            receive
                .try_iter()
                .all(|delivery| delivery["kind"] != "saved"
                    || delivery["event"]["modRoot"] != first.mod_root)
        );
        release_project_session(first.session_id).unwrap();
        release_project_session(second.session_id).unwrap();
        release_window(&owner).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn release_existing_and_removed_roots_cleans_session_and_history() {
        let _serial = TEST_QUEUE.lock().unwrap();
        for remove_root in [false, true] {
            let root = project_workspace("release_removed_project");
            fs::write(root.join("notes.txt"), "before").unwrap();
            let manifest = project::open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("release.removed"),
            )
            .unwrap();
            let sibling = project::open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("release.same-root"),
            )
            .unwrap();
            let transaction = write_transactions::begin(
                &TextSave {
                    session_id: Some(manifest.session_id.clone()),
                    mod_root: manifest.mod_root.clone(),
                    path: root.join("notes.txt").to_string_lossy().into(),
                    text: "after".into(),
                    base_versions: vec![],
                },
                &[],
            )
            .unwrap();
            let result = text_file_editing::save_text_file(
                &manifest.mod_root,
                &root.join("notes.txt").to_string_lossy(),
                "after".into(),
            )
            .unwrap();
            let saved = transaction.commit(result, "saved").unwrap();
            assert_eq!(saved.history.undo_stack.len(), 1);
            if remove_root {
                fs::remove_dir_all(root.as_ref()).unwrap();
            }
            release_project_session(manifest.session_id.clone()).unwrap();
            assert_eq!(
                file_history::snapshot_for_root(&manifest.mod_root)
                    .unwrap()
                    .undo_stack
                    .len(),
                1
            );
            release_project_session(sibling.session_id).unwrap();
            assert!(
                !project::registered_session_ids()
                    .unwrap()
                    .contains(&manifest.session_id)
            );
            assert!(
                file_history::snapshot_for_root(&manifest.mod_root)
                    .unwrap()
                    .undo_stack
                    .is_empty()
            );
            assert_eq!(
                services::query_entity_list(&manifest.session_id, EntityKind::Ship)
                    .unwrap_err()
                    .code(),
                "session.unknown"
            );
            root.close().unwrap();
        }
    }

    fn window(label: &str) -> Receiver<Value> {
        let (send, receive) = mpsc::channel();
        register(
            label,
            None,
            Channel::new(move |body| {
                let InvokeResponseBody::Json(json) = body else {
                    panic!("save delivery is JSON")
                };
                send.send(serde_json::from_str(&json).unwrap())
                    .map_err(|_| Error::Io(ErrorKind::BrokenPipe.into()))?;
                Ok(())
            }),
        )
        .unwrap();
        receive
    }

    fn delivery_for_request(receive: &Receiver<Value>, kind: &str, request_id: &str) -> Value {
        loop {
            // The functional deadline allows file-backed saves to complete under concurrent CI load.
            let delivery = receive
                .recv_timeout(Duration::from_secs(15))
                .unwrap_or_else(|error| panic!("{request_id}: waiting for {kind}: {error}"));
            if delivery["kind"] == kind && delivery["requestId"] == request_id {
                return delivery;
            }
        }
    }

    fn assert_project_idle(root: &str) {
        let saves = saves().unwrap();
        assert!(!saves.roots.contains_key(&saves.registered_root(root)));
    }

    fn save_empty(owner: &str, id: &str, root: &str) {
        execute(owner, id.into(), root, None, "save", |_, _| {
            Ok(WriteResult::<()>::from_changes(Vec::new()))
        })
        .unwrap();
    }

    #[test]
    fn project_completion_is_independent_of_subscriber_failure_and_release() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_subscribers");
        let receiver = window("observer");
        save_empty("observer", "first", &root.to_string_lossy());
        assert_eq!(
            delivery_for_request(&receiver, "saved", "first")["requestId"],
            "first"
        );
        assert!(task("first").is_err());
        drop(receiver);
        save_empty("observer", "broken-channel", &root.to_string_lossy());
        release_window("observer").unwrap();
        save_empty("observer", "released", &root.to_string_lossy());
        assert_project_idle(&root.to_string_lossy());
        root.close().unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn replaced_root_rejects_writing_and_releases_project_waiting() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let (fixture, outside, link) = TestWorkspace::junction("save_replaced_root", "linked");
        let project = fixture.join("project");
        fs::create_dir(&project).unwrap();
        let text = project.to_string_lossy().to_string();
        let queued = enqueue("replaced-root", "replaced-root".into(), &text, None).unwrap();
        fs::remove_dir(&project).unwrap();
        fs::rename(link, &project).unwrap();
        let error = execute_queued::<()>(queued, &text, None, "save", |_, _| {
            panic!("replacement root is rejected before writing")
        })
        .unwrap_err();
        assert_eq!(error.code(), "path.link_rejected");
        wait_projects(&[text]).unwrap();
        assert!(!outside.join("saved.txt").exists());
        fs::remove_dir(project).unwrap();
        fixture.close().unwrap();
    }

    #[test]
    fn queued_failure_releases_its_position_and_missing_root_can_be_closed() {
        let _serial = TEST_QUEUE.lock().unwrap();
        for remove_before_enqueue in [false, true] {
            let root = project_workspace("save_missing_root");
            let text = root.to_string_lossy().to_string();
            if remove_before_enqueue {
                fs::remove_dir_all(&root).unwrap();
            }
            let first = enqueue("detached", "failed".into(), &text, None).unwrap();
            let second = enqueue("detached", "next".into(), &text, None).unwrap();
            if !remove_before_enqueue {
                fs::remove_dir_all(&root).unwrap();
            }
            let calls = Cell::new(0);
            assert!(
                execute_queued(first, &text, None, "save", |_, _| {
                    calls.set(calls.get() + 1);
                    Ok(WriteResult::<()>::from_changes(Vec::new()))
                })
                .is_err()
            );
            assert_eq!(calls.get(), 0);
            fs::create_dir(&root).unwrap();
            execute_queued(second, &text, None, "save", |_, _| {
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap();
            fs::remove_dir_all(&root).unwrap();
            wait_projects(&[text]).unwrap();
            assert_project_idle(&root.to_string_lossy());
        }
    }

    #[test]
    fn receive_order_is_fixed_before_workers_start() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_receive_order");
        let text = root.to_string_lossy().to_string();
        let first = enqueue("ordered", "earlier".into(), &text, None).unwrap();
        let second = enqueue("ordered", "later".into(), &text, None).unwrap();
        let (send, receive) = mpsc::channel();
        let next_root = text.clone();
        let worker = thread::spawn(move || {
            execute_queued(second, &next_root, None, "save", |_, _| {
                send.send(()).unwrap();
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap()
        });
        execute_queued(first, &text, None, "save", |_, _| {
            assert!(receive.try_recv().is_err());
            Ok(WriteResult::<()>::from_changes(Vec::new()))
        })
        .unwrap();
        worker.join().unwrap();
        receive.recv().unwrap();
        assert_project_idle(&root.to_string_lossy());
        root.close().unwrap();
    }

    #[test]
    fn recovery_keeps_one_project_and_survives_all_subscribers_releasing() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_project_recovery");
        let other = project_workspace("save_project_unblocked");
        let text = root.to_string_lossy().to_string();
        let receiver = window("recovery-owner");
        let queued = enqueue("recovery-owner", "recover".into(), &text, None).unwrap();
        let following = enqueue("recovery-owner", "following".into(), &text, None).unwrap();
        let next_root = text.clone();
        let worker = thread::spawn(move || {
            execute_queued(queued, &next_root, None, "save", |_, _| {
                io::retry_write(&next_root, || {
                    fs::read_to_string(Path::new(&next_root).join("available.txt"))?;
                    Ok(())
                })?;
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap()
        });
        delivery_for_request(&receiver, "blocked", "recover");
        assert!(wait_projects(slice::from_ref(&text)).is_err());
        save_empty("other", "independent", &other.to_string_lossy());
        assert_project_idle(&other.to_string_lossy());
        assert_eq!(saves().unwrap().roots[&following.root].len(), 2);
        release_window("recovery-owner").unwrap();
        fs::write(root.join("available.txt"), "ready").unwrap();
        retry("recover").unwrap();
        worker.join().unwrap();
        execute_queued(following, &text, None, "save", |_, _| {
            Ok(WriteResult::<()>::from_changes(Vec::new()))
        })
        .unwrap();
        assert_project_idle(&root.to_string_lossy());
        assert_project_idle(&other.to_string_lossy());
        root.close().unwrap();
        other.close().unwrap();
    }

    #[test]
    fn source_confirmation_cancellation_and_reappearing_files_end_without_writes() {
        let _serial = TEST_QUEUE.lock().unwrap();
        for reappeared in [false, true] {
            let root = project_workspace("missing_source_answer");
            let path = root.join("notes.txt");
            fs::write(&path, "before").unwrap();
            let captured = io::file_version(&path).unwrap();
            fs::remove_file(&path).unwrap();
            let owner = if reappeared {
                "reappeared"
            } else {
                "cancelled"
            };
            let receive = window(owner);
            let next_root = root.to_string_lossy().to_string();
            let worker = thread::spawn(move || {
                execute(
                    owner,
                    owner.into(),
                    &next_root,
                    None,
                    "save",
                    |identities, versions| {
                        let mut expected = vec![captured.clone()];
                        let _lease =
                            prepare_versions(&next_root, &mut expected, versions, identities)?;
                        fs::write(&expected[0].path, "saved")?;
                        Ok(WriteResult::<()>::from_changes(Vec::new()))
                    },
                )
                .unwrap_err()
                .code()
            });
            let delivery = delivery_for_request(&receive, "missing", owner);
            let paths: Vec<String> = serde_json::from_value(delivery["paths"].clone()).unwrap();
            if reappeared {
                fs::write(&path, "external").unwrap();
            }
            resolve_sources(owner, owner, &paths, reappeared).unwrap();
            assert_eq!(
                worker.join().unwrap(),
                if reappeared {
                    "write.version_conflict"
                } else {
                    "write.cancelled"
                }
            );
            if reappeared {
                assert_eq!(fs::read_to_string(&path).unwrap(), "external");
            } else {
                assert!(!path.exists());
            }
            assert_project_idle(&root.to_string_lossy());
            release_window(owner).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn missing_source_confirmation_follows_the_project_after_subscriber_release() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_confirmation_handoff");
        let text = root.to_string_lossy().to_string();
        let source = window("confirmation-source");
        let next_root = text.clone();
        let worker = thread::spawn(move || {
            execute(
                "confirmation-source",
                "confirmation".into(),
                &next_root,
                None,
                "save",
                |_, _| {
                    if !io::source_recreation_allowed(
                        &next_root,
                        &Path::new(&next_root).join("notes.txt").to_string_lossy(),
                    ) {
                        return Err(AppError::SaveSourcesMissing {
                            paths: vec![
                                Path::new(&next_root)
                                    .join("notes.txt")
                                    .to_string_lossy()
                                    .into(),
                            ],
                        });
                    }
                    Ok(WriteResult::<()>::from_changes(Vec::new()))
                },
            )
            .unwrap()
        });
        let delivery = delivery_for_request(&source, "missing", "confirmation");
        let paths = serde_json::from_value::<Vec<String>>(delivery["paths"].clone()).unwrap();
        release_window("confirmation-source").unwrap();
        assert!(task("confirmation").is_ok());
        let receiver = window("confirmation-receiver");
        delivery_for_request(&receiver, "missing", "confirmation");
        assert_eq!(
            resolve_sources("confirmation-source", "confirmation", &paths, true)
                .unwrap_err()
                .code(),
            "write.confirmation_owner"
        );
        resolve_sources("confirmation-receiver", "confirmation", &paths, true).unwrap();
        assert_eq!(
            delivery_for_request(&receiver, "saved", "confirmation")["requestId"],
            "confirmation"
        );
        worker.join().unwrap();
        assert!(task("confirmation").is_err());
        release_window("confirmation-receiver").unwrap();
        root.close().unwrap();
    }

    #[test]
    fn explicit_abandon_ends_recovery_and_following_requests() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_abandon");
        let text = root.to_string_lossy().to_string();
        let receive = window("abandon-owner");
        let first = enqueue("abandon-owner", "blocked".into(), &text, None).unwrap();
        let following = enqueue("abandon-owner", "following".into(), &text, None).unwrap();
        let next_root = text.clone();
        let worker = thread::spawn(move || {
            execute_queued(first, &next_root, None, "save", |_, _| {
                io::retry_write(&next_root, || {
                    Err::<(), _>(AppError::message("io.unexpected", "restore unavailable"))
                })?;
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap_err()
            .code()
        });
        delivery_for_request(&receive, "blocked", "blocked");
        abandon(slice::from_ref(&text)).unwrap();
        assert_eq!(worker.join().unwrap(), "write.recovery_abandoned");
        assert_eq!(
            execute_queued(following, &text, None, "save", |_, _| Ok(
                WriteResult::<()>::from_changes(Vec::new())
            ))
            .unwrap_err()
            .code(),
            "write.abandoned"
        );
        wait_projects(&[text]).unwrap();
        assert_project_idle(&root.to_string_lossy());
        release_window("abandon-owner").unwrap();
        root.close().unwrap();
    }
    #[test]
    fn one_multifile_save_delivers_one_event_and_one_history_entry_to_each_window() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_queue_multifile");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("data/variants")).unwrap();
        fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,hitpoints\ndemo,Demo,100\n",
        )
        .unwrap();
        fs::write(
            root.join("data/hulls/demo.ship"),
            r#"{"hullId":"demo","hullName":"Demo","width":10}"#,
        )
        .unwrap();
        fs::write(
            root.join("data/variants/demo.variant"),
            r#"{"variantId":"demo","hullId":"demo","fluxVents":1}"#,
        )
        .unwrap();
        let manifest = project::open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("save.queue.test"),
        )
        .unwrap();
        let snapshot = services::query_joint_edit_request(&JointEditQuery {
            root: JointEditRoot {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                kind: JointEditKind::Variant,
                id: "demo".into(),
            },
            row_key: None,
            values: None,
            new_sources: vec![],
            catalog: None,
            catalog_source: None,
        })
        .unwrap();
        let mut values = BTreeMap::new();
        for record in &snapshot.records {
            let mut value = record.value.clone();
            let JointValue::Present(data) = &mut value else {
                continue;
            };
            match &record.target {
                JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant => {
                    data["fluxVents"] = serde_json::json!(2)
                }
                JointRecordTarget::Spec { target } if target.kind == EntityKind::Ship => {
                    data["width"] = serde_json::json!(20)
                }
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                } => data["hitpoints"] = serde_json::json!("200"),
                _ => continue,
            }
            values.insert(record.key.clone(), value);
        }
        assert_eq!(values.len(), 3);
        let payload = file_formats::joint_submission(JointEditSubmission {
            documents: Default::default(),
            csv_columns: Default::default(),
            base_versions: snapshot.base_versions.clone(),
            snapshot,
            values,
            json_write: Default::default(),
            create_overrides: vec![],
        });
        let first = window("multifile-first");
        let second = window("multifile-second");
        let broken = root.join("data/variants/broken.variant");
        fs::write(&broken, "{").unwrap();
        let scope = manifest.clone();
        let worker = thread::spawn(move || {
            execute(
                "multifile-first",
                "multifile".into(),
                &scope.mod_root,
                Some(&scope.session_id),
                "save",
                |_, _| {
                    project_save::execute_typed_save::<JointEditSnapshot>(
                        SaveAction::SaveJointEdit(Box::new(payload.clone())),
                    )
                },
            )
            .unwrap()
        });
        for receiver in [&first, &second] {
            delivery_for_request(receiver, "blocked", "multifile");
        }
        assert_eq!(
            query_file_history(&manifest.session_id, &manifest.mod_root)
                .unwrap()
                .undo_stack
                .len(),
            1
        );
        let unrelated = project_workspace("save_unrelated_delivery");
        save_empty("unrelated-owner", "unrelated", &unrelated.to_string_lossy());
        fs::remove_file(broken).unwrap();
        retry("multifile").unwrap();
        let result = worker.join().unwrap();
        assert_eq!(result.changes.len(), 3);
        let paths = result
            .changes
            .iter()
            .map(|change| &change.after_path)
            .collect::<BTreeSet<_>>();
        assert_eq!(paths.len(), 3);
        assert_eq!(result.history.undo_stack.len(), 1);
        let a = delivery_for_request(&first, "saved", "multifile");
        let b = delivery_for_request(&second, "saved", "multifile");
        assert_eq!(a["event"], b["event"]);
        assert_eq!(a["event"]["result"]["changes"].as_array().unwrap().len(), 3);
        assert_project_idle(&root.to_string_lossy());
        release_window("multifile-first").unwrap();
        release_window("multifile-second").unwrap();
        unrelated.close().unwrap();
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
