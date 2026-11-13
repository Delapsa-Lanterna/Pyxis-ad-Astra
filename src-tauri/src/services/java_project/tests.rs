#![cfg(test)]
use super::process::JAVA_ENCODING;
use super::*;
use crate::models::java_project::GradleProject;
use crate::models::java_project::JavaArtifact;
use crate::models::java_project::{GradleModel, JavaBuildResult, JavaProjectSettings};
use crate::models::java_project::{JavaBuildMode, JavaTaskPhase, JavaTaskResult};
use crate::models::{FileChangeReplayDirection, SaveAction, WindowIdentity};
use crate::services::project::PerformanceTrace;
use crate::services::project::test_support::project_workspace;
use crate::services::{project_save, write_transactions};
use crate::test_support::TestWorkspace;
use crate::test_support::work_counts;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use std::env;
use std::fs;
use std::process::Command;
use std::thread;
use std::time::Duration;

fn fixture(root: &Path) -> Arc<JavaProject> {
    Arc::new(JavaProject {
        session: "fixture".into(),
        file: root.join("configuration/project.json"),
        state: Mutex::new(ProjectState {
            stored: StoredProject::default(),
            snapshot: JavaProjectSnapshot {
                task_result: JavaTaskResult {
                    log_path: Some(io::forward_slash_path(&root.join("operation.log"))),
                    task_id: Some("fixture".into()),
                    ..Default::default()
                },
                ..Default::default()
            },
            owner: "sample".into(),
            input_generation: 0,
            receipt: None,
        }),
        changed: Condvar::new(),
        cancelled: AtomicBool::new(false),
        input_generation: AtomicU64::new(1),
    })
}

#[test]
fn configuration_roundtrip_isolated_paths_and_actual_target() {
    let work = TestWorkspace::new("java_project_configuration");
    let root = work.join("sample");
    fs::create_dir(&root).unwrap();
    let entry = fixture(&root);
    let settings = JavaProjectSettings {
        sources: Some(vec!["source/main".into(), "source/generated".into()]),
        libraries: vec!["jars/api.jar".into()],
        primary_jar: Some("jars/sample.jar".into()),
        ..Default::default()
    };
    let stored = StoredProject {
        settings: settings.clone(),
        ..Default::default()
    };
    persist(&entry, &stored).unwrap();
    let restored: StoredProject =
        serde_json::from_str(&io::read_utf8_no_bom(&entry.file).unwrap()).unwrap();
    assert_eq!(restored.settings, settings);
    assert_eq!(
        paths(root.to_str().unwrap(), settings.sources.as_ref().unwrap())
            .unwrap()
            .len(),
        2
    );
    assert!(paths(root.to_str().unwrap(), &["../outside".into()]).is_err());
    assert_eq!(DEFAULT_LANGUAGE, "17");
    work.close().unwrap();
}

#[test]
fn manual_configuration_uses_its_sources_with_a_cached_gradle_model() {
    let work = project_workspace("java_manual_configuration");
    fs::write(work.join("build.gradle"), "invalid Gradle script").unwrap();
    fs::create_dir(work.join("manual")).unwrap();
    let manifest = project::open_project_session_traced(
        &work,
        None,
        &mut PerformanceTrace::new("java.configuration"),
    )
    .unwrap();
    let mut entry = fixture(work.as_path());
    Arc::get_mut(&mut entry).unwrap().session = manifest.session_id;
    {
        let mut state = entry.state.lock().unwrap();
        state.stored.settings.sources = Some(vec!["manual".into()]);
        state.stored.model = Some(GradleModel {
            projects: vec![GradleProject {
                path: ":".into(),
                sources: vec!["gradle-source".into()],
                ..Default::default()
            }],
            ..Default::default()
        });
    }
    let snapshot = describe(&entry, true).unwrap();
    assert_eq!(snapshot.mode, "manual");
    assert_eq!(
        snapshot.sources,
        paths(&manifest.mod_root, &["manual".into()]).unwrap()
    );
    assert!(snapshot.selected_project.is_none());
    {
        let mut state = entry.state.lock().unwrap();
        state.stored.settings.build_mode = JavaBuildMode::Gradle;
        state.stored.settings.primary_jar = Some("jars/manual.jar".into());
        state.stored.model.as_mut().unwrap().projects.clear();
    }
    assert!(describe(&entry, true).unwrap().artifacts.is_empty());
    work.close().unwrap();
}

