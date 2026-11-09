use crate::app_data_dir;
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, canonical_path};
use crate::services::project;
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::{
    AnalysisEvent, AnalysisPaths, AnalysisRequest, AnalysisResponse, AnalysisRuntime, java_path,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::Instant;
use tauri::{AppHandle, Manager, Runtime};
mod inputs;
#[cfg(test)]
mod session_tests;
pub use inputs::{AnalysisExtras, AnalysisInputs, inputs_for_session};

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
static SESSION_RUNTIME: LazyLock<Mutex<Weak<AnalysisRuntime>>> = LazyLock::new(Default::default);

fn record(event: AnalysisEvent) {
    let context = json!({"instance":event.instance});
    if let Some(message) = event.error {
        diagnostics::failure(
            event.code,
            AppError::message("java_analysis.operation_failed", message),
            context,
        );
    } else if event.code == "java_analysis.request" {
        diagnostics::debug(event.code, || context.to_string());
    } else {
        diagnostics::info(event.code, &context.to_string());
    }
}

fn initialize_at(config_root: &Path) -> AppResult<AnalysisRuntime> {
    AnalysisRuntime::new(config_root, Arc::new(record)).map_err(Into::into)
}

pub fn initialize(app: &AppHandle) -> AppResult<()> {
    register(app, &app_data_dir::data_directory(app.clone())?)
}

fn register<R: Runtime>(app: &AppHandle<R>, config_root: &Path) -> AppResult<()> {
    let runtime = Arc::new(initialize_at(config_root)?);
    if !app.manage(Arc::clone(&runtime)) {
        return Err(AppError::message(
            "java_analysis.already_initialized",
            "Java analysis runtime already initialized",
        ));
    }
    *SESSION_RUNTIME.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis runtime unavailable",
        )
    })? = Arc::downgrade(&runtime);
    Ok(())
}

pub fn paths<R: Runtime>(app: &AppHandle<R>) -> AnalysisPaths {
    app.state::<Arc<AnalysisRuntime>>().paths().clone()
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    app.state::<Arc<AnalysisRuntime>>().install()?;
    Ok(())
}

pub fn start<R: Runtime>(app: &AppHandle<R>, java: &Path) -> AppResult<String> {
    let java = canonical_path(java, "Java executable")?;
    app.state::<Arc<AnalysisRuntime>>()
        .start(&java)
        .map_err(Into::into)
}

fn request_value(
    runtime: &AnalysisRuntime,
    instance: &str,
    payload: &Value,
) -> AppResult<AnalysisResponse> {
    let mut payload = payload.clone();
    if payload["op"] == "open" {
        let sources = payload["sources"]
            .as_array()
            .ok_or_else(|| {
                AppError::message(
                    "java_analysis.sources_required",
                    "Source roots are required",
                )
            })?
            .iter()
            .map(|path| {
                FsRootBoundary::new(
                    Path::new(path.as_str().ok_or_else(|| {
                        AppError::message("java_analysis.source_path", "Source root must be a path")
                    })?),
                    "Java source root",
                )
                .map(|boundary| json!(java_path(boundary.root()).to_string_lossy()))
            })
            .collect::<AppResult<Vec<_>>>()?;
        payload["sources"] = json!(sources);
        let classpath = payload["classpath"]
            .as_array()
            .ok_or_else(|| {
                AppError::message("java_analysis.classpath_required", "Classpath is required")
            })?
            .iter()
            .map(|path| {
                canonical_path(
                    Path::new(path.as_str().ok_or_else(|| {
                        AppError::message(
                            "java_analysis.classpath_path",
                            "Classpath entry must be a path",
                        )
                    })?),
                    "Java classpath",
                )
                .map(|resolved| json!(java_path(&resolved).to_string_lossy()))
            })
            .collect::<AppResult<Vec<_>>>()?;
        payload["classpath"] = json!(classpath);
        let java_home = canonical_path(
            Path::new(payload["javaHome"].as_str().ok_or_else(|| {
                AppError::message("java_analysis.java_home", "Java home is required")
            })?),
            "Java home",
        )?;
        payload["javaHome"] = json!(java_path(&java_home).to_string_lossy());
    }
    if payload["op"] == "configure" {
        if let Some(sources) = payload["sources"].as_array() {
            let sources = sources
                .iter()
                .map(|source| {
                    let path = source.as_str().ok_or_else(|| {
                        AppError::message("java_analysis.source_path", "Source root must be a path")
                    })?;
                    FsRootBoundary::new(Path::new(path), "Java source root")
                        .map(|boundary| json!(java_path(boundary.root()).to_string_lossy()))
                })
                .collect::<AppResult<Vec<_>>>()?;
            payload["sources"] = json!(sources);
        }
        let classpath = payload["classpath"]
            .as_array()
            .ok_or_else(|| {
                AppError::message("java_analysis.classpath_required", "Classpath is required")
            })?
            .iter()
            .map(|path| {
                canonical_path(
                    Path::new(path.as_str().ok_or_else(|| {
                        AppError::message(
                            "java_analysis.classpath_path",
                            "Classpath entry must be a path",
                        )
                    })?),
                    "Java classpath",
                )
                .map(|resolved| json!(java_path(&resolved).to_string_lossy()))
            })
            .collect::<AppResult<Vec<_>>>()?;
        payload["classpath"] = json!(classpath);
        let resolved = canonical_path(
            Path::new(payload["javaHome"].as_str().ok_or_else(|| {
                AppError::message("java_analysis.java_home", "Java home is required")
            })?),
            "Java home",
        )?;
        payload["javaHome"] = json!(java_path(&resolved).to_string_lossy());
    }
    if payload["op"] == "update" {
        let files = payload["files"]
            .as_array()
            .ok_or_else(|| {
                AppError::message("java_analysis.files_required", "File changes are required")
            })?
            .iter()
            .map(|file| {
                let mut file = file.clone();
                for key in ["file", "target"] {
                    if let Some(path) = file[key].as_str() {
                        let resolved = canonical_path(Path::new(path), "Java source file")?;
                        file[key] = json!(java_path(&resolved).to_string_lossy());
                    }
                }
                Ok(file)
            })
            .collect::<AppResult<Vec<_>>>()?;
        payload["files"] = json!(files);
    }
    if payload["op"] == "query" {
        let path = payload["file"].as_str().ok_or_else(|| {
            AppError::message("java_analysis.file_path", "Java source file is required")
        })?;
        let resolved = canonical_path(Path::new(path), "Java source file")?;
        payload["file"] = json!(java_path(&resolved).to_string_lossy());
    }
    runtime
        .request(instance, &serde_json::from_value(payload)?)
        .map_err(Into::into)
}

