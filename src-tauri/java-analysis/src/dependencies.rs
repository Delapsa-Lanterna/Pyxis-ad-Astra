use crate::package::{Artifact, Manifest, Package};
use crate::paths::relative;
use crate::transfer::{TransferControl, TransferProgress};
use crate::versions::{PROTOCOL_VERSION, REQUIRED_JAVA};
use crate::{Result, invalid};
use reqwest::redirect::Policy;
use reqwest::{Client, Url};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::ErrorKind;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::runtime::Builder;
use zip::ZipArchive;
fn digest<R: Read>(reader: &mut R) -> Result<(u64, String)> {
    let mut hash = Sha256::new();
    let mut bytes = 0;
    let mut buffer = [0u8; 65536];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        bytes += count as u64;
        hash.update(&buffer[..count]);
    }
    Ok((bytes, format!("{:x}", hash.finalize())))
}

pub(crate) fn matches_file(path: &Path, bytes: u64, hash: &str) -> Result<()> {
    let (actual_bytes, actual_hash) = digest(&mut File::open(path)?)?;
    if actual_bytes != bytes || actual_hash != hash {
        return Err(invalid(format!(
            "Package checksum mismatch: {}",
            path.display()
        )));
    }
    Ok(())
}

pub(crate) fn compatible(version: &str, protocol: u32, java: u32) -> Result<()> {
    if relative(version)?.components().count() != 1
        || protocol != PROTOCOL_VERSION
        || java != REQUIRED_JAVA
    {
        return Err(invalid(
            "Unsupported engine version, protocol or Java requirement",
        ));
    }
    Ok(())
}

/// Reads an installed package and verifies the complete declared file inventory.
pub fn inspect(directory: &Path) -> Result<Manifest> {
    let directory_type = fs::symlink_metadata(directory)?.file_type();
    let manifest_type = fs::symlink_metadata(directory.join("engine.json"))?.file_type();
    if !directory_type.is_dir()
        || directory_type.is_symlink()
        || !manifest_type.is_file()
        || manifest_type.is_symlink()
    {
        return Err(invalid(
            "Package root and manifest must be regular filesystem entries",
        ));
    }
    let manifest: Manifest = serde_json::from_reader(File::open(directory.join("engine.json"))?)?;
    compatible(&manifest.version, manifest.protocol, manifest.java)?;
    let mut listed = BTreeSet::new();
    for entry in &manifest.files {
        let path = relative(&entry.path)?;
        if !listed.insert(entry.path.to_lowercase()) || entry.path == "engine.json" {
            return Err(invalid("Duplicate package file"));
        }
        let full = directory.join(path);
        let metadata = fs::symlink_metadata(&full)?;
        if !metadata.is_file() || metadata.file_type().is_symlink() {
            return Err(invalid("Package entries must be regular files"));
        }
        matches_file(&full, entry.bytes, &entry.sha256)?;
    }
    for required in &manifest.bundles {
        relative(required)?;
        if !listed.contains(&required.to_lowercase()) {
            return Err(invalid(format!("Unlisted engine entry: {required}")));
        }
    }
    fn inventory(root: &Path, current: &Path, found: &mut BTreeSet<String>) -> Result<()> {
        for entry in fs::read_dir(current)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_dir() {
                inventory(root, &entry.path(), found)?;
            } else if kind.is_file() {
                let key = entry
                    .path()
                    .strip_prefix(root)
                    .expect("inventory stays inside root")
                    .to_string_lossy()
                    .replace('\\', "/")
                    .to_lowercase();
                if key != "engine.json" {
                    found.insert(key);
                }
            } else {
                return Err(invalid("Unsupported installed file type"));
            }
        }
        Ok(())
    }
    let mut actual = BTreeSet::new();
    inventory(directory, directory, &mut actual)?;
    if actual != listed {
        return Err(invalid("Installed file inventory differs from manifest"));
    }
    Ok(manifest)
}

