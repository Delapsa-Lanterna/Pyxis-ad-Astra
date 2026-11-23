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
use crate::models::java_project::{
    JavaProjectAction, JavaProjectChange, JavaProjectOperation, JavaProjectSnapshot,
};
use crate::models::{ProjectManifest, windows_path_case, windows_path_key};
use crate::parsers;
use crate::services::project;
use configuration::{StoredProject, build_path, paths, persist};
use sha2::{Digest, Sha256};
use snapshot::describe;
use std::collections::{BTreeMap, BTreeSet};
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
    source_directories: BTreeSet<PathBuf>,
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
fn project_key(mod_root: &Path) -> AppResult<String> {
    // Keep the canonical spelling (including namespace and separators) in the persisted hash.
    let root = io::canonical_path(mod_root, "Java project")?;
    Ok(windows_path_case(&root.to_string_lossy()))
}
fn entry(session: &str) -> AppResult<Arc<JavaProject>> {
    let manifest = project::current_project_manifest(session)?;
    let key = project_key(Path::new(&manifest.mod_root))?;
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
    let file = root.join(format!("{:x}.json", Sha256::digest(key.as_bytes())));
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
            source_directories: BTreeSet::new(),
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
pub fn invalidate(root: &str, paths: &[String]) -> AppResult<Option<JavaProjectChange>> {
    let entries: Vec<_> = PROJECTS
        .lock()
        .map_err(unavailable)?
        .iter()
        .map(|(root, entry)| (PathBuf::from(windows_path_key(root)), Arc::clone(entry)))
        .collect();
    let paths: Vec<_> = paths
        .iter()
        .map(|path| {
            (
                path.as_str(),
                PathBuf::from(windows_path_key(path)),
                Path::new(path).is_dir(),
            )
        })
        .collect();
    let mut change = JavaProjectChange {
        mod_root: Some(root.into()),
        ..Default::default()
    };
    for (root, entry) in entries {
        let state = entry.state.lock().map_err(unavailable)?;
        if changed_inputs(&root, &state, &paths, &mut change) {
            entry.input_generation.fetch_add(1, Ordering::AcqRel);
            change.sessions.push(entry.session.clone());
        }
    }
    change.source_paths.sort();
    change.source_paths.dedup();
    Ok((!change.sessions.is_empty()).then_some(change))
}

fn changed_inputs(
    root: &Path,
    state: &ProjectState,
    paths: &[(&str, PathBuf, bool)],
    change: &mut JavaProjectChange,
) -> bool {
    let snapshot = &state.snapshot;
    let key = |path: &String| root.join(windows_path_key(path));
    let mut sources: Vec<_> = snapshot.sources.iter().map(key).collect();
    let mut missing: BTreeSet<_> = snapshot.missing.iter().map(key).collect();
    if sources.is_empty()
        && state.stored.settings.sources.is_none()
        && (snapshot.mode != "gradle" || state.stored.model.is_none())
    {
        let default = root.join("src");
        missing.insert(default.clone());
        sources.push(default);
    }
    let configuration: Vec<_> = snapshot
        .build_files
        .iter()
        .chain(&snapshot.libraries)
        .chain(&snapshot.game_jars)
        .map(key)
        .collect();
    let versions: Vec<_> = state
        .stored
        .build_versions
        .iter()
        .map(|version| key(&version.path))
        .collect();
    let mut affected = false;
    for (path, changed, directory) in paths {
        let root_changed = sources.iter().any(|source| {
            source.starts_with(changed)
                || (changed.starts_with(source) && missing.contains(source) && source.is_dir())
        });
        let source = root_changed
            || (sources.iter().any(|source| changed.starts_with(source))
                && (*directory
                    || changed.extension().is_some_and(|ext| ext == "java")
                    || state.source_directories.contains(changed)));
        if source {
            change.source_paths.push((*path).to_owned());
        }
        let registered = configuration.iter().any(|input| input.starts_with(changed));
        let mut reconfigure = root_changed || registered;
        if !reconfigure && let Ok(relative) = changed.strip_prefix(root) {
            reconfigure = relative.as_os_str().is_empty()
                || relative == Path::new("mod_info.json")
                || build_path(relative)
                || (snapshot.mode == "core"
                    && relative.parent() == Some(Path::new(""))
                    && relative.extension().is_some_and(|ext| ext == "jar"))
                || (*directory
                    && configuration::build_directory(relative)
                    && configuration::build_files(path).map_or(true, |files| !files.is_empty()));
        }
        change.configuration |= reconfigure;
        affected |= source
            || reconfigure
            || versions
                .iter()
                .any(|input| input.starts_with(changed) || changed.starts_with(input));
    }
    affected
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
