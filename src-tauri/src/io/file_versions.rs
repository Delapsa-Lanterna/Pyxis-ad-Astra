use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
    models::FileVersion,
};
use base64::{Engine as _, engine::general_purpose};
use std::path::Path;

pub fn file_version(path: &Path) -> AppResult<FileVersion> {
    let canonical = super::canonical_path(path, "versioned file")?;
    version_from_path(&canonical, &[], &[])
}

pub(crate) fn directory_version_from_files(
    path: &Path,
    versions: &[FileVersion],
) -> AppResult<FileVersion> {
    let canonical = super::canonical_path(path, "versioned directory")?;
    version_from_path(&canonical, &[], versions)
}

fn version_from_path(
    path: &Path,
    recreated: &[(std::path::PathBuf, String)],
    known: &[FileVersion],
) -> AppResult<FileVersion> {
    let fingerprint = if path.is_file() {
        let bytes = std::fs::read(path)?;
        #[cfg(test)]
        super::csv_files::record_csv_disk_read(path);
        Some(fingerprint(&bytes))
    } else if path.is_dir() {
        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(path) {
            let entry =
                entry.map_err(|error| AppError::message("io.walk_failed", error.to_string()))?;
            crate::io::validate_walk_entry(entry.path(), "versioned directory")?;
            if entry.file_type().is_file() {
                files.push((
                    crate::io::forward_slash_path(
                        entry
                            .path()
                            .strip_prefix(path)
                            .expect("walk entry belongs to root"),
                    ),
                    {
                        if let Some(version) = known
                            .iter()
                            .find(|version| Path::new(&version.path) == entry.path())
                        {
                            version
                                .fingerprint
                                .clone()
                                .expect("existing source has a fingerprint")
                        } else {
                            let bytes = std::fs::read(entry.path())?;
                            #[cfg(test)]
                            super::csv_files::record_csv_disk_read(entry.path());
                            fingerprint(&bytes)
                        }
                    },
                ));
            }
        }
        for (missing, fingerprint) in recreated {
            if let Ok(relative) = missing.strip_prefix(path) {
                files.push((crate::io::forward_slash_path(relative), fingerprint.clone()));
            }
        }
        Some(directory_fingerprint(files)?)
    } else {
        None
    };
    Ok(FileVersion {
        path: path.to_string_lossy().to_string(),
        fingerprint,
    })
}

pub fn version_after_change(change: &crate::models::FileChangeRecord) -> AppResult<FileVersion> {
    let content = if !change.after_exists {
        None
    } else {
        Some(match change.kind {
            crate::models::FileChangeKind::File => fingerprint(&snapshot_bytes(
                change.after_text.as_deref(),
                change.after_data_base64.as_deref(),
            )?),
            crate::models::FileChangeKind::Directory => {
                let files = change
                    .after_files
                    .iter()
                    .map(|file| {
                        Ok((
                            file.rel_path.replace('\\', "/"),
                            fingerprint(&snapshot_bytes(
                                file.text.as_deref(),
                                file.data_base64.as_deref(),
                            )?),
                        ))
                    })
                    .collect::<AppResult<Vec<_>>>()?;
                directory_fingerprint(files)?
            }
        })
    };
    Ok(FileVersion {
        path: change.after_path.clone(),
        fingerprint: content,
    })
}

fn snapshot_bytes(text: Option<&str>, binary: Option<&str>) -> AppResult<Vec<u8>> {
    if let Some(text) = text {
        return Ok(text.as_bytes().to_vec());
    }
    general_purpose::STANDARD
        .decode(binary.expect("applied snapshot has content"))
        .map_err(|error| AppError::message("changeset.invalid_data", error.to_string()))
}

pub(crate) fn fingerprint(bytes: &[u8]) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in bytes {
        hash = (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3);
    }
    format!("{}:{hash:016x}", bytes.len())
}

pub(crate) fn directory_fingerprint(mut files: Vec<(String, String)>) -> AppResult<String> {
    files.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(fingerprint(&serde_json::to_vec(&files)?))
}

pub fn read_versioned_bytes(path: &Path) -> AppResult<(FileVersion, Vec<u8>)> {
    let path = super::canonical_path(path, "source file")?;
    read_authorized_bytes(&path)
}

pub(crate) fn read_authorized_bytes(path: &Path) -> AppResult<(FileVersion, Vec<u8>)> {
    let bytes = std::fs::read(path).map_err(|error| {
        AppError::context(
            format!("读取文本文件失败 ({})", path.display()),
            error.into(),
        )
        .at_path(path)
    })?;
    #[cfg(test)]
    super::csv_files::record_csv_disk_read(path);
    let version = FileVersion {
        path: path.to_string_lossy().to_string(),
        fingerprint: Some(fingerprint(&bytes)),
    };
    Ok((version, bytes))
}

pub fn verify_versions(root: &str, versions: &[FileVersion]) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(root), "version root")?;
    let mut recreated = Vec::new();
    for version in versions {
        if let Some(fingerprint) = &version.fingerprint
            && super::source_recreation_allowed(root, &version.path)
            && !Path::new(&version.path)
                .try_exists()
                .map_err(|error| AppError::from(error).at_path(&version.path))?
        {
            recreated.push((
                boundary.resolve_absolute(Path::new(&version.path), "confirmed source")?,
                fingerprint.clone(),
            ));
        }
    }
    for expected in versions {
        let path = boundary.resolve_absolute(Path::new(&expected.path), "versioned file")?;
        let current = version_from_path(&path, &recreated, &[])?;
        if current.fingerprint.is_none() && super::source_recreation_allowed(root, &expected.path) {
            continue;
        }
        if current.fingerprint != expected.fingerprint {
            return Err(AppError::message(
                "write.version_conflict",
                format!("文件已被修改，请载入外部版本后重新保存: {}", path.display()),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use crate::test_support::TestWorkspace;
    #[test]
    #[cfg(windows)]
    fn alias_reads_return_long_path_credentials_and_keep_conflicts() {
        let root = TestWorkspace::new("version_alias_identity");
        let path = root.join("Long version filename.txt");
        std::fs::write(&path, "before").unwrap();
        let version = super::file_version(&crate::test_support::short_path(&path)).unwrap();
        super::verify_versions(
            &crate::test_support::short_path(&root).to_string_lossy(),
            std::slice::from_ref(&version),
        )
        .unwrap();
        assert_eq!(version.path, path.canonicalize().unwrap().to_string_lossy());
        std::fs::write(&path, "external").unwrap();
        assert_eq!(
            super::verify_versions(&root.to_string_lossy(), &[version])
                .unwrap_err()
                .code(),
            "write.version_conflict"
        );
        let missing = crate::test_support::short_path(&root).join("nested/new.txt");
        let version = super::file_version(&missing).unwrap();
        assert_eq!(
            version.path,
            root.canonicalize()
                .unwrap()
                .join("nested/new.txt")
                .to_string_lossy()
        );
        assert!(version.fingerprint.is_none());
        root.close().unwrap();
    }
}
