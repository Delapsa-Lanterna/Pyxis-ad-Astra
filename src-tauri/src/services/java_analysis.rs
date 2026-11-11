use crate::app_data_dir;
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::canonical_path;
use crate::services::{app_settings, project, system_open};
use pyxis_java_analysis::{AnalysisEvent, AnalysisPaths, AnalysisRuntime, java_path};
use serde_json::json;
use std::fs;
use std::path::Path;
use std::sync::{Arc, LazyLock, Mutex, Weak};
use tauri::{AppHandle, Manager, Runtime};
pub mod editor;
mod environment;
mod inputs;
pub mod management;
mod requests;
mod sessions;
pub use inputs::{AnalysisExtras, AnalysisInputs, inputs_for_session};
use management::ComponentManagement;
pub use requests::request;
pub use sessions::{close_for_session, references_changed, request_for_session, start_for_session};
pub(crate) use sessions::{close_registered_session, refresh_registered_references};

static MANAGEMENT: LazyLock<Mutex<Weak<ComponentManagement>>> = LazyLock::new(Default::default);

fn record(event: AnalysisEvent) {
    let counts_changed = matches!(
        event.code,
        "java_analysis.start" | "java_analysis.start_failed" | "java_analysis.release"
    ) || (event.code == "java_analysis.request"
        && matches!(event.context["operation"].as_str(), Some("open" | "close")));
    if counts_changed
        && let Ok(manager) = MANAGEMENT.lock()
        && let Some(manager) = manager.upgrade()
        && let Err(error) = manager.publish_counts()
    {
        diagnostics::failure("java_analysis.counts", error, json!({}));
    }
    let mut context = event.context;
    context["instance"] = json!(event.instance);
    if let Some(message) = event.error {
        let error = AppError::message("java_analysis.operation_failed", message);
        if event.fault {
            diagnostics::fault(event.code, error, context);
        } else {
            diagnostics::failure(event.code, error, context);
        }
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
    sessions::register_runtime(&runtime)?;
    let manager = ComponentManagement::new(Arc::clone(&runtime));
    *MANAGEMENT.lock().map_err(|_| {
        AppError::message(
            "java_analysis.management_lock",
            "Java component state unavailable",
        )
    })? = Arc::downgrade(&manager);
    app.manage(manager);
    Ok(())
}

pub fn paths<R: Runtime>(app: &AppHandle<R>) -> AnalysisPaths {
    app.state::<Arc<AnalysisRuntime>>().paths().clone()
}

pub fn open_component_directory<R: Runtime>(app: &AppHandle<R>, logs: bool) -> AppResult<()> {
    let paths = paths(app);
    let directory = if logs { paths.logs } else { paths.dependencies };
    fs::create_dir_all(&directory)?;
    system_open::open_path(&directory)
}

pub fn automatic_java_path(
    session_id: Option<&str>,
    game_root: Option<&str>,
) -> AppResult<Option<String>> {
    let game = if let Some(id) = session_id {
        project::current_project_manifest(id)?.starsector_root
    } else {
        project::resolve_core_root(app_settings::starsector_root()?.as_deref(), game_root, None)?
            .map(|path| path.to_string_lossy().into_owned())
    };
    Ok(game.map(|root| {
        java_path(&Path::new(&root).join("jre/bin/java.exe"))
            .to_string_lossy()
            .into_owned()
    }))
}

pub fn start<R: Runtime>(app: &AppHandle<R>, java: &Path) -> AppResult<String> {
    let manager = app.state::<Arc<ComponentManagement>>();
    let _guard = manager.analysis_guard()?;
    let java = canonical_path(java, "Java executable")?;
    app.state::<Arc<AnalysisRuntime>>()
        .start(&java)
        .map_err(Into::into)
}

pub fn close<R: Runtime>(app: &AppHandle<R>, instance: &str) -> AppResult<()> {
    app.state::<Arc<AnalysisRuntime>>()
        .close(instance)
        .map_err(Into::into)
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    let management = app
        .try_state::<Arc<ComponentManagement>>()
        .map_or(Ok(()), |manager| manager.shutdown());
    let runtime = app
        .try_state::<Arc<AnalysisRuntime>>()
        .map_or(Ok(()), |runtime| runtime.shutdown().map_err(Into::into));
    let sessions = sessions::reset();
    management.and(runtime).and(sessions)
}

#[cfg(test)]
#[path = "java_analysis/adapter_tests.rs"]
mod tests;
