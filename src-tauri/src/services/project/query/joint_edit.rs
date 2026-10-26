use super::super::{
    cache,
    model::{LoadedSpecRecord, ProjectSession, csv_table_spec, string_field},
    query::entity_targets::{EntityTargetProjection, prepare_entity_targets},
};
use crate::services::project::sources;
use crate::{
    domain::joint_hull::description_id,
    errors::{AppError, AppResult},
    io::{FsRootBoundary, file_version},
    models::*,
};
use serde_json::Value;
use std::{
    collections::{BTreeMap, BTreeSet},
    path::Path,
};

#[cfg(test)]
pub fn query_joint_edit(root: &JointEditRoot) -> AppResult<JointEditSnapshot> {
    query_joint_edit_values(root, None, &[])
}

pub fn query_joint_edit_request(query: &JointEditQuery) -> AppResult<JointEditSnapshot> {
    let _lease = crate::io::acquire_root_write_lock(Path::new(&query.root.mod_root))?;
    let mut root = query.root.clone();
    if let Some(row_key) = &query.row_key {
        super::super::ensure_project_session_mod_root(&root.session_id, &root.mod_root)?;
        let table = match root.kind {
            JointEditKind::Ship => CsvTableKey::Ships,
            JointEditKind::Weapon => CsvTableKey::Weapons,
            JointEditKind::Wing => CsvTableKey::Wings,
            JointEditKind::Variant => {
                return Err(AppError::message(
                    "joint.row_kind",
                    "装配目标没有 CSV 行身份",
                ));
            }
        };
        let handle = cache::session_handle(&root.session_id)?;
        let mut session = cache::lock_ready_session(&handle)?;
        cache::ensure_registered_table_rows(&mut session, table)?;
        let (_, rows, _) = cache::csv::read_table_snapshot(&session, table)?;
        let row = rows
            .iter()
            .find(|row| row.row_key == *row_key && !row.is_comment)
            .ok_or_else(|| AppError::message("joint.row_changed", "来源行已变化"))?;
        root.id = row
            .data
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::message("joint.id_missing", "来源行缺少 ID"))?
            .into();
    }
    query_joint_edit_values(&root, query.values.as_ref(), &query.new_sources)
}

pub fn query_variant_catalog(
    root: &JointEditRoot,
    kind: JointVariantCatalogKind,
    source: Option<ResourceSource>,
) -> AppResult<JointVariantCatalogRead> {
    let _lease = crate::io::acquire_root_write_lock(Path::new(&root.mod_root))?;
    super::super::ensure_project_session_mod_root(&root.session_id, &root.mod_root)?;
    let handle = cache::session_handle(&root.session_id)?;
    let mut session = cache::lock_ready_session(&handle)?;
    let (reference_settings, damage_icons) = reference_settings(&session)?;
    let catalog = if matches!(kind, JointVariantCatalogKind::Variants) {
        module_variant_catalog(&mut session, source.expect("module catalog source"))?
    } else {
        variant_catalog(&mut session, kind, damage_icons)?
    };
    let mut root = root.clone();
    root.mod_root = session.manifest.mod_root.clone();
    Ok(JointVariantCatalogRead {
        root,
        reference_settings,
        catalog,
    })
}