#[test]
fn deployment_versions_binary_history_noop_and_artifact_changes() {
    let work = project_workspace("java_deployment");
    fs::write(
        work.join("mod_info.json"),
        r#"{"id":"build_sample","jars":["jars/sample.jar"]}"#,
    )
    .unwrap();
    fs::create_dir(work.join("jars")).unwrap();
    let artifact_path = work.join("compiled.jar");
    let bytes = [0x50, 0x4b, 0xff, 0, 1, 2];
    fs::write(&artifact_path, bytes).unwrap();
    let manifest = project::open_project_session_traced(
        &work,
        None,
        &mut PerformanceTrace::new("java.deployment"),
    )
    .unwrap();
    let mut entry = fixture(work.as_path());
    Arc::get_mut(&mut entry).unwrap().session = manifest.session_id.clone();
    entry.state.lock().unwrap().stored.build = Some(JavaBuildResult {
        mode: Default::default(),
        id: "sample-build".into(),
        task: "jar".into(),
        artifacts: vec![JavaArtifact {
            id: "artifact".into(),
            path: io::forward_slash_path(&artifact_path),
            bytes: bytes.len() as u64,
            fingerprint: io::file_version(&artifact_path)
                .unwrap()
                .fingerprint
                .unwrap(),
        }],
        inputs_changed: false,
        milliseconds: 1.,
    });
    let key = io::canonical_path(&work, "Project")
        .unwrap()
        .to_string_lossy()
        .into_owned();
    PROJECTS.lock().unwrap().insert(key, entry);
    let identity = WindowIdentity::CodeEditor {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
    };
    assert!(deployment::preview(identity.clone(), "artifact", "unregistered.jar").is_err());
    let preview = deployment::preview(identity.clone(), "artifact", "jars/sample.jar").unwrap();
    assert!(!preview.exists);
    let saved =
        project_save::execute_save_action(SaveAction::DeployJavaArtifact(preview.request)).unwrap();
    assert_eq!(fs::read(work.join("jars/sample.jar")).unwrap(), bytes);
    assert_eq!(saved.history.undo_stack.len(), 1);
    let undo = write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Undo,
        saved.history.undo_stack[0].id,
        saved.history.revision,
    )
    .unwrap();
    assert!(!work.join("jars/sample.jar").exists());
    write_transactions::replay(
        &manifest.session_id,
        &manifest.mod_root,
        FileChangeReplayDirection::Redo,
        undo.history.redo_stack[0].id,
        undo.history.revision,
    )
    .unwrap();
    assert_eq!(fs::read(work.join("jars/sample.jar")).unwrap(), bytes);
    let current = deployment::preview(identity.clone(), "artifact", "jars/sample.jar").unwrap();
    let noop =
        project_save::execute_save_action(SaveAction::DeployJavaArtifact(current.request.clone()))
            .unwrap();
    assert!(noop.changes.is_empty());
    fs::write(work.join("jars/sample.jar"), [0xff, 9]).unwrap();
    assert!(
        project_save::execute_save_action(SaveAction::DeployJavaArtifact(current.request)).is_err()
    );
    let next = deployment::preview(identity.clone(), "artifact", "jars/sample.jar").unwrap();
    fs::write(&artifact_path, [0xff, 8]).unwrap();
    assert_eq!(
        deployment::preview(identity, "artifact", "jars/sample.jar")
            .unwrap_err()
            .code(),
        "java_project.artifact_changed"
    );
    assert!(
        project_save::execute_save_action(SaveAction::DeployJavaArtifact(next.request)).is_err()
    );
    assert_eq!(fs::read(work.join("jars/sample.jar")).unwrap(), [0xff, 9]);
    release_session(&manifest.session_id).unwrap();
    work.close().unwrap();
}

