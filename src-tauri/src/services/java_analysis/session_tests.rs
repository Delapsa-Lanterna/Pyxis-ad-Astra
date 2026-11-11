use super::super::{
    AnalysisExtras, automatic_java_path, close_for_session, inputs_for_session, register,
    request_for_session, shutdown, start_for_session,
};
use crate::errors::AppResult;
use crate::services::project::PerformanceTrace;
use crate::services::{project, project_sync};
use crate::test_support::TestWorkspace;
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use pyxis_java_analysis::{AnalysisRequest, AnalysisRuntime, java_path};
use serde_json::{Value, json};
use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::Arc;
use tauri::test::{mock_builder, mock_context, noop_assets};
use tauri::{AppHandle, Manager, Runtime};

struct AnalysisCleanup<'a, R: Runtime>(&'a AppHandle<R>);
impl<R: Runtime> Drop for AnalysisCleanup<'_, R> {
    fn drop(&mut self) {
        if let Err(error) = shutdown(self.0) {
            eprintln!("Java test shutdown failed: {error}");
        }
    }
}

fn send<R: Runtime>(app: &AppHandle<R>, session: &str, value: Value) -> AppResult<Value> {
    let request: AnalysisRequest = serde_json::from_value(value)?;
    let result = request_for_session(app, session, request)?;
    assert!(result.error.is_none(), "{result:?}");
    Ok(serde_json::to_value(result)?)
}

fn open(root: &Path, game: &Path) -> String {
    let mut trace = PerformanceTrace::new("java.session.fixture");
    project::open_project_session_traced(root, Some(game), &mut trace)
        .unwrap()
        .session_id
}

