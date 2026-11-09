use crate::app_data_dir;
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, canonical_path};
use pyxis_java_analysis::{
    AnalysisEvent, AnalysisPaths, AnalysisRequest, AnalysisResponse, AnalysisRuntime, java_path,
};
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

fn request_value<R: Runtime>(
    app: &AppHandle<R>,
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
    app.state::<AnalysisRuntime>()
        .request(instance, &serde_json::from_value(payload)?)
        .map_err(Into::into)
}

pub fn request<R: Runtime>(
    app: &AppHandle<R>,
    instance: &str,
    request: &AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    let payload = serde_json::to_value(request)?;
    request_value(app, instance, &payload)
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
        handle.state::<AnalysisRuntime>().import(&archive).unwrap();
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
