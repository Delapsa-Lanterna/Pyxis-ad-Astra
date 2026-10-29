use super::super::{
    cache,
    model::{LoadedSpecRecord, ProjectSession, ReferenceView, SessionCsvRow},
};
#[cfg(test)]
#[path = "references_tests.rs"]
mod tests;
use crate::{
    errors::{AppError, AppResult},
    models::*,
};
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{Arc, LazyLock, Mutex},
};

static REFERENCES: LazyLock<Mutex<ReferenceSources>> = LazyLock::new(Default::default);
static REVISION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub(crate) fn reference_revision() -> u64 {
    REVISION.load(std::sync::atomic::Ordering::Acquire)
}
fn state() -> AppResult<std::sync::MutexGuard<'static, ReferenceSources>> {
    REFERENCES
        .lock()
        .map_err(|_| AppError::message("reference.lock_poisoned", "引用来源状态不可用"))
}
pub(crate) fn reference_sources() -> AppResult<ReferenceSources> {
    Ok(state()?.clone())
}

pub(crate) fn reference_updates() -> AppResult<Vec<CommittedSessionUpdate>> {
    let registered = cache::lock_registry()?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    registered
        .into_iter()
        .map(|registered| {
            let mut session = cache::lock_session(&registered)?;
            session.references.clear();
            Ok(CommittedSessionUpdate {
                session_id: session.manifest.session_id.clone(),
                mod_root: session.manifest.mod_root.clone(),
                projection: ProjectSessionInvalidationResult {
                    manifest: session.manifest.clone(),
                    invalidation: ProjectInvalidation {
                        session: true,
                        ..Default::default()
                    },
                }
                .into(),
            })
        })
        .collect()
}

pub(crate) fn set_reference_sources(ids: Vec<String>) -> AppResult<ReferenceSources> {
    let mut sources = Vec::new();
    for id in &ids {
        let handle = cache::session_handle(id)?;
        let session = cache::lock_ready_session(&handle)?;
        let mut registered = cache::lock_registry()?;
        let source = registered
            .get_mut(id)
            .ok_or_else(|| AppError::message("session.unknown", format!("引用来源已关闭：{id}")))?;
        let view = Arc::new(ReferenceView::new(&session));
        sources.push(view.identity.clone());
        source.reference = Some(view);
    }
    for (id, source) in cache::lock_registry()?.iter_mut() {
        if !ids.contains(id) {
            source.reference = None;
        }
    }
    let mut state = state()?;
    if state.sources != sources {
        state.sources = sources;
        state.revision += 1;
        REVISION.store(state.revision, std::sync::atomic::Ordering::Release);
    }
    Ok(state.clone())
}

pub(crate) fn reference_sources_changed(
    session_id: Option<&str>,
) -> AppResult<Option<ReferenceSources>> {
    let Some(id) = session_id else {
        return Ok(None);
    };
    if !state()?
        .sources
        .iter()
        .any(|source| source.session_id == id)
    {
        return Ok(None);
    }
    let handle = cache::lock_registry()?.get(id).cloned();
    let view = handle
        .as_ref()
        .map(|handle| {
            cache::lock_ready_session(handle).map(|session| Arc::new(ReferenceView::new(&session)))
        })
        .transpose()?;
    let mut registered = cache::lock_registry()?;
    if let Some(source) = registered.get_mut(id) {
        source.reference = view;
    }
    let mut state = state()?;
    state
        .sources
        .retain(|source| registered.contains_key(&source.session_id));
    state.revision += 1;
    REVISION.store(state.revision, std::sync::atomic::Ordering::Release);
    Ok(Some(state.clone()))
}

impl ReferenceView {
    fn new(session: &ProjectSession) -> Self {
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
        let tables = self
            .tables
            .lock()
            .map_err(|_| AppError::message("reference.lock_poisoned", "引用数据不可用"))?
            .clone();
        let mut snapshot = self.session.clone();
        snapshot.csv_tables = tables;
        // Dependent projections may read other sources, so cache locks cannot span the query.
        let result = query(&mut snapshot)?;
        if snapshot.source_versions != self.session.source_versions {
            return Err(AppError::message(
                "reference.changed",
                "引用来源已变化，请等待同步",
            ));
        }
        self.tables
            .lock()
            .map_err(|_| AppError::message("reference.lock_poisoned", "引用数据不可用"))?
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
            cache::ensure_registered_table_rows(session, table)?;
            Ok(session.csv_tables[table.as_str()]
                .rows
                .clone()
                .expect("loaded reference rows"))
        })
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
    pub fn location(&self, relative: &str) -> EntityFileLocation {
        EntityFileLocation {
            reference: Some(Box::new(self.identity.clone())),
            source: ResourceSource::Reference,
            root: self.identity.mod_root.clone(),
            rel_path: relative.into(),
            path: Path::new(&self.identity.mod_root)
                .join(relative)
                .to_string_lossy()
                .into(),
        }
    }
    pub fn resource(&self, resource: &mut ResourceRef) {
        if resource.source != ResourceSource::Core && resource.reference.is_none() {
            resource.source = ResourceSource::Reference;
            resource.reference = Some(self.identity.clone());
        }
    }
}

impl ProjectSession {
    pub fn read_spec_source(
        &self,
        kind: EntityKind,
        id: &str,
        source: &EntityFileLocation,
    ) -> AppResult<(FileVersion, serde_json::Value)> {
        if let Some(identity) = source.reference.as_deref() {
            let view = self
                .references
                .iter()
                .find(|view| &view.identity == identity)
                .expect("authorized reference source");
            let record = view
                .spec(kind, id)
                .expect("reference spec belongs to snapshot");
            return Ok((
                view.session.source_versions[&source.rel_path].clone(),
                record.data,
            ));
        }
        crate::io::read_versioned_json(Path::new(&source.path))
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
        self.references.iter().find_map(|view| view.spec(kind, id))
    }
    pub fn reference_resource(
        &self,
        source: &EntityFileLocation,
        resources: &mut BTreeMap<String, ResourceRef>,
    ) {
        if let Some(identity) = source.reference.as_deref() {
            for resource in resources.values_mut().filter(|resource| {
                resource.source != ResourceSource::Core && resource.reference.is_none()
            }) {
                resource.source = ResourceSource::Reference;
                resource.reference = Some(identity.clone());
            }
        }
    }
}

pub(super) fn prepare(session_id: &str) -> AppResult<(u64, Vec<Arc<ReferenceView>>)> {
    let registered = cache::lock_registry()?;
    let state = state()?;
    Ok((
        state.revision,
        state
            .sources
            .iter()
            .filter(|source| source.session_id != session_id)
            .filter_map(|source| registered.get(&source.session_id)?.reference.clone())
            .collect(),
    ))
}
