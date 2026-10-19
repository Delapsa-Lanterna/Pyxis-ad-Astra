pub(super) mod core;
pub(super) mod documents;
pub(super) mod families;
#[cfg(test)]
mod tests;

use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, forward_slash_relative_path},
    models::{CsvTable, FileVersion},
    parsers::{parse_persisted_json, parse_starsector_json},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{LazyLock, Mutex},
};

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
struct Snapshot {
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
    reused: usize,
    dirty: bool,
}

impl SourceReader {
    pub fn new(root: &Path) -> AppResult<Self> {
        let boundary = FsRootBoundary::new(root, "source root")?;
        let records = cache_path(boundary.root())?
            .and_then(|path| crate::io::read_utf8_no_bom(&path).ok())
            .and_then(|text| parse_persisted_json::<Snapshot>(&text).ok())
            .filter(|snapshot| {
                snapshot.format == 1 && snapshot.root == boundary.root().to_string_lossy()
            })
            .map(|snapshot| snapshot.records)
            .unwrap_or_default();
        Ok(Self::empty(boundary, records))
    }
    pub fn from_session(session: &super::model::ProjectSession) -> AppResult<Self> {
        let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "source root")?;
        let mut sources = Self::empty(boundary, BTreeMap::new());
        for (key, table) in &session.csv_tables {
            let Some(table_key) = crate::models::CsvTableKey::from_key(key) else {
                continue;
            };
            let path = &table.path;
            let Some(version) = session.source_versions.get(path) else {
                continue;
            };
            let summary = &session.manifest.table_summaries[&table_key];
            let count = session.manifest.table_entity_summaries[&table_key];
            sources.records.insert(
                path.clone(),
                SourceRecord {
                    version: version.clone(),
                    parsed: ParsedSource::Csv {
                        header: summary.header.clone(),
                        count,
                    },
                },
            );
            sources.versions.insert(path.clone(), version.clone());
        }
        Ok(sources)
    }
    fn empty(boundary: FsRootBoundary, records: BTreeMap<String, SourceRecord>) -> Self {
        Self {
            boundary,
            records,
            loaded: BTreeSet::new(),
            paths: BTreeMap::new(),
            versions: BTreeMap::new(),
            tables: BTreeMap::new(),
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
        fork.reused = self.reused;
        fork
    }
    pub fn path(&self, relative: &str) -> AppResult<PathBuf> {
        self.boundary.resolve_relative(relative, "source file")
    }
    pub fn key(&self, path: &Path) -> String {
        forward_slash_relative_path(self.root(), path)
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
        let (version, bytes) = crate::io::read_authorized_bytes(path)?;
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
                let text = crate::io::decode_text(path, &bytes)?;
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
        let (version, table) = crate::io::read_versioned_csv(path)?;
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
            self.versions.insert(key, crate::io::file_version(path)?);
            return Ok(0);
        }
        let (version, bytes) = crate::io::read_versioned_bytes(path)?;
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
                let table = crate::io::parse_csv_data(&version.path, &bytes)?;
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
            key,
            SourceRecord {
                version,
                parsed: ParsedSource::Csv { header, count },
            },
        );
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
            for entry in walkdir::WalkDir::new(&dir) {
                let entry = entry.map_err(|error| {
                    AppError::message("io.walk_failed", error.to_string()).at_path(&dir)
                })?;
                crate::io::validate_walk_entry(entry.path(), "source directory")?;
                if entry.file_type().is_file() {
                    paths.push(entry.into_path());
                }
            }
        }
        paths.sort();
        self.paths.insert(directory.to_string(), paths.clone());
        Ok(paths)
    }
    pub fn capture_versions(&mut self) -> AppResult<()> {
        let mut paths = vec![
            self.path("mod_info.json")?,
            self.path("data/world/factions/factions.csv")?,
            self.path("data/missions/mission_list.csv")?,
        ];
        for table in super::model::csv_table_specs() {
            paths.push(self.path(table.rel_path)?);
        }
        for directory in [
            "data/world",
            "data/hulls",
            "data/weapons",
            "data/variants",
            "data/shipsystems",
            "data/characters/skills",
            "data/missions",
        ] {
            for path in self.files(directory)? {
                let extension = path
                    .extension()
                    .and_then(|part| part.to_str())
                    .unwrap_or("");
                if directory == "data/missions"
                    || [
                        "faction", "ship", "skin", "wpn", "proj", "variant", "system", "skill",
                    ]
                    .iter()
                    .any(|part| extension.eq_ignore_ascii_case(part))
                {
                    paths.push(path);
                }
            }
        }
        for path in paths {
            let key = self.key(&path);
            if let std::collections::btree_map::Entry::Vacant(entry) = self.versions.entry(key) {
                entry.insert(crate::io::file_version(&path)?);
            }
        }
        let missions = self.path("data/missions")?;
        if missions.is_dir() {
            for entry in std::fs::read_dir(&missions)? {
                let path = entry?.path();
                crate::io::validate_walk_entry(&path, "mission directory")?;
                if path.is_dir() {
                    let key = self.key(&path);
                    self.versions.insert(key, self.directory_version(&path)?);
                }
            }
        }
        let count = self.records.len();
        self.records.retain(|key, record| {
            self.versions
                .get(key)
                .is_some_and(|version| version == &record.version)
        });
        self.dirty |= count != self.records.len();
        Ok(())
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
                            .map(|hash| (crate::io::forward_slash_path(relative), hash.clone()))
                    })
            })
            .collect();
        Ok(FileVersion {
            path: directory.to_string_lossy().to_string(),
            fingerprint: Some(crate::io::directory_fingerprint(files)?),
        })
    }
    pub fn flush(&self) {
        if !self.dirty {
            return;
        }
        let result = (|| -> AppResult<()> {
            let Some(path) = cache_path(self.root())? else {
                return Ok(());
            };
            std::fs::create_dir_all(path.parent().expect("source cache directory"))?;
            #[derive(Serialize)]
            struct Borrowed<'a> {
                format: u32,
                root: &'a Path,
                records: &'a BTreeMap<String, SourceRecord>,
            }
            crate::io::write_utf8_no_bom(
                &path,
                &serde_json::to_string(&Borrowed {
                    format: 1,
                    root: self.root(),
                    records: &self.records,
                })?,
            )
        })();
        if let Err(error) = result {
            crate::diagnostics::record(format!("source cache save failed: {error}"));
        }
    }
    pub fn reused(&self) -> bool {
        self.reused > 0
    }

    pub fn absorb(&mut self, mut sources: Self) {
        self.dirty |= sources.dirty;
        for key in sources.loaded {
            self.records.insert(
                key.clone(),
                sources.records.remove(&key).expect("loaded source record"),
            );
            self.loaded.insert(key);
        }
        self.versions.extend(sources.versions);
    }

    pub fn retain_projection(&mut self, session: &super::model::ProjectSession, changed: &[&str]) {
        let mut retain = |path: &str, value: &Value| {
            if changed
                .iter()
                .any(|changed| crate::domain::config::path_affects_target(changed, path))
            {
                return;
            }
            if let Some(version) = session.source_versions.get(path) {
                self.records.insert(
                    path.to_string(),
                    SourceRecord {
                        version: version.clone(),
                        parsed: ParsedSource::Json(value.clone()),
                    },
                );
                self.versions.insert(path.to_string(), version.clone());
            }
        };
        for records in [
            &session.ship_files,
            &session.weapon_specs,
            &session.projectile_specs,
            &session.system_files,
            &session.skill_files,
            &session.faction_files,
        ] {
            for record in records
                .values()
                .filter(|record| record.location.source == crate::models::ResourceSource::Mod)
            {
                retain(&record.location.rel_path, &record.data);
            }
        }
        for file in &session.variant_files {
            retain(&file.rel_path, &file.data);
        }
        for file in &session.skin_files {
            retain(&file.rel_path, &file.data);
        }
    }

    pub fn capture_changed_versions(&mut self, paths: &[&str]) -> AppResult<()> {
        let mut directories = BTreeSet::new();
        for relative in paths {
            let path = self.path(relative)?;
            if path.is_dir() {
                for file in self.files(relative)? {
                    let key = self.key(&file);
                    if let std::collections::btree_map::Entry::Vacant(entry) =
                        self.versions.entry(key)
                    {
                        entry.insert(crate::io::file_version(&file)?);
                    }
                }
                directories.insert(path.clone());
            } else if !self.versions.contains_key(*relative) {
                self.versions
                    .insert(relative.to_string(), crate::io::file_version(&path)?);
            }
            if let Some(mission) = relative
                .strip_prefix("data/missions/")
                .and_then(|suffix| suffix.split('/').next())
                .filter(|name| *name != "mission_list.csv")
            {
                let directory = self.path(&format!("data/missions/{mission}"))?;
                if directory.is_dir() {
                    for file in self.files(&format!("data/missions/{mission}"))? {
                        let key = self.key(&file);
                        if let std::collections::btree_map::Entry::Vacant(entry) =
                            self.versions.entry(key)
                        {
                            entry.insert(crate::io::file_version(&file)?);
                        }
                    }
                    directories.insert(directory);
                }
            }
        }
        for directory in directories {
            self.versions
                .insert(self.key(&directory), self.directory_version(&directory)?);
        }
        Ok(())
    }

    pub fn accept_changes(&mut self, changes: &[crate::models::FileChangeRecord]) -> AppResult<()> {
        for change in changes {
            let version = crate::io::version_after_change(change)?;
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
fn cache_path(root: &Path) -> AppResult<Option<PathBuf>> {
    let cache = CACHE_ROOT
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "source cache lock poisoned"))?;
    Ok(cache.as_ref().map(|cache| {
        cache.join(format!(
            "{}.json",
            crate::io::fingerprint(root.to_string_lossy().to_lowercase().as_bytes())
                .replace(':', "-")
        ))
    }))
}
