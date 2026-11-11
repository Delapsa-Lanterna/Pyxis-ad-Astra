use pyxis_java_analysis::dependencies::{import, inspect, remove};
use pyxis_java_analysis::versions::PROTOCOL_VERSION;
use pyxis_java_analysis::{Artifact, Builtin, Engine, Manifest, Package, PackageFile};
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::Path;
use zip::CompressionMethod;
use zip::ZipWriter;
use zip::write::SimpleFileOptions;

mod support;
use support::TestWorkspace;

fn archive(path: &Path, entries: &[(&str, &[u8])]) -> Package {
    let mut output = ZipWriter::new(File::create(path).unwrap());
    for (name, bytes) in entries {
        output
            .start_file(
                *name,
                SimpleFileOptions::default().compression_method(CompressionMethod::Deflated),
            )
            .unwrap();
        output.write_all(bytes).unwrap();
    }
    output.finish().unwrap();
    let bytes = fs::read(path).unwrap();
    Package {
        version: "1.0.0".into(),
        protocol: PROTOCOL_VERSION,
        java: 17,
        artifacts: vec![Artifact {
            path: "dependency.jar".into(),
            url: "https://example.invalid/dependency.jar".into(),
            bytes: 18,
            sha256: format!("{:x}", Sha256::digest(b"fixture-dependency")),
        }],
        bundles: vec!["dependency.jar".into()],
        bytes: bytes.len() as u64,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}

fn valid_archive(path: &Path) -> Package {
    let launcher = b"fixture-dependency";
    let manifest = Manifest {
        version: "1.0.0".into(),
        protocol: PROTOCOL_VERSION,
        java: 17,
        bundles: vec!["dependency.jar".into()],
        files: vec![PackageFile {
            path: "dependency.jar".into(),
            bytes: launcher.len() as u64,
            sha256: format!("{:x}", Sha256::digest(launcher)),
        }],
    };
    let json = serde_json::to_vec(&manifest).unwrap();
    archive(
        path,
        &[("engine.json", &json), ("dependency.jar", launcher)],
    )
}

#[test]
fn imports_checks_and_removes_a_complete_version() {
    let work = TestWorkspace::new();
    let path = work.0.join("engine.zip");
    let package = valid_archive(&path);
    let root = work.0.join("install 中文 spaces");
    let directory = import(&root, &path, &package).unwrap();
    assert_eq!(inspect(&directory).unwrap().version, "1.0.0");
    assert_eq!(import(&root, &path, &package).unwrap(), directory);
    remove(&root, "1.0.0").unwrap();
    assert!(!directory.exists());
    work.close();
}

#[test]
fn removes_damaged_installations_and_staging_with_the_installation_lock() {
    let work = TestWorkspace::new();
    let root = work.0.join("installation");
    remove(&root, "fixture").unwrap();
    assert!(!root.exists());
    for directory in ["fixture", "fixture.staging"] {
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::write(root.join(directory).join("partial.jar"), "incomplete").unwrap();
    }
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(root.join("fixture.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert!(remove(&root, "fixture").is_err());
    assert!(root.join("fixture/partial.jar").is_file());
    drop(lock);
    remove(&root, "fixture").unwrap();
    assert!(!root.join("fixture").exists());
    assert!(!root.join("fixture.staging").exists());
    work.close();
}

#[test]
fn rejects_bad_checksums_protocols_and_version_paths() {
    let work = TestWorkspace::new();
    let path = work.0.join("engine.zip");
    let original = valid_archive(&path);
    for mutation in [0, 1, 2] {
        let mut package = original.clone();
        match mutation {
            0 => package.sha256 = "00".repeat(32),
            1 => package.protocol = 9,
            _ => package.version = "../outside".into(),
        }
        assert!(import(&work.0.join("install"), &path, &package).is_err());
    }
    work.close();
}

#[test]
fn rejects_archive_escape_duplicate_names_and_incomplete_manifests() {
    let work = TestWorkspace::new();
    for (index, entries) in [
        vec![("../outside.txt", b"escape".as_slice())],
        vec![("File.txt", b"a".as_slice()), ("file.txt", b"b".as_slice())],
        vec![("file.txt", b"incomplete".as_slice())],
    ]
    .into_iter()
    .enumerate()
    {
        let path = work.0.join(format!("{index}.zip"));
        let package = archive(&path, &entries);
        let root = work.0.join(format!("install{index}"));
        assert!(import(&root, &path, &package).is_err());
        assert!(!root.join("1.0.0").exists());
        assert!(!root.join("1.0.0.staging").exists());
        assert!(root.join("1.0.0.lock").exists());
    }
    assert!(!work.0.join("outside.txt").exists());
    work.close();
}

#[test]
fn recovers_interrupted_staging_and_observes_live_installation_lock() {
    let work = TestWorkspace::new();
    let path = work.0.join("engine.zip");
    let package = valid_archive(&path);
    let root = work.0.join("install");
    fs::create_dir_all(root.join("1.0.0.staging")).unwrap();
    fs::write(root.join("1.0.0.staging/partial"), "partial").unwrap();
    fs::create_dir_all(root.join("1.0.0")).unwrap();
    fs::write(root.join("1.0.0/partial"), "partial").unwrap();
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("1.0.0.lock"))
        .unwrap();
    lock.try_lock().unwrap();
    assert!(import(&root, &path, &package).is_err());
    assert!(root.join("1.0.0.staging/partial").exists());
    drop(lock);
    let directory = import(&root, &path, &package).unwrap();
    assert!(inspect(&directory).is_ok());
    assert!(!root.join("1.0.0.staging").exists());
    work.close();
}

#[test]
fn verifies_installed_content_and_inventory() {
    let work = TestWorkspace::new();
    let path = work.0.join("engine.zip");
    let package = valid_archive(&path);
    let directory = import(&work.0.join("install"), &path, &package).unwrap();
    fs::write(directory.join("extra.txt"), "unexpected").unwrap();
    assert!(inspect(&directory).is_err());
    fs::remove_file(directory.join("extra.txt")).unwrap();
    fs::write(directory.join("dependency.jar"), "changed").unwrap();
    assert!(inspect(&directory).is_err());
    work.close();
}

#[test]
fn pins_builtin_host_and_dependencies_before_starting_java() {
    let work = TestWorkspace::new();
    let path = work.0.join("dependencies.zip");
    let package = valid_archive(&path);
    let directory = import(&work.0.join("install"), &path, &package).unwrap();
    let builtin = work.0.join("builtin");
    fs::create_dir(&builtin).unwrap();
    fs::write(builtin.join("host.jar"), b"host").unwrap();
    let mut host = Builtin {
        version: "1.0.0".into(),
        protocol: PROTOCOL_VERSION,
        java: 17,
        launcher: "host.jar".into(),
        bundle: "host.jar".into(),
        framework: "dependency.jar".into(),
        dependencies: inspect(&directory).unwrap(),
        files: vec![PackageFile {
            path: "host.jar".into(),
            bytes: 4,
            sha256: format!("{:x}", Sha256::digest(b"host")),
        }],
    };
    host.dependencies.version = "2.0.0".into();
    fs::write(
        builtin.join("builtin.json"),
        serde_json::to_vec(&host).unwrap(),
    )
    .unwrap();
    let error = Engine::start(
        Path::new("absent-java.exe"),
        &builtin,
        &directory,
        &work.0.join("workspace"),
        &work.0.join("engine.log"),
    );
    assert!(
        error
            .err()
            .unwrap()
            .to_string()
            .contains("built-in host lock")
    );
    host.dependencies.version = "1.0.0".into();
    fs::write(
        builtin.join("builtin.json"),
        serde_json::to_vec(&host).unwrap(),
    )
    .unwrap();
    fs::write(builtin.join("host.jar"), b"tampered").unwrap();
    let error = Engine::start(
        Path::new("absent-java.exe"),
        &builtin,
        &directory,
        &work.0.join("workspace"),
        &work.0.join("engine.log"),
    );
    assert!(
        error
            .err()
            .unwrap()
            .to_string()
            .contains("checksum mismatch")
    );
    assert!(!work.0.join("workspace").exists());
    work.close();
}