#[test]
fn cancellation_waits_for_owned_process_and_bounded_log() {
    let work = TestWorkspace::new("java_project_cancel");
    let entry = fixture(work.as_path());
    let log = work.join("operation.log");
    let owned = Arc::clone(&entry);
    let action = thread::spawn(move || {
        tasks::run_process(
            &owned,
            Command::new("powershell.exe").args([
                "-NoProfile",
                "-Command",
                "Write-Output started; Start-Sleep -Seconds 30",
            ]),
            &log,
        )
    });
    thread::sleep(Duration::from_millis(250));
    entry.cancelled.store(true, Ordering::Release);
    assert_eq!(
        action.join().unwrap().unwrap_err().code(),
        "java_project.cancelled"
    );
    fs::write(work.join("large.log"), "x".repeat(20000)).unwrap();
    assert_eq!(process::tail(&work.join("large.log")).unwrap().len(), 8192);
    work.close().unwrap();
}

#[test]
fn cached_description_reuses_source_counts_and_invalidates_resource_versions() {
    let work = project_workspace("java_project_cached_inputs");
    fs::create_dir(work.join("src")).unwrap();
    fs::create_dir(work.join("assets")).unwrap();
    fs::write(work.join("src/Entry.java"), "class Entry {}").unwrap();
    let resource = work.join("assets/value.txt");
    fs::write(&resource, "first").unwrap();
    let manifest =
        project::open_project_session_traced(&work, None, &mut PerformanceTrace::new("java.cache"))
            .unwrap();
    let mut entry = fixture(work.as_path());
    Arc::get_mut(&mut entry).unwrap().session = manifest.session_id;
    let first = describe(&entry, true).unwrap();
    for _ in 0..4 {
        assert_eq!(describe(&entry, false).unwrap().revision, first.revision);
    }
    assert_eq!(work_counts::count("java-source-walk", &work.join("src")), 1);
    {
        let mut state = entry.state.lock().unwrap();
        state.stored.build = Some(JavaBuildResult {
            mode: Default::default(),
            id: "cached".into(),
            task: "jar".into(),
            artifacts: Vec::new(),
            inputs_changed: false,
            milliseconds: 1.,
        });
        state.snapshot.build = state.stored.build.clone();
        state.stored.build_configuration = first.configuration;
        state.stored.build_versions = vec![io::file_version(&work.join("assets")).unwrap()];
    }
    fs::write(&resource, "other").unwrap();
    fs::write(work.join("src/Other.java"), "class Other {}").unwrap();
    entry.input_generation.fetch_add(1, Ordering::AcqRel);
    let changed = describe(&entry, false).unwrap();
    assert_eq!(changed.source_count, 2);
    assert!(changed.build.unwrap().inputs_changed);
    assert!(
        describe(&entry, true)
            .unwrap()
            .build
            .unwrap()
            .inputs_changed
    );
    assert_eq!(work_counts::count("java-source-walk", &work.join("src")), 3);
    work.close().unwrap();
}

