use crate::errors::{AppError, AppResult};
use std::fs;
use std::fs::Metadata;
#[cfg(windows)]
use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone)]
pub struct FsRootBoundary {
    root: PathBuf,
}

impl FsRootBoundary {
    pub fn new(root: &Path, label: &str) -> AppResult<Self> {
        validate_safe_absolute_path(root, label)?;
        reject_existing_path_links(root, label)?;
        let root = root.canonicalize().map_err(|error| {
            AppError::context(
                format!("canonicalize {label} path failed ({})", root.display()),
                error.into(),
            )
            .at_path(root)
        })?;
        if !root.is_dir() {
            return Err(AppError::message(
                "path.not_directory",
                format!("{label} path is not a directory: {}", root.display()),
            ));
        }
        Ok(Self { root })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn resolve_relative(&self, rel_path: &str, label: &str) -> AppResult<PathBuf> {
        let rel_path = validate_safe_relative_path(Path::new(rel_path), label)?;
        self.resolve_absolute(&self.root.join(rel_path), label)
    }

    pub fn resolve_absolute(&self, path: &Path, label: &str) -> AppResult<PathBuf> {
        let target = canonical_path(path, label)?;
        self.require_target(&target, path, label)?;
        Ok(target)
    }

    pub fn resolve_relative_target(&self, rel_path: &str, label: &str) -> AppResult<PathBuf> {
        let rel_path = validate_safe_relative_path(Path::new(rel_path), label)?;
        self.resolve_absolute_target(&self.root.join(rel_path), label)
    }

    pub fn resolve_absolute_target(&self, path: &Path, label: &str) -> AppResult<PathBuf> {
        let resolved = self.resolve_absolute(path, label)?;
        if path.exists() {
            let requested = path.file_name().expect("write target has a name");
            let actual = resolved.file_name().expect("resolved target has a name");
            if requested.to_string_lossy().to_lowercase() == actual.to_string_lossy().to_lowercase()
            {
                return Ok(resolved.with_file_name(requested));
            }
        }
        Ok(resolved)
    }

    pub fn resolve_changed_path_to_relative(
        &self,
        changed_path: &str,
        label: &str,
    ) -> AppResult<Option<String>> {
        let path = Path::new(changed_path);
        if path.is_absolute() {
            return self.resolve_absolute_change_to_relative(path, label);
        }
        let rel_path = validate_safe_relative_path(path, label)?;
        let target = self.resolve_relative(&forward_slash_path(rel_path), label)?;
        Ok(Some(forward_slash_relative_path(&self.root, &target)))
    }

    fn resolve_absolute_change_to_relative(
        &self,
        path: &Path,
        label: &str,
    ) -> AppResult<Option<String>> {
        let target = canonical_path(path, label)?;
        if !path_belongs_to_root(&target, &self.root) {
            return Ok(None);
        }
        let rel = target.strip_prefix(&self.root).map_err(|error| {
            AppError::message(
                "path.outside_root",
                format!("{label} path is outside root: {} ({error})", path.display()),
            )
        })?;
        Ok(Some(forward_slash_path(rel)))
    }

    fn require_target(&self, target: &Path, path: &Path, label: &str) -> AppResult<()> {
        if !path_belongs_to_root(target, &self.root) {
            return Err(AppError::message(
                "path.outside_root",
                format!("{label} path is outside root: {}", path.display()),
            ));
        }
        Ok(())
    }
}

pub fn canonical_path(path: &Path, label: &str) -> AppResult<PathBuf> {
    validate_safe_absolute_path(path, label)?;
    reject_existing_path_links(path, label)?;
    let existing = nearest_existing_path(path).ok_or_else(|| {
        AppError::message(
            "path.no_existing_parent",
            format!("{label} path has no existing parent: {}", path.display()),
        )
    })?;
    let canonical = existing.canonicalize().map_err(|error| {
        AppError::context(
            format!("canonicalize {label} path failed ({})", existing.display()),
            error.into(),
        )
        .at_path(path)
    })?;
    if existing == path {
        Ok(canonical)
    } else {
        Ok(canonical.join(
            path.strip_prefix(&existing)
                .expect("nearest existing path is an ancestor"),
        ))
    }
}

pub fn validate_walk_entry(path: &Path, label: &str) -> AppResult<()> {
    reject_link_path(path, label)
}

pub fn validate_safe_absolute_path<'a>(path: &'a Path, label: &str) -> AppResult<&'a Path> {
    if !path.is_absolute() || path_uses_parent_dir(path) {
        return Err(AppError::message(
            "path.invalid_absolute",
            format!("invalid {label} path: {}", path.display()),
        ));
    }
    Ok(path)
}

