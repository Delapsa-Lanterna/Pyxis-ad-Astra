use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, forward_slash_relative_path};
use crate::models::{CsvTable, FileChangeRecord, FileVersion};
use crate::parsers::{parse_persisted_json, parse_starsector_json};
#[cfg(test)]
use crate::test_support::work_counts;
use crate::{diagnostics, io, models};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use walkdir::WalkDir;

pub(super) mod core;
pub(super) mod documents;
pub(super) mod engine_styles;
pub(super) mod json_documents;
pub(super) mod roots;
#[cfg(test)]
mod tests;

pub(crate) use roots::resolve_core_root;

static CACHE_ROOT: LazyLock<Mutex<Option<PathBuf>>> = LazyLock::new(|| Mutex::new(None));

#[derive(Clone, Serialize, Deserialize)]
enum ParsedSource {
    Json(Value),
    Csv { header: Vec<String>, count: usize },
}
#[derive(Clone, Serialize, Deserialize)]
struct SourceRecord {
    version: FileVersion,
    parsed: ParsedSource,
}
#[derive(Serialize, Deserialize)]
struct SourceCacheSnapshot {
    format: u32,
    root: String,
    records: BTreeMap<String, SourceRecord>,
}

pub(crate) fn configure_persistent_index_cache(directory: &Path) -> AppResult<()> {
    *CACHE_ROOT
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "source cache lock poisoned"))? =
        Some(directory.join("source-record-cache"));
    Ok(())
}

pub(super) struct SourceReader {
    boundary: FsRootBoundary,
    records: BTreeMap<String, SourceRecord>,
    loaded: BTreeSet<String>,
    paths: BTreeMap<String, Vec<PathBuf>>,
    pub versions: BTreeMap<String, FileVersion>,
    pub tables: BTreeMap<String, CsvTable>,
    bytes: BTreeMap<String, (FileVersion, Vec<u8>)>,
    reused: usize,
    dirty: bool,
}

impl SourceReader {
    pub fn new(root: &Path) -> AppResult<Self> {
        let boundary = FsRootBoundary::new(root, "source root")?;
        let records = cache_path(&boundary)?
            .and_then(|path| io::read_utf8_no_bom(&path).ok())
            .and_then(|text| parse_persisted_json::<SourceCacheSnapshot>(&text).ok())
            .filter(|snapshot| {
                snapshot.format == 1 && snapshot.root == boundary.root().to_string_lossy()
            })
            .map(|snapshot| snapshot.records)
            .unwrap_or_default();
        Ok(Self::empty(boundary, records))
    }
    pub fn for_session(root: &Path) -> AppResult<Self> {
        Ok(Self::empty(
            FsRootBoundary::new(root, "source root")?,
            BTreeMap::new(),
        ))
    }
    pub fn retain_csv_summary(
        &mut self,
        relative_path: &str,
        version: &FileVersion,
        header: &[String],
        count: usize,
    ) {
        self.records.insert(
            relative_path.to_string(),
            SourceRecord {
                version: version.clone(),
                parsed: ParsedSource::Csv {
                    header: header.to_vec(),
                    count,
                },
            },
        );
        self.versions
            .insert(relative_path.to_string(), version.clone());
    }
    pub fn retain_json(&mut self, relative_path: &str, version: &FileVersion, value: &Value) {
        self.records.insert(
            relative_path.to_string(),
            SourceRecord {
                version: version.clone(),
                parsed: ParsedSource::Json(value.clone()),
            },
        );
        self.versions
            .insert(relative_path.to_string(), version.clone());
    }
    fn empty(boundary: FsRootBoundary, records: BTreeMap<String, SourceRecord>) -> Self {
        Self {
            boundary,
            records,
            loaded: BTreeSet::new(),
            paths: BTreeMap::new(),
            versions: BTreeMap::new(),
            tables: BTreeMap::new(),
            bytes: BTreeMap::new(),
            reused: 0,
            dirty: false,
        }
    }
    pub fn root(&self) -> &Path {
        self.boundary.root()
    }