#[test]
fn utf8_log_tail_and_configuration_rejection_preserve_owned_state() {
    let work = project_workspace("java_task_boundaries");
    let log = work.join("unicode.log");
    fs::write(&log, "中".repeat(3000)).unwrap();
    let tail = process::tail(&log).unwrap();
    let locations = process::locations(
        "C:/sample/source/Entry.java:3: error\nBuild file 'C:/sample/build.gradle.kts' line: 7\nC:/sample/source/Entry.java:3: duplicate",
    );
    assert_eq!(locations.len(), 2);
    assert_eq!(locations[0].line, Some(3));
    assert_eq!(
        locations[1].path.as_deref(),
        Some("C:/sample/build.gradle.kts")
    );
    assert_eq!(tail.len(), 8190);
    assert_eq!(tail, "中".repeat(2730));
    let manifest =
        project::open_project_session_traced(&work, None, &mut PerformanceTrace::new("java.task"))
            .unwrap();
    let mut entry = fixture(work.as_path());
    Arc::get_mut(&mut entry).unwrap().session = manifest.session_id;
    let error = tasks::operate(
        &entry,
        "window",
        &JavaProjectOperation::Build {
            tasks: Vec::new(),
            arguments: Vec::new(),
            online: false,
        },
        Some("expired"),
    )
    .unwrap_err();
    assert_eq!(error.code(), "java_project.stale");
    assert!(!entry.state.lock().unwrap().snapshot.active);
    let result = tasks::operate(&entry, "window", &JavaProjectOperation::Detect, None).unwrap();
    assert_eq!(result.task_result.phase, JavaTaskPhase::Failed);
    assert!(result.task_result.error.is_some());
    assert_eq!(
        result.task_result.operation,
        Some(JavaProjectOperation::Detect)
    );
    assert!(!result.active);
    let stored: StoredProject =
        serde_json::from_str(&io::read_utf8_no_bom(&entry.file).unwrap()).unwrap();
    assert_eq!(
        stored.last_task.unwrap().task_id,
        result.task_result.task_id
    );
    work.close().unwrap();
}

#[test]
#[ignore = "requires JAVA_PROJECT_TEST_JAVA"]
fn live_build_reads_each_dependency_twice_and_reuses_its_description() {
    let work = project_workspace("java_dependency_reads");
    let game = work.join("game");
    let root = game.join("mods/sample");
    for path in [
        game.join("jre"),
        game.join("starsector-core"),
        root.join("src"),
        work.join("empty"),
    ] {
        fs::create_dir_all(path).unwrap();
    }
    fs::write(
        root.join("mod_info.json"),
        r#"{"id":"sample","jars":["jars/sample.jar"]}"#,
    )
    .unwrap();
    fs::write(root.join("src/Entry.java"), "class Entry {}").unwrap();
    let java = PathBuf::from(env::var("JAVA_PROJECT_TEST_JAVA").unwrap());
    let library = game.join("starsector-core/api.jar");
    assert!(
        Command::new(java.parent().unwrap().join("jar.exe"))
            .args(["--create", "--file"])
            .arg(&library)
            .arg("-C")
            .arg(work.join("empty"))
            .arg(".")
            .output()
            .unwrap()
            .status
            .success()
    );
    let manifest = project::open_project_session_traced(
        &root,
        Some(&game),
        &mut PerformanceTrace::new("java.reads"),
    )
    .unwrap();
    let mut entry = fixture(work.as_path());
    Arc::get_mut(&mut entry).unwrap().session = manifest.session_id;
    let snapshot = JavaProjectSnapshot {
        mod_root: manifest.mod_root.clone(),
        sources: vec![io::forward_slash_path(&root.join("src"))],
        java_path: Some(java.to_string_lossy().into()),
        target: DEFAULT_LANGUAGE.into(),
        primary_jar: Some("jars/sample.jar".into()),
        ..Default::default()
    };
    PROJECTS
        .lock()
        .unwrap()
        .insert(manifest.mod_root, Arc::clone(&entry));
    let before = work_counts::count("read", &library);
    let (built, versions) = build::run(&entry, &snapshot, &[], &[], false).unwrap();
    assert_eq!(work_counts::count("read", &library) - before, 2);
    assert!(!built.inputs_changed);
    let canonical_library = io::canonical_path(&library, "Dependency").unwrap();
    assert!(
        versions
            .iter()
            .any(|version| windows_path_key(&version.path)
                == windows_path_key(&canonical_library.to_string_lossy()))
    );
    release_session(&entry.session).unwrap();
    work.close().unwrap();
}