pub fn validate_safe_relative_path<'a>(path: &'a Path, label: &str) -> AppResult<&'a Path> {
    let mut components = path.components().peekable();
    if components.peek().is_none()
        || components.any(|part| !matches!(part, Component::Normal(_)))
        || !path
            .to_string_lossy()
            .split(['/', '\\'])
            .all(|part| !part.is_empty() && part != "." && part != "..")
    {
        return Err(AppError::message(
            "path.invalid_relative",
            format!("invalid {label} path: {}", path.display()),
        ));
    }
    Ok(path)
}

pub fn path_uses_parent_dir(path: &Path) -> bool {
    path.components()
        .any(|part| matches!(part, Component::ParentDir))
}

pub fn path_belongs_to_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

/// Normalize a path to a forward-slash string key, independent of platform
/// separator; all persisted and wire path strings flow through this form.
pub fn forward_slash_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

/// `forward_slash_path` after stripping `root`, falling back to the full path
/// when it is not underneath `root`.
pub fn forward_slash_relative_path(root: &Path, path: &Path) -> String {
    forward_slash_path(path.strip_prefix(root).unwrap_or(path))
}

fn nearest_existing_path(path: &Path) -> Option<PathBuf> {
    path.ancestors()
        .find(|candidate| candidate.exists())
        .map(Path::to_path_buf)
}

fn reject_existing_path_links(path: &Path, label: &str) -> AppResult<()> {
    for ancestor in path.ancestors() {
        if ancestor.exists() {
            reject_link_path(ancestor, label)?;
        }
    }
    Ok(())
}

fn reject_link_path(path: &Path, label: &str) -> AppResult<()> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        AppError::context(
            format!("读取 {label} 路径元数据失败 ({})", path.display()),
            error.into(),
        )
        .at_path(path)
    })?;
    let file_type = metadata.file_type();
    if file_type.is_symlink() || is_reparse_point(&metadata) {
        return Err(AppError::message(
            "path.link_rejected",
            format!(
                "{label} path uses a link or reparse point: {}",
                path.display()
            ),
        ));
    }
    Ok(())
}

#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

pub fn relative_path_contains(scope: &str, target: &str) -> bool {
    scope.is_empty() || scope == target || target.starts_with(&format!("{scope}/"))
}

#[cfg(test)]
mod tests {
    use super::FsRootBoundary;
    #[cfg(windows)]
    #[cfg(test)]
    use crate::io::paths::canonical_path;
    use crate::io::write_utf8_no_bom;
    use crate::test_support::TestWorkspace;
    #[cfg(windows)]
    #[cfg(test)]
    use crate::{io, test_support};
    use std::fs;

