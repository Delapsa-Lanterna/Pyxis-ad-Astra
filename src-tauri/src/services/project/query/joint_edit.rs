use super::super::{
    cache,
    model::{ProjectSession, csv_table_spec, string_field},
    query::entity_targets::{EntityTargetProjection, prepare_entity_targets},
};
use crate::{
    errors::AppResult,
    io::{FsRootBoundary, file_version, read_csv_data, read_json_file},
    models::*,
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

pub fn query_joint_edit(root: &JointEditRoot) -> AppResult<JointEditSnapshot> {
    let _lease = crate::io::acquire_root_write_lock(Path::new(&root.mod_root))?;
    super::super::ensure_project_session_mod_root(&root.session_id, &root.mod_root)?;
    let handle = cache::session_handle(&root.session_id)?;
    let mut session = cache::lock_ready_session(&handle)?;
    let mut graph = JointGraph {
        session: &mut session,
        records: BTreeMap::new(),
        visiting: BTreeSet::new(),
        tables: BTreeMap::new(),
        targets: BTreeMap::new(),
        core_systems: None,
    };
    match root.kind {
        JointEditKind::Ship => graph.spec(EntityKind::Ship, &root.id, "root")?,
        JointEditKind::Weapon => graph.spec(EntityKind::Weapon, &root.id, "root")?,
        JointEditKind::Variant => graph.spec(EntityKind::Variant, &root.id, "root")?,
        JointEditKind::Wing => {
            let row = graph.csv(
                CsvTableKey::Wings,
                BTreeMap::from([("id".into(), root.id.clone())]),
                "root",
            )?;
            if let Some(id) = string_field(&row, "variant") {
                graph.spec(EntityKind::Variant, &id, &root.id)?;
            }
        }
    }
    let mut records = graph.records.into_values().collect::<Vec<_>>();
    cache::ensure_registered_table_rows(&mut session, CsvTableKey::Wings)?;
    let references = reference_catalog(&session)?;
    for record in &mut records {
        if let Some(owners) = references.get(&record.key) {
            record.referenced_by = owners.iter().cloned().collect();
        }
    }
    let mut versions = BTreeMap::new();
    for record in &records {
        for version in &record.base_versions {
            versions.insert(windows_path_key(&version.path), version.clone());
        }
    }
    Ok(JointEditSnapshot {
        root: root.clone(),
        records,
        base_versions: versions.into_values().collect(),
    })
}

pub fn prepare_joint_edit(draft: &JointEditDraft) -> AppResult<JointEditPrepared> {
    let mut snapshot = query_joint_edit(&draft.baseline.root)?;
    let current = snapshot
        .records
        .iter()
        .map(|record| (&record.key, record))
        .collect::<BTreeMap<_, _>>();
    let mut values = BTreeMap::new();
    let mut conflicts = Vec::new();
    for base in &draft.baseline.records {
        let disk = current
            .get(&base.key)
            .map(|record| record.value.clone())
            .unwrap_or(JointValue::Missing);
        let edited = draft.values.get(&base.key).unwrap_or(&base.value);
        values.insert(
            base.key.clone(),
            crate::domain::joint_edit::merge_joint_value(
                &base.key,
                &[],
                &base.value,
                &disk,
                edited,
                &mut conflicts,
            ),
        );
    }
    for record in &snapshot.records {
        values
            .entry(record.key.clone())
            .or_insert_with(|| record.value.clone());
    }
    for record in &snapshot.records {
        if let (JointRecordTarget::Spec { target }, Some(JointValue::Present(data))) =
            (&record.target, values.get(&record.key))
        {
            let definition =
                crate::domain::editor_config_definitions::entity_spec_definition(target.kind)
                    .expect("joint spec has format");
            if let Some(id) = data
                .get(definition.id_field)
                .and_then(Value::as_str)
                .filter(|id| *id != target.id)
            {
                let id =
                    crate::domain::config::validate_config_id(id, definition.invalid_id_message)?;
                let relative = if target.state == EntityTargetState::Create {
                    definition.default_rel_path(id)
                } else {
                    crate::io::forward_slash_path(
                        &Path::new(&target.write.rel_path)
                            .with_file_name(format!("{id}{}", definition.extension)),
                    )
                };
                let path =
                    FsRootBoundary::new(Path::new(&snapshot.root.mod_root), "joint identity root")?
                        .resolve_relative(&relative, "joint identity destination")?;
                let version = file_version(&path)?;
                if !snapshot.base_versions.iter().any(|current| {
                    windows_path_key(&current.path) == windows_path_key(&version.path)
                }) {
                    snapshot.base_versions.push(version);
                }
            }
        }
    }
    Ok(JointEditPrepared {
        snapshot,
        values,
        conflicts,
    })
}

struct JointGraph<'a> {
    session: &'a mut ProjectSession,
    records: BTreeMap<String, JointEditRecord>,
    visiting: BTreeSet<(EntityKind, String)>,
    tables: BTreeMap<CsvTableKey, JointCsvCatalog>,
    targets: BTreeMap<EntityKind, EntityTargetProjection>,
    core_systems: Option<BTreeMap<String, LoadedSpecRecord>>,
}

