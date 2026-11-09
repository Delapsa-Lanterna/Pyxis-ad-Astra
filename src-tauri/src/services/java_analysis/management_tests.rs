use super::{
    ComponentManagement, ManagementAction, ManagementCompletion, ManagementOperation,
    ManagementSnapshot,
};
use crate::services::java_analysis::initialize_at;
use crate::test_support::TestWorkspace;
use pyxis_java_analysis::transfer::TransferControl;
use pyxis_java_analysis::{AnalysisRequest, Error as AnalysisError, java_path};
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::ipc::{Channel, InvokeResponseBody};

fn listener(values: &Arc<Mutex<Vec<Value>>>) -> Channel<ManagementSnapshot> {
    let values = Arc::clone(values);
    Channel::new(move |body| {
        let InvokeResponseBody::Json(text) = body else {
            panic!("JSON management snapshot");
        };
        values
            .lock()
            .unwrap()
            .push(serde_json::from_str(&text).unwrap());
        Ok(())
    })
}

#[test]
fn management_subscriptions_refresh_failure_and_closed_state() {
    let work = TestWorkspace::new("java_management");
    let runtime = Arc::new(initialize_at(&work.join("config")).unwrap());
    let manager = ComponentManagement::new(Arc::clone(&runtime));
    let first = Arc::new(Mutex::new(Vec::new()));
    let second = Arc::new(Mutex::new(Vec::new()));
    manager
        .subscribe("main".into(), "main-subscription".into(), listener(&first))
        .unwrap();
    manager
        .subscribe(
            "second".into(),
            "second-subscription".into(),
            listener(&second),
        )
        .unwrap();
    manager
        .begin(ManagementAction::Refresh, "refresh-first".into())
        .unwrap();
    manager.join_worker().unwrap();
    assert_eq!(manager.snapshot().unwrap().installation, "missing");
    assert!(!runtime.paths().root.exists());
    let before = first.lock().unwrap().len();
    manager
        .begin(
            ManagementAction::Import {
                archive: work.join("absent.zip").to_string_lossy().into_owned(),
            },
            "import-failure".into(),
        )
        .unwrap();
    manager.join_worker().unwrap();
    let failed = manager.snapshot().unwrap();
    assert_eq!(failed.phase, "failed");
    assert!(failed.error.is_some());
    let next_control = TransferControl::default();
    {
        let mut state = manager.state().unwrap();
        state.current = Some(ManagementOperation {
            key: "next-download".into(),
            action: ManagementAction::Download,
            control: next_control.clone(),
            completion: Arc::new(ManagementCompletion::default()),
        });
        state.snapshot.operation_key = Some("next-download".into());
        state.snapshot.active = true;
        state.snapshot.phase = "downloading".into();
    }
    let stale = manager.cancel("refresh-first").unwrap();
    assert_eq!(stale.operation_key.as_deref(), Some("next-download"));
    assert_eq!(stale.phase, "downloading");
    assert!(next_control.check().is_ok());
    let cancelled = manager.cancel("next-download").unwrap();
    assert_eq!(cancelled.phase, "cancelling");
    assert!(matches!(
        next_control.check(),
        Err(AnalysisError::Cancelled)
    ));
    {
        let mut state = manager.state().unwrap();
        state.snapshot.active = false;
        state.current = None;
    }
    assert!(first.lock().unwrap().len() > before);
    assert_eq!(first.lock().unwrap().len(), second.lock().unwrap().len());
    manager.unsubscribe("main", "main-subscription").unwrap();
    let before = first.lock().unwrap().len();
    manager
        .begin(ManagementAction::Refresh, "refresh-last".into())
        .unwrap();
    manager.join_worker().unwrap();
    assert_eq!(first.lock().unwrap().len(), before);
    manager.shutdown().unwrap();
    assert!(
        manager
            .begin(ManagementAction::Refresh, "after-shutdown".into())
            .is_err()
    );
    runtime.shutdown().unwrap();
    drop(manager);
    drop(runtime);
    work.close().unwrap();
}

