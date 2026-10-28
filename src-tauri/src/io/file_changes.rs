use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, validate_safe_relative_path, validate_walk_entry, write_utf8_no_bom},
    models::{FileChangeKind, FileChangeRecord, FileChangeReplayDirection, FileSnapshot},
};
use base64::{Engine as _, engine::general_purpose};
use std::{
    borrow::Cow,
    cell::RefCell,
    collections::BTreeMap,
    fs,
    path::Path,
    sync::{Arc, Condvar, LazyLock, Mutex, Weak},
};
use walkdir::WalkDir;

static ROOT_WRITE_COORDINATORS: LazyLock<Mutex<BTreeMap<String, Weak<RootWriteCoordinator>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

struct RootWriteCoordinator {
    tickets: Mutex<(u64, u64)>,
    released: Condvar,
}

thread_local! {
    static ACTIVE_WRITES: RefCell<BTreeMap<String, Weak<RootWriteLease>>> = const { RefCell::new(BTreeMap::new()) };
}

struct RootWriteLease {
    root: String,
    recreated_sources: Mutex<Vec<String>>,
    coordinator: Arc<RootWriteCoordinator>,
    retry: Option<WriteRetry>,
}

type WriteRetry = Arc<dyn Fn(&AppError) -> AppResult<()> + Send + Sync>;

fn active_write_lease(root: &str) -> Option<Arc<RootWriteLease>> {
    if let Some(lease) = ACTIVE_WRITES.with(|active| {
        active
            .borrow()
            .get(&crate::models::windows_path_key(root))
            .and_then(Weak::upgrade)
    }) {
        return Some(lease);
    }
    let path = crate::io::canonical_path(Path::new(root), "active save root").ok()?;
    ACTIVE_WRITES.with(|active| {
        active
            .borrow()
            .get(&crate::models::windows_path_key(&path.to_string_lossy()))
            .and_then(Weak::upgrade)
    })
}

pub struct RootWriteLock {
    _lease: Arc<RootWriteLease>,
}

impl RootWriteLock {
    pub fn apply_changes(
        &self,
        changes: &[FileChangeRecord],
        direction: FileChangeReplayDirection,
    ) -> AppResult<()> {
        apply_transaction_changes(changes, direction, &self._lease)
    }
}

/// The existing root lease carries recovery for exactly one active write's disk steps.
pub fn with_write_retry<T>(
    root: &Path,
    retry: impl Fn(&AppError) -> AppResult<()> + Send + Sync + 'static,
    action: impl FnOnce() -> AppResult<T>,
) -> AppResult<T> {
    let _lease = acquire_root_write_lock_with_retry(root, Some(Arc::new(retry)))?;
    action()
}

/// Completed write steps stay on their stack while the owning request awaits recovery.
pub fn retry_write<T>(root: &str, mut action: impl FnMut() -> AppResult<T>) -> AppResult<T> {
    loop {
        match action() {
            Ok(value) => return Ok(value),
            Err(error) => {
                let retry = active_write_lease(root).and_then(|lease| lease.retry.clone());
                match retry {
                    Some(retry) => retry(&error)?,
                    None => return Err(error),
                }
            }
        }
    }
}

impl Drop for RootWriteLease {
    fn drop(&mut self) {
        if let Ok(mut tickets) = self.coordinator.tickets.lock() {
            tickets.1 += 1;
            self.coordinator.released.notify_all();
        }
    }
}

pub fn acquire_root_write_lock(root: &Path) -> AppResult<RootWriteLock> {
    acquire_root_write_lock_with_retry(root, None)
}

pub fn accept_source_recreation(root: &str, paths: Vec<String>) -> AppResult<()> {
    let paths = paths
        .into_iter()
        .map(|path| {
            crate::io::canonical_path(Path::new(&path), "confirmed save source")
                .map(|path| path.to_string_lossy().into_owned())
        })
        .collect::<AppResult<Vec<_>>>()?;
    let lease = active_write_lease(root).expect("source confirmation belongs to the current save");
    *lease
        .recreated_sources
        .lock()
        .map_err(|_| AppError::message("write.lock_poisoned", "保存来源登记不可用"))? = paths;
    Ok(())
}

pub fn source_recreation_allowed(root: &str, path: &str) -> bool {
    let Some(lease) = active_write_lease(root) else {
        return false;
    };
    let sources = lease
        .recreated_sources
        .lock()
        .expect("save source registration is available");
    if sources.is_empty() {
        return false;
    }
    let Ok(path) = crate::io::canonical_path(Path::new(path), "recreated save source") else {
        return false;
    };
    sources
        .iter()
        .any(|owned| same_physical_path(Path::new(owned), &path))
}

fn acquire_root_write_lock_with_retry(
    root: &Path,
    retry: Option<WriteRetry>,
) -> AppResult<RootWriteLock> {
    let canonical_root = FsRootBoundary::new(root, "write root")?
        .root()
        .to_string_lossy()
        .to_string();
    #[cfg(windows)]
    let canonical_root = canonical_root.to_lowercase();
    // Nested synchronous services share the transaction's lease.
    if let Some(lease) = ACTIVE_WRITES.with(|active| {
        active
            .borrow()
            .get(&crate::models::windows_path_key(&canonical_root))
            .and_then(Weak::upgrade)
    }) {
        return Ok(RootWriteLock { _lease: lease });
    }
    let coordinator = {
        let mut coordinators = ROOT_WRITE_COORDINATORS.lock().map_err(|_| {
            AppError::message("write.lock_poisoned", "write coordinator lock poisoned")
        })?;
        coordinators.retain(|_, coordinator| coordinator.strong_count() > 0);
        if let Some(coordinator) = coordinators.get(&canonical_root).and_then(Weak::upgrade) {
            coordinator
        } else {
            let coordinator = Arc::new(RootWriteCoordinator {
                tickets: Mutex::new((0, 0)),
                released: Condvar::new(),
            });
            coordinators.insert(canonical_root.clone(), Arc::downgrade(&coordinator));
            coordinator
        }
    };
    let mut tickets = coordinator
        .tickets
        .lock()
        .map_err(|_| AppError::message("write.lock_poisoned", "write coordinator lock poisoned"))?;
    let ticket = tickets.0;
    tickets.0 += 1;
    while tickets.1 != ticket {
        tickets = coordinator.released.wait(tickets).map_err(|_| {
            AppError::message("write.lock_poisoned", "write coordinator lock poisoned")
        })?;
    }
    drop(tickets);
    let lease = Arc::new(RootWriteLease {
        root: canonical_root.clone(),
        recreated_sources: Mutex::new(Vec::new()),
        coordinator,
        retry,
    });
    ACTIVE_WRITES.with(|active| {
        let mut active = active.borrow_mut();
        active.retain(|_, lease| lease.strong_count() > 0);
        active.insert(
            crate::models::windows_path_key(&canonical_root),
            Arc::downgrade(&lease),
        );
    });
    Ok(RootWriteLock { _lease: lease })
}

