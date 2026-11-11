use super::close;
use super::inputs::{AnalysisExtras, AnalysisInputs, inputs_for_session};
use super::management::ComponentManagement;
use super::requests::{checked_response, request, send};
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::canonical_path;
use crate::services::{app_settings, project};
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use pyxis_java_analysis::{AnalysisRequest, AnalysisResponse, AnalysisRuntime};
use serde_json::json;
use std::collections::BTreeMap;
use std::mem;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard, Weak};
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};

static SESSION_RUNTIME: LazyLock<Mutex<Weak<AnalysisRuntime>>> = LazyLock::new(Default::default);
static LIFECYCLE: Mutex<()> = Mutex::new(());

fn lifecycle() -> AppResult<MutexGuard<'static, ()>> {
    LIFECYCLE.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java session lifecycle unavailable",
        )
    })
}

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
    let _lifecycle = lifecycle()?;
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
        AnalysisResult::Inspection(value) => Some(value.revision),
        AnalysisResult::Assistance(value) => Some(value.revision),
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
    let _lifecycle = lifecycle()?;
    let inputs = inputs_for_session(session_id, &extras)?;
    let state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session state unavailable",
        )
    })?;
    if state.projects.contains_key(session_id) {
        return Ok(state
            .instance
            .clone()
            .expect("registered project owns a shared JVM"));
    }
    let instance = state.instance.clone();
    drop(state);
    let runtime = app.state::<Arc<AnalysisRuntime>>();
    let instance = match instance {
        Some(instance) => instance,
        None => {
            let selected = app_settings::java_executable()?;
            let java = canonical_path(
                selected.as_deref().map(Path::new).unwrap_or(java),
                "Java executable",
            )?;
            let instance = runtime.start(&java)?;
            SESSIONS
                .lock()
                .map_err(|_| {
                    AppError::message("java_analysis.session_lock", "Java session unavailable")
                })?
                .instance = Some(instance.clone());
            instance
        }
    };
    let project_id = format!("session:{session_id}");
    let response = request(
        app,
        &instance,
        AnalysisRequest::Open {
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
            let mut state = SESSIONS.lock().map_err(|_| {
                AppError::message("java_analysis.session_lock", "Java session unavailable")
            })?;
            if state.projects.is_empty() {
                state.instance = None;
                drop(state);
                close(app, &instance)?;
            }
            return Err(error);
        }
    };
    let revision = revision_of(&response).expect("open returns a project snapshot");
    let mod_root = &inputs.mod_root;
    diagnostics::info("java_analysis.project_opened", &json!({"sessionId":session_id,"modRoot":mod_root,"instance":instance,"sourceRoots":inputs.sources.len(),"jars":inputs.classpath.len(),"revision":revision}).to_string());
    if !inputs.missing_dependencies.is_empty() || !inputs.missing_jars.is_empty() {
        diagnostics::failure(
            "java_analysis.incomplete_inputs",
            AppError::message(
                "java_analysis.missing_inputs",
                "Java project uses incomplete dependencies",
            ),
            json!({"sessionId":session_id,"modRoot":mod_root,"missingDependencies":inputs.missing_dependencies,"missingJars":inputs.missing_jars}),
        );
    }
    SESSIONS
        .lock()
        .map_err(|_| AppError::message("java_analysis.session_lock", "Java session unavailable"))?
        .projects
        .insert(
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
    mut request: AnalysisRequest,
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
    if request
        .project()
        .is_some_and(|project| project != expected_project)
    {
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
    // Reference refresh and editor requests share the session's authoritative revision.
    match &mut request {
        AnalysisRequest::EditorUpdate {
            expected_revision, ..
        } => *expected_revision = owner.revision,
        AnalysisRequest::Inspect { revision, .. } => *revision = owner.revision,
        AnalysisRequest::Assist {
            revision, purpose, ..
        } if purpose != "validate" => *revision = owner.revision,
        _ => {}
    }
    let operation = request.operation();
    let mut response = send(&app.state::<Arc<AnalysisRuntime>>(), &instance, request)?;
    response.queue_wait_milliseconds += queue_wait;
    if let Some(revision) = revision_of(&response) {
        owner.revision = revision;
    }
    diagnostics::debug("java_analysis.session_request", || {
        json!({"sessionId":session_id,"modRoot":owner.inputs.mod_root,"operation":operation,"revision":owner.revision,"queueWaitMilliseconds":response.queue_wait_milliseconds,"requestMilliseconds":response.request_milliseconds}).to_string()
    });
    Ok(response)
}

/// Releases the Mod's analysis and closes the shared JVM when its last project ends.
pub fn close_for_session<R: Runtime>(app: &AppHandle<R>, session_id: &str) -> AppResult<()> {
    close_owned_session(&app.state::<Arc<AnalysisRuntime>>(), session_id)
}

fn close_owned_session(runtime: &AnalysisRuntime, session_id: &str) -> AppResult<()> {
    let _lifecycle = lifecycle()?;
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
    let result = runtime
        .request(
            &instance,
            &AnalysisRequest::Close {
                id: json!(session_id),
                project: format!("session:{session_id}"),
            },
        )
        .map_err(Into::into)
        .and_then(checked_response)
        .map(|_| ());
    let release = if last {
        runtime.close(&instance).map_err(Into::into)
    } else {
        Ok(())
    };
    diagnostics::info("java_analysis.project_closed", &json!({"sessionId":session_id,"modRoot":owned.inputs.mod_root,"instance":instance,"lastProject":last,"released":release.is_ok(),"projectReleased":result.is_ok()}).to_string());
    result.and(release)
}

pub(super) fn stop_owned_analysis(runtime: &AnalysisRuntime) -> AppResult<()> {
    let _lifecycle = lifecycle()?;
    let mut state = SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java session state unavailable",
        )
    })?;
    let projects = mem::take(&mut state.projects);
    state.instance = None;
    drop(state);
    for owner in projects.values() {
        owner
            .lock()
            .map_err(|_| {
                AppError::message("java_analysis.session_lock", "Java project unavailable")
            })?
            .closed = true;
    }
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
        let response = checked_response(send(runtime, &instance, configuration)?)?;
        if let Some(next) = revision_of(&response) {
            diagnostics::info("java_analysis.references_refreshed", &json!({"sessionId":session_id,"modRoot":inputs.mod_root,"revision":next,"sourceRoots":inputs.sources.len(),"jars":inputs.classpath.len(),"references":inputs.referenced_sessions.len()}).to_string());
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