    pub fn fork_loaded(&self) -> Self {
        let mut fork = Self::empty(self.boundary.clone(), self.records.clone());
        fork.loaded = self.loaded.clone();
        fork.paths = self.paths.clone();
        fork.versions = self.versions.clone();
        fork.tables = self.tables.clone();
        fork.bytes = self.bytes.clone();
        fork.reused = self.reused;
        fork
    }
    pub fn path(&self, relative: &str) -> AppResult<PathBuf> {
        self.boundary.resolve_relative(relative, "source file")
    }
    pub fn key(&self, path: &Path) -> String {
        forward_slash_relative_path(self.root(), path)
    }
    pub fn stage_version(&mut self, path: &Path) -> AppResult<FileVersion> {
        let path = self.boundary.resolve_absolute(path, "changed source")?;
        let version = if path.is_file() {
            let (version, bytes) = io::read_authorized_bytes(&path)?;
            self.bytes.insert(self.key(&path), (version.clone(), bytes));
            version
        } else {
            io::file_version(&path)?
        };
        self.versions.insert(self.key(&path), version.clone());
        Ok(version)
    }
    pub fn begin_batch(&mut self) {
        self.bytes.clear();
    }
    pub fn invalidate_paths(&mut self, paths: &[&str]) {
        let affected = |path: &str| {
            paths
                .iter()
                .any(|scope| io::relative_path_contains(scope, path))
        };
        self.loaded.retain(|path| !affected(path));
        self.tables.retain(|path, _| !affected(path));
        self.paths.retain(|path, _| {
            !paths.iter().any(|scope| {
                io::relative_path_contains(scope, path) || io::relative_path_contains(path, scope)
            })
        });
        self.versions.retain(|path, _| {
            !paths
                .iter()
                .any(|scope| io::relative_path_contains(scope, path))
        });
        for (path, (version, _)) in &self.bytes {
            self.versions.insert(path.clone(), version.clone());
        }
    }
    fn read_bytes(&mut self, path: &Path) -> AppResult<(FileVersion, Vec<u8>)> {
        self.bytes
            .remove(&self.key(path))
            .map(Ok)
            .unwrap_or_else(|| io::read_authorized_bytes(path))
    }
    pub fn json(&mut self, path: &Path) -> AppResult<Value> {
        let authorized = self.boundary.resolve_absolute(path, "JSON source")?;
        self.json_at(&authorized)
    }
    fn json_at(&mut self, path: &Path) -> AppResult<Value> {
        let key = self.key(path);
        if self.loaded.contains(&key) {
            return Ok(match &self.records[&key].parsed {
                ParsedSource::Json(value) => value.clone(),
                _ => unreachable!("JSON source"),
            });
        }
        let (version, bytes) = self.read_bytes(path)?;
        let parsed = match self
            .records
            .get(&key)
            .filter(|record| record.version == version)
        {
            Some(SourceRecord {
                parsed: ParsedSource::Json(value),
                ..
            }) => {
                self.reused += 1;
                value.clone()
            }
            _ => {
                self.dirty = true;
                let text = io::decode_text(path, &bytes)?;
                #[cfg(test)]
                work_counts::record("parse", path);
                parse_starsector_json(&text).map_err(|error| {
                    AppError::context(format!("解析 JSON 文件失败 ({})", path.display()), error)
                        .at_path(path)
                })?
            }
        };
        self.versions.insert(key.clone(), version.clone());
        self.records.insert(
            key.clone(),
            SourceRecord {
                version,
                parsed: ParsedSource::Json(parsed.clone()),
            },
        );
        self.loaded.insert(key);
        Ok(parsed)
    }
    pub fn csv(&mut self, path: &Path) -> AppResult<CsvTable> {
        let authorized = self.boundary.resolve_absolute(path, "CSV source")?;
        let path = authorized.as_path();
        let key = self.key(path);
        if let Some(table) = self.tables.get(&key) {
            return Ok(table.clone());
        }
        let (version, table) = if path.exists() {
            let (version, bytes) = self.read_bytes(path)?;
            #[cfg(test)]
            work_counts::record("parse", path);
            let table = io::parse_csv_data(&version.path, &bytes)?;
            (version, table)
        } else {
            io::read_versioned_csv(path)?
        };
        self.versions.insert(key.clone(), version);
        self.tables.insert(key, table.clone());
        Ok(table)
    }
    pub fn count(&mut self, path: &Path, field: &str) -> AppResult<usize> {
        let authorized = self.boundary.resolve_absolute(path, "CSV source")?;
        let path = authorized.as_path();
        let key = self.key(path);
        if let Some(table) = self.tables.get(&key) {
            return Ok(table
                .rows
                .iter()
                .filter(|row| {
                    !row.is_comment
                        && row
                            .data
                            .get(field)
                            .and_then(Value::as_str)
                            .is_some_and(|id| !id.trim().is_empty())
                })
                .count());
        }
        if !path.exists() {
            self.versions.insert(key, io::file_version(path)?);
            return Ok(0);
        }
        if self.loaded.contains(&key)
            && let ParsedSource::Csv { count, .. } = &self.records[&key].parsed
        {
            return Ok(*count);
        }
        let (version, bytes) = self.read_bytes(path)?;
        let (header, count) = match self
            .records
            .get(&key)
            .filter(|record| record.version == version)
        {
            Some(SourceRecord {
                parsed: ParsedSource::Csv { header, count },
                ..
            }) => {
                self.reused += 1;
                (header.clone(), *count)
            }
            _ => {
                self.dirty = true;
                #[cfg(test)]
                work_counts::record("parse", path);
                let table = io::parse_csv_data(&version.path, &bytes)?;
                let count = table
                    .rows
                    .iter()
                    .filter(|row| {
                        !row.is_comment
                            && row
                                .data
                                .get(field)
                                .and_then(Value::as_str)
                                .is_some_and(|id| !id.trim().is_empty())
                    })
                    .count();
                let header = table.header.clone();
                self.tables.insert(key.clone(), table);
                (header, count)
            }
        };
        self.versions.insert(key.clone(), version.clone());
        self.records.insert(
            key.clone(),
            SourceRecord {
                version,
                parsed: ParsedSource::Csv { header, count },
            },
        );
        self.loaded.insert(key);
        Ok(count)
    }
    pub fn walk(&mut self, directory: &str, extension: &str) -> AppResult<Vec<(PathBuf, Value)>> {
        let paths = self.files(directory)?;
        paths
            .into_iter()
            .filter(|path| path.extension().and_then(|part| part.to_str()) == Some(extension))
            .map(|path| self.json_at(&path).map(|value| (path, value)))
            .collect()
    }
    pub fn files(&mut self, directory: &str) -> AppResult<Vec<PathBuf>> {
        if let Some(paths) = self.paths.get(directory) {
            return Ok(paths.clone());
        }
        let dir = self.path(directory)?;
        if let Some((_, paths)) = self
            .paths
            .iter()
            .find(|(parent, _)| dir.starts_with(self.root().join(parent)))
        {
            return Ok(paths
                .iter()
                .filter(|path| path.starts_with(&dir))
                .cloned()
                .collect());
        }
        let mut paths = Vec::new();
        if dir.exists() {
            if !dir.is_dir() {
                return Err(AppError::message(
                    "json.dir_not_directory",
                    format!("JSON 目录不是目录: {}", dir.display()),
                ));
            }
            #[cfg(test)]
            work_counts::record("walk", &dir);
            for entry in WalkDir::new(&dir) {
                let entry = entry.map_err(|error| {
                    AppError::message("io.walk_failed", error.to_string()).at_path(&dir)
                })?;
                io::validate_walk_entry(entry.path(), "source directory")?;
                if entry.file_type().is_file() {
                    paths.push(entry.into_path());
                }
            }
        }
        paths.sort();
        self.paths.insert(directory.to_string(), paths.clone());
        Ok(paths)
    }
    pub fn discard_outdated_records(&mut self) {
        let count = self.records.len();
        self.records.retain(|key, record| {
            self.versions
                .get(key)
                .is_some_and(|version| version == &record.version)
        });
        self.dirty |= count != self.records.len();
    }
    pub fn directory_version(&self, directory: &Path) -> AppResult<FileVersion> {
        let files = self
            .versions
            .values()
            .filter_map(|version| {
                let path = Path::new(&version.path);
                path.strip_prefix(directory)
                    .ok()
                    .filter(|part| !part.as_os_str().is_empty())
                    .and_then(|relative| {
                        version
                            .fingerprint
                            .as_ref()
                            .map(|hash| (io::forward_slash_path(relative), hash.clone()))
                    })
            })
            .collect();
        Ok(FileVersion {
            path: directory.to_string_lossy().to_string(),
            fingerprint: Some(io::directory_fingerprint(files)?),
        })
    }
    pub fn flush(&self) {
        if !self.dirty {
            return;
        }
        let result = (|| -> AppResult<()> {
            let Some(path) = cache_path(&self.boundary)? else {
                return Ok(());
            };
            fs::create_dir_all(path.parent().expect("source cache directory"))?;
            #[derive(Serialize)]
            struct Borrowed<'a> {
                format: u32,
                root: &'a Path,
                records: &'a BTreeMap<String, SourceRecord>,
            }
            io::write_utf8_no_bom(
                &path,
                &serde_json::to_string(&Borrowed {
                    format: 1,
                    root: self.root(),
                    records: &self.records,
                })?,
            )
        })();
        if let Err(error) = result {
            diagnostics::failure(
                "cache.source_save_failed",
                error,
                json!({"root":self.root(),"records":self.records.len()}),
            );
        }
    }
    pub fn reused(&self) -> bool {
        self.reused > 0
    }

    pub fn absorb(&mut self, mut sources: Self) {
        self.dirty |= sources.dirty;
        for key in sources.loaded {
            self.bytes.remove(&key);
            self.records.insert(
                key.clone(),
                sources.records.remove(&key).expect("loaded source record"),
            );
            self.loaded.insert(key);
        }
        self.versions.extend(sources.versions);
    }

    pub fn capture_changed_versions(&mut self, paths: &[&str]) -> AppResult<()> {
        let mut directories = BTreeSet::new();
        for relative in paths {
            let path = self.path(relative)?;
            if path.is_dir() {
                for file in self.files(relative)? {
                    let key = self.key(&file);
                    if let Entry::Vacant(entry) = self.versions.entry(key) {
                        entry.insert(io::file_version(&file)?);
                    }
                }
                directories.insert(path.clone());
            } else if !self.versions.contains_key(*relative) {
                self.versions
                    .insert(relative.to_string(), io::file_version(&path)?);
            }
        }
        for directory in directories {
            self.versions
                .insert(self.key(&directory), self.directory_version(&directory)?);
        }
        Ok(())
    }

    pub fn accept_changes(&mut self, changes: &[FileChangeRecord]) -> AppResult<()> {
        for change in changes {
            let version = io::version_after_change(change)?;
            let Some(relative) = self
                .boundary
                .resolve_changed_path_to_relative(&version.path, "committed source")?
            else {
                continue;
            };
            let path = self.path(&relative)?;
            self.versions.insert(self.key(&path), version);
            if let Some(text) = &change.after_text {
                let extension = path
                    .extension()
                    .and_then(|part| part.to_str())
                    .unwrap_or("");
                if [
                    "json", "ship", "wpn", "proj", "system", "skill", "variant", "skin", "faction",
                ]
                .contains(&extension)
                {
                    self.dirty = true;
                    let key = self.key(&path);
                    let value =
                        parse_starsector_json(text).map_err(|error| error.at_path(&path))?;
                    self.records.insert(
                        key.clone(),
                        SourceRecord {
                            version: self.versions[&key].clone(),
                            parsed: ParsedSource::Json(value),
                        },
                    );
                    self.loaded.insert(key);
                }
            }
        }
        Ok(())
    }
}
fn cache_path(boundary: &FsRootBoundary) -> AppResult<Option<PathBuf>> {
    let root = boundary.root();
    let cache = CACHE_ROOT
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "source cache lock poisoned"))?;
    Ok(cache.as_ref().map(|cache| {
        cache.join(format!(
            "{}.json",
            io::fingerprint(models::windows_path_key(&root.to_string_lossy()).as_bytes())
                .replace(':', "-")
        ))
    }))
}