#[test]
fn queued_component_operations_run_fifo_and_cancel_uses_the_owned_operation() {
    let work = TestWorkspace::new("java_management_count_order");
    let runtime = Arc::new(initialize_at(&work.join("config")).unwrap());
    let manager = ComponentManagement::new(Arc::clone(&runtime));
    let current_control = TransferControl::default();
    {
        let mut state = manager.state().unwrap();
        state.current = Some(ManagementOperation {
            key: "queue-first".into(),
            action: ManagementAction::Refresh,
            control: current_control.clone(),
            completion: Arc::new(ManagementCompletion::default()),
        });
        state.worker_running = true;
        state.snapshot.operation_key = Some("queue-first".into());
        state.snapshot.action = Some(ManagementAction::Refresh);
        state.snapshot.active = true;
        state.snapshot.phase = "checking".into();
    }
    let second = manager
        .begin(
            ManagementAction::Probe {
                java_path: "fixture-java".into(),
            },
            "queue-second".into(),
        )
        .unwrap();
    assert_eq!(second.snapshot.queued, 1);
    let stale = manager.cancel("expired-operation").unwrap();
    assert_eq!(stale.operation_key.as_deref(), Some("queue-first"));
    assert_eq!(stale.queued, 1);
    manager.cancel("queue-second").unwrap();
    let second_receipt = second.wait().unwrap();
    assert_eq!(
        second_receipt.operation_key.as_deref(),
        Some("queue-second")
    );
    assert_eq!(second_receipt.phase, "cancelled");
    assert_eq!(manager.snapshot().unwrap().queued, 0);
    assert_eq!(manager.cancel("queue-first").unwrap().phase, "cancelling");
    assert!(matches!(
        current_control.check(),
        Err(AnalysisError::Cancelled)
    ));
    {
        let mut state = manager.state().unwrap();
        state.current = None;
        state.worker_running = false;
        state.snapshot.active = false;
    }
    manager.shutdown().unwrap();
    runtime.shutdown().unwrap();
    drop(manager);
    drop(runtime);
    work.close().unwrap();
}