pub struct FileChangeSetBuilder {
    boundary: FsRootBoundary,
    changes: Vec<FileChangeRecord>,
    _write_lock: RootWriteLock,
}

impl FileChangeSetBuilder {
    pub fn new(root: &Path) -> AppResult<Self> {
        let boundary = FsRootBoundary::new(root, "changeset root")?;
        let write_lock = acquire_root_write_lock(boundary.root())?;
        Ok(Self {
            boundary,
            changes: Vec::new(),
            _write_lock: write_lock,
        })
    }

    pub fn new_with_lock(root: &Path, write_lock: RootWriteLock) -> AppResult<Self> {
        Ok(Self {
            boundary: FsRootBoundary::new(root, "changeset root")?,
            changes: Vec::new(),
            _write_lock: write_lock,
        })
    }

    pub fn root(&self) -> &Path {
        self.boundary.root()
    }

    pub fn text_file(
        &mut self,
        rel_path: impl AsRef<str>,
        after_text: Option<String>,
    ) -> AppResult<&mut Self> {
        self.file(rel_path, after_text, None)
    }

    pub fn file(
        &mut self,
        rel_path: impl AsRef<str>,
        after_text: Option<String>,
        after_data_base64: Option<String>,
    ) -> AppResult<&mut Self> {
        let target = self
            .boundary
            .resolve_relative(rel_path.as_ref(), "relative file")?;
        self.changes
            .push(build_file_change(&target, after_text, after_data_base64)?);
        Ok(self)
    }

    pub fn rename_text_file(
        &mut self,
        before_rel_path: &str,
        after_rel_path: &str,
        text: String,
    ) -> AppResult<&mut Self> {
        let before = self
            .boundary
            .resolve_relative(before_rel_path, "rename source")?;
        let after = self
            .boundary
            .resolve_relative_target(after_rel_path, "rename target")?;
        require_rename_target(&before, &after)?;
        let mut change = build_text_change(&before, Some(text))?;
        change.after_path = after.to_string_lossy().to_string();
        self.changes.push(change);
        Ok(self)
    }

    pub fn delete_directory(&mut self, rel_path: impl AsRef<str>) -> AppResult<&mut Self> {
        let target = self
            .boundary
            .resolve_relative(rel_path.as_ref(), "relative directory")?;
        self.changes.push(build_directory_delete_change(&target)?);
        Ok(self)
    }

    pub fn rename_directory(
        &mut self,
        source_rel_path: &str,
        target_rel_path: &str,
        after_files: Vec<FileSnapshot>,
    ) -> AppResult<&mut Self> {
        let source = self
            .boundary
            .resolve_relative(source_rel_path, "rename directory source")?;
        let target = self
            .boundary
            .resolve_relative_target(target_rel_path, "rename directory target")?;
        require_rename_target(&source, &target)?;
        let mut change = build_directory_replace_change(&source, after_files)?;
        change.after_path = target.to_string_lossy().to_string();
        self.changes.push(change);
        Ok(self)
    }

    pub fn directory_files(&self, rel_path: &str) -> AppResult<Vec<FileSnapshot>> {
        let path = self
            .boundary
            .resolve_relative(rel_path, "directory snapshot")?;
        if path.exists() {
            snapshot_directory(&path)
        } else {
            Ok(Vec::new())
        }
    }

    pub fn apply(self) -> AppResult<Vec<FileChangeRecord>> {
        self._write_lock
            .apply_changes(&self.changes, FileChangeReplayDirection::Redo)?;
        Ok(self.changes)
    }
}

pub fn resolve_change_paths(
    root: &str,
    mut changes: Vec<FileChangeRecord>,
    direction: FileChangeReplayDirection,
) -> AppResult<Vec<FileChangeRecord>> {
    let boundary = FsRootBoundary::new(Path::new(root), "changeset root")?;
    for change in &mut changes {
        let (source, target) = match direction {
            FileChangeReplayDirection::Redo => (&mut change.before_path, &mut change.after_path),
            FileChangeReplayDirection::Undo => (&mut change.after_path, &mut change.before_path),
        };
        let resolved = boundary.resolve_absolute(Path::new(source), "changeset source")?;
        let destination = if source == target {
            resolved.clone()
        } else {
            boundary.resolve_absolute_target(Path::new(target), "changeset target")?
        };
        *source = resolved.to_string_lossy().into();
        *target = destination.to_string_lossy().into();
        for file in change.before_files.iter().chain(change.after_files.iter()) {
            validate_safe_relative_path(Path::new(&file.rel_path), "file snapshot")?;
        }
    }
    Ok(changes)
}

pub fn build_text_change(path: &Path, after_text: Option<String>) -> AppResult<FileChangeRecord> {
    build_file_change(path, after_text, None)
}

