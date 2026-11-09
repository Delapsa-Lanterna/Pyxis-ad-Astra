use crate::model::{Manifest, Package};
use crate::paths::relative;
use crate::{Result, invalid};
use reqwest::redirect::Policy;
use reqwest::{Url, blocking::Client};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::Duration;
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
    if relative(version)?.components().count() != 1 || protocol != 2 || java != 17 {
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
    compatible(version, 2, 17)?;
    let directory = root.join(version);
    if directory.join("engine.json").exists() {
        inspect(&directory).map(Some)
    } else {
        Ok(None)
    }
}

/// Installs a pinned archive into a version directory after all checks complete.
pub fn import(root: &Path, archive: &Path, package: &Package) -> Result<PathBuf> {
    compatible(&package.version, package.protocol, package.java)?;
    let (root, _lock) = installation_lock(root, &package.version)?;
    import_locked(&root, archive, package)
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

fn import_locked(root: &Path, archive: &Path, package: &Package) -> Result<PathBuf> {
    matches_file(archive, package.bytes, &package.sha256)?;
    let destination = root.join(&package.version);
    if destination.exists() {
        if destination.join("engine.json").exists() {
            let installed = inspect(&destination)?;
            if installed != package.manifest() {
                return Err(invalid("Installed dependencies differ from pinned catalog"));
            }
            return Ok(destination);
        }
        clear_staging(root, &destination)?;
    }
    let staging = root.join(format!("{}.staging", package.version));
    clear_staging(root, &staging)?;
    let mut owns_staging = false;
    let result = (|| {
        fs::create_dir(&staging)?;
        owns_staging = true;
        let mut zip = ZipArchive::new(File::open(archive)?)?;
        let mut names = BTreeSet::new();
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index)?;
            let entry_name = entry.name()?.into_owned();
            let name = entry_name.trim_end_matches('/');
            let path = relative(name)?;
            if !names.insert(name.to_lowercase()) {
                return Err(invalid("Duplicate archive entry"));
            }
            if entry
                .unix_mode()
                .is_some_and(|mode| mode & 0o170000 == 0o120000)
            {
                return Err(invalid("Archive links are unsupported"));
            }
            let target = staging.join(path);
            if entry.is_dir() {
                fs::create_dir_all(target)?;
            } else {
                fs::create_dir_all(target.parent().expect("package file has a parent"))?;
                let mut output = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(target)?;
                io::copy(&mut entry, &mut output)?;
                output.sync_all()?;
            }
        }
        let manifest = inspect(&staging)?;
        if manifest != package.manifest() {
            return Err(invalid("Archive identity differs from download catalog"));
        }
        // Windows requires the archive handle to be released before publishing its directory.
        drop(zip);
        publish(&staging, &destination)?;
        Ok(destination)
    })();
    if owns_staging {
        clear_staging(root, &staging)?;
    }
    result
}

/// Downloads pinned Maven artifacts directly; the application owns the catalog and Java host.
pub fn install(root: &Path, package: &Package) -> Result<PathBuf> {
    compatible(&package.version, package.protocol, package.java)?;
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(180))
        .redirect(Policy::limited(5))
        .build()?;
    let (root, _lock) = installation_lock(root, &package.version)?;
    let destination = root.join(&package.version);
    if let Some(installed) = status(&root, &package.version)? {
        if installed != package.manifest() {
            return Err(invalid("Installed dependencies differ from pinned catalog"));
        }
        return Ok(destination);
    }
    clear_staging(&root, &destination)?;
    let staging = root.join(format!("{}.staging", package.version));
    clear_staging(&root, &staging)?;
    fs::create_dir(&staging)?;
    let result = (|| {
        for artifact in &package.artifacts {
            let url = Url::parse(&artifact.url).map_err(|error| invalid(error.to_string()))?;
            let loopback = matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "[::1]"));
            if url.scheme() != "https" && !(url.scheme() == "http" && loopback) {
                return Err(invalid("Downloads require HTTPS or a loopback test server"));
            }
            let target = staging.join(relative(&artifact.path)?);
            fs::create_dir_all(target.parent().expect("artifact has an owned parent"))?;
            let mut response = client.get(url).send()?.error_for_status()?;
            let mut output = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&target)?;
            io::copy(&mut response, &mut output)?;
            output.sync_all()?;
            drop(output);
            matches_file(&target, artifact.bytes, &artifact.sha256)?;
        }
        serde_json::to_writer(
            File::create(staging.join("engine.json"))?,
            &package.manifest(),
        )?;
        inspect(&staging)?;
        publish(&staging, &destination)?;
        Ok(destination)
    })();
    clear_staging(&root, &staging)?;
    result
}

/// Removes an explicitly selected, complete installed version.
pub fn remove(root: &Path, version: &str) -> Result<()> {
    compatible(version, 2, 17)?;
    let directory = root.canonicalize()?.join(version);
    inspect(&directory)?;
    fs::remove_dir_all(directory)?;
    Ok(())
}
