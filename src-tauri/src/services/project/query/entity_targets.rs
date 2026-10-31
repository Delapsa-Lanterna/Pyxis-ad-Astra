use super::super::session::{lock_ready_session, session_handle};
use super::super::{
    definitions::entity_definitions::entity_definition,
    model::{MISSION_LIST_TABLE_KEY, ProjectSession, string_from_row},
    session::csv_tables::{ensure_registered_table_rows, ensure_session_table_rows},
    versions::version_for_path,
};
use crate::{
    errors::AppResult,
    models::{
        EntityEditInfo, EntityEditTarget, EntityFileLocation, EntityKind, EntityLinkedRecord,
        EntityTargetState, ResourceSource, windows_path_key,
    },
};
use std::path::Path;

pub fn query_entity_edit_target(
    session_id: &str,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityEditInfo> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(kind)?.prepare)(&mut session)?;
    let info = describe_entity_target(&mut session, kind, id)?;
    remember_edit_target(&mut session, &info.target);
    Ok(info)
}

pub(super) fn remember_edit_target(session: &mut ProjectSession, target: &EntityEditTarget) {
    session.loaded_edit_targets.retain(|origin| {
        origin.kind != target.kind
            || origin.id != target.id
            || origin.write.rel_path != target.write.rel_path
    });
    session.loaded_edit_targets.push(target.clone());
}

pub fn require_entity_version_scope(
    session_id: &str,
    kind: EntityKind,
    id: &str,
    supplied: &[crate::models::FileVersion],
) -> AppResult<()> {
    let info = query_entity_edit_target(session_id, kind, id)?;
    for required in info.base_versions {
        if !supplied.iter().any(|version| {
            crate::models::windows_path_key(&version.path)
                == crate::models::windows_path_key(&required.path)
        }) {
            return Err(crate::errors::AppError::message(
                "write.version_scope_missing",
                format!("保存缺少读取版本凭据: {}", required.path),
            ));
        }
    }
    Ok(())
}

pub fn require_csv_version_scope(
    session_id: &str,
    table: crate::models::CsvTableKey,
    supplied: &[crate::models::FileVersion],
) -> AppResult<()> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    let state = super::super::session::csv_tables::registered_session_table(&session, table)?;
    let required = version_for_path(&session, &state.path);
    if !supplied.iter().any(|version| {
        crate::models::windows_path_key(&version.path)
            == crate::models::windows_path_key(&required.path)
    }) {
        return Err(crate::errors::AppError::message(
            "write.version_scope_missing",
            format!("CSV 保存缺少读取版本凭据: {}", required.path),
        ));
    }
    Ok(())
}

pub fn query_file_entity_target(session_id: &str, path: &str) -> AppResult<Option<EntityEditInfo>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let key = crate::models::windows_path_key(path);
    let mut found = None;
    for (kind, records) in [
        (EntityKind::Ship, &session.ship_files),
        (EntityKind::Weapon, &session.weapon_specs),
        (EntityKind::Projectile, &session.projectile_specs),
        (EntityKind::System, &session.system_files),
        (EntityKind::Skill, &session.skill_files),
        (EntityKind::Faction, &session.faction_files),
    ] {
        if let Some(record) = records.values().find(|record| {
            record.location.source == ResourceSource::Mod
                && crate::models::windows_path_key(&record.location.path) == key
        }) {
            found = Some((kind, record.id.clone()));
            break;
        }
    }
    if found.is_none() {
        found = session
            .variant_files
            .iter()
            .find(|file| crate::models::windows_path_key(&file.path) == key)
            .map(|file| (EntityKind::Variant, file.variant_id.clone()))
            .or_else(|| {
                session
                    .skin_files
                    .iter()
                    .find(|file| crate::models::windows_path_key(&file.path) == key)
                    .map(|file| (EntityKind::Skin, file.skin_hull_id.clone()))
            });
    }
    found
        .map(|(kind, id)| describe_entity_target(&mut session, kind, &id))
        .transpose()
}