impl JointGraph<'_> {
    fn csv(
        &mut self,
        table: CsvTableKey,
        identity: BTreeMap<String, String>,
        parent: &str,
    ) -> AppResult<Value> {
        let key = serde_json::to_string(&("csv", table, &identity))?;
        if let Some(record) = self.records.get_mut(&key) {
            if !record.referenced_by.iter().any(|id| id == parent) {
                record.referenced_by.push(parent.into());
            }
            return Ok(match &record.value {
                JointValue::Present(value) => value.clone(),
                JointValue::Missing => Value::Null,
            });
        }
        if !self.tables.contains_key(&table) {
            cache::ensure_registered_table_rows(self.session, table)?;
            self.tables
                .insert(table, JointCsvCatalog::load(self.session, table)?);
        }
        let catalog = &self.tables[&table];
        let identity_key = serde_json::to_string(&identity)?;
        let found = catalog.rows.get(&identity_key);
        let value = found.map(|row| Value::Object(row.data.clone()));
        let source = found.map(|row| row.source.clone());
        let source_version = found.map(|row| row.version.clone());
        let row_key = found
            .filter(|row| row.source.source == ResourceSource::Mod)
            .map(|row| row.row_key.clone())
            .unwrap_or_else(|| format!("{}:new:joint-{}", table.as_str(), self.records.len()));
        let record = JointEditRecord {
            key: key.clone(),
            target: JointRecordTarget::Csv {
                table,
                row_key,
                identity,
                write: catalog.write.clone(),
            },
            source,
            source_version,
            value: value
                .clone()
                .map(JointValue::Present)
                .unwrap_or(JointValue::Missing),
            base_versions: vec![catalog.version.clone()],
            resource_refs: BTreeMap::new(),
            referenced_by: vec![parent.into()],
        };
        self.records.insert(key, record);
        Ok(value.unwrap_or(Value::Null))
    }

    fn spec(&mut self, kind: EntityKind, id: &str, parent: &str) -> AppResult<()> {
        let key = serde_json::to_string(&("spec", kind, id))?;
        if let Some(record) = self.records.get_mut(&key)
            && !record.referenced_by.iter().any(|entry| entry == parent)
        {
            record.referenced_by.push(parent.into());
        }
        if !self.visiting.insert((kind, id.into())) {
            return Ok(());
        }
        if !self.targets.contains_key(&kind) {
            self.targets
                .insert(kind, prepare_entity_targets(self.session, kind)?);
        }
        let info = self.targets[&kind].describe(self.session, id);
        let mut target = info.target;
        if target.source.is_none() {
            target.source = self.core_source(kind, id)?;
        }
        let value = target
            .source
            .as_ref()
            .filter(|source| Path::new(&source.path).exists())
            .map(|source| read_json_file(Path::new(&source.path)))
            .transpose()?;
        let source = target.source.clone();
        let mut versions = vec![file_version(Path::new(&target.write.path))?];
        for version in info.base_versions {
            if !versions
                .iter()
                .any(|current| windows_path_key(&current.path) == windows_path_key(&version.path))
            {
                versions.push(version);
            }
        }
        let resources = match (&value, kind) {
            (Some(data), EntityKind::Ship) => {
                super::super::definitions::entity_resources::ship_resource_refs(id, data)
            }
            (Some(data), EntityKind::Weapon) => {
                super::super::definitions::entity_resources::weapon_resource_refs(id, data)
            }
            _ => BTreeMap::new(),
        };
        let mut resources = resources;
        if source
            .as_ref()
            .is_some_and(|source| source.source == ResourceSource::Core)
        {
            for resource in resources.values_mut() {
                resource.source = ResourceSource::Core;
            }
        }
        let source_version = source
            .as_ref()
            .map(|source| file_version(Path::new(&source.path)))
            .transpose()?;
        self.records.insert(
            key,
            JointEditRecord {
                key: serde_json::to_string(&("spec", kind, id))?,
                target: JointRecordTarget::Spec { target },
                source,
                source_version,
                value: value
                    .clone()
                    .map(JointValue::Present)
                    .unwrap_or(JointValue::Missing),
                base_versions: versions,
                resource_refs: resources,
                referenced_by: vec![parent.into()],
            },
        );
        let csv_table = match kind {
            EntityKind::Ship => Some(CsvTableKey::Ships),
            EntityKind::Weapon => Some(CsvTableKey::Weapons),
            EntityKind::System => Some(CsvTableKey::ShipSystems),
            _ => None,
        };
        if let Some(table) = csv_table {
            self.csv(table, BTreeMap::from([("id".into(), id.into())]), id)?;
        }
        let description_type = match kind {
            EntityKind::Ship | EntityKind::Skin => Some("SHIP"),
            EntityKind::Weapon => Some("WEAPON"),
            EntityKind::System => Some("SHIP_SYSTEM"),
            _ => None,
        };
        if let Some(typ) = description_type {
            let description_id = value
                .as_ref()
                .and_then(|data| string_field(data, "descriptionId"))
                .unwrap_or_else(|| id.into());
            self.csv(
                CsvTableKey::Descriptions,
                BTreeMap::from([("id".into(), description_id), ("type".into(), typ.into())]),
                id,
            )?;
        }
        let Some(data) = value else {
            return Ok(());
        };
        if let Some(system) =
            string_field(&data, "shipSystemId").or_else(|| string_field(&data, "systemId"))
        {
            self.spec(EntityKind::System, &system, id)?;
        }
        for field in ["builtInMods", "hullMods", "permaMods", "sMods"] {
            if let Some(mods) = data.get(field).and_then(Value::as_array) {
                for module in mods.iter().filter_map(Value::as_str) {
                    self.csv(
                        CsvTableKey::Hullmods,
                        BTreeMap::from([("id".into(), module.into())]),
                        id,
                    )?;
                }
            }
        }
        if matches!(kind, EntityKind::Variant | EntityKind::Skin) {
            let field = if kind == EntityKind::Variant {
                "hullId"
            } else {
                "baseHullId"
            };
            if let Some(hull) = string_field(&data, field) {
                let hull_kind = if self.has_skin(&hull)? {
                    EntityKind::Skin
                } else {
                    EntityKind::Ship
                };
                self.spec(hull_kind, &hull, id)?;
            }
        }
        if kind == EntityKind::Skin {
            self.csv(
                CsvTableKey::Ships,
                BTreeMap::from([("id".into(), id.into())]),
                id,
            )?;
        }
        if kind == EntityKind::Variant {
            if let Some(modules) = data.get("modules").and_then(Value::as_object) {
                for module in modules.values().filter_map(Value::as_str) {
                    self.spec(EntityKind::Variant, module, id)?;
                }
            }
            if let Some(groups) = data.get("weaponGroups").and_then(Value::as_array) {
                for group in groups {
                    if let Some(weapons) = group.get("weapons").and_then(Value::as_object) {
                        for weapon in weapons.values().filter_map(Value::as_str) {
                            self.spec(EntityKind::Weapon, weapon, id)?;
                        }
                    }
                }
            }
        }
        for field in ["wings", "builtInWings"] {
            if let Some(wings) = data.get(field).and_then(Value::as_array) {
                for wing in wings
                    .iter()
                    .filter_map(Value::as_str)
                    .filter(|id| !id.is_empty())
                {
                    let row = self.csv(
                        CsvTableKey::Wings,
                        BTreeMap::from([("id".into(), wing.into())]),
                        id,
                    )?;
                    if let Some(variant) = string_field(&row, "variant") {
                        self.spec(EntityKind::Variant, &variant, wing)?;
                    }
                }
            }
        }
        if let Some(weapons) = data.get("builtInWeapons").and_then(Value::as_object) {
            for weapon in weapons.values().filter_map(Value::as_str) {
                self.spec(EntityKind::Weapon, weapon, id)?;
            }
        }
        if kind == EntityKind::Weapon
            && let Some(projectile) = string_field(&data, "projectileSpecId")
        {
            self.spec(EntityKind::Projectile, &projectile, id)?;
        }
        Ok(())
    }

    fn has_skin(&self, id: &str) -> AppResult<bool> {
        if self
            .session
            .skin_files
            .iter()
            .any(|skin| skin.skin_hull_id == id)
        {
            return Ok(true);
        }
        self.session
            .manifest
            .starsector_root
            .as_ref()
            .map(|root| {
                cache::load_core_skin_files(root)
                    .map(|files| files.iter().any(|skin| skin.skin_hull_id == id))
            })
            .transpose()
            .map(|value| value.unwrap_or(false))
    }

    fn core_source(&mut self, kind: EntityKind, id: &str) -> AppResult<Option<EntityFileLocation>> {
        let Some(root) = &self.session.manifest.starsector_root else {
            return Ok(None);
        };
        let core = Path::new(root).join("starsector-core");
        Ok(match kind {
            EntityKind::Ship => cache::load_core_ship_files(root)?
                .get(id)
                .map(|record| record.location.clone()),
            EntityKind::Weapon => cache::core::load_core_weapon_specs(root)?
                .get(id)
                .map(|record| record.location.clone()),
            EntityKind::Projectile => cache::load_core_projectile_specs(root)?
                .get(id)
                .map(|record| record.location.clone()),
            EntityKind::Variant => cache::load_core_variant_files(root)?
                .iter()
                .find(|file| file.variant_id == id)
                .map(|file| location(ResourceSource::Core, &core, &file.rel_path)),
            EntityKind::Skin => cache::load_core_skin_files(root)?
                .iter()
                .find(|file| file.skin_hull_id == id)
                .map(|file| location(ResourceSource::Core, &core, &file.rel_path)),
            EntityKind::System => {
                if self.core_systems.is_none() {
                    self.core_systems = Some(cache::load_spec_records(
                        &core,
                        "data/shipsystems",
                        "system",
                        "id",
                        ResourceSource::Core,
                    )?);
                }
                self.core_systems
                    .as_ref()
                    .expect("core systems loaded")
                    .get(id)
                    .map(|record| record.location.clone())
            }
            _ => None,
        })
    }
}