#[test]
fn session_release_leaves_input_registry_available_until_task_finishes() {
    let work = TestWorkspace::new("java_project_release");
    let entry = fixture(work.as_path());
    entry.state.lock().unwrap().snapshot.active = true;
    let key = work.to_string_lossy().into_owned();
    PROJECTS
        .lock()
        .unwrap()
        .insert(key.clone(), Arc::clone(&entry));
    let closing = thread::spawn(|| release_session("fixture"));
    for _ in 0..1000 {
        if entry.cancelled.load(Ordering::Acquire) {
            break;
        }
        thread::sleep(Duration::from_millis(1));
    }
    let cancelled = entry.cancelled.load(Ordering::Acquire);
    let available = PROJECTS.try_lock().is_ok();
    entry.state.lock().unwrap().snapshot.active = false;
    entry.changed.notify_all();
    closing.join().unwrap().unwrap();
    assert!(cancelled && available);
    assert!(!PROJECTS.lock().unwrap().contains_key(&key));
    work.close().unwrap();
}

#[test]
#[ignore = "requires JAVA_PROJECT_TEST_JAVA and installed Gradle"]
fn live_gradle_model_uses_selected_java_and_preserves_sources() {
    let work = TestWorkspace::new("java_project_gradle");
    let root = work.join("project 中文 spaces");
    fs::create_dir_all(root.join("source/main")).unwrap();
    fs::write(root.join("source/main/Sample.java"), "class Sample {}").unwrap();
    fs::write(root.join("settings.gradle"), "rootProject.name='sample'").unwrap();
    let build = "plugins { id 'java' }\nsourceSets.main.java.srcDirs=['source/main','source/generated']\ntasks.named('jar') { destinationDirectory=file('jars'); archiveFileName='sample.jar' }\njava { sourceCompatibility=JavaVersion.VERSION_17; targetCompatibility=JavaVersion.VERSION_17 }";
    fs::write(root.join("build.gradle"), build).unwrap();
    let entry = fixture(work.as_path());
    let snapshot = JavaProjectSnapshot {
        mod_root: io::forward_slash_path(&fs::canonicalize(&root).unwrap()),
        java_path: Some(env::var("JAVA_PROJECT_TEST_JAVA").unwrap()),
        target: DEFAULT_LANGUAGE.into(),
        ..Default::default()
    };
    let model = gradle::synchronize(&entry, &snapshot, false, false)
        .unwrap()
        .unwrap();
    assert_eq!(model.projects.len(), 1);
    assert_eq!(model.projects[0].sources.len(), 2);
    assert!(model.projects[0].artifacts[0].ends_with("sample.jar"));
    assert_eq!(model.projects[0].target, "17");
    assert_eq!(
        fs::read_to_string(root.join("build.gradle")).unwrap(),
        build
    );
    let built = gradle::run_task(&entry, &snapshot, false, &[":jar".into()], &[]).unwrap();
    assert_eq!(built.projects[0].artifacts.len(), 1, "{built:?}");
    assert!(!built.inputs_changed);
    assert!(root.join("jars/sample.jar").is_file());
    fs::create_dir(root.join("assets")).unwrap();
    fs::write(root.join("assets/value.txt"), "before").unwrap();
    fs::write(root.join("build.gradle"),format!("{build}\nsourceSets.main.resources.srcDirs=['assets']\ntasks.named('jar') {{ doLast {{ file('assets/value.txt').text='after' }} }}")).unwrap();
    assert!(
        gradle::run_task(&entry, &snapshot, false, &[":jar".into()], &[])
            .unwrap()
            .inputs_changed
    );
    assert_eq!(
        fs::read_to_string(root.join("assets/value.txt")).unwrap(),
        "after"
    );
    fs::write(
        root.join("build.gradle"),
        build.replace("VERSION_17", "VERSION_21"),
    )
    .unwrap();
    assert!(
        gradle::synchronize(&entry, &snapshot, false, false)
            .unwrap_err()
            .code()
            == "java_project.execution"
    );
    fs::write(root.join("build.gradle"), build).unwrap();
    fs::write(
        root.join("source/main/Sample.java"),
        "class Sample { Missing value; }",
    )
    .unwrap();
    assert_eq!(
        gradle::run_task(&entry, &snapshot, false, &[":jar".into()], &[])
            .unwrap_err()
            .code(),
        "java_project.execution"
    );
    let output = process::tail(&tasks::log(&entry).unwrap()).unwrap();
    assert!(
        process::locations(&output).iter().any(|location| location
            .path
            .as_ref()
            .is_some_and(|path| path.contains("中文"))),
        "{output}"
    );
    fs::write(root.join("source/main/Sample.java"), "class Sample {}").unwrap();
    fs::remove_file(root.join("build.gradle")).unwrap();
    fs::write(root.join("build.gradle.kts"), "plugins { java }\njava { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }\nsourceSets.main { java.setSrcDirs(listOf(\"source/main\", \"generated\")) }").unwrap();
    assert_eq!(
        gradle::synchronize(&entry, &snapshot, false, false)
            .unwrap()
            .unwrap()
            .projects[0]
            .sources
            .len(),
        2
    );
    fs::remove_file(root.join("build.gradle.kts")).unwrap();
    fs::write(
        root.join("settings.gradle"),
        "rootProject.name='sample'; include 'one','two'",
    )
    .unwrap();
    fs::write(root.join("build.gradle"), "").unwrap();
    for name in ["one", "two"] {
        fs::create_dir_all(root.join(name).join("src/main/java")).unwrap();
        fs::write(
            root.join(name).join("src/main/java/Sample.java"),
            "class Sample {}",
        )
        .unwrap();
        fs::write(root.join(name).join("build.gradle"),"plugins { id 'java' }; java {sourceCompatibility=JavaVersion.VERSION_17;targetCompatibility=JavaVersion.VERSION_17}").unwrap();
    }
    let multi = gradle::synchronize(&entry, &snapshot, false, false)
        .unwrap()
        .unwrap();
    assert_eq!(
        multi
            .projects
            .iter()
            .map(|project| project.path.as_str())
            .collect::<Vec<_>>(),
        [":one", ":two"]
    );
    fs::create_dir_all(root.join("gradle/wrapper")).unwrap();
    fs::write(root.join("gradlew.bat"), "@echo off\r\nexit /b 0\r\n").unwrap();
    fs::write(
        root.join("gradle/wrapper/gradle-wrapper.properties"),
        "distributionUrl=https\\://example.invalid/gradle-pyxis-missing-bin.zip\n",
    )
    .unwrap();
    assert_eq!(
        gradle::synchronize(&entry, &snapshot, false, false)
            .unwrap_err()
            .code(),
        "java_project.wrapper_download"
    );
    let mut detection = snapshot;
    detection.mode = "gradle".into();
    assert_eq!(
        gradle::synchronize(&entry, &detection, true, true)
            .unwrap_err()
            .code(),
        "java_project.gradle_invalid"
    );
    assert!(
        !fs::read_dir(entry.file.parent().unwrap())
            .unwrap()
            .any(|entry| entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .starts_with("sync-"))
    );
    work.close().unwrap();
}