pub fn query_entity_identity_intent(
    session_id: &str,
    source: &EntityEditTarget,
    next_id: &str,
) -> AppResult<crate::models::EntityIdentityIntent> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(source.kind)?.prepare)(&mut session)?;
    let current = describe_entity_target(&mut session, source.kind, &source.id)?;
    if current.target != *source {
        return Err(crate::errors::AppError::message(
            "spec.target_changed",
            "实体目标已变化，请载入外部版本",
        ));
    }
    let definition = crate::domain::entity_definitions::entity_spec_definition(source.kind);
    let next_id = crate::domain::entity_identity::validate_entity_id(
        next_id,
        definition
            .map(|definition| definition.invalid_id_message)
            .unwrap_or("无效战役 ID"),
    )?;
    let relative = if source.kind == EntityKind::Mission {
        format!("data/missions/{next_id}")
    } else if source.state == EntityTargetState::Create {
        definition
            .expect("spec kind has definition")
            .default_rel_path(next_id)
    } else if next_id == source.id {
        source.write.rel_path.clone()
    } else {
        crate::io::forward_slash_path(&Path::new(&source.write.rel_path).with_file_name(format!(
            "{next_id}{}",
            definition.expect("spec kind has definition").extension
        )))
    };
    let boundary = crate::io::FsRootBoundary::new(
        Path::new(&session.manifest.mod_root),
        "entity intent root",
    )?;
    let destination = boundary.resolve_relative_target(&relative, "entity intent target")?;
    let same_file = crate::io::same_physical_path(Path::new(&source.write.path), &destination);
    let next_target = describe_entity_target(&mut session, source.kind, next_id)?.target;
    if (destination.exists() && (source.state == EntityTargetState::Create || !same_file))
        || (next_id != source.id && next_target.state == EntityTargetState::Existing)
    {
        return Err(crate::errors::AppError::EntityTargetExists {
            target: Box::new(next_target),
        });
    }
    let mut next_write = source.write.clone();
    next_write.rel_path = relative;
    next_write.path = destination.to_string_lossy().to_string();
    Ok(crate::models::EntityIdentityIntent {
        source: source.clone(),
        next_id: next_id.to_string(),
        destination_version: crate::io::file_version(&destination)?,
        next_write,
    })
}

pub(in crate::services::project) struct EntityTargetProjection {
    kind: EntityKind,
    sources: std::collections::BTreeMap<String, EntityFileLocation>,
    linked: std::collections::BTreeMap<String, EntityLinkedRecord>,
    index_version: Option<crate::models::FileVersion>,
    default_description_ids: std::collections::BTreeSet<String>,
    description_version: Option<crate::models::FileVersion>,
    parent_versions: std::collections::BTreeMap<String, Vec<crate::models::FileVersion>>,
}