pub fn request<R: Runtime>(
    app: &AppHandle<R>,
    instance: &str,
    request: &AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    let payload = serde_json::to_value(request)?;
    request_value(&app.state::<Arc<AnalysisRuntime>>(), instance, &payload)
}

pub fn close<R: Runtime>(app: &AppHandle<R>, instance: &str) -> AppResult<()> {
    app.state::<Arc<AnalysisRuntime>>()
        .close(instance)
        .map_err(Into::into)
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if let Some(runtime) = app.try_state::<Arc<AnalysisRuntime>>() {
        runtime.shutdown()?;
    }
    *SESSIONS.lock().map_err(|_| {
        AppError::message(
            "java_analysis.session_lock",
            "Java analysis session unavailable",
        )
    })? = SessionAnalysisState::default();
    Ok(())
}

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
            let instance = start(app, java)?;
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
            language: Some("17".into()),
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
    let mut payload = serde_json::to_value(request)?;
    if let Some(project) = payload.get("project").and_then(Value::as_str)
        && project != expected_project
    {
        return Err(AppError::message(
            "java_analysis.project_mismatch",
            "Java request belongs to another session",
        ));
    }
    payload["project"] = json!(expected_project);
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
    let mut response = request_value(&app.state::<Arc<AnalysisRuntime>>(), &instance, &payload)?;
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
            language: "17".into(),
            sources: Some(inputs.sources.clone()),
        };
        let response = checked_response(request_value(
            runtime,
            &instance,
            &serde_json::to_value(configuration)?,
        )?)?;
        if let Some(next) = revision_of(&response) {
            previous.revision = next;
            previous.inputs = inputs;
        }
    }
    Ok(())
}

