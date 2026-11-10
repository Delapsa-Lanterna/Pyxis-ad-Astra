use super::super::model::{ProjectSession, ReferenceSnapshot, SessionCsvRow};
use super::super::sources::documents::LoadedSpecRecord;
use super::{csv_tables, registry};
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::file_content::JsonSource;
use crate::models::{
    CommittedSessionUpdate, CsvTableKey, EntityFileLocation, EntityKind, FileVersion,
    ProjectInvalidation, ReferenceSource, ReferenceSources, ResourceSource, SessionContentUpdate,
};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

#[cfg(test)]
#[path = "references_tests.rs"]
mod tests;
static SOURCES: LazyLock<Mutex<ReferenceSources>> = LazyLock::new(Default::default);
static REVISION: AtomicU64 = AtomicU64::new(0);
fn state() -> AppResult<MutexGuard<'static, ReferenceSources>> {
    SOURCES
        .lock()
        .map_err(|_| AppError::message("reference.lock_poisoned", "引用来源状态不可用"))
}
fn advance(state: &mut ReferenceSources) {
    state.revision += 1;
    REVISION.store(state.revision, Ordering::Release);
}
pub(crate) fn reference_revision() -> u64 {
    REVISION.load(Ordering::Acquire)
}
pub(crate) fn reference_sources() -> AppResult<ReferenceSources> {
    Ok(state()?.clone())
}
pub(crate) fn set_reference_order(order: Vec<String>) -> AppResult<()> {
    let mut state = state()?;
    if state.order != order {
        state.order = order;
        advance(&mut state);
    }
    Ok(())
}
pub(crate) fn set_reference_sources(ids: Vec<String>) -> AppResult<ReferenceSources> {
    let mut views = BTreeMap::new();
    for id in &ids {
        let handle = registry::session_handle(id)?;
        let session = registry::lock_content_ready_session(&handle)?;
        views.insert(id.clone(), Arc::new(ReferenceSnapshot::capture(&session)));
    }
    let sources = ids
        .iter()
        .map(|id| views[id].identity.clone())
        .collect::<Vec<_>>();
    for (id, entry) in registry::lock_registry()?.iter_mut() {
        entry.reference = views.remove(id);
    }
    let mut state = state()?;
    if state.sources != sources {
        state.sources = sources;
        advance(&mut state);
    }
    Ok(state.clone())
}
pub(crate) fn reference_sources_changed(id: Option<&str>) -> AppResult<Option<ReferenceSources>> {
    let Some(id) = id else {
        return Ok(None);
    };
    if !state()?
        .sources
        .iter()
        .any(|source| source.session_id == id)
    {
        return Ok(None);
    }
    let handle = registry::lock_registry()?.get(id).cloned();
    let view = handle
        .as_ref()
        .map(|handle| {
            registry::lock_content_ready_session(handle)
                .map(|session| Arc::new(ReferenceSnapshot::capture(&session)))
        })
        .transpose()?;
    let existing = {
        let mut registry = registry::lock_registry()?;
        if let Some(entry) = registry.get_mut(id) {
            entry.reference = view;
        }
        registry.keys().cloned().collect::<Vec<_>>()
    };
    let mut state = state()?;
    state
        .sources
        .retain(|source| existing.contains(&source.session_id));
    advance(&mut state);
    Ok(Some(state.clone()))
}
pub(crate) fn reference_updates() -> AppResult<Vec<CommittedSessionUpdate>> {
    let registered = registry::lock_registry()?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    registered
        .iter()
        .map(|registered| {
            let mut session = registry::lock_session(registered)?;
            session.references.clear();
            Ok(CommittedSessionUpdate {
                session_id: registered.session_id.clone(),
                mod_root: registered.root.clone(),
                content: Arc::new(SessionContentUpdate {
                    manifest: session.manifest.clone(),
                    invalidation: ProjectInvalidation {
                        session: true,
                        ..Default::default()
                    },
                }),
            })
        })
        .collect()
}
pub(super) fn prepare(receiver: &str) -> AppResult<(u64, Vec<Arc<ReferenceSnapshot>>)> {
    let snapshot = state()?.clone();
    let registered = registry::lock_registry()?;
    Ok((
        snapshot.revision,
        snapshot
            .sources
            .iter()
            .filter(|source| source.session_id != receiver)
            .filter_map(|source| registered.get(&source.session_id)?.reference.clone())
            .collect(),
    ))
}
impl ReferenceSnapshot {
    fn capture(session: &ProjectSession) -> Self {
        let session = ProjectSession {
            references: Vec::new(),
            loaded_edit_targets: Vec::new(),
            ..session.clone()
        };
        Self {
            identity: ReferenceSource {
                session_id: session.manifest.session_id.clone(),
                mod_root: session.manifest.mod_root.clone(),
            },
            tables: Mutex::new(session.csv_tables.clone()),
            session,
        }
    }
    pub fn read<T>(&self, query: impl FnOnce(&mut ProjectSession) -> AppResult<T>) -> AppResult<T> {
        let mut snapshot = self.session.clone();
        snapshot.csv_tables = self
            .tables
            .lock()
            .map_err(|_| AppError::message("reference.lock_poisoned", "引用表格状态不可用"))?
            .clone();
        let result = query(&mut snapshot)?;
        if snapshot.source_versions != self.session.source_versions {
            return Err(AppError::message(
                "reference.changed",
                "引用来源已变化，请等待同步",
            ));
        }
        self.tables
            .lock()
            .map_err(|_| AppError::message("reference.lock_poisoned", "引用表格状态不可用"))?
            .extend(
                snapshot
                    .csv_tables
                    .into_iter()
                    .filter(|(_, table)| table.rows.is_some()),
            );
        Ok(result)
    }
    pub fn table(&self, table: CsvTableKey) -> AppResult<Arc<Vec<SessionCsvRow>>> {
        self.read(|session| {
            csv_tables::ensure_registered_table_rows(session, table)?;
            Ok(session.csv_tables[table.as_str()]
                .rows
                .clone()
                .expect("loaded reference rows"))
        })
    }
    pub fn location(&self, relative: &str) -> EntityFileLocation {
        EntityFileLocation {
            reference: Some(Box::new(self.identity.clone())),
            source: ResourceSource::Reference,
            root: self.identity.mod_root.clone(),
            rel_path: relative.into(),
            path: Path::new(&self.identity.mod_root)
                .join(relative)
                .to_string_lossy()
                .into_owned(),
        }
    }
    pub fn spec(&self, kind: EntityKind, id: &str) -> Option<LoadedSpecRecord> {
        if let Some(record) = self
            .session
            .spec_records(kind)
            .and_then(|records| records.get(id))
            .filter(|record| record.location.source == ResourceSource::Mod)
        {
            return Some(LoadedSpecRecord {
                location: self.location(&record.location.rel_path),
                ..record.clone()
            });
        }
        let (relative, data) = match kind {
            EntityKind::Variant => self
                .session
                .variant_files
                .iter()
                .find(|file| file.variant_id == id)
                .map(|file| (&file.rel_path, &file.data)),
            EntityKind::Skin => self
                .session
                .skin_files
                .iter()
                .find(|file| file.skin_hull_id == id)
                .map(|file| (&file.rel_path, &file.data)),
            _ => None,
        }?;
        Some(LoadedSpecRecord {
            id: id.into(),
            location: self.location(relative),
            data: data.clone(),
            document: self.session.documents[relative].clone(),
        })
    }
    pub fn locations(&self, kind: EntityKind) -> BTreeMap<String, EntityFileLocation> {
        match kind {
            EntityKind::Variant => self
                .session
                .variant_files
                .iter()
                .map(|file| (file.variant_id.clone(), self.location(&file.rel_path)))
                .collect(),
            EntityKind::Skin => self
                .session
                .skin_files
                .iter()
                .map(|file| (file.skin_hull_id.clone(), self.location(&file.rel_path)))
                .collect(),
            _ => self
                .session
                .spec_records(kind)
                .into_iter()
                .flat_map(|records| records.iter())
                .filter(|(_, record)| record.location.source == ResourceSource::Mod)
                .map(|(id, record)| (id.clone(), self.location(&record.location.rel_path)))
                .collect(),
        }
    }
}
impl ProjectSession {
    pub fn read_spec_value(
        &self,
        kind: EntityKind,
        id: &str,
        source: &EntityFileLocation,
    ) -> AppResult<(FileVersion, Value)> {
        let (version, source) = self.read_spec_source(kind, id, source)?;
        Ok((version, source.content.to_json()?))
    }
    pub fn preceding_references(&self) -> AppResult<impl Iterator<Item = &Arc<ReferenceSnapshot>>> {
        let order = state()?.order.clone();
        let receiver = order.iter().position(|id| id == &self.manifest.session_id);
        Ok(self.references.iter().filter(move |source| {
            match (
                receiver,
                order
                    .iter()
                    .position(|id| id == &source.identity.session_id),
            ) {
                (Some(receiver), Some(source)) => source < receiver,
                _ => true,
            }
        }))
    }
    pub fn spec_records(&self, kind: EntityKind) -> Option<&BTreeMap<String, LoadedSpecRecord>> {
        match kind {
            EntityKind::Ship => Some(&self.ship_files),
            EntityKind::Weapon => Some(&self.weapon_specs),
            EntityKind::Projectile => Some(&self.projectile_specs),
            EntityKind::System => Some(&self.system_files),
            EntityKind::Skill => Some(&self.skill_files),
            EntityKind::Faction => Some(&self.faction_files),
            _ => None,
        }
    }
    pub fn reference_spec(&self, kind: EntityKind, id: &str) -> Option<LoadedSpecRecord> {
        self.references
            .iter()
            .find_map(|source| source.spec(kind, id))
    }
    pub fn read_spec_source(
        &self,
        kind: EntityKind,
        id: &str,
        source: &EntityFileLocation,
    ) -> AppResult<(FileVersion, JsonSource)> {
        if let Some(reference) = source.reference.as_deref() {
            let view = self
                .references
                .iter()
                .find(|view| view.identity == *reference)
                .expect("authorized reference snapshot");
            let record = view.spec(kind, id).expect("authorized reference document");
            return Ok((
                view.session.source_versions[&source.rel_path].clone(),
                (*record.document).clone(),
            ));
        }
        io::read_versioned_json(Path::new(&source.path))
    }
}