    #[test]
    fn identity_and_requested_target_share_expanded_parent() {
        let root = TestWorkspace::new("path_identity_target");
        fs::create_dir_all(root.join("nested")).unwrap();
        let original = root.join("nested/Original.ship");
        write_utf8_no_bom(&original, "{}").unwrap();
        let boundary = FsRootBoundary::new(&root, "test root").unwrap();
        assert_eq!(
            boundary.resolve_absolute(&original, "source").unwrap(),
            original.canonicalize().unwrap()
        );
        assert_eq!(
            boundary
                .resolve_relative("nested/new/deep/new.ship", "missing")
                .unwrap(),
            boundary.root().join("nested/new/deep/new.ship")
        );
        assert_eq!(
            boundary
                .resolve_relative_target("nested/original.ship", "rename")
                .unwrap(),
            boundary.root().join("nested/original.ship")
        );
        assert_eq!(
            boundary
                .resolve_relative("nested/Original.ship", "source")
                .unwrap(),
            original.canonicalize().unwrap()
        );
        fs::remove_file(&original).unwrap();
        assert_eq!(
            boundary.resolve_absolute(&original, "deleted").unwrap(),
            boundary.root().join("nested/Original.ship")
        );
        root.close().unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn short_aliases_expand_files_parents_and_versions() {
        let root = TestWorkspace::new("expanded_path_identity");
        fs::create_dir_all(root.join("Long directory name")).unwrap();
        let path = root.join("Long directory name/Long weapon filename.wpn");
        write_utf8_no_bom(&path, "{}").unwrap();
        let short = test_support::short_path(&path);
        assert_ne!(short, path);
        let boundary = FsRootBoundary::new(&test_support::short_path(&root), "test root").unwrap();
        let expanded = path.canonicalize().unwrap();
        assert_eq!(boundary.resolve_absolute(&short, "file").unwrap(), expanded);
        assert_eq!(
            boundary
                .resolve_absolute_target(&short, "target alias")
                .unwrap(),
            expanded
        );
        assert_eq!(canonical_path(&short, "file").unwrap(), expanded);
        assert_eq!(
            io::file_version(&short).unwrap().path,
            expanded.to_string_lossy()
        );
        let missing = test_support::short_path(path.parent().unwrap()).join("new/deep/new.wpn");
        assert_eq!(
            boundary.resolve_absolute(&missing, "missing").unwrap(),
            path.parent()
                .unwrap()
                .canonicalize()
                .unwrap()
                .join("new/deep/new.wpn")
        );
        assert_eq!(
            boundary
                .resolve_changed_path_to_relative(&short.to_string_lossy(), "changed")
                .unwrap(),
            Some("Long directory name/Long weapon filename.wpn".into())
        );
        root.close().unwrap();
    }

    #[test]
    fn changed_path_resolves_project_relative_path() {
        let root = TestWorkspace::new("changed_path_relative");
        fs::create_dir_all(root.join("data/hulls")).unwrap();

        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let rel = boundary
            .resolve_changed_path_to_relative("data/hulls/demo.ship", "changed path")
            .unwrap();

        assert_eq!(rel, Some("data/hulls/demo.ship".to_string()));
        root.close().unwrap();
    }

    #[test]
    fn changed_path_resolves_project_absolute_path() {
        let root = TestWorkspace::new("changed_path_absolute");
        let target = root.join("data/hulls/demo.ship");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        write_utf8_no_bom(&target, "{}").unwrap();

        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let rel = boundary
            .resolve_changed_path_to_relative(&target.to_string_lossy(), "changed path")
            .unwrap();

        assert_eq!(rel, Some("data/hulls/demo.ship".to_string()));
        root.close().unwrap();
    }

    #[test]
    fn changed_path_resolves_deleted_project_absolute_path() {
        let root = TestWorkspace::new("changed_path_deleted_absolute");
        let target = root.join("data/hulls/deleted.ship");
        fs::create_dir_all(target.parent().unwrap()).unwrap();

        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let rel = boundary
            .resolve_changed_path_to_relative(&target.to_string_lossy(), "changed path")
            .unwrap();

        assert_eq!(rel, Some("data/hulls/deleted.ship".to_string()));
        root.close().unwrap();
    }

    #[test]
    fn changed_path_ignores_external_absolute_path() {
        let root = TestWorkspace::new("changed_path_external_root");
        let external = TestWorkspace::new("changed_path_external_other");
        let target = external.join("data/hulls/demo.ship");
        fs::create_dir_all(target.parent().unwrap()).unwrap();
        write_utf8_no_bom(&target, "{}").unwrap();

        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let rel = boundary
            .resolve_changed_path_to_relative(&target.to_string_lossy(), "changed path")
            .unwrap();

        assert_eq!(rel, None);
        external.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn changed_path_rejects_parent_dir_path() {
        let root = TestWorkspace::new("changed_path_parent_dir");
        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();

        let error = boundary
            .resolve_changed_path_to_relative("data/hulls/../weapons/demo.wpn", "changed path")
            .unwrap_err()
            .to_string();

        assert!(error.contains("invalid changed path path"));
        root.close().unwrap();
    }

    #[test]
    fn changed_path_rejects_link_parent_escape() {
        let (root, _outside, link) =
            TestWorkspace::directory_link("changed_path_link_parent", "data/link").unwrap();
        let target = link.join("outside.ship");

        let boundary = FsRootBoundary::new(&root, "mod root").unwrap();
        let result =
            boundary.resolve_changed_path_to_relative(&target.to_string_lossy(), "changed path");

        assert!(result.is_err());
        root.close().unwrap();
    }
}