#[test]
#[ignore = "requires JAVA_ANALYSIS_TEST_JAVA, AST_GAME and the prepared dependency archive"]
fn live_sessions_share_jvm_and_refresh_only_affected_sources() {
    let java = PathBuf::from(env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java 17"));
    let game = PathBuf::from(env::var_os("AST_GAME").expect("explicit game root"));
    let work = TestWorkspace::new("java_session_reference");
    let config = work.join("configuration");
    let consumer = work.join("consumer");
    let library = work.join("library");
    for root in [&consumer, &library] {
        fs::create_dir_all(root.join("src")).unwrap();
    }
    fs::write(
        consumer.join("mod_info.json"),
        r#"{"id":"consumer","dependencies":[{"id":"library"}],"jars":["jars/missing.jar"]}"#,
    )
    .unwrap();
    fs::write(library.join("mod_info.json"), r#"{"id":"library"}"#).unwrap();
    let source = "class Entry { Object run(){return Library.value();} }";
    fs::write(consumer.join("src/Entry.java"), source).unwrap();
    for index in 0..24 {
        fs::write(
            consumer.join(format!("src/Quiet{index}.java")),
            format!("class Quiet{index} {{ int x(){{return 1;}} }}"),
        )
        .unwrap();
    }
    fs::write(
        library.join("src/Library.java"),
        "public class Library { public static String value(){return \"fixture\";} }",
    )
    .unwrap();
    let first = open(&consumer, &game);
    let automatic = automatic_java_path(Some(&first), None).unwrap().unwrap();
    assert!(
        Path::new(&automatic).is_file(),
        "automatic Java: {automatic:?}"
    );
    assert_eq!(
        fs::canonicalize(&automatic).unwrap(),
        fs::canonicalize(&java).unwrap()
    );
    let second = open(&library, &game);
    project::set_reference_order(vec![first.clone(), second.clone()]).unwrap();
    project::set_reference_sources(vec![second.clone()]).unwrap();
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let handle = app.handle();
    register(handle, &config).unwrap();
    let cleanup = AnalysisCleanup(handle);
    let runtime = handle.state::<Arc<AnalysisRuntime>>();
    runtime
        .import(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/java-analysis/jdt-dependencies.zip"),
        )
        .unwrap();
    let initial = inputs_for_session(&first, &AnalysisExtras::default()).unwrap();
    assert!(initial.missing_dependencies.is_empty());
    assert_eq!(initial.missing_jars.len(), 1);
    assert_eq!(initial.referenced_sessions.len(), 1);
    assert_eq!(initial.referenced_sessions[0], second);
    let instance = start_for_session(handle, &first, &java, AnalysisExtras::default()).unwrap();
    assert_eq!(
        start_for_session(handle, &second, &java, AnalysisExtras::default()).unwrap(),
        instance
    );
    assert_eq!(runtime.instance_count().unwrap(), 1);
    let first_project = format!("session:{first}");
    let analyze = |session: &str| {
        send(
            handle,
            session,
            json!({"id":"analysis","op":"analyze","project":format!("session:{session}")}),
        )
        .unwrap()
    };
    let initial_analysis = analyze(&first);
    assert_eq!(initial_analysis["result"]["errors"], 0);
    send(handle, &first, json!({"id":"update","op":"update","project":first_project,"expectedRevision":1,"files":[{"action":"replace","file":consumer.join("src/Entry.java"),"source":source.replace("return Library.value()", "return Library.value() "),"version":2}]})).unwrap();
    let changed = analyze(&first);
    assert_eq!(changed["result"]["reparsedFiles"], 1);
    assert_eq!(changed["result"]["errors"], 0);
    project_sync::publish_references(
        project::set_reference_sources(Vec::new()).unwrap(),
        Vec::new(),
    )
    .unwrap();
    let removed = analyze(&first);
    let denied = inputs_for_session(
        &first,
        &AnalysisExtras {
            sources: vec![library.join("src").to_string_lossy().to_string()],
            jars: Vec::new(),
        },
    )
    .unwrap_err();
    assert_eq!(denied.code(), "java_analysis.reference_required");
    assert!(removed["result"]["errors"].as_u64().unwrap() > 0);
    assert!(removed["result"]["reparsedFiles"].as_u64().unwrap() < 25);
    assert_eq!(
        inputs_for_session(&first, &AnalysisExtras::default())
            .unwrap()
            .missing_dependencies,
        ["library"]
    );
    project_sync::publish_references(
        project::set_reference_sources(vec![second.clone()]).unwrap(),
        Vec::new(),
    )
    .unwrap();
    let restored = analyze(&first);
    assert_eq!(restored["result"]["errors"], 0);
    assert_eq!(restored["result"]["reparsedFiles"], 2);
    let revision = restored["result"]["revision"].as_u64().unwrap();
    let queried = send(handle, &first, json!({"id":"query","op":"query","project":first_project,"revision":revision,"file":consumer.join("src/Entry.java"),"offset":source.find("value").unwrap()})).unwrap();
    assert_eq!(queried["result"]["version"], 2);
    assert_eq!(
        queried["result"]["call"]["binding"]["type"],
        "java.lang.String"
    );
    assert!(
        request_for_session(
            handle,
            &first,
            AnalysisRequest::Analyze {
                id: json!(1),
                project: format!("session:{second}"),
                force_full: false
            }
        )
        .is_err()
    );
    project::set_reference_order(vec![second.clone(), first.clone()]).unwrap();
    project_sync::publish_references(project::reference_sources().unwrap(), Vec::new()).unwrap();
    assert_eq!(analyze(&first)["result"]["errors"], 0);
    project_sync::release_project_session(second.clone()).unwrap();
    assert_eq!(runtime.instance_count().unwrap(), 1);
    assert!(analyze(&first)["result"]["errors"].as_u64().unwrap() > 0);
    close_for_session(handle, &first).unwrap();
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    let instance = start_for_session(handle, &first, &java, AnalysisExtras::default()).unwrap();
    runtime
        .request(
            &instance,
            &AnalysisRequest::Close {
                id: json!("remove-before-release"),
                project: first_project,
            },
        )
        .unwrap();
    assert!(close_for_session(handle, &first).is_err());
    assert_eq!(runtime.instance_count().unwrap(), 0);
    assert_eq!(
        fs::read_dir(&runtime.paths().workspaces).unwrap().count(),
        0
    );
    project_sync::release_project_session(first).unwrap();
    shutdown(handle).unwrap();
    drop(cleanup);
    drop(app);
    work.close().unwrap();
}

#[test]
#[ignore = "requires JAVA_ANALYSIS_TEST_JAVA, AST_GAME, real correctness Mods and prepared archive"]
fn live_correct_mods_use_the_published_reference_inputs() {
    let java = PathBuf::from(env::var_os("JAVA_ANALYSIS_TEST_JAVA").expect("explicit Java 17"));
    let game = PathBuf::from(env::var_os("AST_GAME").expect("explicit game root"));
    let work = TestWorkspace::new("java_real_session");
    let app = mock_builder().build(mock_context(noop_assets())).unwrap();
    let handle = app.handle();
    register(handle, &work.join("configuration")).unwrap();
    let cleanup = AnalysisCleanup(handle);
    handle
        .state::<Arc<AnalysisRuntime>>()
        .import(
            &Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("target/java-analysis/jdt-dependencies.zip"),
        )
        .unwrap();
    let libraries = [
        "LazyLib",
        "GraphicsLib",
        "MagicLib",
        "BoxUtil",
        "LunaLib",
        "Console Commands",
        "Nexerelin",
        "UnofficialNewGamePlus",
    ];
    let references: Vec<_> = libraries
        .iter()
        .map(|name| open(&game.join("mods").join(name), &game))
        .collect();
    project::set_reference_order(references.clone()).unwrap();
    project_sync::publish_references(
        project::set_reference_sources(references.clone()).unwrap(),
        Vec::new(),
    )
    .unwrap();
    for name in ["Polaris_Prime", "Kratogen_TA", "Templars"] {
        let session = open(&game.join("mods").join(name), &game);
        let inputs = inputs_for_session(&session, &AnalysisExtras::default()).unwrap();
        assert!(
            inputs.missing_dependencies.is_empty(),
            "{:?}",
            inputs.missing_dependencies
        );
        let instance =
            start_for_session(handle, &session, &java, AnalysisExtras::default()).unwrap();
        let response = request_for_session(
            handle,
            &session,
            AnalysisRequest::Analyze {
                id: json!(name),
                project: format!("session:{session}"),
                force_full: false,
            },
        )
        .unwrap();
        let Some(AnalysisResult::Analysis(result)) = response.result else {
            panic!("analysis result");
        };
        let jdk = env::var_os("AST_JDK")
            .or_else(|| env::var_os("JAVA_HOME"))
            .expect("explicit JDK 17");
        let baseline = Command::new(Path::new(&jdk).join("bin/java.exe"))
            .args([
                "-cp",
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("target/java-analysis")
                    .to_str()
                    .unwrap(),
                "JavacBaseline",
                &inputs.sources.join(";"),
                &inputs.classpath.join(";"),
                DEFAULT_LANGUAGE,
            ])
            .output()
            .unwrap();
        assert!(
            baseline.status.success(),
            "{}",
            String::from_utf8_lossy(&baseline.stderr)
        );
        let javac: Value = serde_json::from_slice(&baseline.stdout).unwrap();
        assert_eq!(javac["files"], result.files);
        assert_eq!(javac["errors"], result.errors);
        assert_eq!(javac["method"], result.method);
        assert_eq!(javac["constructor"], result.constructor);
        assert_eq!(
            javac["enumConstructor"].as_u64().unwrap_or(0),
            result.enum_constructor as u64
        );
        assert_eq!(javac["methodReference"], result.method_reference);
        println!(
            "STAGE9_MOD_INPUT {}",
            json!({"name":name,"instance":instance,"inputs":inputs,"analysis":result,"javac":javac})
        );
        let target = game
            .join("mods")
            .join(name)
            .join("src")
            .canonicalize()
            .unwrap();
        let target = java_path(&target);
        let own_errors: Vec<_> = result
            .diagnostics
            .iter()
            .filter(|diagnostic| {
                diagnostic.severity == "error"
                    && diagnostic
                        .file
                        .as_ref()
                        .is_some_and(|file| Path::new(file).starts_with(&target))
            })
            .collect();
        assert!(own_errors.is_empty(), "{name}: {own_errors:?}");
        assert_eq!(result.unresolved, 0);
        assert_eq!(result.recovered, 0);
        project_sync::release_project_session(session).unwrap();
    }
    for reference in references {
        project_sync::release_project_session(reference).unwrap();
    }
    shutdown(handle).unwrap();
    drop(cleanup);
    drop(app);
    work.close().unwrap();
}
