#[cfg(test)]
use crate::testutil::TestWorkspace;
use crate::{
    errors::{AppError, AppResult, ErrorDiagnostic},
    models::{EntityIdentityChange, FileVersion, SaveDelivery, WriteResult},
};
use serde::Serialize;
use std::{
    collections::{BTreeMap, VecDeque},
    path::Path,
    sync::{Arc, Condvar, LazyLock, Mutex},
};
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
pub struct SaveWork {
    id: String,
    owner: String,
    root: String,
    submitted_root: String,
    session_id: Option<String>,
}
struct QueuedSave {
    work: Arc<SaveWork>,
    progress: Progress,
}
#[derive(Clone)]
struct SaveWindow {
    root: Option<String>,
    channel: Channel<SaveDelivery>,
}
impl SaveWindow {
    fn belongs_to(&self, root: &str) -> bool {
        self.root.as_ref().is_none_or(|owned| {
            crate::models::windows_path_key(owned) == crate::models::windows_path_key(root)
        })
    }
}
#[derive(Default)]
struct ProjectSaves {
    windows: BTreeMap<String, SaveWindow>,
    roots: BTreeMap<String, VecDeque<QueuedSave>>,
}
impl ProjectSaves {
    fn registered_root(&self, root: &str) -> String {
        let requested = crate::models::windows_path_key(root);
        self.roots
            .iter()
            .find(|(key, queue)| {
                **key == requested
                    || queue
                        .iter()
                        .any(|entry| entry.work.submitted_root == requested)
            })
            .map(|(key, _)| key.clone())
            .unwrap_or(requested)
    }
    fn offer_confirmation(&mut self, work: &SaveWork) -> AppResult<()> {
        let Some(confirmation) = self.progress(work).confirmation.as_ref() else {
            return Ok(());
        };
        if confirmation.accepted.is_some() || confirmation.responder.is_some() {
            return Ok(());
        }
        let paths = confirmation.paths.clone();
        let selected = self
            .windows
            .get_key_value(&work.owner)
            .or_else(|| {
                self.windows
                    .iter()
                    .find(|(_, window)| window.belongs_to(&work.root))
            })
            .map(|(label, window)| (label.clone(), window.channel.clone()));
        if let Some((label, channel)) = selected {
            channel.send(SaveDelivery::Missing {
                request_id: work.id.clone(),
                paths,
            })?;
            self.progress(work)
                .confirmation
                .as_mut()
                .expect("current save holds its confirmation")
                .responder = Some(label);
        }
        Ok(())
    }
    fn progress(&mut self, work: &SaveWork) -> &mut Progress {
        &mut self
            .roots
            .get_mut(&work.root)
            .expect("active save owns its root queue")
            .iter_mut()
            .find(|entry| entry.work.id == work.id)
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
            if let Err(error) = window.channel.send(SaveDelivery::Waiting {
                mod_root: root.to_string(),
                waiting,
            }) {
                crate::diagnostics::record(format!("save queue status: {error}"));
            }
        }
    }
    fn block(&mut self, work: &SaveWork, diagnostic: ErrorDiagnostic) {
        self.progress(work).blocked = Some(diagnostic.clone());
        for window in self
            .windows
            .values()
            .filter(|window| window.belongs_to(&work.root))
        {
            if let Err(error) = window.channel.send(SaveDelivery::Blocked {
                request_id: work.id.clone(),
                mod_root: work.root.clone(),
                session_id: work.session_id.clone(),
                diagnostic: diagnostic.clone(),
            }) {
                crate::diagnostics::record(format!("save blocked status: {error}"));
            }
        }
        SAVES.1.notify_all();
    }
}
static SAVES: LazyLock<(Mutex<ProjectSaves>, Condvar)> = LazyLock::new(Default::default);
fn saves() -> AppResult<std::sync::MutexGuard<'static, ProjectSaves>> {
    SAVES
        .0
        .lock()
        .map_err(|_| AppError::message("write.queue_poisoned", "保存队列不可用"))
}
fn wait_changed(
    guard: std::sync::MutexGuard<'static, ProjectSaves>,
) -> AppResult<std::sync::MutexGuard<'static, ProjectSaves>> {
    SAVES
        .1
        .wait(guard)
        .map_err(|_| AppError::message("write.queue_poisoned", "保存队列不可用"))
}
fn root_key(root: &str) -> AppResult<String> {
    Ok(crate::models::windows_path_key(
        &crate::io::canonical_path(Path::new(root), "save root")?.to_string_lossy(),
    ))
}
fn work(id: &str) -> AppResult<Arc<SaveWork>> {
    saves()?
        .roots
        .values()
        .flatten()
        .find(|entry| entry.work.id == id)
        .map(|entry| entry.work.clone())
        .ok_or_else(|| AppError::message("write.request_unknown", "保存请求已结束"))
}
pub fn register(
    label: &str,
    root: Option<String>,
    channel: Channel<SaveDelivery>,
) -> AppResult<()> {
    let mut saves = saves()?;
    let window = SaveWindow { root, channel };
    for root in saves.roots.keys().filter(|root| window.belongs_to(root)) {
        window.channel.send(SaveDelivery::Waiting {
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
        .map(|entry| entry.work.clone())
        .collect::<Vec<_>>();
    for work in confirmations {
        saves.offer_confirmation(&work)?;
    }
    Ok(())
}
/// Registration fixes receive order before blocking workers start.
pub fn enqueue(
    label: &str,
    request_id: String,
    root: &str,
    session_id: Option<&str>,
) -> AppResult<Arc<SaveWork>> {
    if !crate::services::windows::accepts_save(label, session_id)? {
        return Err(AppError::message(
            "write.scope_closing",
            "所属窗口或项目正在关闭",
        ));
    }
    let work = Arc::new(SaveWork {
        id: request_id,
        owner: label.to_string(),
        root: root_key(root)?,
        submitted_root: crate::models::windows_path_key(root),
        session_id: session_id.map(str::to_string),
    });
    let mut saves = saves()?;
    let queue = saves.roots.entry(work.root.clone()).or_default();
    let progress = Progress::default();
    let first = queue.is_empty();
    queue.push_back(QueuedSave {
        work: work.clone(),
        progress,
    });
    if first {
        saves.notify(&work.root, true);
    }
    Ok(work)
}
/// The project queue owns execution; subscribers receive results without holding the queue.
pub fn execute_queued<T: Serialize>(
    work: Arc<SaveWork>,
    event_root: &str,
    session_id: Option<&str>,
    reason: &str,
    mut action: impl FnMut(&[EntityIdentityChange], &[FileVersion]) -> AppResult<WriteResult<T>>,
) -> AppResult<WriteResult<T>> {
    let (identities, versions) = {
        let mut saves = saves()?;
        while saves.roots[&work.root]
            .front()
            .expect("queued save is registered")
            .work
            .id
            != work.id
        {
            saves = wait_changed(saves)?;
        }
        if saves.progress(&work).abandoned {
            saves.finish(&work.root);
            return Err(AppError::message("write.abandoned", "所属项目保存已结束"));
        }
        let progress = saves.progress(&work);
        (progress.identities.clone(), progress.versions.clone())
    };
    let recovery = work.clone();
    let result = crate::io::with_write_retry(
        Path::new(event_root),
        move |error| wait_retry(&recovery, error),
        || loop {
            match action(&identities, &versions) {
                Err(AppError::SaveSourcesMissing { paths }) => {
                    confirm_sources(&work, paths.clone())?;
                    crate::io::accept_source_recreation(&work.root, paths)?;
                }
                result => break result,
            }
        },
    );
    let mut saves = saves()?;
    let result = match result {
        Ok(result) => result,
        Err(error) => {
            saves.finish(&work.root);
            return Err(error);
        }
    };
    for entry in saves
        .roots
        .get_mut(&work.root)
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
                .retain(|old| !old.path.eq_ignore_ascii_case(&version.path));
            entry.progress.versions.push(version.clone());
        }
    }
    let event = serde_json::to_value(crate::models::CommittedWriteEvent {
        origin_window_label: &work.owner,
        mod_root: event_root,
        session_id,
        reason,
        result: &result,
    })?;
    for window in saves
        .windows
        .values()
        .filter(|window| window.belongs_to(&work.root))
    {
        if let Err(error) = window.channel.send(SaveDelivery::Saved {
            request_id: work.id.clone(),
            event: event.clone(),
        }) {
            crate::diagnostics::record(format!("save result delivery: {error}"));
        }
    }
    saves.finish(&work.root);
    Ok(result)
}

fn wait_retry(work: &SaveWork, error: &AppError) -> AppResult<()> {
    let mut saves = saves()?;
    saves.block(work, error.diagnostic());
    while saves.progress(work).blocked.is_some() && !saves.progress(work).abandoned {
        saves = wait_changed(saves)?;
    }
    if saves.progress(work).abandoned {
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
) -> AppResult<crate::io::RootWriteLock> {
    let lease = crate::io::acquire_root_write_lock(Path::new(root))?;
    for identity in identities {
        for version in captured.iter_mut() {
            if crate::models::windows_path_key(&version.path)
                == crate::models::windows_path_key(&identity.before.write.path)
            {
                version.path = identity.after.write.path.clone();
            }
        }
    }
    for captured in captured.iter_mut() {
        if let Some(current) = versions
            .iter()
            .find(|version| version.path.eq_ignore_ascii_case(&captured.path))
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
            && !crate::io::source_recreation_allowed(root, &version.path)
        {
            missing.push(version.path.clone());
        }
    }
    if !missing.is_empty() {
        return Err(AppError::SaveSourcesMissing { paths: missing });
    }
    crate::io::verify_versions(root, captured)?;
    Ok(lease)
}

fn confirm_sources(work: &SaveWork, paths: Vec<String>) -> AppResult<()> {
    let mut saves = saves()?;
    saves.progress(work).confirmation = Some(SourceConfirmation {
        paths: paths.clone(),
        accepted: None,
        responder: None,
    });
    saves.offer_confirmation(work)?;
    loop {
        if saves.progress(work).abandoned {
            return Err(AppError::message("write.abandoned", "所属项目保存已结束"));
        }
        if let Some(accepted) = saves
            .progress(work)
            .confirmation
            .as_ref()
            .and_then(|confirmation| confirmation.accepted)
        {
            saves.progress(work).confirmation = None;
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
    let work = work(request_id)?;
    let mut saves = saves()?;
    if let Some(confirmation) = &mut saves.progress(&work).confirmation
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
    let work = work(request_id)?;
    let mut saves = saves()?;
    saves.progress(&work).blocked = None;
    saves.notify(&work.root, true);
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
    let mut saves = saves()?;
    saves.windows.remove(label);
    let mut confirmations = Vec::new();
    for entry in saves.roots.values_mut().flatten() {
        if let Some(confirmation) = &mut entry.progress.confirmation
            && confirmation.responder.as_deref() == Some(label)
        {
            confirmation.responder = None;
            confirmations.push(entry.work.clone());
        }
    }
    for work in confirmations {
        saves.offer_confirmation(&work)?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use serde_json::Value;
    use std::{sync::mpsc, time::Duration};
    use tauri::ipc::InvokeResponseBody;

    static TEST_QUEUE: Mutex<()> = Mutex::new(());

    fn window(label: &str) -> mpsc::Receiver<Value> {
        let (send, receive) = mpsc::channel();
        register(
            label,
            None,
            Channel::new(move |body| {
                let InvokeResponseBody::Json(json) = body else {
                    panic!("save delivery is JSON")
                };
                send.send(serde_json::from_str(&json).unwrap())
                    .map_err(|_| tauri::Error::Io(std::io::ErrorKind::BrokenPipe.into()))?;
                Ok(())
            }),
        )
        .unwrap();
        receive
    }

    fn saved(receive: &mpsc::Receiver<Value>) -> Value {
        loop {
            let delivery = receive.recv_timeout(Duration::from_secs(5)).unwrap();
            if delivery["kind"] == "saved" {
                return delivery;
            }
        }
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
        assert_eq!(saved(&receiver)["requestId"], "first");
        assert!(work("first").is_err());
        drop(receiver);
        save_empty("observer", "broken-channel", &root.to_string_lossy());
        release_window("observer").unwrap();
        save_empty("observer", "released", &root.to_string_lossy());
        assert!(saves().unwrap().roots.is_empty());
        root.close().unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn replaced_root_rejects_writing_and_releases_project_waiting() {
        let _serial = TEST_QUEUE.lock().unwrap();
        let (fixture, outside, link) = TestWorkspace::junction("save_replaced_root", "linked");
        let project = fixture.join("project");
        std::fs::create_dir(&project).unwrap();
        let text = project.to_string_lossy().to_string();
        let queued = enqueue("replaced-root", "replaced-root".into(), &text, None).unwrap();
        std::fs::remove_dir(&project).unwrap();
        std::fs::rename(link, &project).unwrap();
        let error = execute_queued::<()>(queued, &text, None, "save", |_, _| {
            panic!("replacement root is rejected before writing")
        })
        .unwrap_err();
        assert_eq!(error.code(), "path.link_rejected");
        wait_projects(&[text]).unwrap();
        assert!(!outside.join("saved.txt").exists());
        std::fs::remove_dir(project).unwrap();
        fixture.close().unwrap();
    }

    #[test]
    fn queued_failure_releases_its_position_and_missing_root_can_be_closed() {
        let _serial = TEST_QUEUE.lock().unwrap();
        for remove_before_enqueue in [false, true] {
            let root = project_workspace("save_missing_root");
            let text = root.to_string_lossy().to_string();
            if remove_before_enqueue {
                std::fs::remove_dir_all(&root).unwrap();
            }
            let first = enqueue("detached", "failed".into(), &text, None).unwrap();
            let second = enqueue("detached", "next".into(), &text, None).unwrap();
            if !remove_before_enqueue {
                std::fs::remove_dir_all(&root).unwrap();
            }
            let calls = std::cell::Cell::new(0);
            assert!(
                execute_queued(first, &text, None, "save", |_, _| {
                    calls.set(calls.get() + 1);
                    Ok(WriteResult::<()>::from_changes(Vec::new()))
                })
                .is_err()
            );
            assert_eq!(calls.get(), 0);
            std::fs::create_dir(&root).unwrap();
            execute_queued(second, &text, None, "save", |_, _| {
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap();
            std::fs::remove_dir_all(&root).unwrap();
            wait_projects(&[text]).unwrap();
            assert!(saves().unwrap().roots.is_empty());
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
        let worker = std::thread::spawn(move || {
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
        receive.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(saves().unwrap().roots.is_empty());
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
        let worker = std::thread::spawn(move || {
            execute_queued(queued, &next_root, None, "save", |_, _| {
                crate::io::retry_write(&next_root, || {
                    std::fs::read_to_string(Path::new(&next_root).join("available.txt"))?;
                    Ok(())
                })?;
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap()
        });
        loop {
            if receiver.recv_timeout(Duration::from_secs(5)).unwrap()["kind"] == "blocked" {
                break;
            }
        }
        assert!(wait_projects(std::slice::from_ref(&text)).is_err());
        save_empty("other", "independent", &other.to_string_lossy());
        assert_eq!(saves().unwrap().roots[&following.root].len(), 2);
        release_window("recovery-owner").unwrap();
        std::fs::write(root.join("available.txt"), "ready").unwrap();
        retry("recover").unwrap();
        worker.join().unwrap();
        execute_queued(following, &text, None, "save", |_, _| {
            Ok(WriteResult::<()>::from_changes(Vec::new()))
        })
        .unwrap();
        assert!(saves().unwrap().roots.is_empty());
        root.close().unwrap();
        other.close().unwrap();
    }

    #[test]
    fn source_confirmation_cancellation_and_reappearing_files_end_without_writes() {
        let _serial = TEST_QUEUE.lock().unwrap();
        for reappeared in [false, true] {
            let root = project_workspace("missing_source_answer");
            let path = root.join("notes.txt");
            std::fs::write(&path, "before").unwrap();
            let captured = crate::io::file_version(&path).unwrap();
            std::fs::remove_file(&path).unwrap();
            let owner = if reappeared {
                "reappeared"
            } else {
                "cancelled"
            };
            let receive = window(owner);
            let next_root = root.to_string_lossy().to_string();
            let worker = std::thread::spawn(move || {
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
                        std::fs::write(&expected[0].path, "saved")?;
                        Ok(WriteResult::<()>::from_changes(Vec::new()))
                    },
                )
                .unwrap_err()
                .code()
            });
            loop {
                let delivery = receive.recv_timeout(Duration::from_secs(5)).unwrap();
                if delivery["kind"] == "missing" {
                    let paths: Vec<String> =
                        serde_json::from_value(delivery["paths"].clone()).unwrap();
                    if reappeared {
                        std::fs::write(&path, "external").unwrap();
                    }
                    resolve_sources(owner, owner, &paths, reappeared).unwrap();
                    break;
                }
            }
            assert_eq!(
                worker.join().unwrap(),
                if reappeared {
                    "write.version_conflict"
                } else {
                    "write.cancelled"
                }
            );
            if reappeared {
                assert_eq!(std::fs::read_to_string(&path).unwrap(), "external");
            } else {
                assert!(!path.exists());
            }
            assert!(saves().unwrap().roots.is_empty());
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
        let worker = std::thread::spawn(move || {
            execute(
                "confirmation-source",
                "confirmation".into(),
                &next_root,
                None,
                "save",
                |_, _| {
                    if !crate::io::source_recreation_allowed(
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
        let paths = loop {
            let delivery = source.recv_timeout(Duration::from_secs(5)).unwrap();
            if delivery["kind"] == "missing" {
                break serde_json::from_value::<Vec<String>>(delivery["paths"].clone()).unwrap();
            }
        };
        release_window("confirmation-source").unwrap();
        assert!(work("confirmation").is_ok());
        let receiver = window("confirmation-receiver");
        loop {
            if receiver.recv_timeout(Duration::from_secs(5)).unwrap()["kind"] == "missing" {
                break;
            }
        }
        assert_eq!(
            resolve_sources("confirmation-source", "confirmation", &paths, true)
                .unwrap_err()
                .code(),
            "write.confirmation_owner"
        );
        resolve_sources("confirmation-receiver", "confirmation", &paths, true).unwrap();
        assert_eq!(saved(&receiver)["requestId"], "confirmation");
        worker.join().unwrap();
        assert!(work("confirmation").is_err());
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
        let worker = std::thread::spawn(move || {
            execute_queued(first, &next_root, None, "save", |_, _| {
                crate::io::retry_write(&next_root, || {
                    Err::<(), _>(AppError::message("io.unexpected", "restore unavailable"))
                })?;
                Ok(WriteResult::<()>::from_changes(Vec::new()))
            })
            .unwrap_err()
            .code()
        });
        loop {
            if receive.recv_timeout(Duration::from_secs(5)).unwrap()["kind"] == "blocked" {
                break;
            }
        }
        abandon(std::slice::from_ref(&text)).unwrap();
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
        assert!(saves().unwrap().roots.is_empty());
        release_window("abandon-owner").unwrap();
        root.close().unwrap();
    }
    #[test]
    fn one_multifile_save_delivers_one_event_and_one_history_entry_to_each_window() {
        use crate::models::*;
        let _serial = TEST_QUEUE.lock().unwrap();
        let root = project_workspace("save_queue_multifile");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("data/variants")).unwrap();
        std::fs::write(
            root.join("data/hulls/ship_data.csv"),
            "id,name,hitpoints\ndemo,Demo,100\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/demo.ship"),
            r#"{"hullId":"demo","hullName":"Demo","width":10}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/variants/demo.variant"),
            r#"{"variantId":"demo","hullId":"demo","fluxVents":1}"#,
        )
        .unwrap();
        let manifest = crate::services::project::open_project_session_traced(
            &root,
            None,
            &mut crate::services::project::PerformanceTrace::new("save.queue.test"),
        )
        .unwrap();
        let snapshot = crate::services::query_joint_edit_request(&JointEditQuery {
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
        let payload = JointEditSubmission {
            base_versions: snapshot.base_versions.clone(),
            snapshot,
            values,
            json_write: Default::default(),
            create_overrides: vec![],
        };
        let first = window("multifile-first");
        let second = window("multifile-second");
        let broken = root.join("data/variants/broken.variant");
        std::fs::write(&broken, "{").unwrap();
        let scope = manifest.clone();
        let worker = std::thread::spawn(move || {
            execute(
                "multifile-first",
                "multifile".into(),
                &scope.mod_root,
                Some(&scope.session_id),
                "save",
                |_, _| {
                    crate::testutil::commit_saved::<crate::models::JointEditSnapshot>(
                        crate::models::SaveAction::SaveJointEdit(Box::new(payload.clone())),
                    )
                },
            )
            .unwrap()
        });
        for receiver in [&first, &second] {
            loop {
                if receiver.recv_timeout(Duration::from_secs(5)).unwrap()["kind"] == "blocked" {
                    break;
                }
            }
        }
        assert_eq!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .len(),
            1
        );
        std::fs::remove_file(broken).unwrap();
        retry("multifile").unwrap();
        let result = worker.join().unwrap();
        assert_eq!(result.changes.len(), 3);
        let paths = result
            .changes
            .iter()
            .map(|change| &change.after_path)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(paths.len(), 3);
        assert_eq!(result.history.undo_stack.len(), 1);
        let a = saved(&first);
        let b = saved(&second);
        assert_eq!(a["event"], b["event"]);
        assert_eq!(a["event"]["result"]["changes"].as_array().unwrap().len(), 3);
        assert!(saves().unwrap().roots.is_empty());
        release_window("multifile-first").unwrap();
        release_window("multifile-second").unwrap();
        crate::services::project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