pub(in crate::services::project) fn prepare_entity_targets(
    session: &mut ProjectSession,
    kind: EntityKind,
) -> AppResult<EntityTargetProjection> {
    let root = &session.manifest.mod_root;
    let mut parent_versions =
        std::collections::BTreeMap::<String, Vec<crate::models::FileVersion>>::new();
    if kind == EntityKind::Variant {
        for parent in session.variant_files.iter() {
            let content = &parent.data;
            for (_, id) in crate::domain::variant_modules::module_entries(content.get("modules")) {
                parent_versions
                    .entry(id)
                    .or_default()
                    .push(version_for_path(session, &parent.rel_path));
            }
        }
    }
    let mut sources = std::collections::BTreeMap::new();
    match kind {
        EntityKind::Variant => {
            for record in session.variant_files.iter() {
                sources
                    .entry(record.variant_id.clone())
                    .or_insert_with(|| location(root, &record.rel_path));
            }
        }
        EntityKind::Skin => {
            for record in session.skin_files.iter() {
                sources
                    .entry(record.skin_hull_id.clone())
                    .or_insert_with(|| location(root, &record.rel_path));
            }
        }
        EntityKind::Mission => {}
        _ => {
            let records = session.spec_records(kind).expect("file-backed entity kind");
            sources.extend(
                records
                    .iter()
                    .map(|(id, record)| (id.clone(), record.location.clone())),
            );
        }
    }
    for view in &session.references {
        for (id, location) in view.locations(kind) {
            if sources
                .get(&id)
                .is_none_or(|source| source.source == ResourceSource::Core)
            {
                sources.insert(id, location);
            }
        }
    }
    for target in session
        .loaded_edit_targets
        .iter()
        .filter(|target| target.kind == kind && target.state == EntityTargetState::Existing)
    {
        if !sources.contains_key(&target.id)
            && let Some(source) = &target.source
            && !Path::new(&source.path)
                .try_exists()
                .map_err(|error| crate::errors::AppError::from(error).at_path(&source.path))?
        {
            sources
                .entry(target.id.clone())
                .or_insert_with(|| source.clone());
        }
    }
    let definition = crate::domain::entity_definitions::entity_spec_definition(kind);
    let mut linked = std::collections::BTreeMap::new();
    let index_version = if let Some(table) = definition.and_then(|definition| definition.csv_table)
    {
        ensure_registered_table_rows(session, table)?;
        let state = session
            .csv_tables
            .get(table.as_str())
            .expect("registered table");
        for row in state
            .rows
            .as_ref()
            .expect("associated rows are loaded")
            .iter()
        {
            if row.is_comment {
                continue;
            }
            if let Some(id) = string_from_row(&row.data, "id") {
                linked.entry(id).or_insert_with(|| EntityLinkedRecord::Csv {
                    table,
                    row_key: row.row_key.clone(),
                });
            }
        }
        Some(version_for_path(session, &state.path))
    } else if kind == EntityKind::Faction {
        let index = "data/world/factions/factions.csv";
        let boundary =
            crate::io::FsRootBoundary::new(Path::new(&session.manifest.mod_root), "faction root")?;
        let table = super::super::session::csv_tables::read_retained_csv(session, index)?;
        let entries = crate::io::faction_index_entries(&boundary, &table)?;
        let mut paths = std::collections::BTreeMap::new();
        for entry in entries {
            paths
                .entry(entry.path.to_string_lossy().to_string())
                .or_insert(entry.row_index);
        }
        for (id, source) in &sources {
            if let Some(row_index) = paths.get(&source.path) {
                linked.insert(
                    id.clone(),
                    EntityLinkedRecord::Index {
                        path: index.to_string(),
                        row_index: *row_index,
                    },
                );
            }
        }
        Some(version_for_path(session, index))
    } else if kind == EntityKind::Mission {
        ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)?;
        let index = "data/missions/mission_list.csv";
        for (row_index, row) in session.csv_tables[MISSION_LIST_TABLE_KEY]
            .rows
            .as_ref()
            .expect("mission rows are loaded")
            .iter()
            .enumerate()
        {
            if row.is_comment {
                continue;
            }
            if let Some(id) = string_from_row(&row.data, "mission") {
                linked
                    .entry(id)
                    .or_insert_with(|| EntityLinkedRecord::Index {
                        path: index.to_string(),
                        row_index,
                    });
            }
        }
        Some(version_for_path(session, index))
    } else {
        None
    };
    let default_description_ids = if kind == EntityKind::Ship || kind == EntityKind::Weapon {
        sources
            .keys()
            .chain(linked.keys())
            .filter(|id| {
                kind == EntityKind::Weapon
                    || session
                        .ship_files
                        .get(*id)
                        .is_none_or(|record| record.data.get("descriptionId").is_none())
            })
            .cloned()
            .collect()
    } else {
        std::collections::BTreeSet::new()
    };
    let description_version = ((kind == EntityKind::Ship || kind == EntityKind::Weapon)
        && Path::new(&session.manifest.mod_root)
            .join("data/strings/descriptions.csv")
            .is_file())
    .then(|| version_for_path(session, "data/strings/descriptions.csv"));
    Ok(EntityTargetProjection {
        parent_versions,
        kind,
        sources,
        linked,
        index_version,
        default_description_ids,
        description_version,
    })
}

impl EntityTargetProjection {
    pub(in crate::services::project) fn describe(
        &self,
        session: &ProjectSession,
        id: &str,
    ) -> EntityEditInfo {
        let root = &session.manifest.mod_root;
        let definition = crate::domain::entity_definitions::entity_spec_definition(self.kind);
        let source = if self.kind == EntityKind::Mission {
            let relative = format!("data/missions/{id}");
            Path::new(root)
                .join(&relative)
                .is_dir()
                .then(|| location(root, &relative))
        } else {
            self.sources.get(id).cloned()
        };
        let write = source
            .as_ref()
            .filter(|source| source.source == ResourceSource::Mod)
            .cloned()
            .unwrap_or_else(|| {
                location(
                    root,
                    &definition
                        .map(|definition| definition.default_rel_path(id))
                        .unwrap_or_else(|| format!("data/missions/{id}")),
                )
            });
        let state = if source
            .as_ref()
            .is_some_and(|source| source.source == ResourceSource::Mod)
        {
            EntityTargetState::Existing
        } else {
            EntityTargetState::Create
        };
        let mut versions = vec![version_for_path(session, &write.rel_path)];
        if self.kind == EntityKind::Mission {
            versions.push(version_for_path(
                session,
                &format!("{}/descriptor.json", write.rel_path),
            ));
            versions.push(version_for_path(
                session,
                &format!("{}/mission_text.txt", write.rel_path),
            ));
        }
        versions.extend(self.index_version.iter().cloned());
        if self.default_description_ids.contains(id) {
            versions.extend(self.description_version.iter().cloned());
        }
        if let Some(parents) = self.parent_versions.get(id) {
            versions.extend(parents.iter().cloned());
        }
        versions.sort_by(|left, right| left.path.cmp(&right.path));
        versions
            .dedup_by(|left, right| windows_path_key(&left.path) == windows_path_key(&right.path));
        EntityEditInfo {
            target: EntityEditTarget {
                kind: self.kind,
                id: id.to_string(),
                source,
                write,
                state,
                linked_record: self.linked.get(id).cloned(),
            },
            base_versions: versions,
        }
    }
}