pub fn build_file_change(
    path: &Path,
    after_text: Option<String>,
    after_data_base64: Option<String>,
) -> AppResult<FileChangeRecord> {
    let canonical = super::canonical_path(path, "file change")?;
    let path = canonical.as_path();
    if path.exists() {
        validate_walk_entry(path, "file change")?;
    }
    let before_exists = path.exists();
    let (before_text, before_data_base64) = if before_exists {
        snapshot_file_content(path)?
    } else {
        (None, None)
    };
    if let Some(data) = &after_data_base64 {
        general_purpose::STANDARD.decode(data).map_err(|e| {
            AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
        })?;
    }
    Ok(FileChangeRecord {
        kind: FileChangeKind::File,
        before_path: path.to_string_lossy().to_string(),
        after_path: path.to_string_lossy().to_string(),
        before_exists,
        before_text,
        before_data_base64,
        before_files: vec![],
        after_exists: after_text.is_some() || after_data_base64.is_some(),
        after_text,
        after_data_base64,
        after_files: vec![],
    })
}

pub fn build_directory_delete_change(path: &Path) -> AppResult<FileChangeRecord> {
    let canonical = super::canonical_path(path, "directory change")?;
    let path = canonical.as_path();
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
    }
    let before_exists = path.exists();
    let before_files = if before_exists {
        snapshot_directory(path)?
    } else {
        vec![]
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::Directory,
        before_path: path.to_string_lossy().to_string(),
        after_path: path.to_string_lossy().to_string(),
        before_exists,
        before_text: None,
        before_data_base64: None,
        before_files,
        after_exists: false,
        after_text: None,
        after_data_base64: None,
        after_files: vec![],
    })
}

pub fn build_directory_replace_change(
    path: &Path,
    after_files: Vec<FileSnapshot>,
) -> AppResult<FileChangeRecord> {
    let canonical = super::canonical_path(path, "directory change")?;
    let path = canonical.as_path();
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
    }
    let before_exists = path.exists();
    let before_files = if before_exists {
        snapshot_directory(path)?
    } else {
        vec![]
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::Directory,
        before_path: path.to_string_lossy().to_string(),
        after_path: path.to_string_lossy().to_string(),
        before_exists,
        before_text: None,
        before_data_base64: None,
        before_files,
        after_exists: true,
        after_text: None,
        after_data_base64: None,
        after_files,
    })
}

fn apply_transaction_changes(
    changes: &[FileChangeRecord],
    direction: FileChangeReplayDirection,
    lease: &RootWriteLease,
) -> AppResult<()> {
    let directed: Cow<'_, [FileChangeRecord]> = match direction {
        FileChangeReplayDirection::Redo => Cow::Borrowed(changes),
        FileChangeReplayDirection::Undo => Cow::Owned(
            changes
                .iter()
                .rev()
                .map(FileChangeRecord::reversed)
                .collect(),
        ),
    };
    let changes = &directed;
    let rollback = changes
        .iter()
        .map(|change| {
            let mut original = FileChangeRecord {
                kind: change.kind,
                before_path: change.before_path.clone(),
                after_path: change.before_path.clone(),
                before_exists: change.before_exists,
                before_text: None,
                before_data_base64: None,
                before_files: Vec::new(),
                after_exists: change.before_exists,
                after_text: change.before_text.clone(),
                after_data_base64: change.before_data_base64.clone(),
                after_files: change.before_files.clone(),
            };
            if change.before_path == change.after_path {
                return Ok(vec![original]);
            }
            if same_physical_path(
                Path::new(&change.before_path),
                Path::new(&change.after_path),
            ) {
                original.before_path = change.after_path.clone();
                return Ok(vec![original]);
            }
            Ok(vec![
                original,
                build_current_state(Path::new(&change.after_path))?,
            ])
        })
        .collect::<AppResult<Vec<_>>>()?;
    for (index, change) in changes.iter().enumerate() {
        let applied = (|| {
            #[cfg(test)]
            FILE_STEP.with(|step| {
                if let Some(step) = &mut *step.borrow_mut() {
                    step(index, change)?;
                }
                Ok::<(), AppError>(())
            })?;
            validate_change_boundary(&lease.root, change)?;
            if change.before_exists
                && !Path::new(&change.before_path)
                    .try_exists()
                    .map_err(|error| AppError::from(error).at_path(&change.before_path))?
            {
                return Err(AppError::context(
                    "保存来源在写入前消失",
                    std::io::Error::from(std::io::ErrorKind::NotFound).into(),
                )
                .at_path(&change.before_path));
            }
            apply_one(change)
        })();
        if let Err(error) = applied {
            let total = rollback[..=index].iter().map(Vec::len).sum::<usize>();
            let mut restore_errors = Vec::new();
            for (completed_steps, original) in rollback[..=index]
                .iter()
                .rev()
                .flat_map(|steps| steps.iter().rev())
                .enumerate()
            {
                loop {
                    let restored = (|| {
                        validate_change_boundary(&lease.root, original)?;
                        let current = build_current_state(Path::new(&original.after_path))?;
                        if current.after_exists == original.after_exists
                            && current.after_text == original.after_text
                            && current.after_data_base64 == original.after_data_base64
                            && current.after_files == original.after_files
                        {
                            return Ok(());
                        }
                        apply_one(original)
                    })();
                    match restored {
                        Ok(()) => break,
                        Err(restore_error) => match &lease.retry {
                            Some(retry) => {
                                let pending = rollback[..=index]
                                    .iter()
                                    .rev()
                                    .flat_map(|steps| steps.iter().rev())
                                    .skip(completed_steps)
                                    .map(|step| step.after_path.as_str())
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                let completed = rollback[..=index]
                                    .iter()
                                    .rev()
                                    .flat_map(|steps| steps.iter().rev())
                                    .take(completed_steps)
                                    .map(|step| step.after_path.as_str())
                                    .collect::<Vec<_>>()
                                    .join("\n");
                                let progress = format!(
                                    "写入失败: {error}\n已恢复 {completed_steps}/{total} 个文件步骤:\n{completed}\n待恢复:\n{pending}"
                                );
                                retry(
                                    &AppError::context(progress.clone(), restore_error)
                                        .at_path(&original.after_path),
                                )
                                .map_err(|ended| {
                                    AppError::context(progress, ended).at_path(&original.after_path)
                                })?;
                            }
                            None => {
                                restore_errors
                                    .push(format!("{}: {restore_error}", original.after_path));
                                break;
                            }
                        },
                    }
                }
            }
            return Err(changeset_apply_error(error, restore_errors));
        }
    }
    Ok(())
}