fn location(source: ResourceSource, root: &Path, rel_path: &str) -> EntityFileLocation {
    EntityFileLocation {
        source,
        root: root.to_string_lossy().into(),
        rel_path: rel_path.into(),
        path: root.join(rel_path).to_string_lossy().into(),
    }
}

fn reference_catalog(session: &ProjectSession) -> AppResult<BTreeMap<String, BTreeSet<String>>> {
    let mut references = BTreeMap::<String, BTreeSet<String>>::new();
    let mut add = |key: String, owner: String| {
        references.entry(key).or_default().insert(owner);
    };
    let skin_ids = session
        .skin_files
        .iter()
        .map(|skin| skin.skin_hull_id.as_str())
        .collect::<BTreeSet<_>>();
    let records = session
        .ship_files
        .iter()
        .map(|(id, record)| (EntityKind::Ship, id.as_str(), &record.data))
        .chain(
            session
                .weapon_specs
                .iter()
                .map(|(id, record)| (EntityKind::Weapon, id.as_str(), &record.data)),
        )
        .chain(session.variant_files.iter().map(|record| {
            (
                EntityKind::Variant,
                record.variant_id.as_str(),
                &record.data,
            )
        }))
        .chain(
            session
                .skin_files
                .iter()
                .map(|record| (EntityKind::Skin, record.skin_hull_id.as_str(), &record.data)),
        );
    for (kind, id, data) in records {
        let owner = format!("{kind:?}:{id}");
        add(serde_json::to_string(&("spec", kind, id))?, owner.clone());
        let description_type = match kind {
            EntityKind::Ship | EntityKind::Skin => Some("SHIP"),
            EntityKind::Weapon => Some("WEAPON"),
            _ => None,
        };
        if let Some(typ) = description_type {
            let description_id = string_field(data, "descriptionId").unwrap_or_else(|| id.into());
            add(
                serde_json::to_string(&(
                    "csv",
                    CsvTableKey::Descriptions,
                    BTreeMap::from([("id", description_id.as_str()), ("type", typ)]),
                ))?,
                owner.clone(),
            );
        }
        for field in ["hullId", "baseHullId"] {
            if let Some(hull) = string_field(data, field) {
                let target = if skin_ids.contains(hull.as_str()) {
                    EntityKind::Skin
                } else {
                    EntityKind::Ship
                };
                add(
                    serde_json::to_string(&("spec", target, hull))?,
                    owner.clone(),
                );
            }
        }
        if let Some(system) =
            string_field(data, "shipSystemId").or_else(|| string_field(data, "systemId"))
        {
            add(
                serde_json::to_string(&("spec", EntityKind::System, system))?,
                owner.clone(),
            );
        }
        if let Some(projectile) = string_field(data, "projectileSpecId") {
            add(
                serde_json::to_string(&("spec", EntityKind::Projectile, projectile))?,
                owner.clone(),
            );
        }
        if let Some(weapons) = data.get("builtInWeapons").and_then(Value::as_object) {
            for weapon in weapons.values().filter_map(Value::as_str) {
                add(
                    serde_json::to_string(&("spec", EntityKind::Weapon, weapon))?,
                    owner.clone(),
                );
            }
        }
        if let Some(groups) = data.get("weaponGroups").and_then(Value::as_array) {
            for group in groups {
                if let Some(weapons) = group.get("weapons").and_then(Value::as_object) {
                    for weapon in weapons.values().filter_map(Value::as_str) {
                        add(
                            serde_json::to_string(&("spec", EntityKind::Weapon, weapon))?,
                            owner.clone(),
                        );
                    }
                }
            }
        }
        if let Some(modules) = data.get("modules").and_then(Value::as_object) {
            for module in modules.values().filter_map(Value::as_str) {
                add(
                    serde_json::to_string(&("spec", EntityKind::Variant, module))?,
                    owner.clone(),
                );
            }
        }
    }
    if let Some(rows) = session
        .csv_tables
        .get(CsvTableKey::Wings.as_str())
        .and_then(|table| table.rows.as_ref())
    {
        for row in rows.iter().filter(|row| !row.is_comment) {
            if let (Some(id), Some(variant)) = (
                row.data.get("id").and_then(Value::as_str),
                row.data.get("variant").and_then(Value::as_str),
            ) {
                add(
                    serde_json::to_string(&("spec", EntityKind::Variant, variant))?,
                    format!("Wing:{id}"),
                );
            }
        }
    }
    Ok(references)
}