pub(in crate::services::project) fn describe_entity_target(
    session: &mut ProjectSession,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityEditInfo> {
    Ok(prepare_entity_targets(session, kind)?.describe(session, id))
}

pub(crate) fn location(root: &str, rel_path: &str) -> EntityFileLocation {
    EntityFileLocation {
        reference: None,
        source: ResourceSource::Mod,
        root: root.to_string(),
        rel_path: rel_path.to_string(),
        path: Path::new(root).join(rel_path).to_string_lossy().to_string(),
    }
}

#[cfg(test)]
#[cfg(windows)]
mod tests {
    use super::*;
    use crate::services::project;
    use serde_json::json;

    #[test]
    fn unicode_parent_paths_keep_independent_versions() {
        let work = project::test_support::project_workspace("unicode_parent_versions");
        let directory = work.join("data/variants");
        std::fs::create_dir_all(&directory).unwrap();
        for (name, id, modules) in [
            ("child.variant", "child", json!({})),
            ("\u{130}.variant", "first_parent", json!({"slot":"child"})),
            ("i\u{307}.variant", "second_parent", json!({"slot":"child"})),
        ] {
            let data = json!({"variantId":id,"hullId":"hull","modules":modules});
            std::fs::write(directory.join(name), data.to_string()).unwrap();
        }
        let first = directory.join("\u{130}.variant").canonicalize().unwrap();
        let second = directory.join("i\u{307}.variant").canonicalize().unwrap();
        assert_ne!(first, second);
        let old_equal = first
            .to_string_lossy()
            .eq_ignore_ascii_case(&second.to_string_lossy());
        assert!(!old_equal);
        assert_ne!(
            windows_path_key(&first.to_string_lossy()),
            windows_path_key(&second.to_string_lossy())
        );
        std::fs::create_dir_all(work.join("data/hulls")).unwrap();
        std::fs::write(work.join("data/hulls/hull.ship"), r#"{"hullId":"hull","hullName":"Hull","hullSize":"FRIGATE","width":10,"height":10,"center":[0,0],"weaponSlots":[],"engineSlots":[]}"#).unwrap();
        let manifest = project::open_project_session_traced(
            &work,
            None,
            &mut project::PerformanceTrace::new("unicode.parents"),
        )
        .unwrap();
        let files =
            crate::services::query_entity_list(&manifest.session_id, EntityKind::Variant).unwrap();
        let info =
            query_entity_edit_target(&manifest.session_id, EntityKind::Variant, "child").unwrap();
        let paths = info
            .base_versions
            .iter()
            .map(|version| version.path.clone())
            .collect::<Vec<_>>();
        let joint = project::query::joint_edit::query_joint_edit(&crate::models::JointEditRoot {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            kind: crate::models::JointEditKind::Variant,
            id: "child".into(),
        })
        .unwrap();
        assert_eq!(
            joint
                .base_versions
                .iter()
                .filter(|version| version.path.ends_with(".variant"))
                .count(),
            3
        );
        for parent in [&first, &second] {
            let original = std::fs::read(parent).unwrap();
            let mut modified = crate::io::read_json_file(parent).unwrap();
            modified["displayName"] = json!("External");
            let external = modified.to_string();
            std::fs::write(parent, &external).unwrap();
            let error = crate::services::project_save::execute_save_action(
                crate::models::SaveAction::SaveVariantEntity(crate::models::JsonFileSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    previous_id: Some("child".into()),
                    next_id: "child".into(),
                    rel_path: Some("data/variants/child.variant".into()),
                    data: json!({"variantId":"child","hullId":"hull","displayName":"Draft"}),
                    json_write: Default::default(),
                    ordered_json: None,
                    base_versions: info.base_versions.clone(),
                }),
            )
            .unwrap_err();
            assert_eq!(error.code(), "write.version_conflict");
            assert_eq!(std::fs::read_to_string(parent).unwrap(), external);
            assert!(
                crate::io::read_json_file(&directory.join("child.variant"))
                    .unwrap()
                    .get("displayName")
                    .is_none()
            );
            std::fs::write(parent, original).unwrap();
        }
        project::close_project_session(manifest.session_id).unwrap();
        work.close().unwrap();
        assert_eq!(files.len(), 3);
        assert_eq!(
            paths.len(),
            3,
            "each real file needs its own version: {paths:?}"
        );
    }
}
