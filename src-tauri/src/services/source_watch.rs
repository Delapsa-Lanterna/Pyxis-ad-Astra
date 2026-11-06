use crate::diagnostics;
use crate::errors::{AppError, AppResult, ErrorDiagnostic};
use crate::io::FsRootBoundary;
use crate::models::windows_path_key;
use notify::event::{Flag, ModifyKind, RenameMode};
use notify::{
    Event, EventKind, RecommendedWatcher, RecursiveMode, Result as NotifyResult, Watcher,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::mem;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard, Weak};
use std::thread::{Builder, JoinHandle};
use std::time::{Duration, Instant};

const QUIET: Duration = Duration::from_millis(40);
const MAX_WAIT: Duration = Duration::from_millis(500);
static ROOTS: LazyLock<Mutex<BTreeMap<String, Weak<SourceRoot>>>> = LazyLock::new(Default::default);

#[derive(Default)]
pub struct SourceChangeBatch {
    pub root: String,
    pub paths: BTreeSet<PathBuf>,
    pub renames: Vec<(PathBuf, PathBuf)>,
    pub rescan: bool,
    pub diagnostic: Option<ErrorDiagnostic>,
}

struct SourceRootState {
    batch: SourceChangeBatch,
    first: Option<Instant>,
    latest: Option<Instant>,
    leases: usize,
    openings: usize,
    stopped: bool,
    watcher: Option<RecommendedWatcher>,
}
struct SourceRoot {
    path: String,
    pending: Mutex<SourceRootState>,
    changed: Condvar,
    worker: Mutex<Option<JoinHandle<()>>>,
    deliver: fn(SourceChangeBatch),
}
pub struct SourceSubscription {
    root: Arc<SourceRoot>,
    active: bool,
}

fn roots() -> AppResult<MutexGuard<'static, BTreeMap<String, Weak<SourceRoot>>>> {
    ROOTS
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))
}
impl SourceRoot {
    fn pending(&self) -> AppResult<MutexGuard<'_, SourceRootState>> {
        self.pending
            .lock()
            .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))
    }
    fn record(&self, event: NotifyResult<Event>) {
        let result = (|| -> AppResult<()> {
            let mut pending = self.pending()?;
            if pending.stopped {
                return Ok(());
            }
            match event {
                Ok(event) => {
                    if matches!(event.kind, EventKind::Access(_)) {
                        return Ok(());
                    }
                    pending.batch.rescan |= event.need_rescan();
                    if matches!(
                        event.kind,
                        EventKind::Modify(ModifyKind::Name(RenameMode::Both))
                    ) {
                        pending
                            .batch
                            .renames
                            .push((event.paths[0].clone(), event.paths[1].clone()));
                    }
                    pending.batch.paths.extend(event.paths);
                }
                Err(error) => {
                    pending.batch.diagnostic = Some(
                        AppError::message("source.watch_failed", error.to_string())
                            .at_path(Path::new(&self.path))
                            .diagnostic(),
                    );
                    pending.batch.rescan = true;
                }
            }
            let now = Instant::now();
            pending.first.get_or_insert(now);
            pending.latest = Some(now);
            self.changed.notify_all();
            Ok(())
        })();
        if let Err(error) = result {
            diagnostics::failure(
                "source.watch_event_failed",
                error,
                json!({"root":self.path}),
            );
        }
    }
    fn attach(self: &Arc<Self>) -> AppResult<()> {
        let root = Arc::downgrade(self);
        let mut watcher = notify::recommended_watcher(move |event| {
            if let Some(root) = root.upgrade() {
                root.record(event);
            }
        })
        .map_err(|error| {
            AppError::message("source.watch_failed", error.to_string())
                .at_path(Path::new(&self.path))
        })?;
        let boundary = FsRootBoundary::new(Path::new(&self.path), "watch root")?;
        watcher
            .watch(boundary.root(), RecursiveMode::Recursive)
            .map_err(|error| {
                AppError::message("source.watch_failed", error.to_string()).at_path(boundary.root())
            })?;
        let previous = self.pending()?.watcher.replace(watcher);
        drop(previous);
        Ok(())
    }
    fn run(&self) -> AppResult<()> {
        let mut pending = self.pending()?;
        loop {
            if pending.stopped {
                return Ok(());
            }
            if pending.openings > 0 || pending.first.is_none() {
                pending = self
                    .changed
                    .wait(pending)
                    .map_err(|_| AppError::message("source.watch_lock", "来源监听等待失败"))?;
                continue;
            }
            let deadline = (pending.first.expect("pending batch") + MAX_WAIT)
                .min(pending.latest.expect("latest event") + QUIET);
            let now = Instant::now();
            if now < deadline {
                pending = self
                    .changed
                    .wait_timeout(pending, deadline - now)
                    .map_err(|_| AppError::message("source.watch_lock", "来源监听等待失败"))?
                    .0;
                continue;
            }
            let batch = mem::replace(
                &mut pending.batch,
                SourceChangeBatch {
                    root: self.path.clone(),
                    ..Default::default()
                },
            );
            pending.first = None;
            pending.latest = None;
            drop(pending);
            // Native callbacks keep merging one pending batch while this root is being consumed.
            (self.deliver)(batch);
            pending = self.pending()?;
        }
    }
}