pub(in crate::services::project) fn query_joint_edit_values(
    root: &JointEditRoot,
    values: Option<&BTreeMap<String, JointValue>>,
    new_sources: &[JointSourceCreate],
) -> AppResult<JointEditSnapshot> {
    for source in new_sources {
        if !matches!(
            source.kind,
            EntityKind::Ship | EntityKind::Skin | EntityKind::Variant
        ) {
            return Err(AppError::message("joint.create_kind", "补全来源类型无效"));
        }
        crate::domain::entity_identity::validate_entity_id(&source.id, "补全来源 ID 无效")?;
    }
    let _lease = crate::io::acquire_root_write_lock(Path::new(&root.mod_root))?;
    super::super::ensure_project_session_mod_root(&root.session_id, &root.mod_root)?;
    let handle = cache::session_handle(&root.session_id)?;
    let mut session = cache::lock_ready_session(&handle)?;
    let mut root = root.clone();
    root.mod_root = session.manifest.mod_root.clone();
    let (reference_settings, damage_icons) = reference_settings(&session)?;
    let mut graph = JointGraph {
        session: &mut session,
        records: BTreeMap::new(),
        visiting: BTreeSet::new(),
        tables: BTreeMap::new(),
        targets: BTreeMap::new(),
        core_systems: None,
        core_sources: BTreeMap::new(),
        scope: JointGraphScope::Editing,
        draft_values: values,
        bindings: BTreeMap::new(),
        damage_icons,
        new_sources,
    };
    match root.kind {
        JointEditKind::Ship => graph.spec(EntityKind::Ship, &root.id, "root")?,
        JointEditKind::Weapon => graph.spec(EntityKind::Weapon, &root.id, "root")?,
        JointEditKind::Variant => {
            graph.bindings.insert(
                "variant".into(),
                serde_json::to_string(&("spec", EntityKind::Variant, &root.id))?,
            );
            graph.spec(EntityKind::Variant, &root.id, "root")?;
        }
        JointEditKind::Wing => {
            graph.bindings.insert(
                "csv".into(),
                serde_json::to_string(&(
                    "csv",
                    CsvTableKey::Wings,
                    BTreeMap::from([("id", root.id.as_str())]),
                ))?,
            );
            let row = graph.csv(
                CsvTableKey::Wings,
                BTreeMap::from([("id".into(), root.id.clone())]),
                "root",
            )?;
            if let Some(id) = string_field(&row, "variant") {
                graph.bindings.insert(
                    "variant".into(),
                    serde_json::to_string(&("spec", EntityKind::Variant, &id))?,
                );
                graph.spec(EntityKind::Variant, &id, &root.id)?;
            }
        }
    }
    let mut bindings = graph.bindings;
    let new_sources = graph
        .new_sources
        .iter()
        .filter(|source| {
            graph.records.contains_key(
                &serde_json::to_string(&("spec", source.kind, &source.id))
                    .expect("source identity serializes"),
            )
        })
        .cloned()
        .collect();
    let mut records = graph.records.into_values().collect::<Vec<_>>();
    let hull = if let Some(key) = bindings.get("variant") {
        crate::domain::joint_hull::project_joint_hull(&records, key)?
    } else {
        None
    };
    if let Some(hull) = &hull {
        if root.kind == JointEditKind::Wing {
            bindings.insert("spec".into(), hull.hull_key.clone());
        }
        bindings.insert(
            "hullCsv".into(),
            hull.fields["hitpoints"].record_key.clone(),
        );
        let description_owner = hull.skin_keys.last().unwrap_or(&hull.hull_key);
        let owner = records
            .iter()
            .find(|record| &record.key == description_owner)
            .expect("hull projection owner belongs to graph");
        let target = match &owner.target {
            JointRecordTarget::Spec { target } => target,
            _ => unreachable!("hull owner is a spec"),
        };
        let source = match &owner.value {
            JointValue::Present(data) => Some(data),
            JointValue::Missing => None,
        };
        if let Some(description_id) = description_id(target.kind, &target.id, source) {
            bindings.insert(
                "description".into(),
                serde_json::to_string(&(
                    "csv",
                    CsvTableKey::Descriptions,
                    BTreeMap::from([("id", description_id.as_str()), ("type", "SHIP")]),
                ))?,
            );
        }
        let system = &hull.fields["system id"];
        if let Some(record) = records
            .iter()
            .find(|record| record.key == system.record_key)
            && let JointValue::Present(data) = &record.value
            && let Some(id) = string_field(data, &system.path)
        {
            bindings.insert(
                "system".into(),
                serde_json::to_string(&("spec", EntityKind::System, id))?,
            );
        }
        let field = &hull.fields["shield type"];
        if let Some(record) = records.iter().find(|record| record.key == field.record_key)
            && let JointValue::Present(data) = &record.value
            && string_field(data, &field.path).as_deref() == Some("PHASE")
        {
            let id = string_field(data, "defense id").unwrap_or_else(|| "phasecloak".into());
            bindings.insert(
                "defense".into(),
                serde_json::to_string(&("spec", EntityKind::System, id))?,
            );
        }
    }
    let mut variants = BTreeMap::new();
    if root.kind == JointEditKind::Variant {
        let mut pending = records.iter().filter(|record| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant)).map(|record| record.key.clone()).collect::<Vec<_>>();
        let mut visited = BTreeSet::new();
        while let Some(key) = pending.pop() {
            if !visited.insert(key.clone()) {
                continue;
            }
            if let Some(hull) = crate::domain::joint_hull::project_joint_hull(&records, &key)? {
                pending.extend(hull.modules.iter().map(|module| module.variant_key.clone()));
                variants.insert(key, hull);
            }
        }
    }
    let variant_ids = records
        .iter()
        .filter_map(|record| match &record.target {
            JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant => {
                Some(target.id.clone())
            }
            _ => None,
        })
        .collect::<BTreeSet<_>>();
    let parents = session.variant_files.clone();
    for parent in parents {
        let (parent_version, content) = crate::io::read_versioned_json(Path::new(&parent.path))?;
        if !crate::domain::joint_hull::module_entries(content.get("modules"))
            .iter()
            .any(|(_, id)| variant_ids.contains(id))
        {
            continue;
        }
        let key = serde_json::to_string(&("spec", EntityKind::Variant, &parent.variant_id))?;
        if records.iter().any(|record| record.key == key) {
            continue;
        }
        let mut info = super::entity_targets::describe_entity_target(
            &mut session,
            EntityKind::Variant,
            &parent.variant_id,
        )?;
        for version in &mut info.base_versions {
            if windows_path_key(&version.path) == windows_path_key(&parent_version.path) {
                *version = parent_version.clone();
            }
        }
        let source = info.target.source.clone();
        records.push(JointEditRecord {
            key,
            target: JointRecordTarget::Spec {
                target: info.target,
            },
            source,
            source_version: Some(parent_version),
            value: JointValue::Present(content),
            base_versions: info.base_versions,
            resource_refs: BTreeMap::new(),
            referenced_by: vec!["module-parent".into()],
        });
    }
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
    for version in records
        .iter()
        .filter_map(|record| record.source_version.as_ref())
    {
        if let Some(accepted) = versions.get_mut(&windows_path_key(&version.path)) {
            *accepted = version.clone();
        }
    }
    Ok(JointEditSnapshot {
        root: root.clone(),
        bindings,
        reference_settings,
        records,
        base_versions: versions.into_values().collect(),
        hull,
        new_sources,
        variants,
        catalog: None,
    })
}

