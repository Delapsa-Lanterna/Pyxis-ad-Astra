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
    let response = request_typed(app, instance, serde_json::from_value(value.clone())?)?;
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
        AnalysisRequest::Parse {
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