#[test]
#[ignore = "requires JAVA_PROJECT_TEST_JAVA"]
fn live_gradle_runs_non_java_projects_tasks_and_arguments() {
    let work = TestWorkspace::new("gradle_generic_tasks");
    let root = work.join("project");
    fs::create_dir_all(root.join("child")).unwrap();
    fs::write(
        root.join("settings.gradle"),
        "rootProject.name='sample'; include 'child'",
    )
    .unwrap();
    fs::write(root.join("build.gradle"), "tasks.register('writeNote') { description='Write a note'; outputs.file('note.txt'); doLast { file('note.txt').text=providers.gradleProperty('note').get() } }").unwrap();
    fs::write(root.join("child/build.gradle"), "tasks.register('checkNote') { group='verification'; description='Check a note'; doLast { assert rootProject.file('note.txt').text == providers.gradleProperty('note').get() } }").unwrap();
    let entry = fixture(work.as_path());
    let snapshot = JavaProjectSnapshot {
        mod_root: io::forward_slash_path(&root),
        java_path: Some(env::var("JAVA_PROJECT_TEST_JAVA").unwrap()),
        target: DEFAULT_LANGUAGE.into(),
        ..Default::default()
    };
    let model = gradle::synchronize(&entry, &snapshot, false, false)
        .unwrap()
        .unwrap();
    assert!(model.projects.is_empty());
    let note = model
        .tasks
        .iter()
        .find(|task| task.path == ":writeNote")
        .unwrap();
    assert_eq!(note.description.as_deref(), Some("Write a note"));
    assert!(note.group.is_none());
    assert!(model.tasks.iter().any(
        |task| task.path == ":child:checkNote" && task.group.as_deref() == Some("verification")
    ));
    let result = gradle::run_task(
        &entry,
        &snapshot,
        false,
        &[":writeNote".into(), ":child:checkNote".into()],
        &["-Pnote=sample value".into()],
    )
    .unwrap();
    assert_eq!(
        fs::read_to_string(root.join("note.txt")).unwrap(),
        "sample value"
    );
    assert!(result.outputs.iter().any(|path| path.ends_with("note.txt")));
    assert!(gradle::run_task(&entry, &snapshot, false, &[":absent".into()], &[]).is_err());
    assert!(
        process::tail(&tasks::log(&entry).unwrap())
            .unwrap()
            .contains("absent")
    );
    work.close().unwrap();
}