fn validate_change_boundary(root: &str, change: &FileChangeRecord) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(root), "save root")?;
    boundary.resolve_absolute(Path::new(&change.before_path), "save source")?;
    if change.before_path != change.after_path {
        boundary.resolve_absolute_target(Path::new(&change.after_path), "save destination")?;
    }
    Ok(())
}

pub fn same_physical_path(left: &Path, right: &Path) -> bool {
    #[cfg(windows)]
    {
        left.to_string_lossy()
            .replace('/', "\\")
            .eq_ignore_ascii_case(&right.to_string_lossy().replace('/', "\\"))
    }
    #[cfg(not(windows))]
    {
        left == right
    }
}

pub fn require_rename_target(source: &Path, target: &Path) -> AppResult<()> {
    if target.exists() && !same_physical_path(source, target) {
        return Err(AppError::message(
            "spec.target_exists",
            format!("重命名目标已存在: {}", target.display()),
        ));
    }
    Ok(())
}

fn validate_relative_path(path: &str) -> AppResult<&Path> {
    validate_safe_relative_path(Path::new(path), "relative file")
}

fn apply_one(change: &FileChangeRecord) -> AppResult<()> {
    match change.kind {
        FileChangeKind::File => apply_file_change(change),
        FileChangeKind::Directory => apply_directory_change(change),
    }
}

fn apply_file_change(change: &FileChangeRecord) -> AppResult<()> {
    let source = &change.before_path;
    let target = &change.after_path;
    let path = Path::new(target);
    if path.exists() {
        validate_walk_entry(path, "file change")?;
    }
    if source != target && Path::new(source).exists() {
        require_rename_target(Path::new(source), path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::rename(source, path)?;
    }
    if change.after_exists {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        if let Some(text) = &change.after_text {
            write_utf8_no_bom(path, text)?;
        } else if let Some(data) = &change.after_data_base64 {
            let bytes = general_purpose::STANDARD.decode(data).map_err(|e| {
                AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
            })?;
            fs::write(path, &bytes)?;
        } else {
            return Err(AppError::message(
                "changeset.missing_content",
                "changeset missing file content",
            ));
        }
    } else if path.exists() {
        fs::remove_file(path)?;
    }
    Ok(())
}

fn apply_directory_change(change: &FileChangeRecord) -> AppResult<()> {
    let path = Path::new(&change.after_path);
    if change.before_path != change.after_path && Path::new(&change.before_path).exists() {
        require_rename_target(Path::new(&change.before_path), path)?;
        fs::rename(&change.before_path, path)?;
    }
    if path.exists() {
        validate_walk_entry(path, "directory change")?;
        fs::remove_dir_all(path)?;
    }
    if change.after_exists {
        fs::create_dir_all(path)?;
        for file in &change.after_files {
            let rel = validate_relative_path(&file.rel_path)?;
            let target = path.join(rel);
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent)?;
            }
            restore_snapshot_file(&target, file)?;
        }
    }
    Ok(())
}

fn build_current_state(path: &Path) -> AppResult<FileChangeRecord> {
    if path.exists() {
        validate_walk_entry(path, "current changeset state")?;
    }
    if path.is_dir() {
        // before and after are the same current state; walk once.
        let files = snapshot_directory(path)?;
        return Ok(FileChangeRecord {
            kind: FileChangeKind::Directory,
            before_path: path.to_string_lossy().to_string(),
            after_path: path.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: files.clone(),
            after_exists: true,
            after_text: None,
            after_data_base64: None,
            after_files: files,
        });
    }
    let exists = path.exists();
    let (text, data_base64) = if exists {
        snapshot_file_content(path)?
    } else {
        (None, None)
    };
    Ok(FileChangeRecord {
        kind: FileChangeKind::File,
        before_path: path.to_string_lossy().to_string(),
        after_path: path.to_string_lossy().to_string(),
        before_exists: exists,
        before_text: text.clone(),
        before_data_base64: data_base64.clone(),
        before_files: vec![],
        after_exists: exists,
        after_text: text,
        after_data_base64: data_base64,
        after_files: vec![],
    })
}

fn changeset_apply_error(apply_error: AppError, rollback_errors: Vec<String>) -> AppError {
    if rollback_errors.is_empty() {
        return apply_error;
    }
    AppError::context(
        format!(
            "changeset apply failed and rollback failed; disk state may be partially changed; rollback errors: {}",
            rollback_errors.join(" | ")
        ),
        apply_error,
    )
}