/// Subscribes before baseline reads; activate once after the corresponding consumer is registered.
pub fn subscribe(root: &Path, deliver: fn(SourceChangeBatch)) -> AppResult<SourceSubscription> {
    let path = FsRootBoundary::new(root, "watch root")?
        .root()
        .to_string_lossy()
        .into_owned();
    let key = windows_path_key(&path);
    let mut registered = roots()?;
    if let Some(root) = registered.get(&key).and_then(Weak::upgrade) {
        let mut pending = root.pending()?;
        if !pending.stopped {
            pending.leases += 1;
            pending.openings += 1;
            drop(pending);
            return Ok(SourceSubscription {
                root,
                active: false,
            });
        }
    }
    let root = Arc::new(SourceRoot {
        path: path.clone(),
        pending: Mutex::new(SourceRootState {
            batch: SourceChangeBatch {
                root: path,
                ..Default::default()
            },
            first: None,
            latest: None,
            leases: 1,
            openings: 1,
            stopped: false,
            watcher: None,
        }),
        changed: Condvar::new(),
        worker: Mutex::new(None),
        deliver,
    });
    if let Err(error) = root.attach() {
        let mut pending = root.pending()?;
        pending.batch.diagnostic = Some(error.diagnostic());
        pending.first = Some(Instant::now());
        pending.latest = pending.first;
    }
    let running = root.clone();
    let worker = Builder::new().name("source-watch".into()).spawn(move || {
        if let Err(error) = running.run() {
            diagnostics::failure(
                "source.watch_worker_failed",
                error,
                json!({"root":running.path}),
            );
        }
    })?;
    *root
        .worker
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))? = Some(worker);
    registered.insert(key, Arc::downgrade(&root));
    Ok(SourceSubscription {
        root,
        active: false,
    })
}
impl SourceSubscription {
    pub fn root(&self) -> &str {
        &self.root.path
    }
    pub fn activate(&mut self) -> AppResult<()> {
        self.root.pending()?.openings -= 1;
        self.active = true;
        self.root.changed.notify_all();
        Ok(())
    }
    pub fn retry(&self) -> AppResult<()> {
        self.root.attach()?;
        self.root
            .record(Ok(Event::new(EventKind::Other).set_flag(Flag::Rescan)));
        Ok(())
    }
    fn release(&self) -> AppResult<()> {
        let mut pending = self.root.pending()?;
        pending.leases -= 1;
        if !self.active {
            pending.openings -= 1;
        }
        if pending.leases > 0 {
            self.root.changed.notify_all();
            return Ok(());
        }
        pending.stopped = true;
        let watcher = pending.watcher.take();
        self.root.changed.notify_all();
        drop(pending);
        drop(watcher);
        if let Some(worker) = self
            .root
            .worker
            .lock()
            .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?
            .take()
        {
            worker
                .join()
                .map_err(|_| AppError::message("source.watch_worker_failed", "来源监听结束失败"))?;
        }
        let mut registered = roots()?;
        let key = windows_path_key(&self.root.path);
        if registered
            .get(&key)
            .and_then(Weak::upgrade)
            .is_some_and(|root| Arc::ptr_eq(&root, &self.root))
        {
            registered.remove(&key);
        }
        Ok(())
    }
}
impl Drop for SourceSubscription {
    fn drop(&mut self) {
        if let Err(error) = self.release() {
            diagnostics::failure(
                "source.watch_release_failed",
                error,
                json!({"root":self.root.path}),
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io;
    use crate::test_support::TestWorkspace;
    use notify::Error as NotifyError;
    use std::fs;
    use std::sync::mpsc::{self, Receiver, Sender};
    use std::thread;

    static RECEIVERS: LazyLock<Mutex<BTreeMap<String, Sender<SourceChangeBatch>>>> =
        LazyLock::new(Default::default);
    fn receive(batch: SourceChangeBatch) {
        let registered = RECEIVERS.lock().unwrap();
        if let Some(sender) = registered.get(&windows_path_key(&batch.root)) {
            sender.send(batch).unwrap();
        }
    }
    fn release_workspace(root: &Path) -> Vec<String> {
        RECEIVERS.lock().unwrap().remove(&windows_path_key(
            &root.canonicalize().unwrap().to_string_lossy(),
        ));
        Vec::new()
    }
    fn workspace(label: &str) -> (TestWorkspace, Receiver<SourceChangeBatch>) {
        let root = TestWorkspace::new(label).with_cleanup(release_workspace);
        let (send, receive) = mpsc::channel();
        let canonical = root.canonicalize().unwrap();
        RECEIVERS
            .lock()
            .unwrap()
            .insert(windows_path_key(&canonical.to_string_lossy()), send);
        (root, receive)
    }
    fn contains_path(batch: &SourceChangeBatch, path: &Path) -> bool {
        batch.paths.iter().any(|actual| {
            windows_path_key(
                &io::canonical_path(actual, "event path")
                    .unwrap()
                    .to_string_lossy(),
            ) == windows_path_key(
                &io::canonical_path(path, "expected path")
                    .unwrap()
                    .to_string_lossy(),
            )
        })
    }
    #[test]
    fn source_watch_recreates_the_original_root_after_a_move_and_explicit_retry() {
        let (root, events) = workspace("source_watch_root_recovery");
        let mut subscription = subscribe(&root, receive).unwrap();
        subscription.activate().unwrap();
        fs::rename(root.as_path(), root.outer().join("moved")).unwrap();
        subscription
            .root
            .record(Err(NotifyError::generic("watched root moved")));
        assert!(
            events
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .diagnostic
                .is_some()
        );
        assert!(subscription.retry().is_err());
        fs::create_dir(root.as_path()).unwrap();
        subscription.retry().unwrap();
        let recovered = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(recovered.rescan);
        assert!(recovered.diagnostic.is_none());
        drop(subscription);
        root.close().unwrap();
    }
    #[test]
    fn source_watch_reopening_rejects_events_from_the_released_instance() {
        let (root, events) = workspace("source_watch_reopen");
        let mut previous = subscribe(&root, receive).unwrap();
        previous.activate().unwrap();
        let released = previous.root.clone();
        drop(previous);
        let mut current = subscribe(&root, receive).unwrap();
        assert!(!Arc::ptr_eq(&released, &current.root));
        current.activate().unwrap();
        let obsolete = root.join("obsolete.txt");
        released.record(Ok(Event::new(EventKind::Other).add_path(obsolete.clone())));
        let path = root.join("current.txt");
        fs::write(&path, "current").unwrap();
        let batch = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(contains_path(&batch, &path));
        assert!(!batch.paths.contains(&obsolete));
        drop(current);
        root.close().unwrap();
    }
    #[test]
    fn source_watch_shares_roots_buffers_openings_and_releases_last_owner() {
        let (root, events) = workspace("source_watch_shared");
        let mut first = subscribe(&root, receive).unwrap();
        let mut second = subscribe(&root, receive).unwrap();
        assert!(Arc::ptr_eq(&first.root, &second.root));
        let path = root.join("notes.txt");
        fs::write(&path, "initial").unwrap();
        first
            .root
            .record(Ok(Event::new(EventKind::Other).add_path(path.clone())));
        first.activate().unwrap();
        assert!(events.try_recv().is_err());
        second.activate().unwrap();
        let batch = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(contains_path(&batch, &path));
        drop(first);
        fs::write(&path, "updated").unwrap();
        let batch = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(contains_path(&batch, &path));
        let key = windows_path_key(second.root());
        drop(second);
        assert!(!roots().unwrap().contains_key(&key));
        fs::write(&path, "released").unwrap();
        root.close().unwrap();
    }
    #[test]
    fn source_watch_keeps_rename_pairs_and_delivers_listener_errors_and_retry() {
        let (root, events) = workspace("source_watch_rename");
        let before = root.join("before.txt");
        let after = root.join("after.txt");
        fs::write(&before, "content").unwrap();
        let mut subscription = subscribe(&root, receive).unwrap();
        fs::rename(&before, &after).unwrap();
        subscription
            .root
            .record(Ok(Event::new(EventKind::Modify(ModifyKind::Name(
                RenameMode::Both,
            )))
            .add_path(before.clone())
            .add_path(after.clone())));
        subscription.activate().unwrap();
        let batch = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert!(batch.renames.contains(&(before, after)));
        subscription
            .root
            .record(Err(NotifyError::generic("listener unavailable")));
        let batch = events.recv_timeout(Duration::from_secs(5)).unwrap();
        assert_eq!(batch.diagnostic.unwrap().code, "source.watch_failed");
        subscription.retry().unwrap();
        assert!(events.recv_timeout(Duration::from_secs(5)).unwrap().rescan);
        drop(subscription);
        root.close().unwrap();
    }
    #[test]
    fn source_watch_delivers_before_a_continuous_stream_becomes_quiet() {
        let (root, events) = workspace("source_watch_continuous");
        let path = root.join("stream.txt");
        fs::write(&path, "initial").unwrap();
        let mut subscription = subscribe(&root, receive).unwrap();
        subscription.activate().unwrap();
        thread::scope(|scope| {
            scope.spawn(|| {
                let started = Instant::now();
                while started.elapsed() < Duration::from_millis(1600) {
                    fs::write(&path, started.elapsed().as_nanos().to_string()).unwrap();
                    thread::sleep(Duration::from_millis(20));
                }
            });
            let started = Instant::now();
            let batch = events.recv_timeout(Duration::from_millis(800)).unwrap();
            assert!(started.elapsed() < Duration::from_millis(800));
            assert!(contains_path(&batch, &path));
        });
        drop(subscription);
        root.close().unwrap();
    }
}
