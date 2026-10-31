use super::*;
use std::{collections::BTreeSet, time::Instant};

#[test]
fn concurrent_workspaces_preserve_names_and_contents() {
    let started = Instant::now();
    let workers = (0..8)
        .map(|worker| {
            std::thread::spawn(move || {
                (0..32)
                    .map(|index| {
                        let root = TestWorkspace::new("same_name");
                        fs::write(root.join("notes.txt"), format!("{worker}-{index}")).unwrap();
                        (root, format!("{worker}-{index}"))
                    })
                    .collect::<Vec<_>>()
            })
        })
        .collect::<Vec<_>>();
    let workspaces = workers
        .into_iter()
        .flat_map(|worker| worker.join().unwrap())
        .collect::<Vec<_>>();
    let paths = workspaces
        .iter()
        .map(|(root, _)| root.outer().to_path_buf())
        .collect::<BTreeSet<_>>();
    assert_eq!(paths.len(), 256);
    for (root, text) in workspaces {
        assert_eq!(fs::read_to_string(root.join("notes.txt")).unwrap(), text);
        root.close().unwrap();
    }
    assert!(paths.iter().all(|path| !path.exists()));
    println!(
        "TEST_WORKSPACE_TIMING samples=256 milliseconds={:.3}",
        started.elapsed().as_secs_f64() * 1000.0
    );
    let file = TestWorkspace::file("notes.txt");
    assert_eq!(file.file_name().unwrap(), "notes.txt");
    fs::write(&file, "exact filename").unwrap();
    file.close().unwrap();
}

#[test]
fn renamed_and_missing_business_roots_are_owned_by_the_outer_directory() {
    let root = TestWorkspace::new("rename");
    let outer = root.outer().to_path_buf();
    fs::write(root.join("before.txt"), "content").unwrap();
    let renamed = outer.join("moved");
    fs::rename(&root, &renamed).unwrap();
    root.close().unwrap();
    assert!(!outer.exists());
    let root = TestWorkspace::new("missing");
    let outer = root.outer().to_path_buf();
    fs::remove_dir(&root).unwrap();
    root.close().unwrap();
    assert!(!outer.exists());
}

#[test]
#[cfg(windows)]
fn cleanup_reports_locked_file_and_continues_other_files() {
    use std::os::windows::fs::OpenOptionsExt;
    let root = TestWorkspace::new("locked_cleanup");
    let first = root.join("locked.txt");
    fs::write(&first, "held").unwrap();
    fs::write(root.join("other.txt"), "other").unwrap();
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&first)
        .unwrap();
    let errors = remove_test_tree(root.as_path());
    assert!(errors.iter().any(|error| error.contains("locked.txt")));
    assert!(!root.join("other.txt").exists());
    drop(held);
    root.close().unwrap();
}

#[test]
fn separate_processes_get_independent_workspaces() {
    let name = "test_support::tests::workspace_child";
    let mut children = (0..2)
        .map(|_| {
            std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", name, "--ignored", "--nocapture"])
                .stdout(std::process::Stdio::piped())
                .spawn()
                .unwrap()
        })
        .collect::<Vec<_>>();
    let mut paths = BTreeSet::new();
    for child in children.drain(..) {
        let output = child.wait_with_output().unwrap();
        assert!(output.status.success());
        for line in String::from_utf8(output.stdout)
            .unwrap()
            .lines()
            .filter_map(|line| line.strip_prefix("WORKSPACE_CHILD "))
        {
            let path = PathBuf::from(line);
            assert!(paths.insert(path.clone()));
            assert!(!path.exists());
        }
    }
    assert_eq!(paths.len(), 64);
}

#[test]
fn failure_cleanup_and_retention_preserve_the_original_error() {
    for mode in ["cleanup", "retain", "locked"] {
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "test_support::tests::workspace_failure_child",
                "--ignored",
                "--nocapture",
            ])
            .env("PYXIS_FAILURE_MODE", mode)
            .env_remove("PYXIS_TEST_REPORTS")
            .env_remove("PYXIS_KEEP_FAILED");
        if mode == "retain" {
            command.env("PYXIS_KEEP_FAILED", "1");
        }
        let output = command.output().unwrap();
        assert!(!output.status.success());
        let stdout = String::from_utf8(output.stdout).unwrap();
        let stderr = String::from_utf8(output.stderr).unwrap();
        assert!(stderr.contains("original controlled failure"));
        let root = PathBuf::from(
            stdout
                .lines()
                .find_map(|line| line.strip_prefix("FAILURE_WORKSPACE "))
                .unwrap(),
        );
        if mode == "cleanup" {
            assert!(!root.exists());
        } else {
            assert!(root.exists());
            if mode == "retain" {
                assert_eq!(
                    fs::read_to_string(root.join("root/notes.txt")).unwrap(),
                    "evidence"
                );
                assert!(stderr.contains("TEST_WORKSPACE_RETAINED"));
            } else {
                assert!(stderr.contains("locked.txt"));
                assert!(stderr.contains("TEST_WORKSPACE_RESULT"));
            }
            assert!(remove_test_tree(&root).is_empty());
        }
    }
}

