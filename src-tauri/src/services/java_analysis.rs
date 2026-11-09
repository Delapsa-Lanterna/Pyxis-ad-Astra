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
mod environment;
mod inputs;
pub mod management;
mod requests;
mod sessions;
pub use inputs::{AnalysisExtras, AnalysisInputs, inputs_for_session};
use management::ComponentManagement;
pub use requests::request;
use sessions::stop_owned_analysis;
pub use sessions::{close_for_session, references_changed, request_for_session, start_for_session};
pub(crate) use sessions::{close_registered_session, refresh_registered_references};

static MANAGEMENT: LazyLock<Mutex<Weak<ComponentManagement>>> = LazyLock::new(Default::default);

fn record(event: AnalysisEvent) {
    if matches!(
        event.code,
        "java_analysis.start"
            | "java_analysis.start_failed"
            | "java_analysis.request"
            | "java_analysis.release"
    ) && let Ok(manager) = MANAGEMENT.lock()
        && let Some(manager) = manager.upgrade()
        && let Err(error) = manager.publish_counts()
    {
        diagnostics::debug("java_analysis.counts", || error.to_string());
    }
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
    if let Some(manager) = app.try_state::<Arc<ComponentManagement>>() {
        manager.shutdown()?;
    }
    if let Some(runtime) = app.try_state::<Arc<AnalysisRuntime>>() {
        runtime.shutdown()?;
    }
    sessions::reset()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::requests::checked_response;
    use super::{close, initialize_at, paths, register, request as request_typed, shutdown, start};
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