/// Returns a verified installed manifest for an explicitly selected version.
pub fn status(root: &Path, version: &str) -> Result<Option<Manifest>> {
    compatible(version, PROTOCOL_VERSION, REQUIRED_JAVA)?;
    let directory = root.join(version);
    if directory.join("engine.json").exists() {
        inspect(&directory).map(Some)
    } else {
        Ok(None)
    }
}

/// Installs a pinned archive into a version directory after all checks complete.
pub fn import(root: &Path, archive: &Path, package: &Package) -> Result<PathBuf> {
    import_with_control(root, archive, package, &TransferControl::default())
}

fn installation_lock(root: &Path, version: &str) -> Result<(PathBuf, File)> {
    fs::create_dir_all(root)?;
    let root = root.canonicalize()?;
    let lock = OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(format!("{version}.lock")))?;
    lock.try_lock()
        .map_err(|error| invalid(format!("Installation is already owned: {error}")))?;
    Ok((root, lock))
}

fn clear_staging(root: &Path, staging: &Path) -> Result<()> {
    if staging.exists() {
        let kind = fs::symlink_metadata(staging)?.file_type();
        if !kind.is_dir() || kind.is_symlink() || staging.canonicalize()?.parent() != Some(root) {
            return Err(invalid("Staging directory escapes its installation root"));
        }
        fs::remove_dir_all(staging)?;
    }
    Ok(())
}

fn publish(staging: &Path, destination: &Path) -> Result<()> {
    fs::create_dir(destination)?;
    fn copy_tree(source: &Path, destination: &Path) -> Result<()> {
        for entry in fs::read_dir(source)? {
            let entry = entry?;
            if entry.file_name() == "engine.json" {
                continue;
            }
            let target = destination.join(entry.file_name());
            if entry.file_type()?.is_dir() {
                fs::create_dir(&target)?;
                copy_tree(&entry.path(), &target)?;
            } else {
                fs::copy(entry.path(), target)?;
            }
        }
        Ok(())
    }
    copy_tree(staging, destination)?;
    // The manifest is the completion marker; file scanners may retain staging directory handles.
    let manifest = fs::read(staging.join("engine.json"))?;
    let mut marker = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination.join("engine.json"))?;
    marker.write_all(&manifest)?;
    marker.sync_all()?;
    Ok(())
}

/// Imports the pinned ZIP through the same verified staging and publication used by downloads.
pub fn import_with_control(
    root: &Path,
    archive: &Path,
    package: &Package,
    control: &TransferControl,
) -> Result<PathBuf> {
    compatible(&package.version, package.protocol, package.java)?;
    let (root, _lock) = installation_lock(root, &package.version)?;
    import_controlled(&root, archive, package, control)
}

fn valid_file(path: &Path, bytes: u64, hash: &str) -> Result<bool> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => {
            Ok(matches_file(path, bytes, hash).is_ok())
        }
        Ok(_) => Err(invalid("Dependency entry must be a regular file")),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

fn staging(root: &Path, package: &Package) -> Result<PathBuf> {
    let directory = root.join(format!("{}.staging", package.version));
    if directory.exists() {
        let metadata = fs::symlink_metadata(&directory)?;
        if !metadata.is_dir()
            || metadata.file_type().is_symlink()
            || directory.canonicalize()?.parent() != Some(root)
        {
            return Err(invalid("Staging directory escapes its installation root"));
        }
    } else {
        fs::create_dir(&directory)?;
    }
    let allowed: BTreeSet<_> = package
        .artifacts
        .iter()
        .flat_map(|file| [file.path.clone(), format!("{}.part", file.path)])
        .chain(["engine.json".to_string()])
        .collect();
    fn prune(root: &Path, current: &Path, allowed: &BTreeSet<String>) -> Result<()> {
        for entry in fs::read_dir(current)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            if kind.is_symlink() {
                return Err(invalid("Staged links are unsupported"));
            }
            if kind.is_dir() {
                prune(root, &entry.path(), allowed)?;
            } else if !allowed.contains(
                &entry
                    .path()
                    .strip_prefix(root)
                    .expect("staging child")
                    .to_string_lossy()
                    .replace('\\', "/"),
            ) {
                fs::remove_file(entry.path())?;
            }
        }
        Ok(())
    }
    prune(&directory, &directory, &allowed)?;
    Ok(directory)
}