fn snapshot_directory(path: &Path) -> AppResult<Vec<FileSnapshot>> {
    let mut files = Vec::new();
    for entry in WalkDir::new(path).into_iter() {
        let entry = entry.map_err(|error| {
            AppError::context(
                format!("遍历目录失败 ({})", path.display()),
                AppError::message("io.walk_failed", error.to_string()),
            )
        })?;
        validate_walk_entry(entry.path(), "directory snapshot")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let rel_path = entry
            .path()
            .strip_prefix(path)
            .map_err(|error| AppError::message("path.relative_failed", error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        files.push(snapshot_file(entry.path(), rel_path)?);
    }
    files.sort_by(|a, b| a.rel_path.cmp(&b.rel_path));
    Ok(files)
}

fn snapshot_file(path: &Path, rel_path: String) -> AppResult<FileSnapshot> {
    let (text, data_base64) = snapshot_file_content(path)?;
    Ok(FileSnapshot {
        rel_path,
        text,
        data_base64,
    })
}

fn snapshot_file_content(path: &Path) -> AppResult<(Option<String>, Option<String>)> {
    let bytes = fs::read(path).map_err(|error| AppError::from(error).at_path(path))?;
    #[cfg(test)]
    super::csv_files::record_csv_disk_read(path);
    match String::from_utf8(bytes) {
        Ok(text) => Ok((Some(text), None)),
        Err(error) => Ok((
            None,
            Some(general_purpose::STANDARD.encode(error.into_bytes())),
        )),
    }
}

fn restore_snapshot_file(path: &Path, file: &FileSnapshot) -> AppResult<()> {
    if let Some(text) = &file.text {
        write_utf8_no_bom(path, text)?;
        return Ok(());
    }
    let data = file.data_base64.as_deref().ok_or_else(|| {
        AppError::message(
            "changeset.missing_snapshot_data",
            "directory snapshot missing file data",
        )
    })?;
    let bytes = general_purpose::STANDARD.decode(data).map_err(|e| {
        AppError::context(format!("解码文件数据失败 ({})", path.display()), e.into())
    })?;
    fs::write(path, bytes)?;
    Ok(())
}

#[cfg(test)]
type FileStep = Box<dyn FnMut(usize, &FileChangeRecord) -> AppResult<()>>;

#[cfg(test)]
thread_local! {
    static FILE_STEP: RefCell<Option<FileStep>> = const { RefCell::new(None) };
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::read_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;
    use crate::testutil::TestWorkspace;
    use std::{fs, sync::mpsc, thread, time::Duration};

    #[test]
    fn failed_file_step_restores_all_previous_bytes_and_partial_output() {
        for failed in 0..3 {
            let root = project_workspace("restore_file_positions");
            let originals = [
                vec![0x81, 0x93, 0x0d, 0x0a],
                b"second\r\n".to_vec(),
                vec![0xef, 0xbb, 0xbf, b'x'],
            ];
            for (index, bytes) in originals.iter().enumerate() {
                fs::write(root.join(format!("{index}.txt")), bytes).unwrap();
            }
            FILE_STEP.with(|step| {
                *step.borrow_mut() = Some(Box::new(move |index, change| {
                    if index == failed {
                        fs::write(&change.after_path, "partial")?;
                        return Err(AppError::from(std::io::Error::from(
                            std::io::ErrorKind::WriteZero,
                        )));
                    }
                    Ok(())
                }))
            });
            let retries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
            let count = retries.clone();
            let result = with_write_retry(
                &root,
                move |_| {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok(())
                },
                || {
                    let mut builder = FileChangeSetBuilder::new(&root)?;
                    for index in 0..3 {
                        builder.text_file(format!("{index}.txt"), Some("saved".into()))?;
                    }
                    builder.apply()
                },
            );
            FILE_STEP.with(|step| *step.borrow_mut() = None);
            assert!(result.is_err());
            assert_eq!(retries.load(std::sync::atomic::Ordering::SeqCst), 0);
            for (index, bytes) in originals.iter().enumerate() {
                assert_eq!(fs::read(root.join(format!("{index}.txt"))).unwrap(), *bytes);
            }
            root.close().unwrap();
        }
    }

    #[test]
    fn vanished_root_waits_for_restoration_without_recreating_it() {
        let root = project_workspace("restore_vanished_root");
        let held = root.with_extension("held");
        fs::write(root.join("first.txt"), "first").unwrap();
        fs::write(root.join("second.txt"), "second").unwrap();
        let removed = root.clone();
        let stored = held.clone();
        FILE_STEP.with(|step| {
            *step.borrow_mut() = Some(Box::new(move |index, _| {
                if index == 1 {
                    fs::rename(&removed, &stored)?;
                }
                Ok(())
            }))
        });
        let restore_root = root.clone();
        let restore_held = held.clone();
        let recovered = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let calls = recovered.clone();
        let result = with_write_retry(
            &root,
            move |error| {
                assert!(
                    error
                        .location()
                        .and_then(|location| location.path.as_ref())
                        .is_some()
                );
                assert!(!restore_root.exists());
                fs::rename(&restore_held, &restore_root)?;
                calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
            || {
                let mut builder = FileChangeSetBuilder::new(&root)?;
                builder.text_file("first.txt", Some("saved".into()))?;
                builder.text_file("second.txt", Some("saved".into()))?;
                builder.apply()
            },
        );
        FILE_STEP.with(|step| *step.borrow_mut() = None);
        assert!(result.is_err());
        assert_eq!(recovered.load(std::sync::atomic::Ordering::SeqCst), 1);
        assert_eq!(fs::read_to_string(root.join("first.txt")).unwrap(), "first");
        assert_eq!(
            fs::read_to_string(root.join("second.txt")).unwrap(),
            "second"
        );
        assert!(!held.exists());
        root.close().unwrap();
    }

    #[test]
    fn failed_business_save_restores_files_without_advancing_history_or_session() {
        let root = project_workspace("restore_business_save");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let spec = root.join("data/hulls/original.ship");
        let csv = root.join("data/hulls/ship_data.csv");
        let original_spec = r#"{"hullId":"original","hullName":"Original"}"#;
        let original_csv = "id,name,custom\r\noriginal,Original,001\r\nother,Other,002\r\n";
        fs::write(&spec, original_spec).unwrap();
        fs::write(&csv, original_csv).unwrap();
        let manifest = crate::services::project::open_project_session_traced(
            &root,
            None,
            &mut crate::services::project::PerformanceTrace::new("restore.business"),
        )
        .unwrap();
        let info = crate::services::query_entity_edit_target(
            &manifest.session_id,
            crate::models::EntityKind::Ship,
            "original",
        )
        .unwrap();
        let intent = crate::services::query_entity_identity_intent(
            &manifest.session_id,
            &info.target,
            "saved",
        )
        .unwrap();
        let mut versions = info.base_versions;
        versions.push(intent.destination_version);
        let action = crate::models::SaveAction::SaveEditorSpec(crate::models::SpecSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            target: info.target,
            data: serde_json::json!({"hullId":"saved","hullName":"Captured"}),
            base_versions: versions,
            json_write: Default::default(),
            ordered_json: None,
        });
        FILE_STEP.with(|step| {
            *step.borrow_mut() = Some(Box::new(|index, change| {
                if index == 1 {
                    fs::write(&change.after_path, "partial")?;
                    return Err(AppError::message("io.unexpected", "injected write failure"));
                }
                Ok(())
            }))
        });
        let failed = with_write_retry(
            &root,
            |_| panic!("original files are available"),
            || crate::services::write_transactions::commit_action(action.clone()),
        );
        FILE_STEP.with(|step| *step.borrow_mut() = None);
        assert!(failed.is_err());
        assert_eq!(fs::read(&spec).unwrap(), original_spec.as_bytes());
        assert_eq!(fs::read(&csv).unwrap(), original_csv.as_bytes());
        assert!(!root.join("data/hulls/saved.ship").exists());
        assert!(
            crate::services::write_transactions::query_history(
                &manifest.session_id,
                &manifest.mod_root
            )
            .unwrap()
            .undo_stack
            .is_empty()
        );
        assert!(
            crate::services::query_entity(
                &manifest.session_id,
                crate::models::EntityKind::Ship,
                "original"
            )
            .unwrap()
            .is_some()
        );
        let saved = crate::services::write_transactions::commit_action(action).unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        crate::services::project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn recovery_reverses_create_delete_rename_and_directory_steps() {
        let root = project_workspace("restore_mixed_file_steps");
        fs::write(root.join("deleted.bin"), [0, 255, 1]).unwrap();
        fs::write(root.join("renamed.txt"), "old-name").unwrap();
        fs::create_dir(root.join("directory")).unwrap();
        fs::write(root.join("directory/nested.bin"), [0, 128]).unwrap();
        FILE_STEP.with(|step| {
            *step.borrow_mut() = Some(Box::new(|index, _| {
                if index == 4 {
                    return Err(AppError::message("io.unexpected", "injected file failure"));
                }
                Ok(())
            }))
        });
        let result = with_write_retry(
            &root,
            |_| panic!("all original files remain accessible"),
            || {
                let mut builder = FileChangeSetBuilder::new(&root)?;
                builder.text_file("created.txt", Some("new".into()))?;
                builder.text_file("deleted.bin", None)?;
                builder.rename_text_file("renamed.txt", "next.txt", "new-name".into())?;
                builder.delete_directory("directory")?;
                builder.text_file("last.txt", Some("last".into()))?;
                builder.apply()
            },
        );
        FILE_STEP.with(|step| *step.borrow_mut() = None);
        assert!(result.is_err());
        assert!(!root.join("created.txt").exists());
        assert!(!root.join("last.txt").exists());
        assert!(!root.join("next.txt").exists());
        assert_eq!(fs::read(root.join("deleted.bin")).unwrap(), [0, 255, 1]);
        assert_eq!(
            fs::read_to_string(root.join("renamed.txt")).unwrap(),
            "old-name"
        );
        assert_eq!(
            fs::read(root.join("directory/nested.bin")).unwrap(),
            [0, 128]
        );
        root.close().unwrap();
    }

    #[test]
    fn rename_roundtrips_paths_and_content() {
        let root = project_workspace("rename_roundtrip");
        let old = root.join("nested/old.spec");
        let next = root.join("nested/new.spec");
        fs::create_dir_all(old.parent().unwrap()).unwrap();
        fs::write(&old, "before").unwrap();
        let mut builder = FileChangeSetBuilder::new(&root).unwrap();
        builder
            .rename_text_file("nested/old.spec", "nested/new.spec", "after".into())
            .unwrap();
        let changes = builder.apply().unwrap();
        assert_eq!(changes.len(), 1);
        assert_eq!(
            Path::new(&changes[0].before_path),
            root.canonicalize().unwrap().join("nested").join("old.spec")
        );
        assert_eq!(
            Path::new(&changes[0].after_path).canonicalize().unwrap(),
            next.canonicalize().unwrap()
        );
        assert!(!old.exists());
        assert_eq!(fs::read_to_string(&next).unwrap(), "after");
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            changes.clone(),
        )
        .unwrap();
        assert!(!next.exists());
        assert_eq!(fs::read_to_string(&old).unwrap(), "before");
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            changes,
        )
        .unwrap();
        assert_eq!(fs::read_to_string(&next).unwrap(), "after");
        root.close().unwrap();
    }

    #[test]
    fn rename_failure_restores_source_and_releases_target() {
        let root = project_workspace("rename_rollback");
        fs::write(root.join("old.spec"), "before").unwrap();
        fs::create_dir(root.join("blocked")).unwrap();
        let mut renamed = build_text_change(&root.join("old.spec"), Some("after".into())).unwrap();
        renamed.after_path = root.join("new.spec").to_string_lossy().into();
        let blocked = build_text_change(&root.join("blocked"), Some("bad".into())).unwrap_err();
        assert!(!blocked.code().is_empty());
        let mut failed = renamed.clone();
        failed.before_path = root.join("blocked").to_string_lossy().into();
        failed.after_path = failed.before_path.clone();
        assert!(
            apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Redo,
                vec![renamed, failed]
            )
            .is_err()
        );
        assert_eq!(fs::read_to_string(root.join("old.spec")).unwrap(), "before");
        assert!(!root.join("new.spec").exists());
        root.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn case_only_rename_preserves_actual_filename_through_replay() {
        let root = project_workspace("case_only_rename");
        fs::write(root.join("Demo.spec"), "before").unwrap();
        let mut builder = FileChangeSetBuilder::new(&root).unwrap();
        builder
            .rename_text_file("Demo.spec", "demo.spec", "after".into())
            .unwrap();
        let changes = builder.apply().unwrap();
        let filename = || {
            fs::read_dir(&root)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name()
        };
        assert_eq!(filename(), "demo.spec");
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            changes.clone(),
        )
        .unwrap();
        assert_eq!(filename(), "Demo.spec");
        assert_eq!(
            fs::read_to_string(root.join("Demo.spec")).unwrap(),
            "before"
        );
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            changes,
        )
        .unwrap();
        assert_eq!(filename(), "demo.spec");
        root.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn accepted_change_paths_expand_aliases_and_preserve_rename_case() {
        let root = project_workspace("changeset_alias_case");
        fs::write(root.join("Original.spec"), "before").unwrap();
        let mut change =
            build_text_change(&root.join("Original.spec"), Some("after".into())).unwrap();
        let short_root = crate::testutil::short_path(&root);
        change.before_path = short_root.join("Original.spec").to_string_lossy().into();
        change.after_path = short_root.join("original.spec").to_string_lossy().into();
        let changes = super::resolve_change_paths(
            &root.to_string_lossy(),
            vec![change],
            FileChangeReplayDirection::Redo,
        )
        .unwrap();
        assert_eq!(
            changes[0].before_path,
            root.join("Original.spec")
                .canonicalize()
                .unwrap()
                .to_string_lossy()
        );
        assert_eq!(
            changes[0].after_path,
            root.canonicalize()
                .unwrap()
                .join("original.spec")
                .to_string_lossy()
        );
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            changes.clone(),
        )
        .unwrap();
        assert_eq!(
            fs::read_dir(&root)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name(),
            "original.spec"
        );
        let undo = super::resolve_change_paths(
            &short_root.to_string_lossy(),
            changes,
            FileChangeReplayDirection::Undo,
        )
        .unwrap();
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            undo,
        )
        .unwrap();
        assert_eq!(
            fs::read_dir(&root)
                .unwrap()
                .next()
                .unwrap()
                .unwrap()
                .file_name(),
            "Original.spec"
        );
        assert_eq!(
            fs::read_to_string(root.join("Original.spec")).unwrap(),
            "before"
        );
        root.close().unwrap();
    }

    #[test]
    fn root_queue_is_fifo_and_reentrant() {
        let root = project_workspace("fifo_root_queue");
        let held = acquire_root_write_lock(&root).unwrap();
        let nested = acquire_root_write_lock(&root).unwrap();
        let (sent, received) = mpsc::channel();
        let mut workers = Vec::new();
        for index in 1..=2 {
            let worker_root = root.clone();
            let sent = sent.clone();
            workers.push(thread::spawn(move || {
                let _lease = acquire_root_write_lock(&worker_root).unwrap();
                sent.send(index).unwrap();
            }));
            let start = std::time::Instant::now();
            while held._lease.coordinator.tickets.lock().unwrap().0 < index + 1 {
                assert!(start.elapsed() < Duration::from_secs(3));
                thread::yield_now();
            }
        }
        drop(nested);
        assert!(received.recv_timeout(Duration::from_millis(30)).is_err());
        drop(held);
        assert_eq!(received.recv_timeout(Duration::from_secs(3)).unwrap(), 1);
        assert_eq!(received.recv_timeout(Duration::from_secs(3)).unwrap(), 2);
        for worker in workers {
            worker.join().unwrap();
        }
        root.close().unwrap();
    }

    #[test]
    fn root_write_lock_serializes_same_canonical_root() {
        let root = project_workspace("root_write_lock_serializes");
        let held = acquire_root_write_lock(&root).unwrap();
        let (started_tx, started_rx) = mpsc::channel();
        let (released_tx, released_rx) = mpsc::channel();
        let thread_root = root.clone();
        let worker = thread::spawn(move || {
            started_tx.send(()).unwrap();
            let _lock = acquire_root_write_lock(&thread_root).unwrap();
            released_tx.send(()).unwrap();
        });
        started_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        assert!(released_rx.recv_timeout(Duration::from_millis(50)).is_err());
        drop(held);
        released_rx.recv_timeout(Duration::from_secs(1)).unwrap();
        worker.join().unwrap();
        root.close().unwrap();
    }

    #[cfg(windows)]
    #[test]
    fn later_snapshot_failure_keeps_all_earlier_targets_unchanged() {
        use std::os::windows::fs::OpenOptionsExt;
        let root = project_workspace("snapshot_preflight");
        let first = root.join("first.txt");
        let second = root.join("second.txt");
        fs::write(&first, "first before").unwrap();
        fs::write(&second, "second before").unwrap();
        let changes = [
            build_text_change(&first, Some("first after".to_string())).unwrap(),
            build_text_change(&second, Some("second after".to_string())).unwrap(),
        ];
        let locked = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&second)
            .unwrap();
        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            changes.to_vec(),
        );
        let first_after = fs::read_to_string(&first).unwrap();
        drop(locked);
        assert!(result.is_err());
        assert_eq!(first_after, "first before");
        root.close().unwrap();
    }

    #[test]
    fn root_write_reports_apply_and_restore_errors() {
        let root = project_workspace("rollback_reports_restore_errors");
        fs::create_dir_all(&root).unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::File,
            before_path: root.to_string_lossy().to_string(),
            after_path: root.to_string_lossy().to_string(),
            before_exists: true,
            before_text: Some("before".to_string()),
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: Some("before".to_string()),
            after_data_base64: None,
            after_files: vec![],
        };

        let error = acquire_root_write_lock(&root)
            .unwrap()
            .apply_changes(&[change], FileChangeReplayDirection::Redo)
            .unwrap_err()
            .to_string();

        assert!(error.contains("changeset apply failed and rollback failed"));
        assert!(error.contains("rollback_reports_restore_errors"));
        root.close().unwrap();
    }

    #[test]
    fn changeset_apply_error_includes_apply_and_rollback_errors() {
        let error = changeset_apply_error(
            AppError::message("changeset.apply_failed", "apply failed"),
            vec![
                "first rollback failed".to_string(),
                "second rollback failed".to_string(),
            ],
        )
        .to_string();

        assert!(error.contains("changeset apply failed and rollback failed"));
        assert!(error.contains("apply failed"));
        assert!(error.contains("first rollback failed"));
        assert!(error.contains("second rollback failed"));
    }

    #[test]
    fn directory_delete_change_roundtrips_text_snapshot() {
        let root = project_workspace("directory_delete_roundtrip");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(dir.join("nested")).unwrap();
        write_utf8_no_bom(&dir.join("descriptor.json"), "{\"title\":\"Demo\"}").unwrap();
        write_utf8_no_bom(&dir.join("nested/readme.txt"), "details").unwrap();
        fs::write(dir.join("icon.bin"), [0, 159, 146, 150]).unwrap();

        let change = build_directory_delete_change(&dir).unwrap();
        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!dir.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change],
        )
        .unwrap();

        let descriptor = read_utf8_no_bom(&dir.join("descriptor.json")).unwrap();
        let nested = read_utf8_no_bom(&dir.join("nested/readme.txt")).unwrap();
        let icon = fs::read(dir.join("icon.bin")).unwrap();
        assert_eq!(descriptor, "{\"title\":\"Demo\"}");
        assert_eq!(nested, "details");
        assert_eq!(icon, vec![0, 159, 146, 150]);
        root.close().unwrap();
    }

    #[test]
    fn binary_file_change_can_create_undo_and_redo() {
        let root = project_workspace("binary_file_create_history");
        let path = root.join("graphics/ships/demo.png");
        let change = build_file_change(
            &path,
            None,
            Some(general_purpose::STANDARD.encode([1, 2, 3])),
        )
        .unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!path.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes, vec![1, 2, 3]);
        root.close().unwrap();
    }

    #[test]
    fn binary_file_change_can_overwrite_and_restore() {
        let root = project_workspace("binary_file_overwrite_history");
        let path = root.join("graphics/ships/demo.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, [9, 8, 7]).unwrap();
        let change = build_file_change(
            &path,
            None,
            Some(general_purpose::STANDARD.encode([1, 2, 3])),
        )
        .unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![1, 2, 3]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change.clone()],
        )
        .unwrap();
        assert_eq!(fs::read(&path).unwrap(), vec![9, 8, 7]);

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes, vec![1, 2, 3]);
        root.close().unwrap();
    }

    #[test]
    fn binary_file_change_can_delete_and_restore() {
        let root = project_workspace("binary_file_delete_history");
        let path = root.join("graphics/ships/demo.png");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, [9, 8, 7]).unwrap();
        let change = build_file_change(&path, None, None).unwrap();

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change.clone()],
        )
        .unwrap();
        assert!(!path.exists());

        apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Undo,
            vec![change],
        )
        .unwrap();
        let bytes = fs::read(&path).unwrap();
        assert_eq!(bytes, vec![9, 8, 7]);
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_changeset_path_outside_mod_root() {
        let root = project_workspace("changeset_rejects_external_path");
        let outside = project_workspace("changeset_rejects_external_outside");
        let change =
            build_file_change(&outside.join("outside.txt"), Some("bad".to_string()), None).unwrap();

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_parent_dir_escape() {
        let root = project_workspace("changeset_rejects_parent_dir_escape");
        let mut change =
            build_file_change(&root.join("inside.txt"), Some("bad".to_string()), None).unwrap();
        change.before_path = root.join("..").join("outside.txt").to_string_lossy().into();
        change.after_path = change.before_path.clone();

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_link_parent_escape() {
        let (root, _outside, linked) =
            TestWorkspace::directory_link("replay_link_escape", "linked").unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::File,
            before_path: linked.join("outside.txt").to_string_lossy().to_string(),
            after_path: linked.join("outside.txt").to_string_lossy().to_string(),
            before_exists: false,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: Some("bad".to_string()),
            after_data_base64: None,
            after_files: vec![],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_link_directory_delete() {
        let (root, _outside, linked) =
            TestWorkspace::directory_link("replay_link_directory_delete", "linked").unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::Directory,
            before_path: linked.to_string_lossy().to_string(),
            after_path: linked.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: false,
            after_text: None,
            after_data_base64: None,
            after_files: vec![],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_directory_snapshot_parent_dir_before_apply() {
        let root = project_workspace("changeset_rejects_snapshot_parent_dir");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(&dir.join("mission_text.txt"), "keep").unwrap();
        let change = FileChangeRecord {
            kind: FileChangeKind::Directory,
            before_path: dir.to_string_lossy().to_string(),
            after_path: dir.to_string_lossy().to_string(),
            before_exists: true,
            before_text: None,
            before_data_base64: None,
            before_files: vec![],
            after_exists: true,
            after_text: None,
            after_data_base64: None,
            after_files: vec![FileSnapshot {
                rel_path: "../outside.txt".to_string(),
                text: Some("bad".to_string()),
                data_base64: None,
            }],
        };

        let result = apply_file_change_set(
            &root.to_string_lossy(),
            FileChangeReplayDirection::Redo,
            vec![change],
        );
        let text = read_utf8_no_bom(&dir.join("mission_text.txt")).unwrap();

        assert!(result.is_err());
        assert_eq!(text, "keep");
        root.close().unwrap();
    }

    #[test]
    fn replay_rejects_invalid_directory_snapshot_relative_paths_before_apply() {
        let root = project_workspace("changeset_rejects_invalid_snapshot_rel_path");
        let dir = root.join("data/missions/demo");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(&dir.join("mission_text.txt"), "keep").unwrap();

        for rel_path in ["", ".", "nested/./bad.txt", "C:outside.txt"] {
            let change = FileChangeRecord {
                kind: FileChangeKind::Directory,
                before_path: dir.to_string_lossy().to_string(),
                after_path: dir.to_string_lossy().to_string(),
                before_exists: true,
                before_text: None,
                before_data_base64: None,
                before_files: vec![],
                after_exists: true,
                after_text: None,
                after_data_base64: None,
                after_files: vec![FileSnapshot {
                    rel_path: rel_path.to_string(),
                    text: Some("bad".to_string()),
                    data_base64: None,
                }],
            };

            let result = apply_file_change_set(
                &root.to_string_lossy(),
                FileChangeReplayDirection::Redo,
                vec![change],
            );
            let text = read_utf8_no_bom(&dir.join("mission_text.txt")).unwrap();

            assert!(result.is_err(), "{rel_path}");
            assert_eq!(text, "keep", "{rel_path}");
        }

        root.close().unwrap();
    }

    fn apply_file_change_set(
        root: &str,
        direction: FileChangeReplayDirection,
        changes: Vec<FileChangeRecord>,
    ) -> AppResult<()> {
        let lease = acquire_root_write_lock(Path::new(root))?;
        let changes = resolve_change_paths(root, changes, direction)?;
        lease.apply_changes(&changes, direction)
    }
}
