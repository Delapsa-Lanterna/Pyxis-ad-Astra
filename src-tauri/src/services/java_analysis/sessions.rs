use super::close;
use super::inputs::{AnalysisExtras, AnalysisInputs, inputs_for_session};
use super::management::ComponentManagement;
use super::requests::{checked_response, request, send};
use crate::errors::{AppError, AppResult};
use crate::io::canonical_path;
use crate::services::{app_settings, project};
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use pyxis_java_analysis::{AnalysisRequest, AnalysisResponse, AnalysisRuntime};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};

static SESSION_RUNTIME: LazyLock<Mutex<Weak<AnalysisRuntime>>> = LazyLock::new(Default::default);

pub(super) fn register_runtime(runtime: &Arc<AnalysisRuntime>) -> AppResult<()> {
    *SESSION_RUNTIME.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis runtime unavailable",
        )
    })? = Arc::downgrade(runtime);
    Ok(())
}

pub(super) fn reset() -> AppResult<()> {
    *SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session unavailable",
        )
    })? = SessionAnalysisState::default();
    Ok(())
}

struct SessionProject {
    revision: u64,
    inputs: AnalysisInputs,
    extras: AnalysisExtras,
    closed: bool,
}

#[derive(Default)]
struct SessionAnalysisState {
    instance: Option<String>,
    projects: BTreeMap<String, Arc<Mutex<SessionProject>>>,
}
static SESSIONS: LazyLock<Mutex<SessionAnalysisState>> = LazyLock::new(Default::default);
fn revision_of(result: &AnalysisResponse) -> Option<u64> {
    match result.result.as_ref()? {
        AnalysisResult::Project(value) => Some(value.revision),
        AnalysisResult::Analysis(value) => Some(value.revision),
        AnalysisResult::Query(value) => Some(value.revision),
        _ => None,
    }
}

/// Starts a ready Mod's analysis with published references and explicit supplementary inputs.
/// Returns its shared JVM identity; preparation and engine failures retain their context.
pub fn start_for_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    java: &Path,
    extras: AnalysisExtras,
) -> AppResult<String> {
    let manager = app.state::<Arc<ComponentManagement>>();
    let _guard = manager.analysis_guard()?;
    let inputs = inputs_for_session(session_id, &extras)?;
    let mut state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session state unavailable",
        )
    })?;
    let instance = match &state.instance {
        Some(instance) => instance.clone(),
        None => {
            let selected = app_settings::java_executable()?;
            let java = canonical_path(
                selected.as_deref().map(Path::new).unwrap_or(java),
                "Java executable",
            )?;
            let instance = app.state::<Arc<AnalysisRuntime>>().start(&java)?;
            state.instance = Some(instance.clone());
            instance
        }
    };
    let project_id = format!("session:{session_id}");
    if state.projects.contains_key(session_id) {
        return Ok(instance);
    }
    let response = request(
        app,
        &instance,
        &AnalysisRequest::Open {
            id: json!(session_id),
            project: project_id,
            sources: inputs.sources.clone(),
            classpath: inputs.classpath.clone(),
            java_home: inputs.java_home.clone(),
            language: Some(DEFAULT_LANGUAGE.into()),
        },
    )
    .and_then(checked_response);
    let response = match response {
        Ok(response) => response,
        Err(error) => {
            if state.projects.is_empty() {
                state.instance = None;
                drop(state);
                close(app, &instance)?;
            }
            return Err(error);
        }
    };
    let revision = revision_of(&response).expect("open returns a project snapshot");
    state.projects.insert(
        session_id.to_string(),
        Arc::new(Mutex::new(SessionProject {
            revision,
            inputs,
            extras,
            closed: false,
        })),
    );
    Ok(instance)
}

/// Executes a versioned request for an already-started Mod, rejecting cross-session projects.
pub fn request_for_session<R: Runtime>(
    app: &AppHandle<R>,
    session_id: &str,
    request: &AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    project::current_project_manifest(session_id)?;
    let state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session state unavailable",
        )
    })?;
    let instance = state.instance.clone().ok_or_else(|| {
        AppError::message("java_analysis.not_started", "Java analysis is not started")
    })?;
    let owner = state.projects.get(session_id).cloned().ok_or_else(|| {
        AppError::message(
            "java_analysis.session_unknown",
            "Java analysis session is not started",
        )
    })?;
    drop(state);
    let queued = Instant::now();
    let mut owner = owner
        .lock()
        .map_err(|_| AppError::message("java_analysis.session_lock", "Java project unavailable"))?;
    if owner.closed {
        return Err(AppError::message(
            "java_analysis.session_closed",
            "Java analysis session is closed",
        ));
    }
    let queue_wait = queued.elapsed().as_secs_f64() * 1000.0;
    let expected_project = format!("session:{session_id}");
    let requested_project = match request {
        AnalysisRequest::Open { project, .. }
        | AnalysisRequest::Configure { project, .. }
        | AnalysisRequest::Update { project, .. }
        | AnalysisRequest::Analyze { project, .. }
        | AnalysisRequest::Query { project, .. }
        | AnalysisRequest::Close { project, .. } => Some(project),
        _ => None,
    };
    if requested_project.is_some_and(|project| project != &expected_project) {
        return Err(AppError::message(
            "java_analysis.project_mismatch",
            "Java request belongs to another session",
        ));
    }
    if matches!(
        request,
        AnalysisRequest::Open { .. }
            | AnalysisRequest::Shutdown { .. }
            | AnalysisRequest::Close { .. }
    ) {
        return Err(AppError::message(
            "java_analysis.session_operation",
            "Use the Java analysis session lifecycle entry",
        ));
    }
    let mut response = send(&app.state::<Arc<AnalysisRuntime>>(), &instance, request)?;
    response.queue_wait_milliseconds += queue_wait;
    if let Some(revision) = revision_of(&response) {
        owner.revision = revision;
    }
    Ok(response)
}