#[test]
#[ignore = "requires explicit JAVA_ANALYSIS_TEST_JAVA and the prepared dependency archive"]
fn live_management_install_repair_selfcheck_stop_remove_and_release() {
    let java =
        PathBuf::from(env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java 17 executable"));
    let work = TestWorkspace::new("java_component_live");
    let runtime = Arc::new(initialize_at(&work.join("configuration 中文 spaces")).unwrap());
    let manager = ComponentManagement::new(Arc::clone(&runtime));
    let deliveries = Arc::new(Mutex::new(Vec::new()));
    manager
        .subscribe(
            "main".into(),
            "live-subscription".into(),
            listener(&deliveries),
        )
        .unwrap();
    let mut operation_keys = [
        "download-first",
        "refresh-damaged",
        "repair",
        "import-package",
        "download-in-use",
        "stop-analysis",
        "probe-missing",
        "probe-wrong-version",
        "remove-package",
        "import-final",
    ]
    .into_iter();
    let mut execute = |action| {
        manager
            .begin(action, operation_keys.next().unwrap().into())
            .unwrap();
        manager.join_worker().unwrap();
        let snapshot = manager.snapshot().unwrap();
        assert_eq!(snapshot.phase, "succeeded", "{snapshot:?}");
        snapshot
    };
    let started = Instant::now();
    let downloaded = execute(ManagementAction::Download);
    let download_ms = started.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(downloaded.download_bytes, 16_423_216);
    assert_eq!(downloaded.installation, "installed");
    let package = runtime.package();
    let installation = runtime.paths().dependencies.join(&package.version);
    assert_eq!(fs::read_dir(installation.join("lib")).unwrap().count(), 27);
    let jar = installation.join(&package.artifacts[0].path);
    fs::write(&jar, b"fixture corruption").unwrap();
    assert_eq!(execute(ManagementAction::Refresh).installation, "damaged");
    execute(ManagementAction::Download);
    assert!(runtime.installed().unwrap());
    execute(ManagementAction::Import {
        archive: Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/java-analysis/jdt-dependencies.zip")
            .to_string_lossy()
            .into_owned(),
    });
    let test = ManagementAction::Test {
        java_path: java.to_string_lossy().into_owned(),
    };
    let beginning = manager
        .begin(test.clone(), "live-self-check".into())
        .unwrap();
    assert_eq!(
        manager
            .begin(test, "duplicate-self-check".into())
            .unwrap()
            .operation_key,
        beginning.operation_key
    );
    let queued = execute(ManagementAction::Refresh);
    manager.join_worker().unwrap();
    assert_eq!(queued.phase, "succeeded");
    assert!(queued.environment.as_ref().unwrap().released);
    let receipt = beginning.wait().unwrap();
    assert_eq!(receipt.operation_key.as_deref(), Some("live-self-check"));
    assert_eq!(receipt.phase, "succeeded");
    let self_check_ms = receipt.environment.as_ref().unwrap().milliseconds;
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    let started = Instant::now();
    for _ in 0..100 {
        assert_eq!(manager.snapshot().unwrap().projects, 0);
    }
    let snapshot_ms = started.elapsed().as_secs_f64() * 1000.0 / 100.0;
    let instance = runtime.start(&java).unwrap();
    let source = work.join("source");
    fs::create_dir(&source).unwrap();
    runtime
        .request(
            &instance,
            &AnalysisRequest::Open {
                id: json!(1),
                project: "neutral".into(),
                sources: vec![java_path(&source).to_string_lossy().into_owned()],
                classpath: vec![],
                java_home: java
                    .parent()
                    .unwrap()
                    .parent()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
                language: Some("17".into()),
            },
        )
        .unwrap();
    assert_eq!(manager.snapshot().unwrap().projects, 1);
    manager
        .begin(ManagementAction::Download, "download-in-use".into())
        .unwrap();
    manager.join_worker().unwrap();
    assert_eq!(manager.snapshot().unwrap().phase, "failed");
    execute(ManagementAction::Stop);
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(runtime.project_count(), 0);
    let instance = runtime.start(&java).unwrap();
    runtime.close(&instance).unwrap();
    manager
        .begin(
            ManagementAction::Probe {
                java_path: work.join("missing-java.exe").to_string_lossy().into_owned(),
            },
            "probe-missing".into(),
        )
        .unwrap();
    manager.join_worker().unwrap();
    assert_eq!(manager.snapshot().unwrap().phase, "failed");
    let other_java =
        env::var("JAVA_ANALYSIS_TEST_JAVA_OTHER").expect("explicit other Java version");
    manager
        .begin(
            ManagementAction::Probe {
                java_path: other_java,
            },
            "probe-wrong-version".into(),
        )
        .unwrap();
    manager.join_worker().unwrap();
    assert_eq!(manager.snapshot().unwrap().phase, "failed");
    assert!(
        manager
            .snapshot()
            .unwrap()
            .error
            .unwrap()
            .contains("Java 17 is required")
    );
    manager
        .begin(
            ManagementAction::Test {
                java_path: java.to_string_lossy().into_owned(),
            },
            "self-check-cancelled".into(),
        )
        .unwrap();
    assert_eq!(
        manager
            .cancel("live-self-check")
            .unwrap()
            .operation_key
            .as_deref(),
        Some("self-check-cancelled")
    );
    assert_eq!(
        manager.cancel("self-check-cancelled").unwrap().phase,
        "cancelling"
    );
    manager.join_worker().unwrap();
    assert_eq!(manager.snapshot().unwrap().phase, "cancelled");
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    let saved_logs = fs::read_dir(&runtime.paths().logs).unwrap().count();
    assert_eq!(saved_logs, 3);
    let removed = execute(ManagementAction::Remove);
    assert_eq!(removed.installation, "missing");
    assert_eq!(removed.staged_bytes, 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().logs).unwrap().count(),
        saved_logs
    );
    execute(ManagementAction::Import {
        archive: Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("target/java-analysis/jdt-dependencies.zip")
            .to_string_lossy()
            .into_owned(),
    });
    manager
        .begin(
            ManagementAction::Test {
                java_path: java.to_string_lossy().into_owned(),
            },
            "self-check-shutdown".into(),
        )
        .unwrap();
    let shutdown_started = Instant::now();
    manager.shutdown().unwrap();
    let shutdown_ms = shutdown_started.elapsed().as_secs_f64() * 1000.0;
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    runtime.shutdown().unwrap();
    println!(
        "{}",
        json!({"downloadMilliseconds":download_ms,"snapshotMeanMilliseconds":snapshot_ms,"selfCheckMilliseconds":self_check_ms,"shutdownWaitMilliseconds":shutdown_ms,"jarFiles":27,"logFiles":saved_logs,"deliveries":deliveries.lock().unwrap().len(),"workspaceFiles":0,"instances":0,"projects":0})
    );
    drop(manager);
    drop(runtime);
    work.close().unwrap();
}
