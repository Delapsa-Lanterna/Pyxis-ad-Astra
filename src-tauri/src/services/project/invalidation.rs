use super::definitions::entity_definitions;
use super::model::{self, ProjectSession};
use super::session::{csv_tables, source_versions};
use super::sources::{SourceReader, project_csv};
use crate::domain::entity_definitions as entity_rules;
use crate::errors::AppError;
use crate::errors::AppResult;
use crate::io::{self, FsRootBoundary};
use crate::models;
use crate::models::EntityKind;
use crate::models::file_content::{Record, RecordKind};
use crate::models::file_value::Value;
use crate::models::{
    CsvTableKey, FileChangeKind, FileChangeRecord, InvalidatedEntityRef, InvalidatedQueryKind,
    InvalidatedQueryScope, InvalidatedResourceScope, ProjectInvalidation, ResourceSource,
};
use crate::parsers::game;
use model::MISSION_LIST_REL_PATH;
use model::MISSION_LIST_TABLE_KEY;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::Arc;

fn overlap(left: &str, right: &str) -> bool {
    io::relative_path_contains(left, right) || io::relative_path_contains(right, left)
}
pub(crate) fn invalidate_session_changes(
    session: &mut ProjectSession,
    changes: &[FileChangeRecord],
) -> AppResult<ProjectInvalidation> {
    let mut candidate = session.clone();
    let result = apply_session_changes(&mut candidate, changes)?;
    *session = candidate;
    Ok(result)
}
fn apply_session_changes(
    session: &mut ProjectSession,
    changes: &[FileChangeRecord],
) -> AppResult<ProjectInvalidation> {
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "changed sources")?;
    let mut resources = Vec::new();
    for change in changes {
        for path in [&change.before_path, &change.after_path] {
            if let Some(relative) =
                boundary.resolve_changed_path_to_relative(path, "changed source")?
            {
                let scope = InvalidatedResourceScope {
                    source: ResourceSource::Mod,
                    rel_path: relative,
                };
                if !resources.contains(&scope) {
                    resources.push(scope);
                }
            }
        }
    }
    let mut reader = source_versions::source_reader_for_session(session)?;
    reader.accept_changes(changes)?;
    let mut result = refresh_sources_from(session, &resources, &mut reader)?;
    let mut files = BTreeMap::<String, (Option<String>, Option<String>)>::new();
    for change in changes {
        for (after, path, text, snapshots) in [
            (
                false,
                &change.before_path,
                &change.before_text,
                &change.before_files,
            ),
            (
                true,
                &change.after_path,
                &change.after_text,
                &change.after_files,
            ),
        ] {
            if matches!(change.kind, FileChangeKind::Directory) {
                for file in snapshots {
                    if let Some(relative) = boundary.resolve_changed_path_to_relative(
                        &Path::new(path).join(&file.rel_path).to_string_lossy(),
                        "changed file",
                    )? {
                        let pair = files.entry(relative).or_default();
                        if after {
                            pair.1.clone_from(&file.text);
                        } else {
                            pair.0.clone_from(&file.text);
                        }
                    }
                }
            } else if let Some(relative) =
                boundary.resolve_changed_path_to_relative(path, "changed file")?
            {
                let pair = files.entry(relative).or_default();
                if after {
                    pair.1.clone_from(text);
                } else {
                    pair.0.clone_from(text);
                }
            }
        }
    }
    let mut entities = Vec::new();
    for (path, (before, after)) in files {
        for entity in changed_file_entities(&path, before.as_deref(), after.as_deref())? {
            if !entities.contains(&entity) {
                entities.push(entity);
            }
        }
    }
    result.entities = entities;
    result.query_scopes =
        query_scopes_for_invalidation(&result.tables, &result.entities, &resources)?;
    session.loaded_edit_targets.retain(|target| {
        !changes.iter().any(|change| {
            (!change.after_exists || change.before_path != change.after_path)
                && io::relative_path_contains(
                    &models::windows_path_key(&change.before_path),
                    &models::windows_path_key(&target.write.path),
                )
        })
    });
    Ok(result)
}
#[cfg(test)]
pub(super) fn refresh_sources(
    session: &mut ProjectSession,
    resources: &[InvalidatedResourceScope],
) -> AppResult<ProjectInvalidation> {
    let mut candidate = session.clone();
    let mut reader = source_versions::source_reader_for_session(&candidate)?;
    let paths = resources
        .iter()
        .filter(|scope| scope.source == ResourceSource::Mod)
        .map(|scope| scope.rel_path.as_str())
        .collect::<Vec<_>>();
    reader.invalidate_paths(&paths);
    let result = refresh_sources_from(&mut candidate, resources, &mut reader)?;
    *session = candidate;
    Ok(result)
}
fn affected_csv_tables(path: &str) -> Vec<CsvTableKey> {
    model::csv_table_specs()
        .iter()
        .filter(|spec| overlap(spec.rel_path, path))
        .map(|spec| spec.key)
        .collect()
}
fn changed_file_entities(
    path: &str,
    before: Option<&str>,
    after: Option<&str>,
) -> AppResult<Vec<InvalidatedEntityRef>> {
    let mut result = Vec::new();
    for definition in entity_definitions::entity_definitions() {
        if let Some(spec) = definition
            .spec
            .filter(|spec| spec.path_matches(path) && path.ends_with(spec.extension))
        {
            let parse = |text: Option<&str>| {
                text.and_then(|text| {
                    game::read_json(text.as_bytes())
                        .ok()
                        .map(|source| source.content)
                })
            };
            let old = parse(before);
            let new = parse(after);
            if before != after
                && (before.is_some() && old.is_none() || after.is_some() && new.is_none())
            {
                result.push(InvalidatedEntityRef {
                    kind: definition.kind,
                    id: None,
                });
                continue;
            }
            if old == new {
                continue;
            }
            let ids = [old.as_ref(), new.as_ref()]
                .into_iter()
                .flatten()
                .filter_map(|content| match content.get(spec.id_field) {
                    Some(Value::Text(text)) => text.as_str().map(str::to_owned),
                    _ => None,
                })
                .collect::<BTreeSet<_>>();
            result.extend(ids.into_iter().map(|id| InvalidatedEntityRef {
                kind: definition.kind,
                id: Some(id),
            }));
        }
        if let Some(table) = definition
            .csv_table
            .filter(|table| model::csv_table_spec(*table).rel_path == path)
        {
            let column = model::csv_table_spec(table).entity_id_field;
            let rows = |text: Option<&str>| -> AppResult<BTreeMap<String, Vec<Record>>> {
                let Some(text) = text else {
                    return Ok(BTreeMap::new());
                };
                let content = game::read_csv_content(text.as_bytes()).map_err(AppError::from)?;
                let mut rows = BTreeMap::<String, Vec<Record>>::new();
                if let Some(index) = content.header.iter().rposition(|key| key == column) {
                    for row in content
                        .records
                        .into_iter()
                        .filter(|row| row.kind == RecordKind::Data)
                    {
                        if let Some(id) = row
                            .cells
                            .get(index)
                            .filter(|id| {
                                !id.trim().is_empty()
                                    && entity_rules::csv_id_active(definition.kind, id)
                            })
                            .cloned()
                        {
                            rows.entry(id).or_default().push(row);
                        }
                    }
                }
                Ok(rows)
            };
            let old = rows(before)?;
            let new = rows(after)?;
            let ids = old
                .keys()
                .chain(new.keys())
                .cloned()
                .collect::<BTreeSet<_>>();
            result.extend(
                ids.into_iter()
                    .filter(|id| old.get(id) != new.get(id))
                    .map(|id| InvalidatedEntityRef {
                        kind: definition.kind,
                        id: Some(id),
                    }),
            );
        }
    }
    Ok(result)
}
pub(super) fn refresh_sources_from(
    session: &mut ProjectSession,
    resources: &[InvalidatedResourceScope],
    reader: &mut SourceReader,
) -> AppResult<ProjectInvalidation> {
    let local = resources
        .iter()
        .filter(|scope| scope.source == ResourceSource::Mod)
        .map(|scope| scope.rel_path.as_str())
        .collect::<Vec<_>>();
    source_versions::retain_session_sources(reader, session, &local);
    let mut kinds = BTreeSet::new();
    let mut tables = BTreeSet::new();
    for definition in entity_definitions::entity_definitions() {
        let affected = resources.iter().any(|scope| {
            (definition.path_matches)(definition, &scope.rel_path)
                || definition.spec.is_some_and(|spec| {
                    spec.source_dirs()
                        .iter()
                        .any(|directory| io::relative_path_contains(&scope.rel_path, directory))
                })
        });
        if affected {
            kinds.insert(definition.kind);
        }
    }
    for table in resources
        .iter()
        .flat_map(|scope| affected_csv_tables(&scope.rel_path))
    {
        tables.insert(table);
    }
    let updates = kinds
        .iter()
        .map(|kind| (entity_definitions::entity_definition(*kind)?.refresh)(session, reader))
        .collect::<AppResult<Vec<_>>>()?;
    for update in updates {
        update.apply(session);
    }
    if local.iter().any(|path| overlap(path, "mod_info.json")) {
        let path = reader.path("mod_info.json")?;
        session.manifest.mod_info = path.exists().then(|| reader.json(&path)).transpose()?;
    }
    for table in &tables {
        let spec = model::csv_table_spec(*table);
        let path = reader.path(spec.rel_path)?;
        let before = csv_tables::registered_session_table(session, *table)?;
        let load = before.rows.is_some();
        if !path.exists() {
            let missing = before.missing_baseline
                || session.manifest.table_summaries[table].available && !load;
            csv_tables::session_table_mut(session, table.as_str())?.missing_baseline = missing;
            let summary = session
                .manifest
                .table_summaries
                .get_mut(table)
                .expect("registered table summary");
            summary.available = false;
            continue;
        }
        let csv = reader.csv(&path)?;
        let accepted = before.source.as_ref().is_some_and(|source| {
            reader
                .csv_sources
                .get(spec.rel_path)
                .is_some_and(|next| source.document.source == next.document.source)
        });
        let refreshed = if load && !accepted {
            Some(csv_tables::table_snapshot_from_csv(
                before,
                *table,
                csv.clone(),
            )?)
        } else {
            None
        };
        let state = csv_tables::session_table_mut(session, table.as_str())?;
        state.missing_baseline = false;
        if let Some((header, rows, sequence)) = refreshed {
            state.header = header;
            state.rows = Some(Arc::new(rows));
            state.next_row_seq = sequence;
            state.row_index = None;
        } else if !load {
            state.header.clone_from(&csv.header);
        }
        state.source = reader.csv_sources.get(spec.rel_path).cloned();
        let header = state.header.clone();
        let total = state.rows.as_ref().map(|rows| rows.len());
        let summary = session
            .manifest
            .table_summaries
            .get_mut(table)
            .expect("registered table summary");
        summary.header = header;
        summary.total_rows = total;
        summary.available = path.exists();
    }
    for (key, path) in [
        (MISSION_LIST_TABLE_KEY, MISSION_LIST_REL_PATH),
        ("faction-index", "data/world/factions/factions.csv"),
    ] {
        if local.iter().any(|scope| overlap(scope, path)) {
            if !reader.path(path)?.exists() {
                continue;
            }
            let source = reader.csv_sources.get(path).cloned();
            let csv = if let Some(source) = &source {
                project_csv(source, &reader.path(path)?)
            } else {
                reader.csv(&reader.path(path)?)?
            };
            let state = csv_tables::session_table_mut(session, key)?;
            state.header = csv.header;
            state.rows = None;
            state.row_index = None;
            state.source = source;
        }
    }
    csv_tables::refresh_table_entity_summaries(reader, session, &tables)?;
    session.manifest.warnings = session
        .variant_warnings
        .iter()
        .chain(&session.skin_warnings)
        .cloned()
        .collect();
    source_versions::capture_changed_versions(reader, &local)?;
    session.documents = Arc::new(reader.documents());
    session.source_versions = Arc::new(reader.versions.clone());
    session.source_scopes = Arc::new(reader.scopes.clone());
    session.source_stamps = Arc::new(reader.stamps.clone());
    kinds.extend(
        entity_definitions::entity_definitions()
            .iter()
            .filter(|definition| {
                definition
                    .csv_table
                    .is_some_and(|table| tables.contains(&table))
            })
            .map(|definition| definition.kind),
    );
    let entities = kinds
        .into_iter()
        .map(|kind| InvalidatedEntityRef { kind, id: None })
        .collect::<Vec<_>>();
    let tables = tables.into_iter().collect::<Vec<_>>();
    let query_scopes = query_scopes_for_invalidation(&tables, &entities, resources)?;
    Ok(ProjectInvalidation {
        paths: resources
            .iter()
            .map(|scope| {
                let root = if scope.source == ResourceSource::Core {
                    session
                        .manifest
                        .starsector_root
                        .as_ref()
                        .map(|root| Path::new(root).join("starsector-core"))
                } else {
                    Some(Path::new(&session.manifest.mod_root).to_path_buf())
                };
                root.map_or_else(
                    || scope.rel_path.clone(),
                    |root| root.join(&scope.rel_path).to_string_lossy().into_owned(),
                )
            })
            .collect(),
        resources: resources.to_vec(),
        tables,
        entities,
        query_scopes,
        renames: None,
        session: false,
    })
}
fn scope(kind: InvalidatedQueryKind) -> InvalidatedQueryScope {
    InvalidatedQueryScope {
        kind,
        table: None,
        source: None,
        entity: None,
        resource: None,
    }
}
fn push(items: &mut Vec<InvalidatedQueryScope>, item: InvalidatedQueryScope) {
    if !items.contains(&item) {
        items.push(item);
    }
}
pub(super) fn query_scopes_for_invalidation(
    tables: &[CsvTableKey],
    entities: &[InvalidatedEntityRef],
    resources: &[InvalidatedResourceScope],
) -> AppResult<Vec<InvalidatedQueryScope>> {
    let mut result = Vec::new();
    for table in tables {
        for kind in [
            InvalidatedQueryKind::CsvTableWindow,
            InvalidatedQueryKind::CsvRowPreview,
            InvalidatedQueryKind::CsvSourceOptions,
        ] {
            push(
                &mut result,
                InvalidatedQueryScope {
                    table: Some(*table),
                    ..scope(kind)
                },
            );
        }
    }
    for entity in entities {
        for kind in [
            InvalidatedQueryKind::EntityDetail,
            InvalidatedQueryKind::EntityList,
        ] {
            push(
                &mut result,
                InvalidatedQueryScope {
                    entity: Some(entity.clone()),
                    ..scope(kind)
                },
            );
        }
        let definition = entity_definitions::entity_definition(entity.kind)?;
        for source in entity_definitions::source_option_origin_scopes(definition) {
            push(
                &mut result,
                InvalidatedQueryScope {
                    source: Some(source),
                    ..scope(InvalidatedQueryKind::CsvSourceOptions)
                },
            );
        }
        for kind in definition.query_impacts {
            push(&mut result, scope(*kind));
        }
    }
    if tables.contains(&CsvTableKey::SpecialItems)
        || entities
            .iter()
            .any(|entity| entity.kind == EntityKind::Faction)
    {
        for table in model::csv_table_specs() {
            for source in [
                format!("{}.tags", table.key.as_str()),
                format!("csv:{}.tags", table.key.as_str()),
            ] {
                push(
                    &mut result,
                    InvalidatedQueryScope {
                        source: Some(source),
                        ..scope(InvalidatedQueryKind::CsvSourceOptions)
                    },
                );
            }
        }
    }
    for resource in resources {
        if resource.source == ResourceSource::Core {
            for definition in entity_definitions::entity_definitions()
                .iter()
                .filter(|definition| {
                    resource.rel_path.is_empty()
                        || (definition.path_matches)(definition, &resource.rel_path)
                })
            {
                for source in entity_definitions::source_option_origin_scopes(definition) {
                    push(
                        &mut result,
                        InvalidatedQueryScope {
                            source: Some(source),
                            ..scope(InvalidatedQueryKind::CsvSourceOptions)
                        },
                    );
                }
            }
        }
        push(
            &mut result,
            InvalidatedQueryScope {
                resource: Some(resource.clone()),
                ..scope(InvalidatedQueryKind::ResourceDataUrls)
            },
        );
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::models::EntityKind;
    use crate::models::{CsvTableKey, FileChangeKind, FileChangeRecord, FileSnapshot};
    #[cfg(test)]
    #[cfg(test)]
    use crate::services::project::model::{MISSION_LIST_REL_PATH, MISSION_LIST_TABLE_KEY};
    use crate::services::project::performance::PerformanceTrace;
    #[cfg(test)]
    use crate::services::project::session;
    #[cfg(test)]
    use crate::services::project::session::csv_tables;
    #[cfg(test)]
    use crate::services::project::sources::json_documents::take_load_counts;
    use crate::services::project::test_support::project_workspace;
    use crate::test_support::work_counts;
    use std::fs;
    use std::slice;

    #[test]
    fn committed_text_and_variant_reuse_unaffected_sources() {
        let root = project_workspace("commit_scoped_sources");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        fs::create_dir_all(root.join("data/campaign")).unwrap();
        let variant = root.join("data/variants/edited.variant");
        let unrelated = root.join("data/variants/other.variant");
        let table = root.join("data/campaign/commodities.csv");
        fs::write(&variant, r#"{"variantId":"edited","hullId":"hull"}"#).unwrap();
        fs::write(&unrelated, r#"{"variantId":"other","hullId":"hull"}"#).unwrap();
        fs::write(&table, "id,name\none,One\n").unwrap();
        let mut session =
            session::build_project_session(&root, None, &mut PerformanceTrace::new("commit.scope"))
                .unwrap();
        let table_reads = work_counts::count("read", &table);
        let variant_reads = work_counts::count("read", &unrelated);
        let scans = work_counts::count("walk", &root.join("data/variants"));
        for (path, before, after) in [
            (root.join("notes.txt"), None, "Written"),
            (
                variant,
                Some(r#"{"variantId":"edited","hullId":"hull"}"#),
                r#"{"variantId":"edited","hullId":"hull","displayName":"Written"}"#,
            ),
        ] {
            fs::write(&path, after).unwrap();
            invalidate_session_changes(&mut session, &[file_change(&path, before, Some(after))])
                .unwrap();
            assert_eq!(work_counts::count("read", &table), table_reads);
            assert_eq!(work_counts::count("read", &unrelated), variant_reads);
            assert_eq!(
                work_counts::count("walk", &root.join("data/variants")),
                scans
            );
            assert_eq!(
                session.manifest.table_entity_summaries[&CsvTableKey::Commodities],
                1
            );
        }
        assert_eq!(
            session
                .variant_files
                .iter()
                .find(|file| file.variant_id == "edited")
                .unwrap()
                .data["displayName"],
            "Written"
        );
        root.close().unwrap();
    }
    struct ChangedProjectPath;
    impl ChangedProjectPath {
        fn classify(path: &str) -> String {
            path.into()
        }
    }
    struct ChangedProjectFile {
        path: String,
        before_text: Option<String>,
        after_text: Option<String>,
    }
    fn invalidated_entities_for_file(
        _path: &str,
        file: &ChangedProjectFile,
    ) -> AppResult<Vec<InvalidatedEntityRef>> {
        changed_file_entities(
            &file.path,
            file.before_text.as_deref(),
            file.after_text.as_deref(),
        )
    }
    fn invalidated_entity(kind: EntityKind, id: Option<String>) -> InvalidatedEntityRef {
        InvalidatedEntityRef { kind, id }
    }

    #[test]
    fn core_entity_refresh_invalidates_each_registered_catalog_source() {
        for (path, source) in [
            ("data/world/factions/demo.faction", "csv:factions.id"),
            ("data/world/factions", "csv:factions.id"),
            ("data/custom/demo.faction", "csv:factions.id"),
            ("data/variants/demo.variant", "csv:variants.variantId"),
            ("data/weapons/proj/demo.proj", "csv:projectiles.id"),
            ("", "csv:factions.id"),
        ] {
            let scopes = query_scopes_for_invalidation(
                &[],
                &[],
                &[InvalidatedResourceScope {
                    source: ResourceSource::Core,
                    rel_path: path.into(),
                }],
            )
            .unwrap();
            assert!(
                scopes
                    .iter()
                    .any(|scope| scope.kind == InvalidatedQueryKind::CsvSourceOptions
                        && scope.source.as_deref() == Some(source)),
                "{path}"
            );
        }
    }

    #[test]
    fn mission_index_changes_refresh_cached_lists_and_counts() {
        let root = project_workspace("mission_cached_index");
        let path = root.join(MISSION_LIST_REL_PATH);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_utf8_no_bom(&path, "mission\r\nfirst\r\n").unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        let definition = entity_definitions::entity_definition(EntityKind::Mission).unwrap();
        for (before, after, ids) in [
            (
                "mission\r\nfirst\r\n",
                "mission\r\nfirst\r\nsecond\r\n",
                vec!["first", "second"],
            ),
            (
                "mission\r\nfirst\r\nsecond\r\n",
                "mission\r\nrenamed\r\nsecond\r\n",
                vec!["renamed", "second"],
            ),
            (
                "mission\r\nrenamed\r\nsecond\r\n",
                "mission\r\nsecond\r\n",
                vec!["second"],
            ),
        ] {
            (definition.prepare)(&mut session).unwrap();
            assert!(session.csv_tables[MISSION_LIST_TABLE_KEY].rows.is_some());
            write_utf8_no_bom(&path, after).unwrap();
            invalidate_session_changes(
                &mut session,
                &[file_change(&path, Some(before), Some(after))],
            )
            .unwrap();
            (definition.prepare)(&mut session).unwrap();
            let listed = (definition.list)(&mut session).unwrap();
            assert_eq!(
                listed
                    .iter()
                    .map(|item| item.id.as_str())
                    .collect::<Vec<_>>(),
                ids
            );
            assert_eq!(session.manifest.entity_summaries.missions, listed.len());
        }
        write_utf8_no_bom(&path, "mission\r\nexternal\r\n").unwrap();
        refresh_sources(
            &mut session,
            &[InvalidatedResourceScope {
                source: ResourceSource::Mod,
                rel_path: "data/missions".into(),
            }],
        )
        .unwrap();
        (definition.prepare)(&mut session).unwrap();
        assert_eq!((definition.list)(&mut session).unwrap()[0].id, "external");
        assert_eq!(session.manifest.entity_summaries.missions, 1);
        write_utf8_no_bom(&path, "mission\r\nfirst\r\n").unwrap();
        invalidate_session_changes(
            &mut session,
            &[file_change(
                &path,
                Some("mission\r\nexternal\r\n"),
                Some("mission\r\nfirst\r\n"),
            )],
        )
        .unwrap();
        (definition.prepare)(&mut session).unwrap();
        assert_eq!((definition.list)(&mut session).unwrap()[0].id, "first");
        root.close().unwrap();
    }

    #[test]
    fn resource_query_scopes_preserve_source_and_path() {
        for origin in [ResourceSource::Mod, ResourceSource::Core] {
            for changed in ["data/config/sounds.json", "data/config"] {
                let resource = InvalidatedResourceScope {
                    source: origin,
                    rel_path: changed.into(),
                };
                let scopes =
                    query_scopes_for_invalidation(&[], &[], slice::from_ref(&resource)).unwrap();
                assert_eq!(scopes.len(), 1);
                assert_eq!(scopes[0].kind, InvalidatedQueryKind::ResourceDataUrls);
                assert_eq!(scopes[0].resource.as_ref(), Some(&resource));
            }
        }
    }

    #[test]
    fn family_refresh_counts_and_diagnostics_follow_independent_owners() {
        let root = project_workspace("family_projection_counts");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        let variant = r#"{"variantId":"variant","hullId":"hull"}"#;
        let skin = r#"{"skinHullId":"skin","baseHullId":"hull"}"#;
        for name in ["a", "b"] {
            fs::write(root.join(format!("data/variants/{name}.variant")), variant).unwrap();
            fs::write(root.join(format!("data/hulls/skins/{name}.skin")), skin).unwrap();
        }
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        take_load_counts();
        assert_eq!(session.manifest.warnings.len(), 2);
        assert!(session.manifest.warnings[0].message.contains("variantId"));
        assert!(session.manifest.warnings[1].message.contains("skinHullId"));
        fs::remove_file(root.join("data/variants/b.variant")).unwrap();
        invalidate_session_changes(
            &mut session,
            &[file_change(
                &root.join("data/variants/b.variant"),
                Some(variant),
                None,
            )],
        )
        .unwrap();
        assert_eq!(take_load_counts(), (1, 0));
        assert!(session.variant_warnings.is_empty());
        assert_eq!(session.skin_warnings.len(), 1);
        assert_eq!(session.manifest.warnings.len(), 1);
        fs::remove_file(root.join("data/hulls/skins/b.skin")).unwrap();
        invalidate_session_changes(
            &mut session,
            &[file_change(
                &root.join("data/hulls/skins/b.skin"),
                Some(skin),
                None,
            )],
        )
        .unwrap();
        assert_eq!(take_load_counts(), (0, 1));
        assert!(session.manifest.warnings.is_empty());
        invalidate_session_changes(
            &mut session,
            &[
                file_change(
                    &root.join("data/variants/a.variant"),
                    Some(variant),
                    Some(variant),
                ),
                file_change(
                    &root.join("data/hulls/skins/a.skin"),
                    Some(skin),
                    Some(skin),
                ),
            ],
        )
        .unwrap();
        assert_eq!(take_load_counts(), (1, 1));
        root.close().unwrap();
    }

    #[test]
    fn failed_projection_keeps_all_previous_family_state() {
        let root = project_workspace("atomic_family_projection");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        let before = r#"{"variantId":"old","hullId":"hull"}"#;
        let after = r#"{"variantId":"new","hullId":"hull"}"#;
        fs::write(root.join("data/variants/a.variant"), before).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        fs::write(root.join("data/variants/a.variant"), after).unwrap();
        fs::write(root.join("data/hulls/skins/b.skin"), "{").unwrap();
        assert!(
            invalidate_session_changes(
                &mut session,
                &[
                    file_change(
                        &root.join("data/variants/a.variant"),
                        Some(before),
                        Some(after)
                    ),
                    file_change(&root.join("data/hulls/skins/b.skin"), None, Some("{"))
                ]
            )
            .is_err()
        );
        assert_eq!(session.variant_files[0].variant_id, "old");
        assert_eq!(session.manifest.entity_summaries.variants, 1);
        assert!(session.skin_files.is_empty());
        root.close().unwrap();
    }

    #[test]
    fn blueprint_metadata_invalidates_tags_for_every_registered_table_and_source_origin() {
        for (tables, entities) in [
            (vec![CsvTableKey::SpecialItems], Vec::new()),
            (
                Vec::new(),
                vec![invalidated_entity(
                    EntityKind::Faction,
                    Some("demo".to_string()),
                )],
            ),
        ] {
            let scopes = query_scopes_for_invalidation(&tables, &entities, &[]).unwrap();
            for definition in model::csv_table_specs() {
                let source = format!("{}.tags", definition.key.as_str());
                for source in [source.clone(), format!("csv:{source}")] {
                    assert!(
                        scopes
                            .iter()
                            .any(|scope| scope.kind == InvalidatedQueryKind::CsvSourceOptions
                                && scope.source.as_ref() == Some(&source))
                    );
                }
            }
        }
    }

    #[test]
    fn invalidating_variant_path_refreshes_session_variant_index() {
        let root = project_workspace("invalidate_variant_index");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"old","hullId":"hull"}"#,
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/demo.variant"),
            r#"{"variantId":"new","hullId":"hull"}"#,
        )
        .unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                &root.join("data/variants/demo.variant"),
                Some(r#"{"variantId":"old","hullId":"hull"}"#),
                Some(r#"{"variantId":"new","hullId":"hull"}"#),
            )],
        )
        .unwrap();

        assert!(
            session
                .variant_files
                .iter()
                .any(|variant| variant.variant_id == "new")
        );
        assert!(
            !session
                .variant_files
                .iter()
                .any(|variant| variant.variant_id == "old")
        );
        assert_eq!(session.manifest.entity_summaries.variants, 1);
        assert_eq!(
            invalidation.entities,
            vec![
                invalidated_entity(EntityKind::Variant, Some("new".to_string())),
                invalidated_entity(EntityKind::Variant, Some("old".to_string())),
            ]
        );
        root.close().unwrap();
    }

    #[test]
    fn invalidating_faction_path_refreshes_tag_sources_and_preserves_csv_rows() {
        let root = project_workspace("invalidate_faction_tags");
        fs::create_dir_all(root.join("data/world/factions")).unwrap();
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/factions.csv"),
            "id,file\r\ndemo,data/world/factions/demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_old_bp"]}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,tags\r\nship,demo_old_bp\r\n",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        csv_tables::ensure_registered_table_rows(&mut session, CsvTableKey::Ships).unwrap();
        write_utf8_no_bom(
            &root.join("data/world/factions/demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_new_bp"]}}"#,
        )
        .unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                &root.join("data/world/factions/demo.faction"),
                Some(r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_old_bp"]}}"#),
                Some(r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_new_bp"]}}"#),
            )],
        )
        .unwrap();

        assert!(
            invalidation
                .query_scopes
                .iter()
                .any(|scope| scope.kind == InvalidatedQueryKind::CsvSourceOptions
                    && scope.source.as_deref() == Some("csv:factions.id"))
        );
        assert!(session.faction_blueprint_tags.contains_key("demo_new_bp"));
        assert!(!session.faction_blueprint_tags.contains_key("demo_old_bp"));
        let rows = session
            .csv_tables
            .get(CsvTableKey::Ships.as_str())
            .unwrap()
            .rows
            .as_ref()
            .unwrap();
        assert_eq!(rows[0].row_key, "ships:row:0");
        assert_eq!(rows[0].data["tags"], "demo_old_bp");
        assert!(invalidation.entities.contains(&invalidated_entity(
            EntityKind::Faction,
            Some("demo".to_string())
        )));
        assert!(invalidation.tables.is_empty());
        assert!(
            invalidation
                .query_scopes
                .iter()
                .any(|scope| scope.kind == InvalidatedQueryKind::CsvSourceOptions
                    && scope.source.as_deref() == Some("csv:ships.tags"))
        );
        root.close().unwrap();
    }

    #[test]
    fn invalidating_csv_snapshot_scopes_ship_queries_to_changed_rows() {
        let root = project_workspace("invalidate_ship_csv_snapshot");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        let before = "id,name\r\nalpha,Old\r\nbeta,Unchanged\r\n";
        let after = "id,name\r\nalpha,New\r\nbeta,Unchanged\r\n";
        write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), after).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[file_change(
                &root.join("data/hulls/ship_data.csv"),
                Some(before),
                Some(after),
            )],
        )
        .unwrap();

        assert_eq!(invalidation.tables, vec![CsvTableKey::Ships]);
        assert_eq!(
            invalidation.entities,
            vec![invalidated_entity(
                EntityKind::Ship,
                Some("alpha".to_string())
            )]
        );
        assert!(invalidation.query_scopes.iter().any(|scope| {
            scope.kind == InvalidatedQueryKind::EntityDetail
                && scope.entity
                    == Some(invalidated_entity(
                        EntityKind::Ship,
                        Some("alpha".to_string()),
                    ))
        }));
        assert!(!invalidation.query_scopes.iter().any(|scope| {
            scope.kind == InvalidatedQueryKind::EntityDetail
                && scope.entity == Some(invalidated_entity(EntityKind::Ship, None))
        }));
        root.close().unwrap();
    }

    #[test]
    fn invalidating_directory_snapshot_refreshes_exact_variant_ids() {
        let root = project_workspace("invalidate_variant_directory_snapshot");
        fs::create_dir_all(root.join("data/variants")).unwrap();
        let old = r#"{"variantId":"old","hullId":"hull"}"#;
        write_utf8_no_bom(&root.join("data/variants/old.variant"), old).unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();
        fs::remove_dir_all(root.join("data/variants")).unwrap();

        let invalidation = invalidate_session_changes(
            &mut session,
            &[directory_change(
                &root.join("data/variants"),
                vec![FileSnapshot {
                    rel_path: "old.variant".to_string(),
                    text: Some(old.to_string()),
                    data_base64: None,
                }],
                Vec::new(),
            )],
        )
        .unwrap();

        assert!(session.variant_files.is_empty());
        assert_eq!(
            invalidation.entities,
            vec![invalidated_entity(
                EntityKind::Variant,
                Some("old".to_string())
            )]
        );
        root.close().unwrap();
    }

    #[test]
    fn spec_snapshots_cover_all_registered_kinds_and_change_directions() {
        for definition in entity_definitions::entity_definitions() {
            let Some(spec) = definition.spec else {
                continue;
            };
            let path = format!("{}/demo{}", spec.dir, spec.extension);
            let old = format!(r#"{{"{}":"old"}}"#, spec.id_field);
            let new = format!(r#"{{"{}":"new"}}"#, spec.id_field);
            let target = ChangedProjectPath::classify(&path);

            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(new.clone()),
                        before_text: None,
                        path: path.clone(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("new".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: None,
                        before_text: Some(old.clone()),
                        path: path.clone(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("old".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(new),
                        before_text: Some(old),
                        path,
                    },
                )
                .unwrap(),
                vec![
                    invalidated_entity(definition.kind, Some("new".to_string())),
                    invalidated_entity(definition.kind, Some("old".to_string())),
                ]
            );
        }
    }

    #[test]
    fn csv_snapshots_cover_create_delete_and_rename_for_registered_entities() {
        for definition in entity_definitions::entity_definitions() {
            let Some(table) = definition.csv_table else {
                continue;
            };
            let id_field = model::csv_table_spec(table).entity_id_field;
            let path = model::csv_table_spec(table).rel_path;
            let target = ChangedProjectPath::classify(path);
            let create = format!("{id_field},name\r\nnew,New\r\n");
            let delete = format!("{id_field},name\r\nold,Old\r\n");
            let rename_before = format!("{id_field},name\r\nold,Same\r\n");
            let rename_after = format!("{id_field},name\r\nnew,Same\r\n");

            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(create),
                        before_text: None,
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("new".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: None,
                        before_text: Some(delete),
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![invalidated_entity(definition.kind, Some("old".to_string()))]
            );
            assert_eq!(
                invalidated_entities_for_file(
                    &target,
                    &ChangedProjectFile {
                        after_text: Some(rename_after),
                        before_text: Some(rename_before),
                        path: path.to_string(),
                    },
                )
                .unwrap(),
                vec![
                    invalidated_entity(definition.kind, Some("new".to_string())),
                    invalidated_entity(definition.kind, Some("old".to_string())),
                ]
            );
        }
    }

    #[test]
    fn csv_snapshot_ignores_rows_without_an_entity_id() {
        let path = model::csv_table_spec(CsvTableKey::Weapons).rel_path;
        let target = ChangedProjectPath::classify(path);
        let before = "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,ENERGY,70\r\n";
        let after = "id,type,number\r\n,ENERGY,69\r\ndemo_weapon,BALLISTIC,70\r\n";

        assert_eq!(
            invalidated_entities_for_file(
                &target,
                &ChangedProjectFile {
                    after_text: Some(after.to_string()),
                    before_text: Some(before.to_string()),
                    path: path.to_string(),
                },
            )
            .unwrap(),
            vec![invalidated_entity(
                EntityKind::Weapon,
                Some("demo_weapon".to_string()),
            )]
        );
    }

    #[test]
    fn changed_path_classification_uses_project_relative_targets() {
        assert!(affected_csv_tables("data/hulls/ship_data.csv").contains(&CsvTableKey::Ships));
        assert!(affected_csv_tables("data/hulls").contains(&CsvTableKey::Ships));
        assert!(
            !affected_csv_tables("backup/data/hulls/ship_data.csv").contains(&CsvTableKey::Ships)
        );
        assert!(entity_spec_path_matches(
            EntityKind::Faction,
            "data/world/factions/demo.faction"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Faction,
            "backup/data/world/factions/demo.faction"
        ));
        assert!(entity_spec_path_matches(EntityKind::Ship, "data/hulls"));
        assert!(entity_spec_path_matches(EntityKind::Skin, "data/hulls"));
        assert!(entity_spec_path_matches(
            EntityKind::Ship,
            "data/hulls/demo.ship"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Ship,
            "data/hulls/demo.txt"
        ));
        assert!(!entity_spec_path_matches(
            EntityKind::Ship,
            "backup/data/hulls/demo.ship"
        ));
    }

    #[test]
    fn invalidating_external_absolute_path_does_not_refresh_session_indexes() {
        let root = project_workspace("invalidate_external_current");
        let external = project_workspace("invalidate_external_other");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(external.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/current.ship"),
            r#"{"hullId":"current"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &external.join("data/hulls/external.ship"),
            r#"{"hullId":"external"}"#,
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let mut session = session::build_project_session(&root, None, &mut trace).unwrap();

        invalidate_session_changes(
            &mut session,
            &[file_change(
                &external.join("data/hulls/external.ship"),
                None,
                Some(r#"{"hullId":"external"}"#),
            )],
        )
        .unwrap();

        assert_eq!(session.manifest.entity_summaries.ships, 1);
        assert!(session.ship_files.contains_key("current"));
        assert!(!session.ship_files.contains_key("external"));
        external.close().unwrap();
        root.close().unwrap();
    }

    fn file_change(
        path: &Path,
        before_text: Option<&str>,
        after_text: Option<&str>,
    ) -> FileChangeRecord {
        FileChangeRecord {
            kind: FileChangeKind::File,
            before_path: path.to_string_lossy().to_string(),
            after_path: path.to_string_lossy().to_string(),
            before_exists: before_text.is_some(),
            before_text: before_text.map(ToOwned::to_owned),
            before_data_base64: None,
            before_files: Vec::new(),
            after_exists: after_text.is_some(),
            after_text: after_text.map(ToOwned::to_owned),
            after_data_base64: None,
            after_files: Vec::new(),
        }
    }

    fn directory_change(
        path: &Path,
        before_files: Vec<FileSnapshot>,
        after_files: Vec<FileSnapshot>,
    ) -> FileChangeRecord {
        FileChangeRecord {
            kind: FileChangeKind::Directory,
            before_path: path.to_string_lossy().to_string(),
            after_path: path.to_string_lossy().to_string(),
            before_exists: !before_files.is_empty(),
            before_text: None,
            before_data_base64: None,
            before_files,
            after_exists: !after_files.is_empty(),
            after_text: None,
            after_data_base64: None,
            after_files,
        }
    }

    fn entity_spec_path_matches(kind: EntityKind, path: &str) -> bool {
        entity_definitions::entity_definitions()
            .iter()
            .find(|definition| definition.kind == kind)
            .and_then(|definition| definition.spec)
            .is_some_and(|spec| spec.path_matches(path))
    }
}