/// Releases the Mod's analysis and closes the shared JVM when its last project ends.
pub fn close_for_session<R: Runtime>(app: &AppHandle<R>, session_id: &str) -> AppResult<()> {
    close_owned_session(&app.state::<Arc<AnalysisRuntime>>(), session_id)
}

fn close_owned_session(runtime: &AnalysisRuntime, session_id: &str) -> AppResult<()> {
    let mut state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session state unavailable",
        )
    })?;
    let instance = state.instance.clone();
    let owned = state.projects.remove(session_id);
    let Some(instance) = instance else {
        return Ok(());
    };
    let Some(owned) = owned else {
        return Ok(());
    };
    let last = state.projects.is_empty();
    if last {
        state.instance = None;
    }
    drop(state);
    let mut owned = owned
        .lock()
        .map_err(|_| AppError::message("java_analysis.session_lock", "Java project unavailable"))?;
    owned.closed = true;
    checked_response(runtime.request(
        &instance,
        &AnalysisRequest::Close {
            id: json!(session_id),
            project: format!("session:{session_id}"),
        },
    )?)?;
    if last {
        runtime.close(&instance)?;
    }
    Ok(())
}

pub(super) fn stop_owned_analysis(runtime: &AnalysisRuntime) -> AppResult<()> {
    let mut state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java session state unavailable",
        )
    })?;
    for owner in state.projects.values() {
        owner
            .lock()
            .map_err(|_| {
                AppError::message("java_analysis.session_lock", "Java project unavailable")
            })?
            .closed = true;
    }
    state.projects.clear();
    state.instance = None;
    runtime.close_all()?;
    Ok(())
}

/// Refreshes active projects from the published reference snapshot, preserving unsaved text.
pub fn references_changed<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    refresh_owned_references(&app.state::<Arc<AnalysisRuntime>>())
}

fn refresh_owned_references(runtime: &AnalysisRuntime) -> AppResult<()> {
    let state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session state unavailable",
        )
    })?;
    let sessions = state.projects.clone();
    let instance = state.instance.clone();
    drop(state);
    let Some(instance) = instance else {
        return Ok(());
    };
    for (session_id, previous) in sessions {
        let mut previous = previous.lock().map_err(|_| {
            AppError::message("java_analysis.session_lock", "Java project unavailable")
        })?;
        if previous.closed {
            continue;
        }
        let inputs = inputs_for_session(&session_id, &previous.extras)?;
        if inputs == previous.inputs {
            continue;
        }
        let configuration = AnalysisRequest::Configure {
            id: json!(session_id),
            project: format!("session:{session_id}"),
            expected_revision: previous.revision,
            classpath: inputs.classpath.clone(),
            java_home: inputs.java_home.clone(),
            language: DEFAULT_LANGUAGE.into(),
            sources: Some(inputs.sources.clone()),
        };
        let response = checked_response(send(runtime, &instance, &configuration)?)?;
        if let Some(next) = revision_of(&response) {
            previous.revision = next;
            previous.inputs = inputs;
        }
    }
    Ok(())
}

pub(crate) fn close_registered_session(session_id: &str) -> AppResult<()> {
    let runtime = SESSION_RUNTIME
        .lock()
        .map_err(|_| {
            AppError::message(
                "java_analysis.session_lock",
                "Java analysis runtime unavailable",
            )
        })?
        .upgrade();
    if let Some(runtime) = runtime {
        close_owned_session(&runtime, session_id)?;
    }
    Ok(())
}

pub(crate) fn refresh_registered_references() -> AppResult<()> {
    let runtime = SESSION_RUNTIME
        .lock()
        .map_err(|_| {
            AppError::message(
                "java_analysis.session_lock",
                "Java analysis runtime unavailable",
            )
        })?
        .upgrade();
    if let Some(runtime) = runtime {
        refresh_owned_references(&runtime)?;
    }
    Ok(())
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
