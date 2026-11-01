use super::super::session::{lock_ready_session, session_handle};
use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, forward_slash_path, read_text_bytes_no_bom};
use crate::models::{
    ModDirectory, ModFileEntry, ModFileKind, ModFileSearch, ModTextFileTarget,
    decode_starsector_text,
};
use chrono::{DateTime, Utc};
use std::collections::BTreeMap;
use std::fs;
use std::fs::Metadata;
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::path::Path;
use walkdir::WalkDir;

fn session_boundary(session_id: &str) -> AppResult<FsRootBoundary> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    FsRootBoundary::new(Path::new(&session.manifest.mod_root), "mod root")
}
pub fn query_mod_directory(session_id: &str, directory: Option<&str>) -> AppResult<ModDirectory> {
    let boundary = session_boundary(session_id)?;
    read_directory(&boundary, directory)
}
fn read_directory(boundary: &FsRootBoundary, directory: Option<&str>) -> AppResult<ModDirectory> {
    let path = directory
        .map(|rel| boundary.resolve_relative(rel, "mod directory"))
        .transpose()?
        .unwrap_or_else(|| boundary.root().to_path_buf());
    let children = fs::read_dir(&path).map_err(|error| {
        AppError::context(format!("读取目录失败 ({})", path.display()), error.into()).at_path(&path)
    })?;
    let mut entries = Vec::new();
    for child in children {
        let child = child.map_err(|error| {
            AppError::context(
                format!("读取目录条目失败 ({})", path.display()),
                error.into(),
            )
            .at_path(&path)
        })?;
        let target = child.path();
        entries.push(describe_entry(boundary, &target)?);
    }
    Ok(ModDirectory {
        directory: directory.map(str::to_owned),
        entries,
    })
}
fn describe_entry(boundary: &FsRootBoundary, target: &Path) -> AppResult<ModFileEntry> {
    let metadata = fs::symlink_metadata(target).map_err(|error| {
        AppError::context(format!("读取条目失败 ({})", target.display()), error.into())
            .at_path(target)
    })?;
    let kind = if metadata.file_type().is_symlink() || is_reparse_point(&metadata) {
        ModFileKind::Restricted
    } else if metadata.is_dir() {
        ModFileKind::Directory
    } else if metadata.is_file() {
        ModFileKind::File
    } else {
        ModFileKind::Restricted
    };
    Ok(ModFileEntry {
        name: target
            .file_name()
            .expect("directory child has a name")
            .to_string_lossy()
            .into_owned(),
        rel_path: forward_slash_path(
            target
                .strip_prefix(boundary.root())
                .expect("enumerated entry belongs to root"),
        ),
        kind,
        size_bytes: (kind == ModFileKind::File).then_some(metadata.len()),
        modified_at: metadata
            .modified()
            .ok()
            .map(|time| DateTime::<Utc>::from(time).timestamp_millis()),
    })
}
pub fn query_mod_file_search(session_id: &str, query: &str) -> AppResult<ModFileSearch> {
    search_files(&session_boundary(session_id)?, query)
}
fn search_files(boundary: &FsRootBoundary, query: &str) -> AppResult<ModFileSearch> {
    let query = query.trim().to_owned();
    let needle = query.to_lowercase();
    let mut walker = WalkDir::new(boundary.root())
        .min_depth(1)
        .follow_links(false)
        .into_iter();
    let mut directories = BTreeMap::<String, ModFileEntry>::new();
    let mut entries = BTreeMap::<String, ModFileEntry>::new();
    let mut matched_paths = Vec::new();
    while let Some(next) = walker.next() {
        let next = next.map_err(|error| {
            let path = error.path().unwrap_or(boundary.root()).to_path_buf();
            AppError::message(
                "io.walk_failed",
                format!("搜索目录失败 ({}): {error}", path.display()),
            )
            .at_path(path)
        })?;
        let entry = describe_entry(boundary, next.path())?;
        if entry.kind == ModFileKind::Restricted && next.file_type().is_dir() {
            walker.skip_current_dir();
        }
        if entry.kind == ModFileKind::Directory {
            directories.insert(entry.rel_path.clone(), entry.clone());
        }
        if entry.name.to_lowercase().contains(&needle) {
            matched_paths.push(entry.rel_path.clone());
            let mut parent = Path::new(&entry.rel_path).parent();
            while let Some(path) = parent.filter(|path| !path.as_os_str().is_empty()) {
                let key = forward_slash_path(path);
                entries
                    .entry(key.clone())
                    .or_insert_with(|| directories[&key].clone());
                parent = path.parent();
            }
            entries.insert(entry.rel_path.clone(), entry);
        }
    }
    Ok(ModFileSearch {
        query,
        entries: entries.into_values().collect(),
        matched_paths,
    })
}
#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    metadata.file_attributes() & 0x400 != 0
}
#[cfg(not(windows))]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}
pub fn query_mod_text_file_target(
    session_id: &str,
    rel_path: &str,
) -> AppResult<Option<ModTextFileTarget>> {
    let boundary = session_boundary(session_id)?;
    let target = boundary.resolve_relative(rel_path, "mod file")?;
    if !is_text_file(&target)? {
        return Ok(None);
    }
    Ok(Some(ModTextFileTarget {
        session_id: session_id.into(),
        mod_root: forward_slash_path(boundary.root()),
        path: forward_slash_path(&target),
    }))
}
fn is_text_file(path: &Path) -> AppResult<bool> {
    let bytes = read_text_bytes_no_bom(path)?;
    if binary_content(&bytes) {
        return Ok(false);
    }
    decode_starsector_text(&bytes).map_err(|offset| {
        AppError::message(
            "text.invalid_utf8",
            format!("{} is not valid UTF-8 at byte {offset}", path.display()),
        )
        .at_path(path)
    })?;
    Ok(true)
}
fn binary_content(bytes: &[u8]) -> bool {
    const HEADERS: &[&[u8]] = &[
        b"\x89PNG\r\n\x1a\n",
        b"\xff\xd8\xff",
        b"GIF87a",
        b"GIF89a",
        b"BM",
        b"DDS ",
        b"RIFF",
        b"OggS",
        b"fLaC",
        b"ID3",
        b"PK\x03\x04",
        b"PK\x05\x06",
        b"PK\x07\x08",
        b"\x1f\x8b",
        b"7z\xbc\xaf\x27\x1c",
        b"Rar!\x1a\x07",
        b"MZ",
        b"\xca\xfe\xba\xbe",
    ];
    HEADERS.iter().any(|header| bytes.starts_with(header))
        || bytes
            .windows(2)
            .take(1)
            .any(|pair| pair[0] == 0xff && pair[1] & 0xe0 == 0xe0)
        || bytes.iter().any(|byte| {
            *byte == 0x7f || (*byte < 0x20 && !matches!(byte, b'\t' | b'\n' | b'\r' | 0x0c))
        })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::services::file_editor;
    #[cfg(test)]
    use crate::services::project::performance::PerformanceTrace;
    #[cfg(test)]
    use crate::services::project::session;
    use crate::services::project::test_support::project_workspace;
    use crate::test_support::TestWorkspace;
    #[cfg(test)]
    use encoding_rs::GB18030;

    #[test]
    fn lists_direct_children_hidden_files_and_empty_directories() {
        let root = project_workspace("mod_file_browser_list");
        fs::create_dir_all(root.join("data/nested")).unwrap();
        fs::write(root.join(".hidden"), b"hidden").unwrap();
        fs::write(root.join("data/deep.txt"), b"text").unwrap();
        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let list = read_directory(&boundary, None).unwrap();
        assert_eq!(list.entries.len(), 2);
        assert!(
            list.entries
                .iter()
                .any(|entry| entry.name == ".hidden" && entry.kind == ModFileKind::File)
        );
        assert!(
            list.entries
                .iter()
                .any(|entry| entry.rel_path == "data" && entry.kind == ModFileKind::Directory)
        );
        assert!(
            read_directory(&boundary, Some("data/nested"))
                .unwrap()
                .entries
                .is_empty()
        );
        assert!(read_directory(&boundary, Some("../outside")).is_err());
        root.close().unwrap();
    }
    #[test]
    fn content_detection_preserves_text_formats_and_reports_actual_encoding_path() {
        let root = project_workspace("mod_file_browser_content");
        for (name, bytes) in [
            ("README", b"hello".as_slice()),
            ("empty", b"".as_slice()),
            ("custom.ext", "中文\n\t".as_bytes()),
            ("bom", b"\xef\xbb\xbftext".as_slice()),
            ("punctuation", b"\x91word\x92".as_slice()),
        ] {
            let path = root.join(name);
            fs::write(&path, bytes).unwrap();
            assert!(is_text_file(&path).unwrap());
        }
        for bytes in [
            b"ID3example".as_slice(),
            b"PK\x03\x04archive".as_slice(),
            b"MZexample".as_slice(),
            b"abc\0def".as_slice(),
            b"abc\x1bdef".as_slice(),
            b"abc\x7fdef".as_slice(),
        ] {
            let path = root.join("renamed.txt");
            fs::write(&path, bytes).unwrap();
            assert!(!is_text_file(&path).unwrap());
        }
        let path = root.join("gbk.txt");
        let (encoded, _, _) = GB18030.encode("中文");
        fs::write(&path, encoded).unwrap();
        let error = is_text_file(&path).unwrap_err();
        assert_eq!(error.code(), "text.invalid_utf8");
        assert_eq!(
            error.location().unwrap().path.as_deref(),
            Some(path.to_str().unwrap())
        );
        root.close().unwrap();
    }
    #[test]
    fn exposes_links_as_restricted_without_following_them() {
        let (root, _outside, link) =
            TestWorkspace::directory_link("mod_browser_link", "linked").unwrap();
        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let list = read_directory(&boundary, None).unwrap();
        assert!(
            list.entries
                .iter()
                .any(|entry| entry.name == "linked" && entry.kind == ModFileKind::Restricted)
        );
        assert!(read_directory(&boundary, Some("linked")).is_err());
        assert!(
            boundary
                .resolve_relative("linked/file.txt", "mod file")
                .is_err()
        );
        let _ = link;
        root.close().unwrap();
    }
    #[test]
    fn every_registered_binary_header_is_classified_before_decoding() {
        for bytes in [
            b"\x89PNG\r\n\x1a\n".as_slice(),
            b"\xff\xd8\xff",
            b"GIF89a",
            b"BM",
            b"DDS ",
            b"RIFF",
            b"OggS",
            b"fLaC",
            b"ID3",
            b"PK\x03\x04",
            b"\x1f\x8b",
            b"7z\xbc\xaf\x27\x1c",
            b"Rar!\x1a\x07",
            b"MZ",
            b"\xca\xfe\xba\xbe",
            b"\xff\xfb",
        ] {
            assert!(binary_content(bytes));
        }
    }

    #[test]
    fn public_queries_bind_targets_to_session_and_reject_released_or_external_paths() {
        let root = project_workspace("mod_browser_session");
        fs::write(root.join("README"), "中文").unwrap();
        fs::write(root.join("archive.jar"), b"PK\x03\x04").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = session::open_project_session_traced(&root, None, &mut trace).unwrap();
        let entries = query_mod_directory(&manifest.session_id, None).unwrap();
        assert_eq!(entries.entries.len(), 2);
        let target = query_mod_text_file_target(&manifest.session_id, "README")
            .unwrap()
            .unwrap();
        assert_eq!(target.session_id, manifest.session_id);
        assert_eq!(
            target.mod_root,
            forward_slash_path(FsRootBoundary::new(&root, "mod root").unwrap().root())
        );
        let loaded = file_editor::load_project_editable_file(
            Some(&target.session_id),
            &target.mod_root,
            target.path.clone(),
        )
        .unwrap();
        assert_eq!(loaded.text, "中文");
        assert!(
            query_mod_text_file_target(&manifest.session_id, "archive.jar")
                .unwrap()
                .is_none()
        );
        assert!(query_mod_text_file_target(&manifest.session_id, "../external.txt").is_err());
        assert!(query_mod_directory(&manifest.session_id, Some("../external")).is_err());
        session::close_project_session(manifest.session_id.clone()).unwrap();
        assert_eq!(
            query_mod_directory(&manifest.session_id, None)
                .unwrap_err()
                .code(),
            "session.unknown"
        );
        assert_eq!(
            query_mod_text_file_target(&manifest.session_id, "README")
                .unwrap_err()
                .code(),
            "session.unknown"
        );
        root.close().unwrap();
    }

    #[test]
    fn search_returns_unopened_matches_with_ancestors_and_metadata() {
        let root = project_workspace("mod_file_search_metadata");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("匹配目录")).unwrap();
        fs::write(root.join("data/hulls/测试.SHIP"), "中文").unwrap();
        fs::write(root.join("data/hulls/skip.txt"), "skip").unwrap();
        fs::write(root.join("empty.txt"), []).unwrap();
        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let result = search_files(&boundary, "  测试  ").unwrap();
        assert_eq!(result.query, "测试");
        assert_eq!(result.matched_paths, vec!["data/hulls/测试.SHIP"]);
        assert_eq!(
            result
                .entries
                .iter()
                .map(|entry| entry.rel_path.as_str())
                .collect::<Vec<_>>(),
            vec!["data", "data/hulls", "data/hulls/测试.SHIP"]
        );
        assert_eq!(result.entries[2].size_bytes, Some("中文".len() as u64));
        assert!(result.entries[2].modified_at.is_some());
        assert_eq!(result.entries[0].size_bytes, None);
        assert_eq!(
            search_files(&boundary, "ship").unwrap().matched_paths,
            vec!["data/hulls/测试.SHIP"]
        );
        assert_eq!(
            search_files(&boundary, "匹配").unwrap().matched_paths,
            vec!["匹配目录"]
        );
        assert!(
            search_files(&boundary, "unknown")
                .unwrap()
                .entries
                .is_empty()
        );
        let list = read_directory(&boundary, None).unwrap();
        assert_eq!(
            list.entries
                .iter()
                .find(|entry| entry.name == "empty.txt")
                .unwrap()
                .size_bytes,
            Some(0)
        );
        root.close().unwrap();
    }
    #[test]
    fn recursive_search_displays_links_and_keeps_their_targets_outside_its_traversal() {
        let (root, outside, _link) =
            TestWorkspace::directory_link("mod_search_links", "linked").unwrap();
        fs::write(outside.join("secret.txt"), "secret").unwrap();
        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        assert!(
            search_files(&boundary, "secret")
                .unwrap()
                .entries
                .is_empty()
        );
        assert_eq!(
            search_files(&boundary, "linked").unwrap().entries[0].kind,
            ModFileKind::Restricted
        );
        root.close().unwrap();
    }
}
