use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::file_content::{CsvContent, CsvSource, JsonSource, RecordKind};
use crate::models::{self, CsvRow, CsvTable, FileChangeKind, FileChangeRecord, FileVersion};
use crate::parsers::game;
use crate::parsers::tool_json;
#[cfg(test)]
use crate::test_support::work_counts;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::SystemTime;
use walkdir::WalkDir;

pub(super) mod core;
pub(super) mod documents;
pub(super) mod engine_styles;
pub(super) mod json_documents;
pub(super) mod roots;
#[cfg(test)]
mod tests;
pub(crate) use roots::resolve_core_root;

const SOURCE_CACHE_FORMAT: u32 = 4;
static CACHE_ROOT: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Serialize, Deserialize)]
enum SourceProduct {
    Json(Arc<JsonSource>),
    Csv { header: Vec<String>, count: usize },
}
#[derive(Clone, Serialize, Deserialize)]
struct SourceRecord {
    version: FileVersion,
    product: SourceProduct,
}
#[derive(Serialize, Deserialize)]
struct SourceCache {
    format: u32,
    root: String,
    records: BTreeMap<String, SourceRecord>,
}

#[derive(Clone)]
struct SharedFile {
    version: FileVersion,
    bytes: Arc<[u8]>,
}
#[derive(Clone, Default)]
pub(crate) struct SourceReadBatch {
    files: Arc<Mutex<BTreeMap<PathBuf, SharedFile>>>,
    paths: Arc<Mutex<BTreeMap<PathBuf, Vec<PathBuf>>>>,
}
#[derive(Clone, Default)]
pub(super) struct SourceScope {
    extensions: BTreeSet<String>,
    content: bool,
    entries: BTreeMap<String, Option<(u64, SystemTime)>>,
    directories: BTreeMap<String, Option<(u64, SystemTime)>>,
}

pub(super) struct SourceReader {
    boundary: FsRootBoundary,
    records: BTreeMap<String, SourceRecord>,
    loaded: BTreeSet<String>,
    paths: BTreeMap<String, Vec<PathBuf>>,
    bytes: BTreeMap<String, SharedFile>,
    pub versions: BTreeMap<String, FileVersion>,
    pub tables: BTreeMap<String, CsvTable>,
    pub csv_sources: BTreeMap<String, Arc<CsvSource>>,
    pub scopes: BTreeMap<String, SourceScope>,
    pub stamps: BTreeMap<String, Option<(u64, SystemTime)>>,
    changed: BTreeSet<String>,
    batch: Option<SourceReadBatch>,
    reused: usize,
    dirty: bool,
}

pub(crate) fn configure_persistent_index_cache(directory: &Path) -> AppResult<()> {
    *CACHE_ROOT.lock().map_err(|_| lock_error())? = Some(directory.join("source-record-cache"));
    Ok(())
}
fn lock_error() -> AppError {
    AppError::message("source.batch_lock", "来源读取状态不可用")
}
fn stamp(path: &Path) -> AppResult<Option<(u64, SystemTime)>> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(path)?;
    Ok(Some((metadata.len(), metadata.modified()?)))
}
fn extension(path: &str) -> Option<&str> {
    Path::new(path).extension()?.to_str()
}

