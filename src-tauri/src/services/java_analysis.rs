use crate::app_data_dir;
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, canonical_path};
use pyxis_java_analysis::{AnalysisEvent, AnalysisPaths, AnalysisRuntime};
use serde_json::{Value, json};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

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
    let runtime = initialize_at(config_root)?;
    if !app.manage(runtime) {
        return Err(AppError::message(
            "java_analysis.already_initialized",
            "Java analysis runtime already initialized",
        ));
    }
    Ok(())
}

pub fn paths<R: Runtime>(app: &AppHandle<R>) -> AnalysisPaths {
    app.state::<AnalysisRuntime>().paths().clone()
}

pub fn install<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    app.state::<AnalysisRuntime>().install()?;
    Ok(())
}

pub fn start<R: Runtime>(app: &AppHandle<R>, java: &Path) -> AppResult<String> {
    let java = canonical_path(java, "Java executable")?;
    app.state::<AnalysisRuntime>()
        .start(&java)
        .map_err(Into::into)
}

pub fn request<R: Runtime>(
    app: &AppHandle<R>,
    instance: &str,
    payload: &Value,
) -> AppResult<Value> {
    if payload["op"] == "open" {
        for path in payload["sources"].as_array().ok_or_else(|| {
            AppError::message(
                "java_analysis.sources_required",
                "Source roots are required",
            )
        })? {
            FsRootBoundary::new(
                Path::new(path.as_str().ok_or_else(|| {
                    AppError::message("java_analysis.source_path", "Source root must be a path")
                })?),
                "Java source root",
            )?;
        }
        for path in payload["classpath"].as_array().ok_or_else(|| {
            AppError::message("java_analysis.classpath_required", "Classpath is required")
        })? {
            canonical_path(
                Path::new(path.as_str().ok_or_else(|| {
                    AppError::message(
                        "java_analysis.classpath_path",
                        "Classpath entry must be a path",
                    )
                })?),
                "Java classpath",
            )?;
        }
        canonical_path(
            Path::new(payload["javaHome"].as_str().ok_or_else(|| {
                AppError::message("java_analysis.java_home", "Java home is required")
            })?),
            "Java home",
        )?;
    }
    app.state::<AnalysisRuntime>()
        .request(instance, payload)
        .map_err(Into::into)
}

pub fn close<R: Runtime>(app: &AppHandle<R>, instance: &str) -> AppResult<()> {
    app.state::<AnalysisRuntime>()
        .close(instance)
        .map_err(Into::into)
}

pub fn shutdown<R: Runtime>(app: &AppHandle<R>) -> AppResult<()> {
    if let Some(runtime) = app.try_state::<AnalysisRuntime>() {
        runtime.shutdown()?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{close, initialize_at, paths, register, request, shutdown, start};
    use crate::diagnostics;
    use crate::test_support::TestWorkspace;
    use pyxis_java_analysis::AnalysisRuntime;
    use serde_json::json;
    use std::env;
    use std::fs;
    use std::path::Path;
    use std::sync::{Arc, Mutex};
    use tauri::Manager;
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::utils::config::AppDirectoriesOverride;

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
    #[ignore = "run in a dedicated test process with JAVA_ANALYSIS_TEST_JAVA and prepared archive"]
    fn live_adapter_routes_configuration_diagnostics_and_shutdown() {
        let java = env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java test executable");
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
        handle.state::<AnalysisRuntime>().import(&archive).unwrap();
        let first = start(handle, Path::new(&java)).unwrap();
        let second = start(handle, Path::new(&java)).unwrap();
        let result = request(
            handle,
            &first,
            &json!({"id":1,"op":"parse","source":"class Orbit {}","version":1}),
        )
        .unwrap();
        assert_eq!(result["result"]["errors"], 0);
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