fn reuse(root: &Path, stage: &Path, artifact: &Artifact) -> Result<bool> {
    let path = relative(&artifact.path)?;
    let target = stage.join(&path);
    if valid_file(&target, artifact.bytes, &artifact.sha256)? {
        return Ok(true);
    }
    let installed = root.join(&path);
    if valid_file(&installed, artifact.bytes, &artifact.sha256)? {
        fs::create_dir_all(target.parent().expect("artifact parent"))?;
        fs::copy(installed, target)?;
        return Ok(true);
    }
    Ok(false)
}

fn publish_verified(
    root: &Path,
    stage: &Path,
    package: &Package,
    control: &TransferControl,
) -> Result<PathBuf> {
    control.check()?;
    for artifact in &package.artifacts {
        let part = stage.join(format!("{}.part", artifact.path));
        if part.exists() {
            fs::remove_file(part)?;
        }
    }
    serde_json::to_writer(
        File::create(stage.join("engine.json"))?,
        &package.manifest(),
    )?;
    inspect(stage)?;
    control.check()?;
    let destination = root.join(&package.version);
    clear_staging(root, &destination)?;
    publish(stage, &destination)?;
    clear_staging(root, stage)?;
    Ok(destination)
}

fn import_controlled(
    root: &Path,
    archive: &Path,
    package: &Package,
    control: &TransferControl,
) -> Result<PathBuf> {
    control.check()?;
    matches_file(archive, package.bytes, &package.sha256)?;
    let destination = root.join(&package.version);
    let mut zip = ZipArchive::new(File::open(archive)?)?;
    let mut names = BTreeSet::new();
    // Validate the entire inventory before extracting any caller-controlled entry.
    for index in 0..zip.len() {
        let entry = zip.by_index(index)?;
        let name = entry.name()?.trim_end_matches('/').to_string();
        relative(&name)?;
        if !names.insert(name.to_lowercase()) {
            return Err(invalid("Duplicate archive entry"));
        }
        if entry
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err(invalid("Archive links are unsupported"));
        }
        if !entry.is_dir()
            && name != "engine.json"
            && !package
                .artifacts
                .iter()
                .any(|artifact| artifact.path == name)
        {
            return Err(invalid("Unlisted archive entry"));
        }
    }
    let manifest: Manifest = serde_json::from_reader(zip.by_name("engine.json")?)?;
    if manifest != package.manifest() {
        return Err(invalid("Archive identity differs from download catalog"));
    }
    if let Ok(Some(installed)) = status(root, &package.version)
        && installed == manifest
    {
        return Ok(destination);
    }
    let stage = staging(root, package)?;
    let mut completed = 0;
    for (index, artifact) in package.artifacts.iter().enumerate() {
        control.check()?;
        if !reuse(&destination, &stage, artifact)? {
            let mut entry = zip.by_name(&artifact.path)?;
            let target = stage.join(relative(&artifact.path)?);
            fs::create_dir_all(target.parent().expect("artifact parent"))?;
            let part = stage.join(format!("{}.part", artifact.path));
            let mut file = File::create(&part)?;
            let mut buffer = [0u8; 65536];
            loop {
                control.check()?;
                let count = entry.read(&mut buffer)?;
                if count == 0 {
                    break;
                }
                file.write_all(&buffer[..count])?;
                control.progress(TransferProgress {
                    phase: "importing",
                    completed_bytes: completed + file.metadata()?.len(),
                    total_bytes: package.artifacts.iter().map(|file| file.bytes).sum(),
                    files_done: index,
                    files_total: package.artifacts.len(),
                });
            }
            file.sync_all()?;
            drop(file);
            matches_file(&part, artifact.bytes, &artifact.sha256)?;
            if target.exists() {
                fs::remove_file(&target)?;
            }
            fs::rename(&part, &target)?;
        }
        completed += artifact.bytes;
    }
    drop(zip);
    publish_verified(root, &stage, package, control)
}

