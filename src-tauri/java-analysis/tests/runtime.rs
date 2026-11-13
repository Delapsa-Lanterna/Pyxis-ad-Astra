use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::{AnalysisRequest, AnalysisRuntime, dependencies};
use serde_json::json;
use std::env;
use std::fs;
use std::path::Path;
use std::sync::{Arc, Barrier, Mutex};
use std::thread;
use std::time::Instant;
mod support;
use support::TestWorkspace;

#[test]
#[ignore = "requires JAVA_ANALYSIS_TEST_JAVA and the prepared dependency archive"]
fn live_requests_measure_same_instance_queue_and_independent_instances() {
    let java = env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java 17");
    let work = TestWorkspace::new();
    let runtime = Arc::new(AnalysisRuntime::new(&work.0, Arc::new(|_| {})).unwrap());
    runtime
        .import(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../target/java-analysis/jdt-dependencies.zip"),
        )
        .unwrap();
    let first = runtime.start(Path::new(&java)).unwrap();
    let second = runtime.start(Path::new(&java)).unwrap();
    let source = "class Fixture {".to_string()
        + &(0..8000)
            .map(|index| format!("int field{index}={index};"))
            .collect::<String>()
        + "}";
    let mut measurements = Vec::new();
    for same_instance in [true, false] {
        let barrier = Arc::new(Barrier::new(3));
        let started = Instant::now();
        let workers = [
            (0, first.clone()),
            (
                1,
                if same_instance {
                    first.clone()
                } else {
                    second.clone()
                },
            ),
        ]
        .map(|(index, instance)| {
            let runtime = Arc::clone(&runtime);
            let barrier = Arc::clone(&barrier);
            let source = source.clone();
            thread::spawn(move || {
                barrier.wait();
                let response = runtime
                    .request(
                        &instance,
                        &AnalysisRequest::Parse {
                            id: json!(index),
                            source,
                            version: 1,
                            language: Some("17".into()),
                        },
                    )
                    .unwrap();
                assert!(response.error.is_none());
                assert!(response.response_bytes > 0);
                (
                    response.queue_wait_milliseconds,
                    response.request_milliseconds,
                    response.response_bytes,
                )
            })
        });
        barrier.wait();
        let results: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        if same_instance {
            assert!(results.iter().any(|(wait, _, _)| *wait > 0.0));
        }
        let elapsed = started.elapsed().as_secs_f64() * 1000.0;
        if !same_instance {
            assert!(
                elapsed < results.iter().map(|(_, request, _)| request).sum::<f64>(),
                "Independent JVM work must overlap"
            );
        }
        measurements
            .push(json!({"sameInstance":same_instance,"milliseconds":elapsed,"responses":results}));
    }
    println!("{}", json!({"concurrency":measurements}));
    runtime.shutdown().unwrap();
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    drop(runtime);
    work.close();
}

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
    let began = Instant::now();
    let source = format!(
        "/*{}*/record Orbit(int radius) {{}}",
        "x".repeat(10 * 1024 * 1024)
    );
    let source_bytes = source.len();
    let result = runtime
        .request(
            &id,
            &AnalysisRequest::Parse {
                id: json!(1),
                source,
                version: 1,
                language: None,
            },
        )
        .unwrap();
    let Some(AnalysisResult::Syntax(result)) = result.result else {
        panic!("syntax result");
    };
    assert_eq!(result.errors, 0);
    println!(
        "{}",
        json!({"sourceBytes":source_bytes,"roundtripMilliseconds":began.elapsed().as_secs_f64()*1000.0})
    );
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