struct JointCsvRow {
    row_key: String,
    data: serde_json::Map<String, Value>,
    source: EntityFileLocation,
    version: FileVersion,
}
struct JointCsvCatalog {
    write: EntityFileLocation,
    version: FileVersion,
    rows: BTreeMap<String, JointCsvRow>,
}
impl JointCsvCatalog {
    fn load(session: &ProjectSession, table: CsvTableKey) -> AppResult<Self> {
        let relative = csv_table_spec(table).rel_path;
        let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "joint CSV")?;
        let path = boundary.resolve_relative(relative, "joint CSV")?;
        let write = location(ResourceSource::Mod, boundary.root(), relative);
        let version = file_version(&path)?;
        let (_, mod_rows, _) = cache::csv::read_table_snapshot(session, table)?;
        let mut catalog = Self {
            write: write.clone(),
            version: version.clone(),
            rows: BTreeMap::new(),
        };
        catalog.add_rows(table, &mod_rows, &write, &version)?;
        if let Some(root) = &session.manifest.starsector_root {
            let core = cache::core::core_dir(root)?;
            let source_path = core.join(relative);
            if source_path.exists() {
                let source = location(ResourceSource::Core, &core, relative);
                let source_version = file_version(&source_path)?;
                let csv = read_csv_data(&source_path)?;
                let rows = csv
                    .rows
                    .into_iter()
                    .enumerate()
                    .map(|(index, row)| super::super::model::SessionCsvRow {
                        row_key: format!("core:{}:row:{index}", table.as_str()),
                        data: row.data,
                        is_comment: row.is_comment,
                    })
                    .collect::<Vec<_>>();
                catalog.add_rows(table, &rows, &source, &source_version)?;
            }
        }
        Ok(catalog)
    }
    fn add_rows(
        &mut self,
        table: CsvTableKey,
        rows: &[super::super::model::SessionCsvRow],
        source: &EntityFileLocation,
        version: &FileVersion,
    ) -> AppResult<()> {
        for row in rows.iter().filter(|row| !row.is_comment) {
            let Some(id) = row
                .data
                .get(csv_table_spec(table).entity_id_field)
                .and_then(Value::as_str)
            else {
                continue;
            };
            let mut identity = BTreeMap::from([("id".to_string(), id.to_string())]);
            if table == CsvTableKey::Descriptions {
                identity.insert(
                    "type".into(),
                    row.data
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .into(),
                );
            }
            self.rows
                .entry(serde_json::to_string(&identity)?)
                .or_insert_with(|| JointCsvRow {
                    row_key: row.row_key.clone(),
                    data: row.data.clone(),
                    source: source.clone(),
                    version: version.clone(),
                });
        }
        Ok(())
    }
}