/// Downloads the fixed catalog, preserving verified files for retry.
pub fn install(root: &Path, package: &Package) -> Result<PathBuf> {
    install_with_control(root, package, &TransferControl::default())
}

pub fn install_with_control(
    root: &Path,
    package: &Package,
    control: &TransferControl,
) -> Result<PathBuf> {
    compatible(&package.version, package.protocol, package.java)?;
    let (root, _lock) = installation_lock(root, &package.version)?;
    if let Ok(Some(installed)) = status(&root, &package.version)
        && installed == package.manifest()
    {
        return Ok(root.join(&package.version));
    }
    let stage = staging(&root, package)?;
    let destination = root.join(&package.version);
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .redirect(Policy::limited(5))
        .build()?;
    let runtime = Builder::new_current_thread().enable_all().build()?;
    runtime.block_on(async {
        let mut completed = 0;
        let total = package
            .artifacts
            .iter()
            .map(|artifact| artifact.bytes)
            .sum();
        for (index, artifact) in package.artifacts.iter().enumerate() {
            control.check()?;
            control.progress(TransferProgress {
                phase: "checking",
                completed_bytes: completed,
                total_bytes: total,
                files_done: index,
                files_total: package.artifacts.len(),
            });
            if !reuse(&destination, &stage, artifact)? {
                let url = Url::parse(&artifact.url).map_err(|error| invalid(error.to_string()))?;
                let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
                if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
                    return Err(invalid("Downloads require HTTPS or loopback"));
                }
                let mut response = control
                    .network(client.get(url).send())
                    .await?
                    .error_for_status()?;
                let target = stage.join(relative(&artifact.path)?);
                fs::create_dir_all(target.parent().expect("artifact parent"))?;
                let part = stage.join(format!("{}.part", artifact.path));
                let mut output = File::create(&part)?;
                let mut received = 0;
                while let Some(bytes) = control.network(response.chunk()).await? {
                    received += bytes.len() as u64;
                    if received > artifact.bytes {
                        return Err(invalid("Download exceeds catalog size"));
                    }
                    output.write_all(&bytes)?;
                    control.progress(TransferProgress {
                        phase: "downloading",
                        completed_bytes: completed + received,
                        total_bytes: total,
                        files_done: index,
                        files_total: package.artifacts.len(),
                    });
                }
                output.sync_all()?;
                drop(output);
                matches_file(&part, artifact.bytes, &artifact.sha256)?;
                if target.exists() {
                    fs::remove_file(&target)?;
                }
                fs::rename(part, target)?;
            }
            completed += artifact.bytes;
        }
        control.progress(TransferProgress {
            phase: "checking",
            completed_bytes: completed,
            total_bytes: total,
            files_done: package.artifacts.len(),
            files_total: package.artifacts.len(),
        });
        publish_verified(&root, &stage, package, control)
    })
}

/// Removes the selected installation and its staging under the same installation lock.
pub fn remove(root: &Path, version: &str) -> Result<()> {
    compatible(version, PROTOCOL_VERSION, REQUIRED_JAVA)?;
    if !root.exists() {
        return Ok(());
    }
    let (root, _lock) = installation_lock(root, version)?;
    clear_staging(&root, &root.join(version))?;
    clear_staging(&root, &root.join(format!("{version}.staging")))?;
    Ok(())
}
