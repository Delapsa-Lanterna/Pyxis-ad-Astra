use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::{AnalysisRequest, AnalysisRuntime, dependencies};
use serde_json::json;
use std::env;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};
mod support;
use support::TestWorkspace;

#[test]
fn initialization_and_shutdown_are_lazy() {
    let root =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/java-analysis/lazy-runtime");
    assert!(!root.exists());
    let runtime = AnalysisRuntime::new(&root, Arc::new(|_| {})).unwrap();
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert!(runtime.paths().root.ends_with("java-analysis"));
    assert!(!root.exists());
    runtime.shutdown().unwrap();
    assert!(runtime.instance_count().is_err());
}

#[test]
#[ignore = "requires JAVA_ANALYSIS_TEST_JAVA and prepared dependency archive"]
fn live_runtime_releases_instances_workspaces_and_preserves_logs() {
    let java = env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit test Java");
    let archive =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../target/java-analysis/jdt-dependencies.zip");
    let work = TestWorkspace::new();
    let root = work.0.join("configuration");
    let events = Arc::new(Mutex::new(Vec::new()));
    let captured = events.clone();
    let runtime = AnalysisRuntime::new(
        &root,
        Arc::new(move |event| captured.lock().unwrap().push((event.code, event.error))),
    )
    .unwrap();
    runtime.import(&archive).unwrap();
    let id = runtime.start(Path::new(&java)).unwrap();
    let second = runtime.start(Path::new(&java)).unwrap();
    assert_eq!(runtime.instance_count().unwrap(), 2);
    let result = runtime
        .request(
            &id,
            &serde_json::from_value(
                json!({"id":1,"op":"parse","source":"record Orbit(int radius) {}","version":1}),
            )
            .unwrap(),
        )
        .unwrap();
    let Some(AnalysisResult::Syntax(result)) = result.result else {
        panic!("syntax result");
    };
    assert_eq!(result.errors, 0);
    assert!(
        runtime
            .request("unknown", &AnalysisRequest::Hello { id: json!(2) })
            .is_err()
    );
    runtime.close(&id).unwrap();
    assert!(!runtime.paths().workspaces.join(&id).exists());
    assert!(runtime.paths().workspaces.join(&second).exists());
    runtime.shutdown().unwrap();
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    assert_eq!(fs::read_dir(&runtime.paths().logs).unwrap().count(), 2);
    assert!(
        dependencies::inspect(
            &runtime
                .paths()
                .dependencies
                .join(&runtime.package().version)
        )
        .is_ok()
    );
    let captured = events.lock().unwrap();
    assert_eq!(
        captured
            .iter()
            .filter(|event| event.0 == "java_analysis.start")
            .count(),
        2
    );
    assert_eq!(
        captured
            .iter()
            .filter(|event| event.0 == "java_analysis.release")
            .count(),
        2
    );
    assert!(captured.iter().all(|event| event.1.is_none()));
    drop(captured);
    drop(runtime);
    work.close();
}