fn checked_response(response: AnalysisResponse) -> AppResult<AnalysisResponse> {
    if let Some(error) = &response.error {
        let failure = AppError::message(
            "java_analysis.operation_failed",
            serde_json::to_string(error)?,
        );
        return Err(if let Some(path) = &error.file {
            failure.at_path(Path::new(path))
        } else {
            failure
        });
    }
    Ok(response)
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
mod tests {
    use super::{
        checked_response, close, initialize_at, paths, register, request as request_typed,
        shutdown, start,
    };
    use crate::diagnostics;
    use crate::errors::AppResult;
    use crate::test_support::TestWorkspace;
    use pyxis_java_analysis::protocol::AnalysisResult;
    use pyxis_java_analysis::{AnalysisRequest, AnalysisRuntime};
    use serde_json::{Value, json};
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri::Manager;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::utils::config::AppDirectoriesOverride;
    use tauri::{AppHandle, Runtime};

    fn request<R: Runtime>(app: &AppHandle<R>, instance: &str, value: &Value) -> AppResult<Value> {
        let response = request_typed(app, instance, &serde_json::from_value(value.clone())?)?;
        Ok(serde_json::to_value(response)?)
    }

    #[test]
    fn initialization_describes_config_paths_without_io_or_java() {
        let work = TestWorkspace::new("java_analysis_initialize");
        let config = work.join("configuration");
        let runtime = initialize_at(&config).unwrap();
        assert_eq!(runtime.paths().root, config.join("java-analysis"));
        assert_eq!(
            runtime.paths().dependencies,
            config.join("java-analysis/dependencies")
        );
        assert_eq!(runtime.instance_count().unwrap(), 0);
        assert!(!config.exists());
        runtime.shutdown().unwrap();
        drop(runtime);
        work.close().unwrap();
    }

    #[test]
    fn engine_failure_retains_original_type_project_and_source_offset() {
        let response=serde_json::from_value(json!({"id":7,"error":{"code":"engine.stale_document","type":"java.lang.IllegalArgumentException","message":"Document version must increase","project":"fixture","file":"M:/fixture/Entry.java","offset":12}})).unwrap();
        let error = checked_response(response).unwrap_err();
        assert_eq!(
            error.location().unwrap().path.as_deref(),
            Some("M:/fixture/Entry.java")
        );
        let message = error.to_string();
        assert!(message.contains("engine.stale_document"));
        assert!(message.contains("java.lang.IllegalArgumentException"));
        assert!(message.contains("\"project\":\"fixture\""));
        assert!(message.contains("\"offset\":12"));
    }

    #[test]
    #[ignore = "run in a dedicated test process with JAVA_ANALYSIS_TEST_JAVA and prepared archive"]
    fn live_adapter_routes_configuration_diagnostics_and_shutdown() {
        let java = env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java test executable");
        let java = Path::new(&java);
        let work = TestWorkspace::new("java_analysis_adapter");
        let config_root = work.join("configuration");
        let mut context = mock_context(noop_assets());
        context.config_mut().app.app_directories_override =
            Some(AppDirectoriesOverride::Root(config_root.clone()));
        let app = mock_builder().build(context).unwrap();
        let handle = app.handle();
        let events = Arc::new(Mutex::new(Vec::new()));
        let captured = events.clone();
        diagnostics::install(Arc::new(move |entry| captured.lock().unwrap().push(entry)));
        let resolved = handle.path().app_data_dir().unwrap();
        assert_eq!(resolved, config_root);
        register(handle, &resolved).unwrap();
        assert_eq!(paths(handle).root, config_root.join("java-analysis"));
        assert!(!config_root.exists());
        let archive =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("target/java-analysis/jdt-dependencies.zip");
        handle
            .state::<Arc<AnalysisRuntime>>()
            .import(&archive)
            .unwrap();
        let first = start(handle, java).unwrap();
        let second = start(handle, java).unwrap();
        let result = request_typed(
            handle,
            &first,
            &AnalysisRequest::Parse {
                id: json!(1),
                source: "class Orbit {}".into(),
                version: 1,
                language: Some("17".into()),
            },
        )
        .unwrap();
        let Some(AnalysisResult::Syntax(result)) = result.result else {
            panic!("syntax result");
        };
        assert_eq!(result.errors, 0);
        let source = work.join("source");
        fs::create_dir_all(&source).unwrap();
        request(
            handle,
            &first,
            &json!({"id":3,"op":"open","project":"overlay","sources":[source],"classpath":[],"javaHome":java.parent().unwrap().parent().unwrap().to_string_lossy(),"language":"17"}),
        )
        .unwrap();
        let added = source.join("New.java");
        let update = request(
            handle,
            &first,
            &json!({"id":4,"op":"update","project":"overlay","expectedRevision":1,"files":[{"action":"add","file":added,"source":"class New {}","version":1}]}),
        )
        .unwrap();
        assert!(update.get("error").is_none_or(Value::is_null), "{update}");
        let analysis = request(
            handle,
            &first,
            &json!({"id":5,"op":"analyze","project":"overlay"}),
        )
        .unwrap();
        assert_eq!(analysis["result"]["files"], 1);
        assert!(!added.exists());
        request(
            handle,
            &first,
            &json!({"id":6,"op":"close","project":"overlay"}),
        )
        .unwrap();
        let failure = request(
            handle,
            &first,
            &json!({"id":2,"op":"analyze","project":"absent"}),
        )
        .unwrap();
        assert_eq!(failure["error"]["code"], "engine.request_failed");
        close(handle, &first).unwrap();
        assert!(paths(handle).workspaces.join(&second).exists());
        shutdown(handle).unwrap();
        assert_eq!(fs::read_dir(paths(handle).workspaces).unwrap().count(), 0);
        assert_eq!(fs::read_dir(paths(handle).logs).unwrap().count(), 2);
        let events = events.lock().unwrap();
        assert!(events.iter().any(|event| {
            event.code.as_deref() == Some("java_analysis.request")
                && event.fields.as_ref().is_some_and(|fields| {
                    fields.get("errorCode").map(String::as_str)
                        == Some("java_analysis.operation_failed")
                })
        }));
        assert_eq!(
            events
                .iter()
                .filter(|e| e.code.as_deref() == Some("java_analysis.start"))
                .count(),
            2
        );
        assert_eq!(
            events
                .iter()
                .filter(|e| e.code.as_deref() == Some("java_analysis.release"))
                .count(),
            2
        );
        assert!(
            events
                .iter()
                .all(|e| e.fields.as_ref().is_none_or(|f| !f.contains_key("source")))
        );
        drop(events);
        drop(app);
        work.close().unwrap();
    }
}