fn variant_catalog(
    session: &mut ProjectSession,
    kind: JointVariantCatalogKind,
    damage_icons: BTreeMap<String, ResourceRef>,
) -> AppResult<JointVariantCatalog> {
    let table = match kind {
        JointVariantCatalogKind::Weapons => CsvTableKey::Weapons,
        JointVariantCatalogKind::Wings => CsvTableKey::Wings,
        JointVariantCatalogKind::Hullmods => CsvTableKey::Hullmods,
        JointVariantCatalogKind::Variants => unreachable!("module catalogs use hull summaries"),
    };
    cache::ensure_registered_table_rows(session, table)?;
    let rows = JointCsvCatalog::load(session, table)?;
    let core = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| crate::services::project::sources::core::load_core_source_data(root, table))
        .transpose()?;
    let wing_variants = if matches!(kind, JointVariantCatalogKind::Wings) {
        rows.rows
            .values()
            .filter_map(|row| row.data.get("variant").and_then(Value::as_str))
            .filter_map(|id| {
                session
                    .variant_files
                    .iter()
                    .find(|variant| variant.variant_id == id)
                    .map(|variant| (id.to_owned(), (variant.clone(), ResourceSource::Mod)))
                    .or_else(|| {
                        core.as_ref()
                            .and_then(|data| {
                                data.variant_files
                                    .iter()
                                    .find(|variant| variant.variant_id == id)
                            })
                            .map(|variant| (id.to_owned(), (variant.clone(), ResourceSource::Core)))
                    })
            })
            .collect::<BTreeMap<_, _>>()
    } else {
        BTreeMap::new()
    };
    let hull_ids = wing_variants
        .values()
        .map(|(variant, _)| variant.hull_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let wing_hulls = if hull_ids.is_empty() {
        None
    } else {
        Some(super::hull_references::build_hull_references(
            session, &hull_ids,
        )?)
    };
    let previews = catalog_wing_previews(
        session,
        wing_variants.keys().cloned().collect(),
        damage_icons,
    )?;
    let descriptions = if matches!(kind, JointVariantCatalogKind::Weapons) {
        cache::ensure_registered_table_rows(session, CsvTableKey::Descriptions)?;
        Some(JointCsvCatalog::load(session, CsvTableKey::Descriptions)?)
    } else {
        None
    };
    let mut entries = Vec::new();
    for row in rows.rows.into_values() {
        let id = row.data["id"]
            .as_str()
            .expect("catalog row has ID")
            .to_owned();
        let mut refs = BTreeMap::new();
        let mut spec_source = None;
        let mut spec_version = None;
        let spec = if matches!(kind, JointVariantCatalogKind::Weapons) {
            let source = session
                .weapon_specs
                .get(&id)
                .or_else(|| core.as_ref().and_then(|data| data.weapon_specs.get(&id)));
            if let Some(source) = source {
                spec_source = Some(source.location.clone());
                let (version, content) =
                    crate::io::read_versioned_json(Path::new(&source.location.path))?;
                spec_version = Some(version);
                refs = super::super::definitions::entity_resources::weapon_resource_refs(
                    &id, &content,
                );
                for resource in refs.values_mut() {
                    resource.source = source.location.source;
                }
                Some(content)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(resource) =
            super::super::definitions::table_definitions::csv_table_source_resource_ref(
                row.source.source,
                table,
                &id,
                &row.data,
                core.as_ref(),
                session,
            )?
        {
            refs.insert("icon".into(), resource);
        }
        let wing_variant = row
            .data
            .get("variant")
            .and_then(Value::as_str)
            .and_then(|id| wing_variants.get(id));
        let projectile = if let Some(data) = &spec
            && data
                .get("renderHints")
                .and_then(Value::as_array)
                .is_some_and(|hints| {
                    hints.iter().any(|hint| {
                        matches!(
                            hint.as_str(),
                            Some("RENDER_LOADED_MISSILES" | "RENDER_LOADED_MISSILES_UNLESS_HIDDEN")
                        )
                    })
                })
            && let Some(id) = string_field(data, "projectileSpecId")
        {
            let core_projectiles = session
                .manifest
                .starsector_root
                .as_ref()
                .map(|root| {
                    crate::services::project::sources::core::load_core_projectile_specs(root)
                })
                .transpose()?;
            session
                .projectile_specs
                .get(&id)
                .or_else(|| core_projectiles.as_ref().and_then(|specs| specs.get(&id)))
                .map(|source| -> AppResult<JointPreviewSpec> {
                    let (version, data) =
                        crate::io::read_versioned_json(Path::new(&source.location.path))?;
                    let mut resource_refs =
                        super::super::definitions::entity_resources::projectile_resource_refs(
                            &id, &data,
                        );
                    for resource in resource_refs.values_mut() {
                        resource.source = source.location.source;
                    }
                    Ok(JointPreviewSpec {
                        kind: EntityKind::Projectile,
                        id,
                        data,
                        resource_refs,
                        source: Some(source.location.clone()),
                        source_version: Some(version),
                    })
                })
                .transpose()?
        } else {
            None
        };
        if let (Some((variant, source)), Some(hulls)) = (wing_variant, &wing_hulls) {
            if let Some(resource) = hulls.sprites.get(&variant.hull_id) {
                refs.insert("icon".into(), resource.clone());
            }
            let root = match source {
                ResourceSource::Mod => Path::new(&session.manifest.mod_root).to_path_buf(),
                ResourceSource::Core => sources::core::core_dir(
                    session
                        .manifest
                        .starsector_root
                        .as_ref()
                        .expect("Core variant has a configured root"),
                )?,
            };
            let location = location(*source, &root, &variant.rel_path);
            spec_source = Some(location);
            spec_version = Some(file_version(Path::new(&variant.path))?);
        }
        let label = if let (Some((variant, _)), Some(hulls)) = (wing_variant, &wing_hulls) {
            [
                hulls
                    .hull_names
                    .get(&variant.hull_id)
                    .cloned()
                    .unwrap_or_else(|| variant.hull_id.clone()),
                string_field(&variant.data, "displayName").unwrap_or_default(),
            ]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ")
        } else {
            row.data
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned)
                .unwrap_or_else(|| id.clone())
        };
        let primary_role = row
            .data
            .get("primaryRoleStr")
            .and_then(Value::as_str)
            .filter(|role| !role.is_empty())
            .map(str::to_owned)
            .or_else(|| {
                descriptions
                    .as_ref()
                    .and_then(|catalog| {
                        catalog.rows.get(
                            &serde_json::to_string(&BTreeMap::from([
                                ("id", id.as_str()),
                                ("type", "WEAPON"),
                            ]))
                            .expect("description identity serializes"),
                        )
                    })
                    .and_then(|row| row.data.get("text2"))
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        entries.push(JointVariantEntry {
            module_hull: None,
            id,
            label,
            data: Value::Object(row.data),
            spec,
            spec_source,
            spec_version,
            source: row.source,
            source_version: row.version,
            resource_refs: refs,
            preview: wing_variant
                .and_then(|(variant, _)| previews.get(&variant.variant_id))
                .cloned(),
            projectile,
            primary_role,
        });
    }
    Ok(JointVariantCatalog { kind, entries })
}

fn module_variant_catalog(
    session: &mut ProjectSession,
    source: ResourceSource,
) -> AppResult<JointVariantCatalog> {
    let variants = if source == ResourceSource::Mod {
        session.variant_files.clone()
    } else {
        session
            .manifest
            .starsector_root
            .as_ref()
            .map(|root| sources::core::load_core_variant_files(root))
            .transpose()?
            .map(|files| {
                files
                    .iter()
                    .filter(|file| {
                        !session
                            .variant_files
                            .iter()
                            .any(|own| own.variant_id == file.variant_id)
                    })
                    .cloned()
                    .collect()
            })
            .unwrap_or_default()
    };
    if variants.is_empty() {
        return Ok(JointVariantCatalog {
            kind: JointVariantCatalogKind::Variants,
            entries: Vec::new(),
        });
    }
    let mut graph = JointGraph {
        session,
        records: BTreeMap::new(),
        visiting: BTreeSet::new(),
        tables: BTreeMap::new(),
        targets: BTreeMap::new(),
        core_systems: None,
        core_sources: BTreeMap::new(),
        scope: JointGraphScope::HullCatalog,
        draft_values: None,
        bindings: BTreeMap::new(),
        damage_icons: BTreeMap::new(),
        new_sources: &[],
    };
    let mut hulls = BTreeMap::new();
    let mut entries = Vec::new();
    let source_root = if source == ResourceSource::Mod {
        graph.session.manifest.mod_root.clone()
    } else {
        sources::core::core_dir(
            graph
                .session
                .manifest
                .starsector_root
                .as_ref()
                .expect("core catalog root"),
        )?
        .to_string_lossy()
        .into_owned()
    };
    for variant in variants {
        if !hulls.contains_key(&variant.hull_id) {
            graph.records.clear();
            graph.visiting.clear();
            graph.spec(EntityKind::Variant, &variant.variant_id, "catalog")?;
            let key = serde_json::to_string(&("spec", EntityKind::Variant, &variant.variant_id))?;
            let records = graph.records.values().cloned().collect::<Vec<_>>();
            let hull = crate::domain::joint_hull::project_joint_hull(&records, &key)?;
            let summary = hull.map(|hull| {
                let binding = &hull.fields["name"];
                let data = |key: &str| match &graph.records[key].value {
                    JointValue::Present(data) => data.clone(),
                    JointValue::Missing => Value::Null,
                };
                let spec = data(&hull.hull_key);
                let name = string_field(&data(&binding.record_key), &binding.path)
                    .or_else(|| string_field(&spec, "hullName"))
                    .unwrap_or_else(|| variant.hull_id.clone());
                (
                    JointModuleHull {
                        id: variant.hull_id.clone(),
                        name,
                        hints: hull.hints,
                    },
                    hull.sprite,
                )
            });
            hulls.insert(variant.hull_id.clone(), summary);
        }
        let Some((hull, sprite)) = hulls[&variant.hull_id].as_ref() else {
            continue;
        };
        if !hull.hints.iter().any(|hint| hint == "MODULE") {
            continue;
        }
        let location = EntityFileLocation {
            source,
            root: source_root.clone(),
            path: variant.path.clone(),
            rel_path: variant.rel_path.clone(),
        };
        entries.push(JointVariantEntry {
            id: variant.variant_id.clone(),
            label: string_field(&variant.data, "displayName")
                .unwrap_or_else(|| variant.variant_id.clone()),
            data: serde_json::json!({"variantId":variant.variant_id,"hullId":variant.hull_id,"displayName":string_field(&variant.data, "displayName").unwrap_or_default()}),
            module_hull: Some(hull.clone()),
            source_version: file_version(Path::new(&variant.path))?,
            source: location,
            resource_refs: sprite
                .clone()
                .map(|sprite| BTreeMap::from([("icon".into(), sprite)]))
                .unwrap_or_default(),
            spec: None,
            spec_source: None,
            spec_version: None,
            preview: None,
            projectile: None,
            primary_role: None,
        });
    }
    Ok(JointVariantCatalog {
        kind: JointVariantCatalogKind::Variants,
        entries,
    })
}

fn catalog_wing_previews(
    session: &mut ProjectSession,
    ids: Vec<String>,
    damage_icons: BTreeMap<String, ResourceRef>,
) -> AppResult<BTreeMap<String, JointVariantPreview>> {
    let mut graph = JointGraph {
        session,
        records: BTreeMap::new(),
        visiting: BTreeSet::new(),
        tables: BTreeMap::new(),
        targets: BTreeMap::new(),
        core_systems: None,
        core_sources: BTreeMap::new(),
        scope: JointGraphScope::Preview,
        draft_values: None,
        bindings: BTreeMap::new(),
        damage_icons,
        new_sources: &[],
    };
    for id in &ids {
        graph.spec(EntityKind::Variant, id, "catalog")?;
    }
    let records = graph.records.into_values().collect::<Vec<_>>();
    let mut previews = BTreeMap::new();
    for id in ids {
        let key = serde_json::to_string(&("spec", EntityKind::Variant, &id))?;
        let Some(hull) = crate::domain::joint_hull::project_joint_hull(&records, &key)? else {
            continue;
        };
        let hull_record = records
            .iter()
            .find(|record| record.key == hull.hull_key)
            .expect("projected hull belongs to catalog graph");
        let JointValue::Present(spec) = &hull_record.value else {
            continue;
        };
        let weapons = hull.weapons.values().collect::<BTreeSet<_>>();
        let projectiles = records
            .iter()
            .filter_map(|record| match &record.target {
                JointRecordTarget::Spec { target }
                    if target.kind == EntityKind::Weapon && weapons.contains(&target.id) =>
                {
                    match &record.value {
                        JointValue::Present(data) => string_field(data, "projectileSpecId"),
                        JointValue::Missing => None,
                    }
                }
                _ => None,
            })
            .collect::<BTreeSet<_>>();
        let specs = records
            .iter()
            .filter_map(|record| {
                let JointRecordTarget::Spec { target } = &record.target else {
                    return None;
                };
                let relevant = record.key == hull.hull_key
                    || hull.skin_keys.contains(&record.key)
                    || (target.kind == EntityKind::Weapon && weapons.contains(&target.id))
                    || (target.kind == EntityKind::Projectile && projectiles.contains(&target.id));
                let JointValue::Present(data) = &record.value else {
                    return None;
                };
                relevant.then(|| JointPreviewSpec {
                    kind: target.kind,
                    id: target.id.clone(),
                    data: data.clone(),
                    resource_refs: record.resource_refs.clone(),
                    source: record.source.clone(),
                    source_version: record.source_version.clone(),
                })
            })
            .collect();
        previews.insert(
            id,
            JointVariantPreview {
                hull,
                spec: spec.clone(),
                specs,
            },
        );
    }
    Ok(previews)
}

fn reference_settings(
    session: &ProjectSession,
) -> AppResult<(JointReferenceSettings, BTreeMap<String, ResourceRef>)> {
    let mut result = JointReferenceSettings {
        resources: BTreeMap::new(),
        values: BTreeMap::new(),
        versions: Vec::new(),
    };
    let mut roots = Vec::new();
    let mut icons = BTreeMap::new();
    if let Some(game) = &session.manifest.starsector_root {
        roots.push((sources::core::core_dir(game)?, ResourceSource::Core));
    }
    roots.push((
        Path::new(&session.manifest.mod_root).to_path_buf(),
        ResourceSource::Mod,
    ));
    for (root, source) in roots {
        let boundary = FsRootBoundary::new(&root, "joint reference settings")?;
        let path = boundary.resolve_relative("data/config/settings.json", "reference settings")?;
        if path.exists() {
            let (settings_version, data) = crate::io::read_versioned_json(&path)?;
            for key in [
                "baseSensorFrigate",
                "baseSensorDestroyer",
                "baseSensorCruiser",
                "baseSensorCapital",
                "fluxPerCapacitor",
                "dissipationPerVent",
            ] {
                if let Some(value) = data.get(key) {
                    result.values.insert(key.into(), value.clone());
                }
            }
            if let Some(colors) = data.get("designTypeColors").and_then(Value::as_object) {
                let value = result
                    .values
                    .entry("designTypeColors".into())
                    .or_insert_with(|| Value::Object(Default::default()));
                value
                    .as_object_mut()
                    .expect("design colors are an object")
                    .extend(colors.clone());
            }
            for (damage, key) in [
                ("KINETIC", "icon_kinetic"),
                ("HIGH_EXPLOSIVE", "icon_high_explosive"),
                ("FRAGMENTATION", "icon_fragmentation"),
                ("ENERGY", "icon_energy"),
                ("OTHER", "icon_other"),
            ] {
                if let Some(path) = data
                    .get("graphics")
                    .and_then(|value| value.get("ui"))
                    .and_then(|value| value.get(key))
                    .and_then(Value::as_str)
                {
                    icons.insert(
                        damage.into(),
                        super::super::resources::resource_ref(
                            source,
                            path,
                            ResourceOwnerKind::Weapon,
                            "damage-type",
                            key,
                        ),
                    );
                }
            }
            result.versions.push(settings_version);
            for (group, key) in [
                ("ui", "checkmark"),
                ("ui", "checkmark_locked"),
                ("ui", "checkmark_unlocked"),
                ("ui", "sortIcon"),
                ("ui", "ui_border1_bot_left"),
                ("ui", "ui_border1_bot_right"),
                ("ui", "ui_border1_bot"),
                ("ui", "ui_border1_left"),
                ("ui", "ui_border1_right"),
                ("ui", "ui_border1_top_left"),
                ("ui", "ui_border1_top_right"),
                ("ui", "ui_border1_top"),
                ("ui", "ui_border1b_e"),
                ("ui", "ui_border1b_e_bot"),
                ("ui", "ui_border1b_e_top"),
                ("ui", "ui_border1b_w"),
                ("ui", "ui_border1b_w_bot"),
                ("ui", "ui_border1b_w_top"),
                ("ui", "toggle20_on"),
                ("ui", "toggle20_off"),
                ("misc", "fighterButtonBlank"),
                ("fleetScreen", "icon_more_info"),
            ] {
                if let Some(path) = data
                    .get("graphics")
                    .and_then(|value| value.get(group))
                    .and_then(|value| value.get(key))
                    .and_then(Value::as_str)
                {
                    result.resources.insert(
                        key.into(),
                        super::super::resources::resource_ref(
                            source,
                            path,
                            ResourceOwnerKind::Ship,
                            "refit-ui",
                            key,
                        ),
                    );
                }
            }
        }
    }
    Ok((result, icons))
}

pub fn prepare_joint_edit(draft: &JointEditDraft) -> AppResult<JointEditPrepared> {
    let mut snapshot =
        query_joint_edit_values(&draft.baseline.root, None, &draft.baseline.new_sources)?;
    let current = snapshot
        .records
        .iter()
        .map(|record| (&record.key, record))
        .collect::<BTreeMap<_, _>>();
    let mut values = BTreeMap::new();
    let mut conflicts = Vec::new();
    for base in draft
        .baseline
        .records
        .iter()
        .filter(|record| draft.values.contains_key(&record.key))
    {
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
        if let (JointRecordTarget::Spec { target }, Some(JointValue::Present(data))) =
            (&record.target, values.get(&record.key))
        {
            let definition = crate::domain::entity_definitions::entity_spec_definition(target.kind)
                .expect("joint spec has format");
            if let Some(id) = data
                .get(definition.id_field)
                .and_then(Value::as_str)
                .filter(|id| *id != target.id)
            {
                let id = crate::domain::entity_identity::validate_entity_id(
                    id,
                    definition.invalid_id_message,
                )?;
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
    if !snapshot.new_sources.is_empty() {
        let projected =
            query_joint_edit_values(&draft.baseline.root, Some(&values), &snapshot.new_sources)?;
        for version in projected.base_versions {
            if !snapshot
                .base_versions
                .iter()
                .any(|existing| windows_path_key(&existing.path) == windows_path_key(&version.path))
            {
                snapshot.base_versions.push(version);
            }
        }
    }
    Ok(JointEditPrepared {
        snapshot,
        values,
        conflicts,
    })
}

#[derive(Clone, Copy, PartialEq)]
enum JointGraphScope {
    Editing,
    Preview,
    HullCatalog,
}
struct JointGraph<'a> {
    session: &'a mut ProjectSession,
    records: BTreeMap<String, JointEditRecord>,
    visiting: BTreeSet<(EntityKind, String)>,
    tables: BTreeMap<CsvTableKey, JointCsvCatalog>,
    targets: BTreeMap<EntityKind, EntityTargetProjection>,
    core_systems: Option<BTreeMap<String, LoadedSpecRecord>>,
    core_sources: BTreeMap<EntityKind, BTreeMap<String, EntityFileLocation>>,
    scope: JointGraphScope,
    draft_values: Option<&'a BTreeMap<String, JointValue>>,
    bindings: BTreeMap<String, String>,
    damage_icons: BTreeMap<String, ResourceRef>,
    new_sources: &'a [JointSourceCreate],
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
        let value = self.projected_value(&key, found.map(|row| Value::Object(row.data.clone())));
        let source = found.map(|row| row.source.clone());
        let source_version = found.map(|row| row.version.clone());
        let row_key = found
            .filter(|row| row.source.source == ResourceSource::Mod)
            .map(|row| row.row_key.clone())
            .unwrap_or_else(|| format!("{}:new:joint-{}", table.as_str(), self.records.len()));
        let mut resource_refs = if table == CsvTableKey::Weapons {
            value
                .as_ref()
                .map(|data| string_field(data, "type").unwrap_or_else(|| "OTHER".into()))
                .and_then(|damage| self.damage_icons.get(&damage))
                .map(|resource| BTreeMap::from([("damageIcon".into(), resource.clone())]))
                .unwrap_or_default()
        } else {
            BTreeMap::new()
        };
        if table == CsvTableKey::Hullmods
            && let Some(data) = value.as_ref().and_then(Value::as_object)
            && let Some(icon) =
                super::super::definitions::table_definitions::csv_table_icon_resource_ref(
                    source
                        .as_ref()
                        .map(|location| location.source)
                        .unwrap_or(ResourceSource::Mod),
                    table,
                    data,
                )
        {
            resource_refs.insert("icon".into(), icon);
        }
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
            resource_refs,
            referenced_by: vec![parent.into()],
        };
        self.records.insert(key, record);
        Ok(value.unwrap_or(Value::Null))
    }

    fn spec(&mut self, kind: EntityKind, id: &str, parent: &str) -> AppResult<()> {
        let key = serde_json::to_string(&("spec", kind, id))?;
        if parent == "root" {
            self.bindings.insert("spec".into(), key.clone());
        }
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
        let source_read = target
            .source
            .as_ref()
            .filter(|source| Path::new(&source.path).exists())
            .map(|source| crate::io::read_versioned_json(Path::new(&source.path)))
            .transpose()?;
        let source_version = source_read.as_ref().map(|(version, _)| version.clone());
        let value = source_read.map(|(_, value)| value);
        let value = self.projected_value(&key, value);
        let source = target.source.clone();
        let mut versions = vec![
            source_version
                .as_ref()
                .filter(|version| {
                    windows_path_key(&version.path) == windows_path_key(&target.write.path)
                })
                .cloned()
                .map(Ok)
                .unwrap_or_else(|| file_version(Path::new(&target.write.path)))?,
        ];
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
            (Some(data), EntityKind::Projectile) => {
                super::super::definitions::entity_resources::projectile_resource_refs(id, data)
            }
            (Some(data), EntityKind::Skin) => string_field(data, "spriteName")
                .map(|path| {
                    BTreeMap::from([(
                        "sprite".into(),
                        super::super::resources::resource_ref(
                            ResourceSource::Mod,
                            &path,
                            ResourceOwnerKind::Skin,
                            id,
                            "sprite",
                        ),
                    )])
                })
                .unwrap_or_default(),
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
            EntityKind::Weapon if self.scope == JointGraphScope::Editing => {
                Some(CsvTableKey::Weapons)
            }
            EntityKind::System => Some(CsvTableKey::ShipSystems),
            _ => None,
        };
        let csv = csv_table
            .map(|table| self.csv(table, BTreeMap::from([("id".into(), id.into())]), id))
            .transpose()?;
        if parent == "root"
            && let Some(table) = csv_table
        {
            self.bindings.insert(
                "csv".into(),
                serde_json::to_string(&("csv", table, BTreeMap::from([("id", id)])))?,
            );
        }
        let description_type = match kind {
            EntityKind::Ship | EntityKind::Skin => Some("SHIP"),
            EntityKind::Weapon => Some("WEAPON"),
            EntityKind::System => Some("SHIP_SYSTEM"),
            _ => None,
        };
        if self.scope == JointGraphScope::Editing
            && let Some(typ) = description_type
            && let Some(description_id) = description_id(kind, id, value.as_ref())
        {
            if parent == "root" {
                self.bindings.insert(
                    "description".into(),
                    serde_json::to_string(&(
                        "csv",
                        CsvTableKey::Descriptions,
                        BTreeMap::from([("id", description_id.as_str()), ("type", typ)]),
                    ))?,
                );
            }
            self.csv(
                CsvTableKey::Descriptions,
                BTreeMap::from([("id".into(), description_id), ("type".into(), typ.into())]),
                id,
            )?;
        }
        if self.scope == JointGraphScope::Editing
            && kind == EntityKind::Ship
            && let Some(row) = &csv
            && string_field(row, "shield type").as_deref() == Some("PHASE")
        {
            let defense = string_field(row, "defense id").unwrap_or_else(|| "phasecloak".into());
            self.spec(EntityKind::System, &defense, id)?;
            if parent == "root" {
                self.bindings.insert(
                    "defense".into(),
                    serde_json::to_string(&("spec", EntityKind::System, defense))?,
                );
            }
        }
        let system = if kind == EntityKind::Ship {
            csv.as_ref().and_then(|row| string_field(row, "system id"))
        } else {
            value.as_ref().and_then(|data| {
                string_field(data, "shipSystemId").or_else(|| string_field(data, "systemId"))
            })
        };
        if self.scope == JointGraphScope::Editing
            && let Some(system) = system
        {
            if parent == "root" {
                self.bindings.insert(
                    "system".into(),
                    serde_json::to_string(&("spec", EntityKind::System, &system))?,
                );
            }
            self.spec(EntityKind::System, &system, id)?;
        }
        let Some(data) = value else {
            return Ok(());
        };
        if self.scope == JointGraphScope::Editing {
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
                if kind == EntityKind::Variant
                    && self.bindings.get("variant")
                        == Some(&serde_json::to_string(&("spec", kind, id))?)
                {
                    self.bindings.insert(
                        "hull".into(),
                        serde_json::to_string(&("spec", hull_kind, &hull))?,
                    );
                }
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
            if self.scope == JointGraphScope::Editing {
                for (_, module) in crate::domain::joint_hull::module_entries(data.get("modules")) {
                    self.spec(EntityKind::Variant, &module, id)?;
                }
            }
            if self.scope != JointGraphScope::HullCatalog
                && let Some(groups) = data.get("weaponGroups").and_then(Value::as_array)
            {
                for group in groups {
                    if let Some(weapons) = group.get("weapons").and_then(Value::as_object) {
                        for weapon in weapons.values().filter_map(Value::as_str) {
                            self.spec(EntityKind::Weapon, weapon, id)?;
                        }
                    }
                }
            }
        }
        if self.scope == JointGraphScope::Editing {
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
        }
        if self.scope != JointGraphScope::HullCatalog
            && let Some(weapons) = data.get("builtInWeapons").and_then(Value::as_object)
        {
            for weapon in weapons.values().filter_map(Value::as_str) {
                self.spec(EntityKind::Weapon, weapon, id)?;
            }
        }
        if kind == EntityKind::Weapon
            && (self.scope == JointGraphScope::Editing
                || data
                    .get("renderHints")
                    .and_then(Value::as_array)
                    .is_some_and(|hints| {
                        hints.iter().any(|hint| {
                            matches!(
                                hint.as_str(),
                                Some(
                                    "RENDER_LOADED_MISSILES"
                                        | "RENDER_LOADED_MISSILES_UNLESS_HIDDEN"
                                )
                            )
                        })
                    }))
            && let Some(projectile) = string_field(&data, "projectileSpecId")
        {
            if parent == "root" {
                self.bindings.insert(
                    "projectile".into(),
                    serde_json::to_string(&("spec", EntityKind::Projectile, &projectile))?,
                );
            }
            self.spec(EntityKind::Projectile, &projectile, id)?;
        }
        Ok(())
    }

    fn projected_value(&self, key: &str, current: Option<Value>) -> Option<Value> {
        match self.draft_values.and_then(|values| values.get(key)) {
            Some(JointValue::Present(value)) => Some(value.clone()),
            Some(JointValue::Missing) => None,
            None => current,
        }
    }

    fn has_skin(&mut self, id: &str) -> AppResult<bool> {
        if self
            .new_sources
            .iter()
            .any(|source| source.kind == EntityKind::Skin && source.id == id)
        {
            if self.session.ship_files.contains_key(id)
                || self.core_source(EntityKind::Ship, id)?.is_some()
            {
                return Err(AppError::message(
                    "skin.id_conflict",
                    "已有船体占用此 ID，无法建立 Skin",
                ));
            }
            return Ok(true);
        }
        if self
            .session
            .skin_files
            .iter()
            .any(|skin| skin.skin_hull_id == id)
        {
            return Ok(true);
        }
        Ok(self.core_source(EntityKind::Skin, id)?.is_some())
    }

    fn core_source(&mut self, kind: EntityKind, id: &str) -> AppResult<Option<EntityFileLocation>> {
        let Some(root) = &self.session.manifest.starsector_root else {
            return Ok(None);
        };
        let core = Path::new(root).join("starsector-core");
        if !self.core_sources.contains_key(&kind) {
            let sources = match kind {
                EntityKind::Ship => {
                    crate::services::project::sources::core::load_core_ship_files(root)?
                        .iter()
                        .map(|(id, record)| (id.clone(), record.location.clone()))
                        .collect()
                }
                EntityKind::Weapon => sources::core::load_core_weapon_specs(root)?
                    .iter()
                    .map(|(id, record)| (id.clone(), record.location.clone()))
                    .collect(),
                EntityKind::Projectile => {
                    crate::services::project::sources::core::load_core_projectile_specs(root)?
                        .iter()
                        .map(|(id, record)| (id.clone(), record.location.clone()))
                        .collect()
                }
                EntityKind::Variant => {
                    crate::services::project::sources::core::load_core_variant_files(root)?
                        .iter()
                        .map(|file| {
                            (
                                file.variant_id.clone(),
                                location(ResourceSource::Core, &core, &file.rel_path),
                            )
                        })
                        .collect()
                }
                EntityKind::Skin => {
                    crate::services::project::sources::core::load_core_skin_files(root)?
                        .iter()
                        .map(|file| {
                            (
                                file.skin_hull_id.clone(),
                                location(ResourceSource::Core, &core, &file.rel_path),
                            )
                        })
                        .collect()
                }
                EntityKind::System => {
                    if self.core_systems.is_none() {
                        self.core_systems = Some(
                            crate::services::project::sources::documents::load_spec_records(
                                &core,
                                "data/shipsystems",
                                "system",
                                "id",
                                ResourceSource::Core,
                            )?,
                        );
                    }
                    self.core_systems
                        .as_ref()
                        .expect("core systems loaded")
                        .iter()
                        .map(|(id, record)| (id.clone(), record.location.clone()))
                        .collect()
                }
                _ => BTreeMap::new(),
            };
            self.core_sources.insert(kind, sources);
        }
        Ok(self.core_sources[&kind].get(id).cloned())
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
    let mut owner_keys = BTreeMap::new();
    let core_ships = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| crate::services::project::sources::core::load_core_ship_files(root))
        .transpose()?;
    let core_variants = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| crate::services::project::sources::core::load_core_variant_files(root))
        .transpose()?;
    let core_skins = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| crate::services::project::sources::core::load_core_skin_files(root))
        .transpose()?;
    {
        let mut add = |key: String, owner: String| {
            references.entry(key).or_default().insert(owner);
        };
        let skin_ids = session
            .skin_files
            .iter()
            .map(|skin| skin.skin_hull_id.as_str())
            .chain(
                core_skins
                    .iter()
                    .flat_map(|skins| skins.iter())
                    .map(|skin| skin.skin_hull_id.as_str()),
            )
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
            )
            .chain(
                core_ships
                    .iter()
                    .flat_map(|files| files.iter())
                    .map(|(id, record)| (EntityKind::Ship, id.as_str(), &record.data)),
            )
            .chain(
                core_variants
                    .iter()
                    .flat_map(|files| files.iter())
                    .map(|record| {
                        (
                            EntityKind::Variant,
                            record.variant_id.as_str(),
                            &record.data,
                        )
                    }),
            )
            .chain(
                core_skins
                    .iter()
                    .flat_map(|files| files.iter())
                    .map(|record| (EntityKind::Skin, record.skin_hull_id.as_str(), &record.data)),
            );
        let mut seen = BTreeSet::new();
        for (kind, id, data) in records {
            if !seen.insert((kind, id)) {
                continue;
            }
            let owner = format!("{kind:?}:{id}");
            owner_keys.insert(owner.clone(), serde_json::to_string(&("spec", kind, id))?);
            add(serde_json::to_string(&("spec", kind, id))?, owner.clone());
            if matches!(kind, EntityKind::Ship | EntityKind::Skin) {
                add(
                    serde_json::to_string(&(
                        "csv",
                        CsvTableKey::Ships,
                        BTreeMap::from([("id", id)]),
                    ))?,
                    owner.clone(),
                );
            }
            let description_type = match kind {
                EntityKind::Ship | EntityKind::Skin => Some("SHIP"),
                EntityKind::Weapon => Some("WEAPON"),
                _ => None,
            };
            if let Some(typ) = description_type
                && let Some(description_id) = description_id(kind, id, Some(data))
            {
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
            for (_, module) in crate::domain::joint_hull::module_entries(data.get("modules")) {
                add(
                    serde_json::to_string(&("spec", EntityKind::Variant, &module))?,
                    owner.clone(),
                );
            }
        }
        let wings = JointCsvCatalog::load(session, CsvTableKey::Wings)?;
        for row in wings.rows.values() {
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
    let direct = references.clone();
    for owners in references.values_mut() {
        let mut pending = owners.iter().cloned().collect::<Vec<_>>();
        while let Some(owner) = pending.pop() {
            if let Some(key) = owner_keys.get(&owner)
                && let Some(parents) = direct.get(key)
            {
                for parent in parents {
                    if owners.insert(parent.clone()) {
                        pending.push(parent.clone());
                    }
                }
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
        let (version, csv) = crate::io::read_versioned_csv(&path)?;
        let (_, mod_rows, _) =
            cache::csv::table_snapshot_from_csv(&session.csv_tables[table.as_str()], table, csv)?;
        let mut catalog = Self {
            write: write.clone(),
            version: version.clone(),
            rows: BTreeMap::new(),
        };
        catalog.add_rows(table, &mod_rows, &write, &version)?;
        if let Some(root) = &session.manifest.starsector_root {
            let core = sources::core::core_dir(root)?;
            let source_path = core.join(relative);
            if source_path.exists() {
                let source = location(ResourceSource::Core, &core, relative);
                let (source_version, csv) = crate::io::read_versioned_csv(&source_path)?;
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