#[test]
#[ignore = "requires JAVA_PROJECT_TEST_JAVA"]
fn live_manual_jar_contains_only_classes_at_target_17_and_preserves_errors() {
    let work = TestWorkspace::new("java_manual_build");
    let root = work.join("project 中文 spaces");
    for directory in ["first", "second", "output", "failure"] {
        fs::create_dir_all(root.join(directory)).unwrap();
    }
    fs::write(
        root.join("first/Entry.java"),
        "public class Entry { Helper value; }",
    )
    .unwrap();
    fs::write(root.join("second/Helper.java"), "class Helper {}").unwrap();
    fs::write(root.join("second/resource.txt"), "resource").unwrap();
    let entry = fixture(work.as_path());
    let java = PathBuf::from(env::var("JAVA_PROJECT_TEST_JAVA").unwrap());
    let snapshot = JavaProjectSnapshot {
        mod_root: io::forward_slash_path(&root),
        sources: vec![
            io::forward_slash_path(&root.join("first")),
            io::forward_slash_path(&root.join("second")),
        ],
        java_path: Some(java.to_string_lossy().into()),
        target: DEFAULT_LANGUAGE.into(),
        game_jars: vec!["jars/sample.jar".into()],
        primary_jar: Some("jars/sample.jar".into()),
        ..Default::default()
    };
    let files = inputs::source_files(&snapshot.sources).unwrap();
    let jar = build::manual(
        &entry,
        &snapshot,
        &root.join("output"),
        &root.join("build.log"),
        &[],
        &files,
    )
    .unwrap();
    let bin = java.parent().unwrap();
    let listing = Command::new(bin.join("jar.exe"))
        .args(["tf", &jar])
        .output()
        .unwrap();
    assert!(listing.status.success());
    let listing = String::from_utf8(listing.stdout).unwrap();
    assert!(listing.contains("Entry.class") && listing.contains("Helper.class"));
    assert!(!listing.contains(".java") && !listing.contains("resource.txt"));
    let detail = Command::new(bin.join("javap.exe"))
        .args(JAVA_ENCODING.map(|option| format!("-J{option}")))
        .args(["-verbose", "-classpath", &jar, "Entry"])
        .output()
        .unwrap();
    assert!(detail.status.success());
    assert!(
        String::from_utf8(detail.stdout)
            .unwrap()
            .contains("major version: 61")
    );
    let successful = fs::read(&jar).unwrap();
    fs::write(
        root.join("first/Entry.java"),
        "public class Entry { Missing value; }",
    )
    .unwrap();
    assert_eq!(
        build::manual(
            &entry,
            &snapshot,
            &root.join("failure"),
            &root.join("failure.log"),
            &[],
            &files
        )
        .unwrap_err()
        .code(),
        "java_project.execution"
    );
    assert!(
        process::tail(&root.join("failure.log"))
            .unwrap()
            .contains("Missing")
    );
    assert_eq!(fs::read(&jar).unwrap(), successful);
    assert!(!root.join("output/classes").exists());
    work.close().unwrap();
}