impl SourceReader {
    pub fn new(root: &Path) -> AppResult<Self> {
        let mut reader = Self::for_session(root)?;
        if let Some(path) = reader.cache_path()?
            && path.exists()
        {
            let cache = io::read_utf8_no_bom(&path)
                .and_then(|text| tool_json::parse_persisted_json::<SourceCache>(&text));
            match cache {
                Ok(cache)
                    if cache.format == SOURCE_CACHE_FORMAT
                        && cache.root == reader.root().to_string_lossy() =>
                {
                    reader.records = cache.records
                }
                Ok(_) => {}
                Err(error) => {
                    diagnostics::failure("cache.source_read_failed", error, json!({"path":path}))
                }
            }
        }
        Ok(reader)
    }
    pub fn for_session(root: &Path) -> AppResult<Self> {
        Ok(Self {
            boundary: FsRootBoundary::new(root, "source root")?,
            records: BTreeMap::new(),
            loaded: BTreeSet::new(),
            paths: BTreeMap::new(),
            bytes: BTreeMap::new(),
            versions: BTreeMap::new(),
            tables: BTreeMap::new(),
            csv_sources: BTreeMap::new(),
            scopes: BTreeMap::new(),
            stamps: BTreeMap::new(),
            changed: BTreeSet::new(),
            batch: None,
            reused: 0,
            dirty: false,
        })
    }
    pub fn root(&self) -> &Path {
        self.boundary.root()
    }
    pub fn documents(&self) -> BTreeMap<String, Arc<JsonSource>> {
        self.records
            .iter()
            .filter_map(|(path, record)| match &record.product {
                SourceProduct::Json(source) => Some((path.clone(), source.clone())),
                SourceProduct::Csv { .. } => None,
            })
            .collect()
    }
    pub fn key(&self, path: &Path) -> String {
        io::forward_slash_relative_path(self.root(), path)
    }
    pub fn path(&self, relative: &str) -> AppResult<PathBuf> {
        self.bytes
            .get(relative)
            .map(|file| Ok(PathBuf::from(&file.version.path)))
            .unwrap_or_else(|| self.boundary.resolve_relative(relative, "source file"))
    }
    pub fn fork_loaded(&self) -> Self {
        Self {
            boundary: self.boundary.clone(),
            records: self.records.clone(),
            loaded: self.loaded.clone(),
            paths: self.paths.clone(),
            bytes: self.bytes.clone(),
            versions: self.versions.clone(),
            tables: self.tables.clone(),
            csv_sources: self.csv_sources.clone(),
            scopes: self.scopes.clone(),
            stamps: self.stamps.clone(),
            changed: self.changed.clone(),
            batch: self.batch.clone(),
            reused: self.reused,
            dirty: false,
        }
    }
    pub fn begin_batch(&mut self) {
        self.batch = None;
        self.paths.clear();
        self.bytes.clear();
    }
    pub fn use_batch(&mut self, batch: &SourceReadBatch) {
        self.batch = Some(batch.clone());
    }
    pub fn end_batch(&mut self) {
        self.batch = None;
    }
    pub fn discard_staged_bytes(&mut self, key: &str) {
        self.bytes.remove(key);
    }
    fn disk_file(&self, path: &Path) -> AppResult<SharedFile> {
        let read = || {
            io::read_authorized_bytes(path).map(|(version, bytes)| SharedFile {
                version,
                bytes: Arc::from(bytes),
            })
        };
        let Some(batch) = &self.batch else {
            return read();
        };
        let mut files = batch.files.lock().map_err(|_| lock_error())?;
        if let Some(file) = files.get(path) {
            return Ok(file.clone());
        }
        let file = read()?;
        files.insert(path.to_path_buf(), file.clone());
        Ok(file)
    }
    fn read_file(&mut self, path: &Path) -> AppResult<SharedFile> {
        self.bytes
            .remove(&self.key(path))
            .map(Ok)
            .unwrap_or_else(|| self.disk_file(path))
    }
    pub fn stage_version(&mut self, path: &Path) -> AppResult<FileVersion> {
        let path = self.boundary.resolve_absolute(path, "source file")?;
        let version = if path.is_file() {
            let file = self.disk_file(&path)?;
            let version = file.version.clone();
            self.bytes.insert(self.key(&path), file);
            version
        } else {
            io::file_version(&path)?
        };
        self.stamps.insert(self.key(&path), stamp(&path)?);
        self.versions.insert(self.key(&path), version.clone());
        Ok(version)
    }
    pub fn stage_directory(
        &mut self,
        relative: &str,
        keep: impl Fn(&str, &FileVersion) -> bool,
    ) -> AppResult<BTreeMap<PathBuf, FileVersion>> {
        let mut result = BTreeMap::new();
        let mut authorized = BTreeSet::new();
        for path in self.files(relative)? {
            let key = self.key(&path);
            if !self.tracks(&key) {
                continue;
            }
            let version = if path.is_file() {
                // Authorize shared ancestors once within this directory byte snapshot.
                for ancestor in path.ancestors() {
                    if authorized.insert(ancestor.to_path_buf()) {
                        io::validate_walk_entry(ancestor, "source file")?;
                    }
                }
                let file = self.disk_file(&path)?;
                let version = file.version.clone();
                self.stamps.insert(key.clone(), stamp(&path)?);
                self.versions.insert(key.clone(), version.clone());
                self.bytes.insert(key.clone(), file);
                version
            } else {
                self.stage_version(&path)?
            };
            if !keep(&key, &version) {
                self.bytes.remove(&key);
            }
            result.insert(path, version);
        }
        Ok(result)
    }
    pub fn json_source(&mut self, path: &Path) -> AppResult<Arc<JsonSource>> {
        // Loaded products already belong to this reader's captured source version.
        if let Some(source) = self.loaded_json(&self.key(path)) {
            return Ok(source);
        }
        let staged = self
            .bytes
            .get(&self.key(path))
            .is_some_and(|file| Path::new(&file.version.path) == path);
        // Staged bytes already carry the authorized path and its matching version.
        let path = if staged {
            path.to_path_buf()
        } else {
            #[cfg(test)]
            work_counts::record("source-path", path);
            self.boundary.resolve_absolute(path, "source file")?
        };
        let key = self.key(&path);
        if let Some(source) = self.loaded_json(&key) {
            return Ok(source);
        }
        let file = self.read_file(&path)?;
        let source = match self.records.get(&key) {
            Some(SourceRecord {
                version,
                product: SourceProduct::Json(source),
            }) if *version == file.version => {
                self.reused += 1;
                source.clone()
            }
            _ => {
                let source = io::parse_json_data(&file.version, &file.bytes)?;
                self.dirty = true;
                source
            }
        };
        self.records.insert(
            key.clone(),
            SourceRecord {
                version: file.version.clone(),
                product: SourceProduct::Json(source.clone()),
            },
        );
        io::capture_json(&file.version, source.clone());
        self.stamps.insert(key.clone(), stamp(&path)?);
        self.versions.insert(key.clone(), file.version);
        self.loaded.insert(key);
        Ok(source)
    }
    fn loaded_json(&self, key: &str) -> Option<Arc<JsonSource>> {
        if self.loaded.contains(key)
            && let SourceProduct::Json(source) = &self.records[key].product
        {
            Some(source.clone())
        } else {
            None
        }
    }
    pub fn json(&mut self, path: &Path) -> AppResult<Value> {
        self.json_source(path)?
            .content
            .to_json()
            .map_err(|error| AppError::from(error).at_path(path))
    }
    pub fn retain_json(&mut self, relative: &str, version: &FileVersion, source: Arc<JsonSource>) {
        self.records.insert(
            relative.into(),
            SourceRecord {
                version: version.clone(),
                product: SourceProduct::Json(source),
            },
        );
        self.loaded.insert(relative.into());
        self.versions.insert(relative.into(), version.clone());
    }
    pub fn retain_csv_summary(
        &mut self,
        relative: &str,
        version: &FileVersion,
        header: &[String],
        count: usize,
    ) {
        self.records.insert(
            relative.into(),
            SourceRecord {
                version: version.clone(),
                product: SourceProduct::Csv {
                    header: header.to_vec(),
                    count,
                },
            },
        );
        self.versions.insert(relative.into(), version.clone());
        self.loaded.insert(relative.into());
    }
    pub fn csv_source(&mut self, path: &Path) -> AppResult<Arc<CsvSource>> {
        let path = self.boundary.resolve_absolute(path, "source file")?;
        let key = self.key(&path);
        if let Some(source) = self.csv_sources.get(&key) {
            return Ok(source.clone());
        }
        let file = self.read_file(&path)?;
        let source = Arc::new(io::parse_csv_data(&path.to_string_lossy(), &file.bytes)?);
        self.stamps.insert(key.clone(), stamp(&path)?);
        self.versions.insert(key.clone(), file.version);
        self.csv_sources.insert(key, source.clone());
        Ok(source)
    }
    pub fn csv(&mut self, path: &Path) -> AppResult<CsvTable> {
        let path = self.boundary.resolve_absolute(path, "source file")?;
        let key = self.key(&path);
        if let Some(table) = self.tables.get(&key) {
            return Ok(table.clone());
        }
        let table = if !path.exists() {
            self.versions.insert(key.clone(), io::file_version(&path)?);
            CsvTable {
                header: Vec::new(),
                rows: Vec::new(),
                path: path.to_string_lossy().into_owned(),
            }
        } else {
            let source = self.csv_source(&path)?;
            project_csv(source.as_ref(), &path)
        };
        self.tables.insert(key, table.clone());
        Ok(table)
    }
    pub fn count(
        &mut self,
        path: &Path,
        field: &str,
        accepts: fn(&str) -> bool,
    ) -> AppResult<usize> {
        let key = self.key(path);
        if self.loaded.contains(&key)
            && let Some(SourceRecord {
                product: SourceProduct::Csv { count, .. },
                ..
            }) = self.records.get(&key)
        {
            return Ok(*count);
        }
        if let Some(source) = self.csv_sources.get(&key) {
            let content = &source.document.content;
            let column = content.header.iter().rposition(|key| key == field);
            let count = content
                .records
                .iter()
                .filter(|row| {
                    row.kind == RecordKind::Data
                        && column
                            .and_then(|i| row.cells.get(i))
                            .is_some_and(|id| !id.trim().is_empty() && accepts(id))
                })
                .count();
            let header = content.header.clone();
            self.retain_csv_summary(&key, &self.versions[&key].clone(), &header, count);
            return Ok(count);
        }
        let path = self.boundary.resolve_absolute(path, "source file")?;
        let key = self.key(&path);
        if !path.exists() {
            self.stamps.insert(key.clone(), None);
            self.versions.insert(key, io::file_version(&path)?);
            return Ok(0);
        }
        if self.loaded.contains(&key)
            && let SourceProduct::Csv { count, .. } = &self.records[&key].product
        {
            return Ok(*count);
        }
        let file = self.read_file(&path)?;
        if let Some(SourceRecord {
            version,
            product: SourceProduct::Csv { count, .. },
        }) = self.records.get(&key)
            && *version == file.version
        {
            let count = *count;
            self.reused += 1;
            self.versions.insert(key.clone(), file.version);
            self.loaded.insert(key);
            return Ok(count);
        }
        self.bytes.insert(key.clone(), file.clone());
        #[cfg(test)]
        io::record_csv_parse(&path);
        let content = game::read_csv_content(&file.bytes).map_err(|error| {
            AppError::context(
                format!("读取 CSV 失败：{}", path.display()),
                AppError::from(error),
            )
            .at_path(&path)
        })?;
        let column = content.header.iter().rposition(|key| key == field);
        let count = content
            .records
            .iter()
            .filter(|row| {
                row.kind == RecordKind::Data
                    && column
                        .and_then(|index| row.cells.get(index))
                        .is_some_and(|value| !value.trim().is_empty() && accepts(value))
            })
            .count();
        self.tables
            .insert(key.clone(), project_csv_content(&content, &path));
        self.stamps.insert(key.clone(), stamp(&path)?);
        self.retain_csv_summary(&key, &file.version, &content.header, count);
        self.loaded.insert(key);
        self.dirty = true;
        Ok(count)
    }
    pub fn walk(&mut self, directory: &str, extension: &str) -> AppResult<Vec<(PathBuf, Value)>> {
        self.discover(directory, &[extension], true)?
            .into_iter()
            .map(|path| self.json(&path).map(|value| (path, value)))
            .collect()
    }
    pub fn files(&mut self, directory: &str) -> AppResult<Vec<PathBuf>> {
        if let Some(paths) = self.paths.get(directory) {
            return Ok(paths.clone());
        }
        let directory_path = self.path(directory)?;
        if let Some(batch) = &self.batch
            && let Some(paths) = batch
                .paths
                .lock()
                .map_err(|_| lock_error())?
                .get(&directory_path)
        {
            self.paths.insert(directory.into(), paths.clone());
            return Ok(paths.clone());
        }
        if let Some((_, paths)) = self
            .paths
            .iter()
            .find(|(parent, _)| directory_path.starts_with(self.root().join(parent)))
        {
            return Ok(paths
                .iter()
                .filter(|path| path.starts_with(&directory_path))
                .cloned()
                .collect());
        }
        let mut paths = Vec::new();
        let mut directories = BTreeMap::new();
        if directory_path.exists() {
            #[cfg(test)]
            work_counts::record("walk", &directory_path);
            for entry in WalkDir::new(&directory_path) {
                let entry = entry.map_err(|error| {
                    AppError::message("io.walk_failed", error.to_string()).at_path(&directory_path)
                })?;
                io::validate_walk_entry(entry.path(), "source directory")?;
                if entry.file_type().is_file() {
                    paths.push(entry.into_path());
                } else if entry.file_type().is_dir() {
                    directories.insert(self.key(entry.path()), stamp(entry.path())?);
                }
            }
        }
        paths.sort();
        self.scopes.entry(directory.into()).or_default().directories = directories;
        if let Some(batch) = &self.batch {
            batch
                .paths
                .lock()
                .map_err(|_| lock_error())?
                .insert(directory_path, paths.clone());
        }
        self.paths.insert(directory.into(), paths.clone());
        Ok(paths)
    }
    pub fn discover(
        &mut self,
        directory: &str,
        extensions: &[&str],
        content: bool,
    ) -> AppResult<Vec<PathBuf>> {
        let files = self.files(directory)?;
        let paths = files
            .into_iter()
            .filter(|path| {
                path.extension()
                    .and_then(|v| v.to_str())
                    .is_some_and(|v| extensions.contains(&v))
            })
            .collect::<Vec<_>>();
        let scope = self.scopes.entry(directory.into()).or_default();
        scope
            .extensions
            .extend(extensions.iter().map(|v| (*v).into()));
        scope.content |= content;
        if !scope.content {
            self.stamps
                .retain(|path, _| !io::relative_path_contains(directory, path));
            let known = scope.entries.keys().cloned().collect::<Vec<_>>();
            for path in known {
                scope.entries.insert(path, None);
            }
            for path in &paths {
                let relative = io::forward_slash_relative_path(self.boundary.root(), path);
                scope.entries.insert(relative, stamp(path)?);
            }
        }
        Ok(paths)
    }
    pub fn tracks(&self, relative: &str) -> bool {
        self.versions.contains_key(relative)
            || self.scopes.iter().any(|(directory, scope)| {
                scope.content
                    && io::relative_path_contains(directory, relative)
                    && extension(relative).is_some_and(|v| scope.extensions.contains(v))
            })
    }
    pub fn tracks_scope(&self, relative: &str) -> bool {
        self.tracks(relative)
            || self.scopes.iter().any(|(directory, scope)| {
                scope.content && io::relative_path_contains(relative, directory)
            })
            || self
                .versions
                .keys()
                .any(|known| io::relative_path_contains(relative, known))
    }
    pub fn notice_changed(&mut self, relative: &str) -> AppResult<bool> {
        let current = stamp(&self.path(relative)?)?;
        for (directory, scope) in &mut self.scopes {
            if io::relative_path_contains(directory, relative)
                && extension(relative).is_some_and(|v| scope.extensions.contains(v))
            {
                return Ok(scope.entries.insert(relative.into(), current) != Some(current));
            }
        }
        Ok(self.stamps.insert(relative.into(), current) != Some(current))
    }
    pub fn invalidate_paths(&mut self, scopes: &[&str]) {
        self.changed
            .extend(scopes.iter().map(|path| (*path).to_owned()));
        let affected = |path: &str| {
            scopes
                .iter()
                .any(|scope| io::relative_path_contains(scope, path))
        };
        self.loaded.retain(|path| !affected(path));
        self.tables.retain(|path, _| !affected(path));
        self.csv_sources.retain(|path, _| !affected(path));
        self.versions.retain(|path, _| !affected(path));
        self.paths.retain(|path, _| {
            !scopes.iter().any(|scope| {
                io::relative_path_contains(scope, path) || io::relative_path_contains(path, scope)
            })
        });
        for (key, file) in &self.bytes {
            self.versions.insert(key.clone(), file.version.clone());
        }
    }
    pub fn rescan_paths(&mut self) -> AppResult<Vec<String>> {
        let mut paths = self
            .versions
            .keys()
            .chain(self.stamps.keys())
            .cloned()
            .collect::<BTreeSet<_>>();
        // Unversioned catalog roots change through membership, rather than retained directory stamps.
        paths.retain(|path| {
            self.versions.contains_key(path)
                || self.scopes.get(path).is_none_or(|scope| scope.content)
        });
        for (directory, before) in self.scopes.clone() {
            let extensions = before
                .extensions
                .iter()
                .map(String::as_str)
                .collect::<Vec<_>>();
            let current = self.discover(&directory, &extensions, before.content)?;
            if before.content {
                paths.extend(current.iter().map(|path| self.key(path)));
            } else if before.entries != self.scopes[&directory].entries {
                paths.insert(directory);
            }
        }
        let mut changed = Vec::new();
        for path in paths {
            if self.scopes.get(&path).is_some_and(|scope| !scope.content) {
                changed.push(path);
                continue;
            }
            if self.notice_changed(&path)? {
                changed.push(path);
            }
        }
        Ok(changed)
    }
    pub fn directory_version(&self, directory: &Path) -> AppResult<FileVersion> {
        let files = self
            .versions
            .values()
            .filter_map(|version| {
                let relative = Path::new(&version.path).strip_prefix(directory).ok()?;
                if relative.as_os_str().is_empty() {
                    return None;
                }
                Some((
                    io::forward_slash_path(relative),
                    version.fingerprint.clone()?,
                ))
            })
            .collect();
        Ok(FileVersion {
            path: directory.to_string_lossy().into_owned(),
            fingerprint: Some(io::directory_fingerprint(files)?),
        })
    }
    pub fn capture_changed_versions(&mut self, paths: &[&str]) -> AppResult<()> {
        for relative in paths {
            let path = self.path(relative)?;
            if path.is_dir() {
                for file in self.files(relative)? {
                    let key = self.key(&file);
                    if !self.versions.contains_key(&key) {
                        self.stage_version(&file)?;
                    }
                }
                self.versions
                    .insert((*relative).into(), self.directory_version(&path)?);
            } else if !self.versions.contains_key(*relative) {
                self.stage_version(&path)?;
            }
        }
        Ok(())
    }
    pub fn discard_outdated_records(&mut self) {
        let before = self.records.len();
        self.records
            .retain(|key, record| self.versions.get(key) == Some(&record.version));
        self.dirty |= before != self.records.len();
    }
    pub fn absorb(&mut self, next: Self) {
        self.dirty |= next.dirty;
        for key in &next.loaded {
            self.bytes.remove(key);
            self.loaded.insert(key.clone());
        }
        // A fork may still carry persisted records it never validated or consumed.
        self.records.extend(
            next.records
                .into_iter()
                .filter(|(key, _)| next.loaded.contains(key)),
        );
        self.paths.extend(next.paths);
        self.versions.extend(next.versions);
        self.tables.extend(next.tables);
        self.csv_sources.extend(next.csv_sources);
        self.scopes.extend(next.scopes);
        self.stamps.extend(next.stamps);
    }
    pub fn accept_changes(&mut self, changes: &[FileChangeRecord]) -> AppResult<()> {
        // A committed changeset supplies the complete membership delta for this capture.
        for (directory, scope) in &self.scopes {
            let membership_matches = scope
                .directories
                .iter()
                .map(|(path, expected)| {
                    stamp(&self.root().join(path)).map(|actual| actual == *expected)
                })
                .collect::<AppResult<Vec<_>>>()?
                .into_iter()
                .all(|same| same);
            if membership_matches {
                self.paths.insert(
                    directory.clone(),
                    self.records
                        .keys()
                        .filter(|path| io::relative_path_contains(directory, path))
                        .map(|path| self.root().join(path))
                        .collect(),
                );
            }
        }
        for change in changes {
            if matches!(change.kind, FileChangeKind::Directory) {
                for path in [&change.before_path, &change.after_path] {
                    let Some(relative) = self
                        .boundary
                        .resolve_changed_path_to_relative(path, "saved directory")?
                    else {
                        continue;
                    };
                    self.records
                        .retain(|key, _| !io::relative_path_contains(&relative, key));
                    self.loaded
                        .retain(|key| !io::relative_path_contains(&relative, key));
                    self.versions
                        .retain(|key, _| !io::relative_path_contains(&relative, key));
                    let absolute = self.root().join(&relative);
                    for paths in self.paths.values_mut() {
                        paths.retain(|known| !known.starts_with(&absolute));
                    }
                    self.changed.insert(relative);
                }
                for file in &change.after_files {
                    let path = Path::new(&change.after_path).join(&file.rel_path);
                    let nested = FileChangeRecord {
                        kind: FileChangeKind::File,
                        before_path: path.to_string_lossy().into_owned(),
                        after_path: path.to_string_lossy().into_owned(),
                        before_exists: false,
                        before_text: None,
                        before_data_base64: None,
                        before_files: Vec::new(),
                        after_exists: true,
                        after_text: file.text.clone(),
                        after_data_base64: file.data_base64.clone(),
                        after_files: Vec::new(),
                    };
                    self.accept_file_change(&nested)?;
                }
            } else {
                self.accept_file_change(change)?;
            }
        }
        Ok(())
    }
    fn accept_file_change(&mut self, change: &FileChangeRecord) -> AppResult<()> {
        if change.before_path != change.after_path {
            let Some(key) = self
                .boundary
                .resolve_changed_path_to_relative(&change.before_path, "saved source")?
            else {
                return Ok(());
            };
            self.records.remove(&key);
            self.loaded.remove(&key);
            self.versions.remove(&key);
            self.changed.insert(key);
        }
        let mut version = io::version_after_change(change)?;
        let Some(relative) = self
            .boundary
            .resolve_changed_path_to_relative(&version.path, "saved source")?
        else {
            return Ok(());
        };
        let before = self
            .boundary
            .resolve_changed_path_to_relative(&change.before_path, "saved source")?
            .map(|path| self.root().join(path));
        let after = self.root().join(&relative);
        version.path = after.to_string_lossy().into_owned();
        self.changed.insert(relative.clone());
        for (directory, paths) in &mut self.paths {
            paths.retain(|path| Some(path) != before.as_ref() && path != &after);
            if change.after_exists && io::relative_path_contains(directory, &relative) {
                paths.push(after.clone());
                paths.sort();
            }
        }
        self.loaded.remove(&relative);
        self.tables.remove(&relative);
        self.csv_sources.remove(&relative);
        self.versions.insert(relative.clone(), version.clone());
        if let Some(text) = &change.after_text {
            io::capture_file(&version, text.as_bytes());
            match extension(&relative) {
                Some(
                    "json" | "ship" | "wpn" | "proj" | "system" | "skill" | "variant" | "skin"
                    | "faction",
                ) => match io::parse_json_data(&version, text.as_bytes()) {
                    Ok(source) => self.retain_json(&relative, &version, source),
                    Err(_) => {
                        self.records.remove(&relative);
                    }
                },
                Some("csv") => {
                    if let Ok(source) = io::parse_csv_data(&version.path, text.as_bytes()) {
                        self.csv_sources.insert(relative.clone(), Arc::new(source));
                    }
                    self.records.remove(&relative);
                }
                _ => {}
            }
        } else {
            self.records.remove(&relative);
        }
        self.dirty = true;
        Ok(())
    }
    pub fn changed_paths(&self) -> &BTreeSet<String> {
        &self.changed
    }
    pub fn reused(&self) -> bool {
        self.reused > 0
    }
    fn cache_path(&self) -> AppResult<Option<PathBuf>> {
        Self::cache_path_for(&self.root().to_string_lossy())
    }
    fn cache_path_for(canonical_root: &str) -> AppResult<Option<PathBuf>> {
        Ok(CACHE_ROOT
            .lock()
            .map_err(|_| lock_error())?
            .as_ref()
            .map(|root| {
                root.join(format!(
                    "{}.json",
                    io::fingerprint(models::windows_path_key(canonical_root).as_bytes())
                        .replace(':', "-")
                ))
            }))
    }
    pub fn flush(&self) {
        if !self.dirty {
            return;
        }
        self.persist();
    }
    pub fn persist(&self) {
        Self::persist_records(self.root(), &self.records);
    }
    pub fn persist_project_sources(
        root: &Path,
        documents: BTreeMap<String, (FileVersion, Arc<JsonSource>)>,
        tables: Vec<(String, FileVersion, Vec<String>, usize)>,
    ) {
        let mut records = documents
            .into_iter()
            .map(|(path, (version, source))| {
                (
                    path,
                    SourceRecord {
                        version,
                        product: SourceProduct::Json(source),
                    },
                )
            })
            .collect::<BTreeMap<_, _>>();
        records.extend(tables.into_iter().map(|(path, version, header, count)| {
            (
                path,
                SourceRecord {
                    version,
                    product: SourceProduct::Csv { header, count },
                },
            )
        }));
        Self::persist_records(root, &records);
    }
    fn persist_records(root: &Path, records: &BTreeMap<String, SourceRecord>) {
        let persist = || -> AppResult<()> {
            let Some(path) = Self::cache_path_for(&root.to_string_lossy())? else {
                return Ok(());
            };
            fs::create_dir_all(path.parent().expect("source cache parent"))?;
            #[cfg(test)]
            work_counts::record("cache-write", &path);
            #[derive(Serialize)]
            struct Cache<'a> {
                format: u32,
                root: &'a Path,
                records: &'a BTreeMap<String, SourceRecord>,
            }
            io::write_utf8_no_bom(
                &path,
                &serde_json::to_string(&Cache {
                    format: SOURCE_CACHE_FORMAT,
                    root,
                    records,
                })?,
            )
        };
        if let Err(error) = persist() {
            diagnostics::failure("cache.source_save_failed", error, json!({"root":root}));
        }
    }
}

pub(super) fn project_csv(source: &CsvSource, path: &Path) -> CsvTable {
    project_csv_content(&source.document.content, path)
}
fn project_csv_content(content: &CsvContent, path: &Path) -> CsvTable {
    CsvTable {
        header: content.header.clone(),
        path: path.to_string_lossy().into_owned(),
        rows: content
            .records
            .iter()
            .map(|record| CsvRow {
                is_comment: record.kind == RecordKind::Comment,
                data: content
                    .header
                    .iter()
                    .zip(&record.cells)
                    .map(|(key, value)| (key.clone(), Value::String(value.clone())))
                    .collect(),
            })
            .collect(),
    }
}
