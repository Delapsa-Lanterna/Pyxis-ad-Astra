use super::super::definitions::entity_definitions::entity_definition;
use super::super::model::{MISSION_LIST_TABLE_KEY, ProjectSession, string_from_row};
use super::super::session::{csv_tables, lock_ready_session, session_handle};
use super::super::versions::version_for_path;
use super::entity_presentation;
use crate::domain::{entity_definitions, entity_identity, variant_modules};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::{
    CsvTableKey, EntityEditTarget, EntityFileLocation, EntityIdentityIntent, EntityKind,
    EntityLinkedRecord, EntityTargetSnapshot, EntityTargetState, FileVersion, ResourceSource,
    windows_path_key,
};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub(crate) fn location(root: &str, relative: &str) -> EntityFileLocation {
    EntityFileLocation {
        source: ResourceSource::Mod,
        reference: None,
        root: root.into(),
        rel_path: relative.into(),
        path: Path::new(root)
            .join(relative)
            .to_string_lossy()
            .into_owned(),
    }
}
pub(super) fn remember_edit_target(session: &mut ProjectSession, target: &EntityEditTarget) {
    session.loaded_edit_targets.retain(|previous| {
        previous.kind != target.kind
            || previous.id != target.id
            || previous.write.rel_path != target.write.rel_path
    });
    session.loaded_edit_targets.push(target.clone());
}
pub fn query_entity_edit_target(
    session_id: &str,
    kind: EntityKind,
    id: &str,
) -> AppResult<EntityTargetSnapshot> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(kind)?.prepare)(&mut session)?;
    let result = describe_entity_target(&mut session, kind, id)?;
    remember_edit_target(&mut session, &result.target);
    Ok(result)
}
fn require_versions(required: &[FileVersion], supplied: &[FileVersion]) -> AppResult<()> {
    for version in required {
        if !supplied
            .iter()
            .any(|supplied| windows_path_key(&supplied.path) == windows_path_key(&version.path))
        {
            return Err(AppError::message(
                "write.version_scope_missing",
                format!("保存缺少读取版本凭据：{}", version.path),
            ));
        }
    }
    Ok(())
}
pub fn require_entity_version_scope(
    session: &str,
    kind: EntityKind,
    id: &str,
    supplied: &[FileVersion],
) -> AppResult<()> {
    require_versions(
        &query_entity_edit_target(session, kind, id)?.base_versions,
        supplied,
    )
}
pub fn require_csv_version_scope(
    session: &str,
    table: CsvTableKey,
    supplied: &[FileVersion],
) -> AppResult<()> {
    let handle = session_handle(session)?;
    let session = lock_ready_session(&handle)?;
    let table = csv_tables::registered_session_table(&session, table)?;
    require_versions(&[version_for_path(&session, &table.path)], supplied)
}
pub(in crate::services::project) struct EntityTargetIndex {
    kind: EntityKind,
    sources: BTreeMap<String, EntityFileLocation>,
    linked: BTreeMap<String, EntityLinkedRecord>,
    index: Option<FileVersion>,
    descriptions: BTreeSet<String>,
    description_version: Option<FileVersion>,
    parents: BTreeMap<String, Vec<FileVersion>>,
}
pub(in crate::services::project) fn prepare_entity_targets(
    session: &mut ProjectSession,
    kind: EntityKind,
) -> AppResult<EntityTargetIndex> {
    let root = session.manifest.mod_root.clone();
    let mut sources = BTreeMap::new();
    match kind {
        EntityKind::Variant => {
            for file in session.variant_files.iter() {
                sources.insert(file.variant_id.clone(), location(&root, &file.rel_path));
            }
        }
        EntityKind::Skin => {
            for file in session.skin_files.iter() {
                sources.insert(file.skin_hull_id.clone(), location(&root, &file.rel_path));
            }
        }
        EntityKind::Mission => {}
        _ => sources.extend(
            session
                .spec_records(kind)
                .expect("file-backed entity")
                .iter()
                .map(|(id, file)| (id.clone(), file.location.clone())),
        ),
    }
    for reference in &session.references {
        for (id, source) in reference.locations(kind) {
            if sources
                .get(&id)
                .is_none_or(|source| source.source == ResourceSource::Core)
            {
                sources.insert(id, source);
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
            && !Path::new(&source.path).try_exists()?
        {
            sources.insert(target.id.clone(), source.clone());
        }
    }
    let mut linked = BTreeMap::new();
    let definition = entity_definitions::entity_spec_definition(kind);
    let index = if let Some(table) = definition.and_then(|definition| definition.csv_table) {
        csv_tables::ensure_registered_table_rows(session, table)?;
        let state = csv_tables::registered_session_table(session, table)?;
        for row in csv_tables::loaded_csv_rows(state, table.as_str())?
            .iter()
            .filter(|row| !row.is_comment)
        {
            if let Some(id) = string_from_row(&row.data, "id") {
                linked.entry(id).or_insert_with(|| EntityLinkedRecord::Csv {
                    table,
                    row_key: row.row_key.clone(),
                });
            }
        }
        Some(version_for_path(session, &state.path))
    } else if kind == EntityKind::Faction {
        #[cfg(test)]
        io::record_faction_index_read();
        let path = "data/world/factions/factions.csv";
        let boundary = FsRootBoundary::new(Path::new(&root), "faction index")?;
        let table = csv_tables::read_retained_csv(session, path)?;
        let entries = io::faction_index_entries(&boundary, &table)?;
        for (id, source) in &sources {
            if let Some(entry) = entries
                .iter()
                .find(|entry| io::same_physical_path(&entry.path, Path::new(&source.path)))
            {
                linked.insert(
                    id.clone(),
                    EntityLinkedRecord::Index {
                        path: path.into(),
                        row_index: entry.row_index,
                    },
                );
            }
        }
        Some(version_for_path(session, path))
    } else if kind == EntityKind::Mission {
        csv_tables::ensure_session_table_rows(session, MISSION_LIST_TABLE_KEY)?;
        let state = csv_tables::session_table(session, MISSION_LIST_TABLE_KEY)?;
        for (index, row) in csv_tables::loaded_csv_rows(state, MISSION_LIST_TABLE_KEY)?
            .iter()
            .enumerate()
            .filter(|(_, row)| !row.is_comment)
        {
            if let Some(id) = string_from_row(&row.data, "mission") {
                linked
                    .entry(id)
                    .or_insert_with(|| EntityLinkedRecord::Index {
                        path: state.path.clone(),
                        row_index: index,
                    });
            }
        }
        Some(version_for_path(session, &state.path))
    } else {
        None
    };
    let mut parents = BTreeMap::<String, Vec<FileVersion>>::new();
    if kind == EntityKind::Variant {
        for file in session.variant_files.iter() {
            for (_, id) in variant_modules::module_entries(file.data.get("modules")) {
                parents
                    .entry(id)
                    .or_default()
                    .push(version_for_path(session, &file.rel_path));
            }
        }
    }
    let descriptions = if matches!(kind, EntityKind::Ship | EntityKind::Weapon) {
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
        BTreeSet::new()
    };
    let description_version = (matches!(kind, EntityKind::Ship | EntityKind::Weapon)
        && Path::new(&root)
            .join("data/strings/descriptions.csv")
            .is_file())
    .then(|| version_for_path(session, "data/strings/descriptions.csv"));
    Ok(EntityTargetIndex {
        kind,
        sources,
        linked,
        index,
        descriptions,
        description_version,
        parents,
    })
}
impl EntityTargetIndex {
    pub(in crate::services::project) fn describe(
        &self,
        session: &ProjectSession,
        id: &str,
    ) -> EntityTargetSnapshot {
        let root = &session.manifest.mod_root;
        let source = if self.kind == EntityKind::Mission {
            let path = format!("data/missions/{id}");
            Path::new(root)
                .join(&path)
                .is_dir()
                .then(|| location(root, &path))
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
                    &entity_definitions::entity_spec_definition(self.kind).map_or_else(
                        || format!("data/missions/{id}"),
                        |definition| definition.default_rel_path(id),
                    ),
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
            for file in ["descriptor.json", "mission_text.txt"] {
                versions.push(version_for_path(
                    session,
                    &format!("{}/{file}", write.rel_path),
                ));
            }
        }
        versions.extend(self.index.iter().cloned());
        if self.descriptions.contains(id) {
            versions.extend(self.description_version.iter().cloned());
        }
        if let Some(parents) = self.parents.get(id) {
            versions.extend(parents.iter().cloned());
        }
        versions.sort_by_key(|a| windows_path_key(&a.path));
        versions.dedup_by(|a, b| windows_path_key(&a.path) == windows_path_key(&b.path));
        EntityTargetSnapshot {
            target: EntityEditTarget {
                kind: self.kind,
                id: id.into(),
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
) -> AppResult<EntityTargetSnapshot> {
    Ok(prepare_entity_targets(session, kind)?.describe(session, id))
}
pub fn query_file_entity_target(
    session_id: &str,
    path: &str,
) -> AppResult<Option<EntityTargetSnapshot>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let key = windows_path_key(path);
    let mut found = None;
    for kind in [
        EntityKind::Ship,
        EntityKind::Weapon,
        EntityKind::Projectile,
        EntityKind::System,
        EntityKind::Skill,
        EntityKind::Faction,
    ] {
        if let Some(record) = session.spec_records(kind).and_then(|records| {
            records.values().find(|record| {
                record.location.source == ResourceSource::Mod
                    && windows_path_key(&record.location.path) == key
            })
        }) {
            found = Some((kind, record.id.clone()));
            break;
        }
    }
    found = found
        .or_else(|| {
            session
                .variant_files
                .iter()
                .find(|file| windows_path_key(&file.path) == key)
                .map(|file| (EntityKind::Variant, file.variant_id.clone()))
        })
        .or_else(|| {
            session
                .skin_files
                .iter()
                .find(|file| windows_path_key(&file.path) == key)
                .map(|file| (EntityKind::Skin, file.skin_hull_id.clone()))
        });
    found
        .map(|(kind, id)| describe_entity_target(&mut session, kind, &id))
        .transpose()
}
pub fn query_entity_identity_intent(
    session_id: &str,
    source: &EntityEditTarget,
    next: &str,
) -> AppResult<EntityIdentityIntent> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    (entity_definition(source.kind)?.prepare)(&mut session)?;
    if describe_entity_target(&mut session, source.kind, &source.id)?.target != *source {
        return Err(AppError::message(
            "spec.target_changed",
            "实体目标已变化，请载入外部版本",
        ));
    }
    let definition = entity_definitions::entity_spec_definition(source.kind);
    let next = entity_identity::validate_entity_id(
        next,
        definition.map_or("无效战役 ID", |definition| {
            definition.invalid_id_message
        }),
    )?;
    let relative = if source.kind == EntityKind::Mission {
        format!("data/missions/{next}")
    } else if source.state == EntityTargetState::Create {
        definition.expect("spec definition").default_rel_path(next)
    } else if next == source.id {
        source.write.rel_path.clone()
    } else {
        io::forward_slash_path(&Path::new(&source.write.rel_path).with_file_name(format!(
            "{next}{}",
            definition.expect("spec definition").extension
        )))
    };
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "identity root")?;
    let destination = boundary.resolve_relative_target(&relative, "identity destination")?;
    let same = io::same_physical_path(Path::new(&source.write.path), &destination);
    let next_target = describe_entity_target(&mut session, source.kind, next)?.target;
    let filename_taken = destination.exists()
        && !same
        && source.state == EntityTargetState::Existing
        && definition.is_some();
    if destination.exists()
        && (source.state == EntityTargetState::Create || !same)
        && !filename_taken
        || next != source.id && next_target.state == EntityTargetState::Existing
    {
        return Err(AppError::EntityTargetExists {
            target: Box::new(next_target),
        });
    }
    let inherits = next != source.id
        && entity_presentation::entity_composition(&session, source)?
            .is_some_and(|composition| !composition.layers.is_empty() && !composition.replace);
    let mut next_write = source.write.clone();
    next_write.rel_path = relative;
    next_write.path = destination.to_string_lossy().into_owned();
    Ok(EntityIdentityIntent {
        source: source.clone(),
        next_id: next.into(),
        next_write,
        destination_version: io::file_version(&destination)?,
        filename_taken,
        inherits,
    })
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::services::project_sync::release_project_session;

    use super::*;
    #[cfg(test)]
    use crate::models::{JointEditKind, JointEditRoot, JsonFileSave, SaveAction};
    #[cfg(test)]
    use crate::services;
    use crate::services::project;
    #[cfg(test)]
    use crate::services::project::query::joint_edit;
    #[cfg(test)]
    use crate::services::project::{PerformanceTrace, test_support};
    #[cfg(test)]
    use crate::services::project_save;
    use serde_json::json;
    #[cfg(test)]
    use std::fs;

    #[test]
    fn unicode_parent_paths_keep_independent_versions() {
        let work = test_support::project_workspace("unicode_parent_versions");
        let directory = work.join("data/variants");
        fs::create_dir_all(&directory).unwrap();
        for (name, id, modules) in [
            ("child.variant", "child", json!({})),
            ("\u{130}.variant", "first_parent", json!({"slot":"child"})),
            ("i\u{307}.variant", "second_parent", json!({"slot":"child"})),
        ] {
            let data = json!({"variantId":id,"hullId":"hull","modules":modules});
            fs::write(directory.join(name), data.to_string()).unwrap();
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
        fs::create_dir_all(work.join("data/hulls")).unwrap();
        fs::write(work.join("data/hulls/hull.ship"), r#"{"hullId":"hull","hullName":"Hull","hullSize":"FRIGATE","width":10,"height":10,"center":[0,0],"weaponSlots":[],"engineSlots":[]}"#).unwrap();
        let manifest = project::open_project_session_traced(
            &work,
            None,
            &mut PerformanceTrace::new("unicode.parents"),
        )
        .unwrap();
        let files = services::query_entity_list(&manifest.session_id, EntityKind::Variant).unwrap();
        let snapshot =
            query_entity_edit_target(&manifest.session_id, EntityKind::Variant, "child").unwrap();
        let paths = snapshot
            .base_versions
            .iter()
            .map(|version| version.path.clone())
            .collect::<Vec<_>>();
        let joint = joint_edit::query_joint_edit(&JointEditRoot {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            kind: JointEditKind::Variant,
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
            let original = fs::read(parent).unwrap();
            let mut modified = file_formats::read_json_value(parent).unwrap();
            modified["displayName"] = json!("External");
            let external = modified.to_string();
            fs::write(parent, &external).unwrap();
            let error =
                project_save::execute_save_action(SaveAction::SaveVariantEntity(JsonFileSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    previous_id: Some("child".into()),
                    next_id: "child".into(),
                    rel_path: Some("data/variants/child.variant".into()),
                    document: file_formats::json_write(
                        &(json!({"variantId":"child","hullId":"hull","displayName":"Draft"})),
                    ),
                    json_write: Default::default(),
                    base_versions: snapshot.base_versions.clone(),
                }))
                .unwrap_err();
            assert_eq!(error.code(), "write.version_conflict");
            assert_eq!(fs::read_to_string(parent).unwrap(), external);
            assert!(
                file_formats::read_json_value(&directory.join("child.variant"))
                    .unwrap()
                    .get("displayName")
                    .is_none()
            );
            fs::write(parent, original).unwrap();
        }
        release_project_session(manifest.session_id).unwrap();
        work.close().unwrap();
        assert_eq!(files.len(), 3);
        assert_eq!(
            paths.len(),
            3,
            "each real file needs its own version: {paths:?}"
        );
    }
}
