use super::environment::{JavaEnvironment, probe_java};
use super::stop_owned_analysis;
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::canonical_path;
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::transfer::{TransferControl, TransferProgress};
use pyxis_java_analysis::{AnalysisRequest, AnalysisRuntime, Error as AnalysisError, java_path};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::{BTreeMap, VecDeque};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread::{self, JoinHandle};
use std::time::Instant;
use tauri::ipc::Channel;

#[cfg(test)]
#[path = "management_tests.rs"]
mod tests;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum ManagementAction {
    Refresh,
    Download,
    Import { archive: String },
    Probe { java_path: String },
    Test { java_path: String },
    Stop,
    Remove,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagementSnapshot {
    pub revision: u64,
    pub operation_key: Option<String>,
    pub queued: usize,
    pub action: Option<ManagementAction>,
    pub active: bool,
    pub phase: String,
    pub installation: String,
    pub jdt_version: String,
    pub download_bytes: u64,
    pub installation_path: String,
    pub log_path: String,
    pub staged_bytes: u64,
    pub instances: usize,
    pub projects: usize,
    pub progress: Option<TransferProgress>,
    pub environment: Option<JavaEnvironment>,
    pub error: Option<String>,
}

#[derive(Clone)]
pub struct ManagementSubmission {
    pub operation_key: String,
    pub snapshot: ManagementSnapshot,
    completion: Arc<ManagementCompletion>,
}

#[derive(Default)]
struct ManagementCompletion {
    result: Mutex<Option<ManagementSnapshot>>,
    changed: Condvar,
}

impl ManagementSubmission {
    pub fn wait(self) -> AppResult<ManagementSnapshot> {
        let mut result = self.completion.result.lock().map_err(|_| {
            AppError::message(
                "java_analysis.management_lock",
                "Java operation receipt unavailable",
            )
        })?;
        while result.is_none() {
            result = self.completion.changed.wait(result).map_err(|_| {
                AppError::message(
                    "java_analysis.management_lock",
                    "Java operation receipt unavailable",
                )
            })?;
        }
        Ok(result
            .as_ref()
            .expect("queue delivered the operation receipt")
            .clone())
    }
}

impl ManagementCompletion {
    fn deliver(&self, snapshot: ManagementSnapshot) {
        match self.result.lock() {
            Ok(mut result) => {
                *result = Some(snapshot);
                self.changed.notify_all();
            }
            Err(error) => diagnostics::failure(
                "java_analysis.receipt",
                AppError::message("java_analysis.management_lock", error.to_string()),
                json!({}),
            ),
        }
    }
}

#[derive(Clone)]
struct ManagementOperation {
    key: String,
    action: ManagementAction,
    control: TransferControl,
    completion: Arc<ManagementCompletion>,
}

struct ManagementState {
    snapshot: ManagementSnapshot,
    current: Option<ManagementOperation>,
    queue: VecDeque<ManagementOperation>,
    worker_running: bool,
    last_progress: Instant,
    closed: bool,
    listeners: BTreeMap<String, (String, Channel<ManagementSnapshot>)>,
}

pub struct ComponentManagement {
    runtime: Arc<AnalysisRuntime>,
    state: Mutex<ManagementState>,
    gate: Mutex<()>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl ComponentManagement {
    pub fn new(runtime: Arc<AnalysisRuntime>) -> Arc<Self> {
        let package = runtime.package();
        let version = package
            .version
            .strip_prefix("jdt-")
            .and_then(|version| version.split('-').next())
            .expect("fixed JDT inventory identity")
            .to_string();
        let snapshot = ManagementSnapshot {
            revision: 0,
            operation_key: None,
            queued: 0,
            action: None,
            active: false,
            phase: "idle".into(),
            installation: "unchecked".into(),
            jdt_version: version,
            download_bytes: package.artifacts.iter().map(|file| file.bytes).sum(),
            installation_path: java_path(&runtime.paths().dependencies.join(&package.version))
                .to_string_lossy()
                .into_owned(),
            log_path: java_path(&runtime.paths().logs)
                .to_string_lossy()
                .into_owned(),
            staged_bytes: 0,
            instances: 0,
            projects: 0,
            progress: None,
            environment: None,
            error: None,
        };
        Arc::new(Self {
            runtime,
            state: Mutex::new(ManagementState {
                snapshot,
                current: None,
                queue: VecDeque::new(),
                worker_running: false,
                last_progress: Instant::now(),
                closed: false,
                listeners: BTreeMap::new(),
            }),
            gate: Mutex::new(()),
            worker: Mutex::new(None),
        })
    }
    fn state(&self) -> AppResult<MutexGuard<'_, ManagementState>> {
        self.state.lock().map_err(|_| {
            AppError::message(
                "java_analysis.management_lock",
                "Java component state unavailable",
            )
        })
    }
    pub fn snapshot(&self) -> AppResult<ManagementSnapshot> {
        let mut state = self.state()?;
        let (instances, projects) = self.runtime.managed_counts()?;
        state.snapshot.instances = instances;
        state.snapshot.projects = projects;
        Ok(state.snapshot.clone())
    }
    pub fn subscribe(
        &self,
        window: String,
        subscription_key: String,
        channel: Channel<ManagementSnapshot>,
    ) -> AppResult<()> {
        let mut state = self.state()?;
        let (instances, projects) = self.runtime.managed_counts()?;
        state.snapshot.instances = instances;
        state.snapshot.projects = projects;
        channel.send(state.snapshot.clone())?;
        state.listeners.insert(subscription_key, (window, channel));
        Ok(())
    }
    pub fn unsubscribe(&self, window: &str, subscription_key: &str) -> AppResult<()> {
        let mut state = self.state()?;
        if state
            .listeners
            .get(subscription_key)
            .is_some_and(|(owner, _)| owner == window)
        {
            state.listeners.remove(subscription_key);
        }
        Ok(())
    }
    pub fn analysis_guard(&self) -> AppResult<MutexGuard<'_, ()>> {
        let gate = self.gate.lock().map_err(|_| {
            AppError::message(
                "java_analysis.management_lock",
                "Java component operation unavailable",
            )
        })?;
        let state = self.state()?;
        if state.closed || state.snapshot.active || !state.queue.is_empty() {
            return Err(AppError::message(
                "java_analysis.operation_busy",
                "A Java component operation is active",
            ));
        }
        Ok(gate)
    }
    pub fn publish_counts(&self) -> AppResult<()> {
        let mut state = self.state()?;
        if state.closed {
            return Ok(());
        }
        let (instances, projects) = self.runtime.managed_counts()?;
        if state.snapshot.instances == instances && state.snapshot.projects == projects {
            return Ok(());
        }
        state.snapshot.instances = instances;
        state.snapshot.projects = projects;
        state.snapshot.revision += 1;
        let snapshot = state.snapshot.clone();
        state
            .listeners
            .retain(|_, (_, channel)| channel.send(snapshot.clone()).is_ok());
        Ok(())
    }
    pub fn cancel(&self, operation_key: &str) -> AppResult<ManagementSnapshot> {
        let mut state = self.state()?;
        if let Some(operation) = state
            .current
            .as_ref()
            .filter(|entry| entry.key == operation_key)
        {
            operation.control.cancel();
            state.snapshot.phase = "cancelling".into();
            return Self::publish(&mut state);
        }
        if let Some(index) = state
            .queue
            .iter()
            .position(|entry| entry.key == operation_key)
        {
            let operation = state
                .queue
                .remove(index)
                .expect("queued cancellation target");
            state.snapshot.queued = state.queue.len();
            Self::cancel_pending(&operation, &state.snapshot);
            return Self::publish(&mut state);
        }
        Ok(state.snapshot.clone())
    }
    pub fn begin(
        self: &Arc<Self>,
        action: ManagementAction,
        operation_key: String,
    ) -> AppResult<ManagementSubmission> {
        let _gate = self.gate.lock().map_err(|_| {
            AppError::message(
                "java_analysis.management_lock",
                "Java component operation unavailable",
            )
        })?;
        let key_for_progress = operation_key.clone();
        let weak = Arc::downgrade(self);
        let control = TransferControl::new(Arc::new(move |progress| {
            if let Some(owner) = weak.upgrade() {
                let publish = owner.state().is_ok_and(|state| {
                    state
                        .current
                        .as_ref()
                        .is_some_and(|operation| operation.key == key_for_progress)
                        && (state.last_progress.elapsed().as_millis() >= 100
                            || state.snapshot.phase != progress.phase)
                });
                if publish && let Err(error) = owner.publish_progress(&key_for_progress, progress) {
                    diagnostics::failure("java_analysis.progress", error, json!({}));
                }
            }
        }));
        let operation = ManagementOperation {
            key: operation_key,
            action,
            control,
            completion: Arc::new(ManagementCompletion::default()),
        };
        let mut state = self.state()?;
        if state.closed {
            return Err(AppError::message(
                "java_analysis.management_closed",
                "Java component management is closing",
            ));
        }
        if let Some(existing) = state
            .current
            .iter()
            .chain(state.queue.iter())
            .find(|entry| entry.action == operation.action)
        {
            return Ok(ManagementSubmission {
                operation_key: existing.key.clone(),
                snapshot: state.snapshot.clone(),
                completion: Arc::clone(&existing.completion),
            });
        }
        state.queue.push_back(operation.clone());
        state.snapshot.queued = state.queue.len();
        let start_worker = !state.worker_running;
        if start_worker {
            state.worker_running = true;
            Self::activate_next(&mut state);
        }
        let snapshot = Self::publish(&mut state)?;
        drop(state);
        if start_worker {
            self.join_worker()?;
            let owner = Arc::clone(self);
            *self.worker.lock().map_err(|_| {
                AppError::message(
                    "java_analysis.management_lock",
                    "Java component worker unavailable",
                )
            })? = Some(thread::spawn(move || owner.run_queue()));
        }
        Ok(ManagementSubmission {
            operation_key: operation.key,
            snapshot,
            completion: operation.completion,
        })
    }
    fn cancel_pending(operation: &ManagementOperation, snapshot: &ManagementSnapshot) {
        operation.control.cancel();
        let mut receipt = snapshot.clone();
        receipt.operation_key = Some(operation.key.clone());
        receipt.action = Some(operation.action.clone());
        receipt.active = false;
        receipt.phase = "cancelled".into();
        receipt.error = None;
        operation.completion.deliver(receipt);
    }
    fn activate_next(state: &mut ManagementState) {
        state.current = state.queue.pop_front();
        state.snapshot.queued = state.queue.len();
        if let Some(operation) = &state.current {
            state.snapshot.operation_key = Some(operation.key.clone());
            state.snapshot.action = Some(operation.action.clone());
            state.snapshot.active = true;
            state.snapshot.phase = match &operation.action {
                ManagementAction::Stop => "stopping",
                ManagementAction::Remove => "removing",
                ManagementAction::Test { .. } => "testing",
                _ => "checking",
            }
            .into();
            state.snapshot.error = None;
            state.snapshot.progress = None;
        }
    }
    fn publish(state: &mut ManagementState) -> AppResult<ManagementSnapshot> {
        state.snapshot.revision += 1;
        let snapshot = state.snapshot.clone();
        state
            .listeners
            .retain(|_, (_, channel)| channel.send(snapshot.clone()).is_ok());
        Ok(snapshot)
    }
    fn publish_progress(&self, operation_key: &str, progress: TransferProgress) -> AppResult<()> {
        let mut state = self.state()?;
        if !state
            .current
            .as_ref()
            .is_some_and(|operation| operation.key == operation_key)
        {
            return Ok(());
        }
        state.last_progress = Instant::now();
        if state.snapshot.phase != "cancelling" {
            state.snapshot.phase = progress.phase.into();
        }
        state.snapshot.progress = Some(progress);
        Self::publish(&mut state)?;
        Ok(())
    }
    fn run_queue(self: Arc<Self>) {
        loop {
            let operation = match self.state() {
                Ok(state) => state.current.clone(),
                Err(error) => {
                    diagnostics::failure("java_analysis.management", error, json!({}));
                    return;
                }
            };
            let Some(operation) = operation else {
                return;
            };
            let result = self.perform(&operation);
            let cancelled = matches!(
                &result,
                Err(AppError::JavaAnalysis(AnalysisError::Cancelled))
            );
            let inspection = self.inspect();
            if let Some(error) = result.as_ref().err()
                && !cancelled
            {
                diagnostics::failure(
                    "java_analysis.management",
                    AppError::message("java_analysis.operation_failed", error.to_string()),
                    json!({"action":operation.action}),
                );
            }
            let mut state = match self.state() {
                Ok(state) => state,
                Err(error) => {
                    diagnostics::failure("java_analysis.management", error, json!({}));
                    return;
                }
            };
            if !state
                .current
                .as_ref()
                .is_some_and(|active| active.key == operation.key)
            {
                continue;
            }
            let counts = self.runtime.managed_counts();
            state.snapshot.active = false;
            state.snapshot.phase = if cancelled {
                "cancelled"
            } else if result.is_err() {
                "failed"
            } else {
                "succeeded"
            }
            .into();
            state.snapshot.error = if cancelled {
                None
            } else {
                result.as_ref().err().map(ToString::to_string)
            };
            match inspection {
                Ok((installation, bytes)) => {
                    state.snapshot.installation = installation;
                    state.snapshot.staged_bytes = bytes;
                }
                Err(error) => {
                    state.snapshot.phase = "failed".into();
                    state.snapshot.error = Some(error.to_string());
                }
            }
            match counts {
                Ok((instances, projects)) => {
                    state.snapshot.instances = instances;
                    state.snapshot.projects = projects;
                }
                Err(error) => {
                    state.snapshot.phase = "failed".into();
                    state.snapshot.error = Some(error.to_string());
                }
            }
            state.current = None;
            if let Err(error) = Self::publish(&mut state) {
                diagnostics::failure("java_analysis.management", error, json!({}));
            }
            operation.completion.deliver(state.snapshot.clone());
            if state.closed {
                for pending in state.queue.drain(..).collect::<Vec<_>>() {
                    Self::cancel_pending(&pending, &state.snapshot);
                }
                state.snapshot.queued = 0;
                state.worker_running = false;
                return;
            }
            if state.queue.is_empty() {
                state.worker_running = false;
                return;
            }
            Self::activate_next(&mut state);
            if let Err(error) = Self::publish(&mut state) {
                diagnostics::failure("java_analysis.management", error, json!({}));
            }
        }
    }
    fn inspect(&self) -> AppResult<(String, u64)> {
        let installation = match self.runtime.installed() {
            Ok(true) => "installed",
            Ok(false) => "missing",
            Err(_) => "damaged",
        };
        let stage = self
            .runtime
            .paths()
            .dependencies
            .join(format!("{}.staging", self.runtime.package().version));
        fn size(path: &Path) -> AppResult<u64> {
            if !path.exists() {
                return Ok(0);
            }
            let mut bytes = 0;
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let kind = entry.file_type()?;
                if kind.is_symlink() {
                    return Err(AppError::message(
                        "java_analysis.staging_link",
                        "Staging links are unsupported",
                    ));
                }
                bytes += if kind.is_dir() {
                    size(&entry.path())?
                } else {
                    entry.metadata()?.len()
                };
            }
            Ok(bytes)
        }
        Ok((installation.into(), size(&stage)?))
    }
    fn perform(&self, operation: &ManagementOperation) -> AppResult<()> {
        let action = &operation.action;
        let control = &operation.control;
        control.check()?;
        match action {
            ManagementAction::Refresh => {}
            ManagementAction::Download => {
                self.require_idle_runtime()?;
                self.runtime.install_with_control(control)?;
            }
            ManagementAction::Import { archive } => {
                self.require_idle_runtime()?;
                self.runtime
                    .import_with_control(Path::new(archive), control)?;
            }
            ManagementAction::Probe { java_path } | ManagementAction::Test { java_path } => {
                let started = Instant::now();
                let mut environment = probe_java(Path::new(java_path), control)?;
                if matches!(action, ManagementAction::Test { .. }) {
                    let instance = self.runtime.start(Path::new(java_path))?;
                    let result = (|| -> AppResult<()> {
                        control.check()?;
                        let response = self.runtime.request(
                            &instance,
                            &AnalysisRequest::Parse {
                                id: json!("environment-test"),
                                source: "record Satellite(int radius) {}".into(),
                                version: 1,
                                language: Some("17".into()),
                            },
                        )?;
                        if !matches!(response.result,Some(AnalysisResult::Syntax(ref syntax)) if syntax.errors==0)
                        {
                            return Err(AppError::message(
                                "java_analysis.self_check",
                                "Java AST self-check failed",
                            ));
                        }
                        Ok(())
                    })();
                    let release = self.runtime.close(&instance);
                    result?;
                    release?;
                    environment.log_path = Some(
                        self.runtime
                            .paths()
                            .logs
                            .join(format!("{instance}.log"))
                            .to_string_lossy()
                            .into_owned(),
                    );
                    control.check()?;
                }
                environment.milliseconds = started.elapsed().as_secs_f64() * 1000.0;
                let mut state = self.state()?;
                if state
                    .current
                    .as_ref()
                    .is_some_and(|active| active.key == operation.key)
                {
                    state.snapshot.environment = Some(environment);
                    Self::publish(&mut state)?;
                }
            }
            ManagementAction::Stop => stop_owned_analysis(&self.runtime)?,
            ManagementAction::Remove => {
                self.require_idle_runtime()?;
                let root = &self.runtime.paths().dependencies;
                if root.exists() {
                    for path in [
                        root.join(&self.runtime.package().version),
                        root.join(format!("{}.staging", self.runtime.package().version)),
                    ] {
                        remove_owned(&path, root)?;
                    }
                }
            }
        }
        Ok(())
    }
    fn require_idle_runtime(&self) -> AppResult<()> {
        if self.runtime.instance_count()? > 0 {
            return Err(AppError::message(
                "java_analysis.in_use",
                "Stop Java analysis before changing dependencies",
            ));
        }
        Ok(())
    }
    fn join_worker(&self) -> AppResult<()> {
        if let Some(worker) = self
            .worker
            .lock()
            .map_err(|_| {
                AppError::message(
                    "java_analysis.management_lock",
                    "Java component worker unavailable",
                )
            })?
            .take()
        {
            worker.join().map_err(|_| {
                AppError::message(
                    "java_analysis.worker_failed",
                    "Java component worker panicked",
                )
            })?;
        }
        Ok(())
    }
    pub fn shutdown(&self) -> AppResult<()> {
        let _gate = self.gate.lock().map_err(|_| {
            AppError::message(
                "java_analysis.management_lock",
                "Java component operation unavailable",
            )
        })?;
        {
            let mut state = self.state()?;
            state.closed = true;
            for pending in state.queue.drain(..).collect::<Vec<_>>() {
                Self::cancel_pending(&pending, &state.snapshot);
            }
            state.snapshot.queued = 0;
            if let Some(operation) = &state.current {
                operation.control.cancel();
                state.snapshot.phase = "cancelling".into();
            }
        }
        self.join_worker()
    }
}

fn remove_owned(path: &Path, root: &Path) -> AppResult<()> {
    if !path.exists() {
        return Ok(());
    }
    if canonical_path(path, "Component removal target")?.parent()
        != Some(canonical_path(root, "Component root")?.as_path())
        || fs::symlink_metadata(path)?.file_type().is_symlink()
    {
        return Err(AppError::message(
            "java_analysis.installation_path",
            "Component path escapes its root",
        ));
    }
    fn remove(path: &Path) -> AppResult<()> {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() && !kind.is_symlink() {
                remove(&entry.path())?;
            } else {
                fs::remove_file(entry.path())?;
            }
        }
        fs::remove_dir(path)?;
        Ok(())
    }
    remove(path)
}
