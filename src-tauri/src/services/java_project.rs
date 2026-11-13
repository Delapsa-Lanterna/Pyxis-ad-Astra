mod artifacts;
mod build;
mod configuration;
pub mod deployment;
pub mod environment;
mod gradle;
pub mod inputs;
mod process;
mod snapshot;
mod tasks;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::java_project::{JavaProjectAction, JavaProjectOperation, JavaProjectSnapshot};
use crate::models::{ProjectManifest, windows_path_key};
use crate::parsers;
use crate::services::project;
use configuration::{StoredProject, paths, persist};
use sha2::{Digest, Sha256};
use snapshot::describe;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::slice;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex, PoisonError};
use tasks::{TaskReceipt, cancel, operate};

static ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);
fn unavailable<T>(error: PoisonError<T>) -> AppError {
    let message = error.to_string();
    drop(error.into_inner());
    AppError::message("java_project.state", message)
}
static PROJECTS: LazyLock<Mutex<BTreeMap<String, Arc<JavaProject>>>> =
    LazyLock::new(Default::default);
struct ProjectState {
    stored: StoredProject,
    snapshot: JavaProjectSnapshot,
    owner: String,
    input_generation: u64,
    receipt: Option<Arc<TaskReceipt>>,
}
struct JavaProject {
    session: String,
    file: PathBuf,
    state: Mutex<ProjectState>,
    changed: Condvar,
    cancelled: AtomicBool,
    input_generation: AtomicU64,
}
pub fn initialize(directory: &Path) -> AppResult<()> {
    *ROOT.lock().map_err(unavailable)? = Some(directory.join("java-project"));
    Ok(())
}
fn entry(session: &str) -> AppResult<Arc<JavaProject>> {
    let manifest = project::current_project_manifest(session)?;
    let key = io::canonical_path(Path::new(&manifest.mod_root), "Java project")?
        .to_string_lossy()
        .into_owned();
    let mut projects = PROJECTS.lock().map_err(unavailable)?;
    if let Some(entry) = projects.get(&key) {
        return Ok(Arc::clone(entry));
    }
    let root = ROOT.lock().map_err(unavailable)?.clone().ok_or_else(|| {
        AppError::message(
            "java_project.uninitialized",
            "Java project configuration unavailable",
        )
    })?;
    let file = root.join(format!(
        "{:x}.json",
        Sha256::digest(key.to_lowercase().as_bytes())
    ));
    let stored = if file.is_file() {
        parsers::parse_persisted_json(&io::read_utf8_no_bom(&file)?)?
    } else {
        StoredProject::default()
    };
    let mut snapshot = JavaProjectSnapshot {
        build: stored.build.clone(),
        ..Default::default()
    };
    if let Some(task) = &stored.last_task {
        snapshot.task_result.clone_from(task);
        if let Some(log) = &task.log_path {
            snapshot.output = process::tail(Path::new(log))?;
            snapshot.locations = process::locations(&snapshot.output);
        }
    }
    let entry = Arc::new(JavaProject {
        session: session.into(),
        file,
        state: Mutex::new(ProjectState {
            stored,
            snapshot,
            owner: String::new(),
            input_generation: 0,
            receipt: None,
        }),
        changed: Condvar::new(),
        cancelled: AtomicBool::new(false),
        input_generation: AtomicU64::new(1),
    });
    projects.insert(key, Arc::clone(&entry));
    Ok(entry)
}
pub fn configured_inputs(manifest: &ProjectManifest) -> AppResult<(Vec<String>, Vec<String>)> {
    let entry = entry(&manifest.session_id)?;
    let snapshot = describe(&entry, false)?;
    Ok((
        snapshot
            .sources
            .into_iter()
            .filter(|path| Path::new(path).is_dir())
            .collect(),
        snapshot.libraries,
    ))
}
pub fn execute(
    session: &str,
    owner: &str,
    action: JavaProjectAction,
) -> AppResult<JavaProjectSnapshot> {
    let entry = entry(session)?;
    match action {
        JavaProjectAction::Cancel => {
            cancel(&entry)?;
            return describe(&entry, false);
        }
        JavaProjectAction::Save { settings } => {
            let root = project::current_project_manifest(session)?.mod_root;
            let mut state = entry.state.lock().map_err(unavailable)?;
            if state.snapshot.active {
                return Err(AppError::message(
                    "java_project.busy",
                    "Project synchronization is running",
                ));
            }
            paths(&root, settings.sources.as_deref().unwrap_or_default())?;
            paths(&root, &settings.libraries)?;
            if let Some(path) = &settings.primary_jar {
                paths(&root, slice::from_ref(path))?;
            }
            let mut stored = state.stored.clone();
            stored.settings = settings;
            persist(&entry, &stored)?;
            state.stored = stored;
            state.snapshot.revision += 1;
            entry.input_generation.fetch_add(1, Ordering::AcqRel);
        }
        JavaProjectAction::Sync { online } => {
            return operate(&entry, owner, &JavaProjectOperation::Sync { online }, None);
        }
        JavaProjectAction::Detect => {
            return operate(&entry, owner, &JavaProjectOperation::Detect, None);
        }
        JavaProjectAction::Build {
            tasks,
            arguments,
            online,
            configuration,
        } => {
            return operate(
                &entry,
                owner,
                &JavaProjectOperation::Build {
                    tasks,
                    arguments,
                    online,
                },
                Some(&configuration),
            );
        }
        JavaProjectAction::Locate { artifact } => {
            artifacts::locate(&entry, &artifact)?;
        }
        JavaProjectAction::Read => return describe(&entry, false),
        JavaProjectAction::Refresh => return describe(&entry, true),
    }
    describe(&entry, true)
}
pub fn release_window(owner: &str) -> AppResult<()> {
    let entries: Vec<_> = PROJECTS
        .lock()
        .map_err(unavailable)?
        .values()
        .cloned()
        .collect();
    for entry in entries {
        if entry.state.lock().map_err(unavailable)?.owner == owner {
            cancel(&entry)?;
        }
    }
    Ok(())
}
pub fn invalidate(root: &str) -> AppResult<()> {
    let root = windows_path_key(root);
    for (path, entry) in PROJECTS.lock().map_err(unavailable)?.iter() {
        if windows_path_key(path) == root
            || entry
                .state
                .lock()
                .map_err(unavailable)?
                .stored
                .build_versions
                .iter()
                .any(|version| Path::new(&windows_path_key(&version.path)).starts_with(&root))
        {
            entry.input_generation.fetch_add(1, Ordering::AcqRel);
        }
    }
    Ok(())
}
pub fn release_session(session: &str) -> AppResult<()> {
    let entries: Vec<_> = PROJECTS
        .lock()
        .map_err(unavailable)?
        .values()
        .filter(|entry| entry.session == session)
        .cloned()
        .collect();
    for entry in entries {
        cancel(&entry)?;
    }
    PROJECTS
        .lock()
        .map_err(unavailable)?
        .retain(|_, entry| entry.session != session);
    Ok(())
}

#[cfg(test)]
mod tests;
pub fn shutdown() -> AppResult<()> {
    let sessions: Vec<_> = PROJECTS
        .lock()
        .map_err(unavailable)?
        .values()
        .map(|entry| entry.session.clone())
        .collect();
    for session in sessions {
        release_session(&session)?;
    }
    Ok(())
}