#[test]
#[ignore = "test workspace failure subprocess fixture"]
fn workspace_failure_child() {
    let mode = std::env::var("PYXIS_FAILURE_MODE").unwrap();
    let root = TestWorkspace::new("failure_child");
    println!("FAILURE_WORKSPACE {}", root.outer().display());
    fs::write(root.join("notes.txt"), "evidence").unwrap();
    #[cfg(windows)]
    if mode == "locked" {
        use std::os::windows::fs::OpenOptionsExt;
        let path = root.join("locked.txt");
        fs::write(&path, "held").unwrap();
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        std::mem::forget(held);
    }
    #[cfg(not(windows))]
    assert_ne!(mode, "locked", "locked fixture requires Windows");
    panic!("original controlled failure");
}

#[test]
#[ignore = "test workspace subprocess fixture"]
fn workspace_child() {
    let parent = std::env::var_os("PYXIS_TEST_ROOT")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir);
    let occupied = parent.join(format!(
        "pyxis_test_{}_0_process_same_name",
        std::process::id()
    ));
    fs::create_dir(&occupied).unwrap();
    fs::write(occupied.join("sentinel.txt"), "existing contents").unwrap();
    let workspaces = (0..32)
        .map(|_| TestWorkspace::new("process_same_name"))
        .collect::<Vec<_>>();
    for root in workspaces {
        println!("WORKSPACE_CHILD {}", root.outer().display());
        root.close().unwrap();
    }
    assert_eq!(
        fs::read_to_string(occupied.join("sentinel.txt")).unwrap(),
        "existing contents"
    );
    assert!(remove_test_tree(&occupied).is_empty());
}

#[test]
#[ignore = "filesystem capability probe"]
fn workspace_capabilities() {
    let directory_link = TestWorkspace::directory_link("directory_link_probe", "link")
        .map(|(root, _, _)| root.close().unwrap())
        .map_err(|error| error.to_string());
    let file_link = TestWorkspace::file_link("file_link_probe", "link")
        .map(|(root, _, _)| root.close().unwrap())
        .map_err(|error| error.to_string());
    #[cfg(windows)]
    let short = {
        let root = TestWorkspace::new("actual_short_name_probe");
        let result = try_short_path(&root)
            .map(|short| {
                crate::models::windows_path_key(&short.to_string_lossy())
                    != crate::models::windows_path_key(
                        &root.canonicalize().unwrap().to_string_lossy(),
                    )
            })
            .and_then(|different| {
                if different {
                    Ok(())
                } else {
                    Err(std::io::Error::other("no actual short alias"))
                }
            })
            .map_err(|error| error.to_string());
        root.close().unwrap();
        result
    };
    #[cfg(not(windows))]
    let short: Result<(), String> = Err("Windows short names are unavailable".into());
    #[cfg(windows)]
    let junction = TestWorkspace::try_junction("junction_probe", "link")
        .map(|(root, _, _)| root.close().unwrap())
        .map_err(|error| error.to_string());
    #[cfg(not(windows))]
    let junction: Result<(), String> = Err("Windows junctions are unavailable".into());
    println!(
        "TEST_CAPABILITIES {}",
        serde_json::json!({
            "directory_link":directory_link.err(), "file_link":file_link.err(), "short":short.err(), "junction":junction.err()
        })
    );
}

#[test]
fn ordinary_paths_preserve_unicode_spaces_and_missing_parents() {
    let root = TestWorkspace::new("path_shapes");
    let directory = root.join("中文 directory");
    fs::create_dir(&directory).unwrap();
    let first = directory.join("Notes.txt");
    fs::write(&first, "content").unwrap();
    let next = directory.join("notes.txt");
    fs::rename(&first, &next).unwrap();
    assert_eq!(fs::read_to_string(&next).unwrap(), "content");
    assert!(!directory.join("missing/notes.txt").exists());
    root.close().unwrap();
}
