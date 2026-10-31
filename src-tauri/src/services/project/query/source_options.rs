use super::super::session::{lock_ready_session, session_handle};
use super::super::{
    cache::{ensure_registered_table_rows, loaded_csv_rows, loaded_registered_csv_rows},
    definitions::{
        config_sources::CONFIG_OPTION_SOURCES,
        entity_definitions::entity_definitions,
        table_definitions::{csv_table_source_display_name, csv_table_source_resource_ref},
    },
    model::{ProjectSession, string_from_row},
    resources::HullReferenceResolver,
};
use crate::services::project::sources::core::CoreSourceData;
use crate::services::project::sources::core::{
    load_core_csv_table, load_core_skin_files, load_core_source_data,
};
use crate::{
    domain::well_known_labels::{WellKnownCatalog, well_known_catalog},
    errors::{AppError, AppResult},
    models::{CsvTableKey, EntityKind, ResourceSource, SourceOptionGroup},
};
use serde_json::{Map, Value};
use std::collections::{BTreeSet, HashMap};

pub fn query_image_source_options(
    session_id: &str,
    directories: &[String],
    mission_id: Option<&str>,
) -> AppResult<Vec<SourceOptionGroup>> {
    use crate::io::{FsRootBoundary, forward_slash_relative_path, validate_walk_entry};
    use crate::models::SourceOption;
    use std::path::Path;
    let handle = session_handle(session_id)?;
    let (mod_root, game_root, references) = {
        let session = lock_ready_session(&handle)?;
        (
            session.manifest.mod_root.clone(),
            session.manifest.starsector_root.clone(),
            session.references.clone(),
        )
    };
    if directories.is_empty() {
        return Ok(Vec::new());
    }
    let mut roots = vec![(ResourceSource::Mod, mod_root.into(), None)];
    roots.extend(references.iter().map(|view| {
        (
            ResourceSource::Reference,
            view.identity.mod_root.clone().into(),
            Some(view.identity.clone()),
        )
    }));
    if let Some(root) = game_root {
        roots.push((
            ResourceSource::Core,
            super::super::sources::core::core_dir(&root)?,
            None,
        ));
    }
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    for (origin, root, reference) in roots {
        let boundary = FsRootBoundary::new(&root, "image source root")?;
        let base = mission_id
            .map(|id| {
                boundary.resolve_relative(&format!("data/missions/{id}"), "mission image root")
            })
            .transpose()?
            .unwrap_or(root);
        if !base.exists() {
            continue;
        }
        let boundary = FsRootBoundary::new(&base, "image path base")?;
        let mut paths = BTreeSet::new();
        for directory in directories {
            let path = if directory == "." {
                boundary.root().to_path_buf()
            } else {
                boundary.resolve_relative(directory, "image directory")?
            };
            if !path.exists() {
                continue;
            }
            for entry in walkdir::WalkDir::new(&path) {
                let entry = entry.map_err(|error| {
                    AppError::message("io.walk_failed", error.to_string()).at_path(&path)
                })?;
                validate_walk_entry(entry.path(), "image candidate")?;
                if entry.file_type().is_file()
                    && matches!(
                        entry
                            .path()
                            .extension()
                            .and_then(|extension| extension.to_str()),
                        Some("png" | "jpg" | "jpeg" | "gif")
                    )
                {
                    let path = boundary.resolve_absolute(entry.path(), "image candidate")?;
                    paths.insert(forward_slash_relative_path(boundary.root(), &path));
                }
            }
        }
        let options = paths
            .into_iter()
            .filter(|path| seen.insert(path.clone()))
            .map(|value| SourceOption {
                label: Path::new(&value)
                    .file_name()
                    .expect("image has a file name")
                    .to_string_lossy()
                    .into_owned(),
                value,
                origin,
                description: None,
                resource_ref: None,
                template_value: None,
                template_max: None,
            })
            .collect::<Vec<_>>();
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin,
                options,
                reference,
            });
        }
    }
    drop(lock_ready_session(&handle)?);
    Ok(groups)
}

#[cfg(test)]
mod image_tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project::{
        PerformanceTrace,
        session::{close_project_session, open_project_session_traced},
    };
    use crate::test_support::TestWorkspace;
    use std::fs;

    #[test]
    fn image_directories_merge_sources_and_keep_mission_paths_relative() {
        let root = project_workspace("image_source_catalog");
        let local = root.join("mod");
        let game = root.join("game");
        let core = game.join("starsector-core");
        for base in [&local, &core] {
            fs::create_dir_all(base.join("graphics/icons/sub")).unwrap();
            fs::create_dir_all(base.join("graphics/other")).unwrap();
            fs::create_dir_all(base.join("data/missions/sample/sub")).unwrap();
            for path in [
                "graphics/icons/shared.png",
                "graphics/icons/sub/a.jpg",
                "graphics/icons/b.jpeg",
                "graphics/icons/c.gif",
                "graphics/icons/ignored.txt",
                "graphics/other/outside.png",
                "data/missions/sample/icon.jpg",
                "data/missions/sample/sub/extra.png",
            ] {
                fs::write(base.join(path), [1]).unwrap();
            }
        }
        fs::write(core.join("graphics/icons/core.png"), [1]).unwrap();
        let manifest = open_project_session_traced(
            &local,
            Some(&game),
            &mut PerformanceTrace::new("images.test"),
        )
        .unwrap();
        let directories = vec![
            "graphics/icons".into(),
            "graphics/icons/sub".into(),
            "missing".into(),
        ];
        let groups = query_image_source_options(&manifest.session_id, &directories, None).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(groups[0].options.len(), 4);
        assert_eq!(
            groups[1]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["graphics/icons/core.png"]
        );
        assert!(
            groups
                .iter()
                .flat_map(|group| &group.options)
                .all(|option| option.resource_ref.is_none())
        );
        assert_eq!(groups[0].options[0].label, "b.jpeg");
        let mission =
            query_image_source_options(&manifest.session_id, &[".".into()], Some("sample"))
                .unwrap();
        assert_eq!(
            mission[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["icon.jpg", "sub/extra.png"]
        );
        assert!(
            query_image_source_options(&manifest.session_id, &[], None)
                .unwrap()
                .is_empty()
        );
        assert!(
            query_image_source_options(&manifest.session_id, &["missing".into()], None)
                .unwrap()
                .is_empty()
        );
        for invalid in ["../outside", "/absolute", "graphics/../other"] {
            assert!(
                query_image_source_options(&manifest.session_id, &[invalid.into()], None).is_err()
            );
        }
        assert!(
            query_image_source_options(&manifest.session_id, &[".".into()], Some("../outside"))
                .is_err()
        );
        close_project_session(manifest.session_id.clone()).unwrap();
        assert!(query_image_source_options(&manifest.session_id, &directories, None).is_err());
        root.close().unwrap();
    }

    #[test]
    fn image_directories_reject_linked_children() {
        let (root, outside, _link) =
            TestWorkspace::directory_link("image_catalog_link", "graphics/icons").unwrap();
        let root = root.with_cleanup(crate::services::project::test_support::release_workspace);
        fs::write(outside.join("outside.png"), [1]).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("images.test"))
                .unwrap();
        assert!(
            query_image_source_options(&manifest.session_id, &["graphics/icons".into()], None)
                .is_err()
        );
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}

struct SourceOptionRowsContext<'a> {
    core_data: Option<&'a CoreSourceData>,
    resource_context: SourceOptionResourceContext<'a>,
    seen: &'a mut BTreeSet<String>,
}

#[derive(Clone, Copy)]
struct SourceOptionResourceContext<'a> {
    metadata_catalog: Option<&'a SourceTokenMetadataCatalog>,
    session: &'a ProjectSession,
    table: CsvTableKey,
}

pub fn query_csv_source_options(
    session_id: &str,
    source: &str,
) -> AppResult<Vec<SourceOptionGroup>> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    let (mut groups, core): (Vec<_>, Vec<_>) = source_catalog(&mut session, source, None)?
        .into_iter()
        .partition(|group| group.origin != ResourceSource::Core);
    for view in &session.references {
        for mut group in view
            .read(|snapshot| source_catalog(snapshot, source, Some(&session)))?
            .into_iter()
            .filter(|group| group.origin == ResourceSource::Mod)
        {
            group.origin = ResourceSource::Reference;
            group.reference = Some(view.identity.clone());
            for option in &mut group.options {
                option.origin = ResourceSource::Reference;
                if let Some(resource) = &mut option.resource_ref {
                    view.resource(resource);
                }
            }
            groups.push(group);
        }
    }
    groups.extend(core);
    let mut seen = BTreeSet::new();
    for group in &mut groups {
        group
            .options
            .retain(|option| option.template_value.is_some() || seen.insert(option.value.clone()));
    }
    groups.retain(|group| !group.options.is_empty());
    Ok(groups)
}

fn source_catalog(
    session: &mut ProjectSession,
    source: &str,
    context: Option<&ProjectSession>,
) -> AppResult<Vec<SourceOptionGroup>> {
    if let Some(groups) = config_source_option_groups(session, source)? {
        return Ok(groups);
    }
    if let Some(groups) = entity_source_option_groups(session, source, context)? {
        return Ok(groups);
    }
    let (table, column) = parse_csv_source(source)?;
    let table_key = table.as_str();
    ensure_registered_table_rows(session, table)?;
    ensure_source_column(&session.csv_tables[table_key].header, table_key, column)?;
    let metadata_catalog = source_token_metadata_catalog(table, column, session)?;
    let csv = &session.csv_tables[table_key];
    let rows = loaded_csv_rows(csv, table_key)?;
    let starsector_root = context.unwrap_or(session).manifest.starsector_root.clone();
    let core_csv = if let Some(root) = starsector_root.as_ref() {
        load_core_csv_table(
            root,
            crate::services::project::model::csv_table_spec(table).rel_path,
        )?
    } else {
        None
    };
    let core_rows = core_csv
        .as_ref()
        .map(|csv| {
            ensure_source_column(&csv.header, table_key, column)?;
            Ok::<_, AppError>(csv.rows.as_slice())
        })
        .transpose()?;
    let core_data = if core_rows.is_some() {
        let root = starsector_root
            .as_ref()
            .expect("Core rows have a configured root");
        Some(load_core_source_data(
            root,
            crate::services::project::model::csv_table_spec(table).core_source_requirements,
        )?)
    } else {
        None
    };
    let core_skins = if table == CsvTableKey::Ships {
        starsector_root
            .as_ref()
            .map(|root| load_core_skin_files(root))
            .transpose()?
    } else {
        None
    };
    let mut resolver = HullReferenceResolver::new(context.unwrap_or(session));
    let resource_context = SourceOptionResourceContext {
        metadata_catalog: metadata_catalog.as_ref(),
        session: context.unwrap_or(session),
        table,
    };
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    let own_skins = if table == CsvTableKey::Ships {
        session.skin_files.as_slice()
    } else {
        &[]
    };
    let core_skins = core_skins.as_deref().map(Vec::as_slice).unwrap_or_default();
    let mut options = Vec::new();
    for (origin, skins) in [
        (ResourceSource::Mod, own_skins),
        (ResourceSource::Core, core_skins),
    ] {
        let context = SourceOptionRowsContext {
            core_data: if origin == ResourceSource::Core {
                core_data.as_ref()
            } else {
                None
            },
            resource_context,
            seen: &mut seen,
        };
        let mut values = if origin == ResourceSource::Mod {
            source_options_from_rows(
                origin,
                rows.iter().map(|row| (&row.data, row.is_comment)),
                column,
                context,
            )?
        } else {
            source_options_from_rows(
                origin,
                core_rows
                    .into_iter()
                    .flatten()
                    .map(|row| (&row.data, row.is_comment)),
                column,
                context,
            )?
        };
        values.extend(skin_source_options(
            skins,
            origin,
            column,
            &mut resolver,
            resource_context,
            &mut seen,
        )?);
        if origin == ResourceSource::Core {
            options = values;
        } else if !values.is_empty() {
            groups.push(SourceOptionGroup {
                reference: None,
                origin,
                options: values,
            });
        }
    }
    if let Some(catalog) = metadata_catalog.as_ref().and_then(|catalog| catalog.known) {
        for (value, entry) in &catalog.values {
            if seen.insert(value.clone()) {
                options.push(crate::models::SourceOption {
                    label: format!("{value} ({})", entry.label),
                    value: value.clone(),
                    description: Some(entry.description.clone()),
                    resource_ref: None,
                    origin: ResourceSource::Core,
                    template_value: None,
                    template_max: None,
                });
            }
        }
        for pattern in &catalog.patterns {
            let entry = pattern.entry(None);
            options.push(crate::models::SourceOption {
                label: format!("{}* ({})", pattern.prefix, entry.label),
                value: format!("{}*", pattern.prefix),
                description: Some(entry.description),
                resource_ref: None,
                origin: ResourceSource::Core,
                template_value: Some(format!("{}0", pattern.prefix)),
                template_max: Some(pattern.max),
            });
        }
    }
    if !options.is_empty() {
        groups.push(SourceOptionGroup {
            reference: None,
            origin: ResourceSource::Core,
            options,
        });
    }
    Ok(groups)
}

fn config_source_option_groups(
    session: &ProjectSession,
    source: &str,
) -> AppResult<Option<Vec<SourceOptionGroup>>> {
    let Some((_, relative, section)) = CONFIG_OPTION_SOURCES
        .iter()
        .find(|(id, _, _)| *id == source)
    else {
        return Ok(None);
    };
    let mut roots = vec![(
        std::path::PathBuf::from(&session.manifest.mod_root),
        ResourceSource::Mod,
    )];
    if let Some(game) = &session.manifest.starsector_root {
        roots.push((
            super::super::sources::core::core_dir(game)?,
            ResourceSource::Core,
        ));
    }
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    for (root, origin) in roots {
        let mut sources = super::super::sources::SourceReader::new(&root)?;
        let path = sources.path(relative)?;
        if !path.exists() {
            continue;
        }
        let data = if source == "config:engineStyles" {
            Value::Object(
                super::super::sources::engine_styles::read_engine_styles(&root)?
                    .0
                    .into_iter()
                    .collect(),
            )
        } else {
            sources.json(&path)?
        };
        let entries = if let Some(section) = section {
            let Some(value) = data.get(section) else {
                continue;
            };
            value.as_object().ok_or_else(|| {
                AppError::message(
                    "misc_config.shape_invalid",
                    format!("{section} must be an object"),
                )
                .at_path(&path)
            })?
        } else {
            data.as_object()
                .expect("source parser guarantees an object")
        };
        let options = entries
            .keys()
            .filter(|key| {
                !(source == "config:sounds" && *key == "music") && seen.insert((*key).clone())
            })
            .map(|key| crate::models::SourceOption {
                label: key.clone(),
                value: key.clone(),
                description: None,
                resource_ref: None,
                origin,
                template_value: None,
                template_max: None,
            })
            .collect::<Vec<_>>();
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin,
                options,
                reference: None,
            });
        }
    }
    Ok(Some(groups))
}

fn skin_source_options(
    skins: &[crate::models::SkinFile],
    origin: ResourceSource,
    column: &str,
    resolver: &mut HullReferenceResolver<'_>,
    context: SourceOptionResourceContext<'_>,
    seen: &mut BTreeSet<String>,
) -> AppResult<Vec<crate::models::SourceOption>> {
    let mut options = Vec::new();
    for skin in skins {
        let values = match column {
            "id" => vec![skin.skin_hull_id.clone()],
            "tags" => skin
                .data
                .get("tags")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|tag| tag.trim().to_string())
                .collect(),
            _ => return Ok(options),
        };
        for value in values {
            if value.is_empty() || !seen.insert(value.clone()) {
                continue;
            }
            let (label, resource_ref) = if column == "id" {
                let name = resolver
                    .field(origin, &value, "hullName")?
                    .map(|(name, _, _)| name)
                    .unwrap_or_else(|| value.clone());
                (
                    if name == value {
                        name
                    } else {
                        format!("{name} ({value})")
                    },
                    resolver.resource(origin, &value)?,
                )
            } else {
                (
                    source_option_label_for_value(column, &value, context.metadata_catalog),
                    None,
                )
            };
            options.push(crate::models::SourceOption {
                label,
                value: value.clone(),
                origin,
                description: source_option_description(&value, context.metadata_catalog),
                resource_ref,
                template_value: None,
                template_max: None,
            });
        }
    }
    Ok(options)
}

/// Sources declared by an entity (its `source_options`) resolve to the entity
/// list as the value domain — e.g. `variants.variantId` enumerates variant
/// entities, Mod first then core-only entries, mirroring the CSV column flow.
/// Registered CSV tables keep the column path; the entity path only serves
/// domains no CSV table provides.
fn entity_source_option_groups(
    session: &mut ProjectSession,
    source: &str,
    context: Option<&ProjectSession>,
) -> AppResult<Option<Vec<SourceOptionGroup>>> {
    let key = source.strip_prefix("csv:").unwrap_or(source);
    if key
        .split_once('.')
        .and_then(|(table, _)| CsvTableKey::from_key(table))
        .is_some()
    {
        return Ok(None);
    }
    let Some(definition) = entity_definitions()
        .iter()
        .find(|definition| definition.source_options.contains(&key))
    else {
        return Ok(None);
    };
    (definition.prepare)(session)?;
    if definition.kind == EntityKind::Variant {
        ensure_registered_table_rows(session, CsvTableKey::Ships)?;
    }
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    for origin in [ResourceSource::Mod, ResourceSource::Core] {
        let entities = if definition.kind == EntityKind::Projectile {
            session
                .projectile_specs
                .values()
                .filter(|record| record.location.source == origin)
                .map(|record| super::super::model::EntityProjection {
                    kind: EntityKind::Projectile,
                    id: record.id.clone(),
                    data: record.data.clone(),
                    resource_refs:
                        super::super::definitions::entity_resources::projectile_resource_refs(
                            &record.id,
                            &record.data,
                        )
                        .into_iter()
                        .filter(|(key, _)| key == "sprite" || key == "bulletSprite")
                        .collect(),
                })
                .collect()
        } else if origin == ResourceSource::Mod {
            (definition.list)(session)?
        } else if let Some(core_list) = definition.core_list {
            core_list(session)?
        } else {
            continue;
        };
        let options =
            entity_source_options(origin, context.unwrap_or(session), entities, &mut seen)?;
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin,
                options,
                reference: None,
            });
        }
    }
    Ok(Some(groups))
}

fn entity_source_options(
    origin: ResourceSource,
    session: &ProjectSession,
    entities: Vec<super::super::model::EntityProjection>,
    seen: &mut BTreeSet<String>,
) -> AppResult<Vec<crate::models::SourceOption>> {
    let mut options = Vec::new();
    for mut entity in entities {
        if !seen.insert(entity.id.clone()) {
            continue;
        }
        if entity.kind == EntityKind::Variant {
            entity.resource_refs =
                super::super::definitions::entity_resources::variant_resource_refs(
                    session,
                    ResourceSource::Mod,
                    &entity.data,
                );
        }
        options.push(crate::models::SourceOption {
            label: entity_source_option_label(origin, session, &entity)?,
            value: entity.id.clone(),
            description: None,
            resource_ref: entity
                .resource_refs
                .values()
                .next()
                .cloned()
                .map(|mut resource| {
                    if resource.source == ResourceSource::Mod && resource.reference.is_none() {
                        resource.source = origin;
                    }
                    resource
                }),
            origin,
            template_value: None,
            template_max: None,
        });
    }
    Ok(options)
}

fn entity_source_option_label(
    origin: ResourceSource,
    session: &ProjectSession,
    entity: &super::super::model::EntityProjection,
) -> AppResult<String> {
    let display_name = entity
        .data
        .get("displayName")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    if entity.kind == EntityKind::Variant {
        let hull_id = entity
            .data
            .get("hullId")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let hull_name = if hull_id.is_empty() {
            None
        } else {
            HullReferenceResolver::new(session)
                .field(origin, hull_id, "hullName")?
                .map(|(name, _, _)| name)
        };
        let hull_name = hull_name.or_else(|| (!hull_id.is_empty()).then(|| hull_id.to_string()));
        let label = match (hull_name, display_name.trim()) {
            (Some(hull_name), display_name) if !display_name.is_empty() => {
                format!("{hull_name} ({display_name})")
            }
            (Some(hull_name), _) => hull_name,
            (None, display_name) if !display_name.is_empty() => display_name.to_string(),
            (None, _) => entity.id.clone(),
        };
        return Ok(label);
    }
    if display_name.trim().is_empty() || display_name == entity.id {
        Ok(entity.id.clone())
    } else {
        Ok(format!("{display_name} ({})", entity.id))
    }
}

fn parse_csv_source(source: &str) -> AppResult<(CsvTableKey, &str)> {
    let trimmed = source.strip_prefix("csv:").unwrap_or(source);
    let (table, column) = trimmed.split_once('.').ok_or_else(|| {
        AppError::message("source.invalid", format!("invalid csv source: {source}"))
    })?;
    let table = CsvTableKey::from_key(table).ok_or_else(|| {
        AppError::message(
            "source.table_unknown",
            format!("unknown csv source table: {table}"),
        )
    })?;
    Ok((table, column))
}

fn ensure_source_column(header: &[String], table: &str, column: &str) -> AppResult<()> {
    if header.iter().any(|field| field == column) {
        return Ok(());
    }
    Err(AppError::message(
        "source.column_unknown",
        format!("csv source column does not exist: {table}.{column}"),
    ))
}

fn source_options_from_rows<'a>(
    resource_source: ResourceSource,
    rows: impl Iterator<Item = (&'a Map<String, Value>, bool)>,
    column: &str,
    context: SourceOptionRowsContext<'_>,
) -> AppResult<Vec<crate::models::SourceOption>> {
    let is_id_column = column == "id";
    let mut options = Vec::new();
    for (row, _) in rows.filter(|(_, is_comment)| !is_comment) {
        let Some(cell_value) = row.get(column).and_then(serde_json::Value::as_str) else {
            continue;
        };
        if cell_value.trim().is_empty() {
            continue;
        }
        let values: Vec<&str> = if is_id_column {
            vec![cell_value]
        } else {
            cell_value
                .split(',')
                .map(|v| v.trim())
                .filter(|v| !v.is_empty())
                .collect()
        };
        for value in values {
            if !context.seen.insert(value.to_string()) {
                continue;
            }
            options.push(source_option_from_row(
                resource_source,
                row,
                column,
                value,
                context.core_data,
                context.resource_context,
            )?);
        }
    }
    Ok(options)
}

fn source_option_from_row(
    resource_source: ResourceSource,
    row: &Map<String, Value>,
    column: &str,
    value: &str,
    core_data: Option<&CoreSourceData>,
    context: SourceOptionResourceContext<'_>,
) -> AppResult<crate::models::SourceOption> {
    let resource_ref = if column == "id" {
        csv_table_source_resource_ref(
            resource_source,
            context.table,
            value,
            row,
            core_data,
            context.session,
        )?
    } else {
        None
    };
    Ok(crate::models::SourceOption {
        label: source_option_label_for_row(
            resource_source,
            row,
            column,
            value,
            core_data,
            context,
        )?,
        value: value.to_string(),
        description: source_option_description(value, context.metadata_catalog),
        resource_ref,
        origin: resource_source,
        template_value: None,
        template_max: None,
    })
}

fn source_option_label_for_row(
    resource_source: ResourceSource,
    row: &Map<String, Value>,
    column: &str,
    value: &str,
    core_data: Option<&CoreSourceData>,
    context: SourceOptionResourceContext<'_>,
) -> AppResult<String> {
    if column == "id" {
        if let Some(display_name) = csv_table_source_display_name(
            resource_source,
            context.table,
            value,
            row,
            core_data,
            context.session,
        )? && display_name != value
        {
            return Ok(format!("{display_name} ({value})"));
        }
        let name = row
            .get("name")
            .or_else(|| row.get("displayName"))
            .and_then(serde_json::Value::as_str)
            .unwrap_or_default();
        if name.trim().is_empty() || name == value {
            Ok(value.to_string())
        } else {
            Ok(format!("{name} ({value})"))
        }
    } else {
        Ok(source_option_label_for_value(
            column,
            value,
            context.metadata_catalog,
        ))
    }
}

fn source_option_description(
    value: &str,
    metadata_catalog: Option<&SourceTokenMetadataCatalog>,
) -> Option<String> {
    metadata_catalog
        .and_then(|metadata_catalog| metadata_catalog.find(value))
        .and_then(|metadata| metadata.description)
}

fn source_option_label_for_value(
    column: &str,
    value: &str,
    metadata_catalog: Option<&SourceTokenMetadataCatalog>,
) -> String {
    if column == "id" {
        return value.to_string();
    }
    if let Some(metadata) =
        metadata_catalog.and_then(|metadata_catalog| metadata_catalog.find(value))
    {
        format!("{value} ({})", metadata.label)
    } else {
        value.to_string()
    }
}

fn source_token_metadata_catalog(
    table: CsvTableKey,
    column: &str,
    session: &mut super::super::model::ProjectSession,
) -> AppResult<Option<SourceTokenMetadataCatalog>> {
    if !matches!(column, "tags" | "hints" | "uiTags") {
        return Ok(None);
    }
    let mut catalog = SourceTokenMetadataCatalog {
        values: HashMap::new(),
        known: well_known_catalog(table, column),
    };
    if column == "tags" {
        add_core_blueprint_package_metadata(&mut catalog.values, session)?;
        add_mod_blueprint_package_metadata(&mut catalog.values, session)?;
        add_faction_blueprint_metadata(&mut catalog.values, session);
    }
    Ok(Some(catalog))
}

#[derive(Clone)]
struct SourceTokenMetadata {
    label: String,
    description: Option<String>,
}

struct SourceTokenMetadataCatalog {
    values: HashMap<String, SourceTokenMetadata>,
    known: Option<&'static WellKnownCatalog>,
}

impl SourceTokenMetadataCatalog {
    fn find(&self, value: &str) -> Option<SourceTokenMetadata> {
        self.known
            .and_then(|catalog| catalog.find(value))
            .map(|entry| SourceTokenMetadata {
                label: entry.label,
                description: Some(entry.description),
            })
            .or_else(|| self.values.get(value).cloned())
    }
}

fn add_core_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &super::super::model::ProjectSession,
) -> AppResult<()> {
    let Some(root) = session.manifest.starsector_root.as_ref() else {
        return Ok(());
    };
    let Some(table) = load_core_csv_table(
        root,
        crate::services::project::model::csv_table_spec(CsvTableKey::SpecialItems).rel_path,
    )?
    else {
        return Ok(());
    };
    for row in table.rows.iter().filter(|row| !row.is_comment) {
        add_blueprint_package_metadata(metadata, &row.data);
    }
    Ok(())
}

fn add_mod_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &mut super::super::model::ProjectSession,
) -> AppResult<()> {
    ensure_registered_table_rows(session, CsvTableKey::SpecialItems)?;
    for row in loaded_registered_csv_rows(session, CsvTableKey::SpecialItems)?
        .iter()
        .filter(|row| !row.is_comment)
    {
        add_blueprint_package_metadata(metadata, &row.data);
    }
    Ok(())
}

fn add_blueprint_package_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    row: &Map<String, Value>,
) {
    if !row_has_tag(row, "package_bp") {
        return;
    }
    let Some(tag) = string_from_row(row, "plugin params") else {
        return;
    };
    let Some(name) = string_from_row(row, "name") else {
        return;
    };
    metadata.insert(
        tag,
        SourceTokenMetadata {
            label: name,
            description: string_from_row(row, "desc"),
        },
    );
}

fn row_has_tag(row: &Map<String, Value>, expected: &str) -> bool {
    row.get("tags")
        .and_then(Value::as_str)
        .is_some_and(|tags| tags.split(',').map(str::trim).any(|tag| tag == expected))
}

fn add_faction_blueprint_metadata(
    metadata: &mut HashMap<String, SourceTokenMetadata>,
    session: &super::super::model::ProjectSession,
) {
    for (tag, faction_id) in &session.faction_blueprint_tags {
        if metadata.contains_key(tag) {
            continue;
        }
        let faction_name = session
            .faction_files
            .get(faction_id)
            .and_then(|v| v.data.get("displayName"))
            .or_else(|| {
                session
                    .faction_files
                    .get(faction_id)
                    .and_then(|v| v.data.get("displayNameLong"))
            })
            .and_then(serde_json::Value::as_str)
            .unwrap_or(faction_id);
        metadata.insert(
            tag.clone(),
            SourceTokenMetadata {
                label: format!("{faction_name}蓝图"),
                description: Some(format!("由势力 {faction_name} 推导的蓝图标签。")),
            },
        );
    }
}

#[cfg(test)]
mod tests {
    use crate::services::project::test_support::project_workspace;
    #[test]
    fn projectile_reference_catalog() {
        let root = project_workspace("projectile_catalog");
        let local = root.join("mod");
        let core = root.join("starsector-core");
        for dir in [&local, &core] {
            std::fs::create_dir_all(dir.join("data/weapons/proj")).unwrap();
        }
        for (dir, id, sprite) in [
            (&local, "shared", "mod.png"),
            (&local, "local", "local.png"),
            (&core, "shared", "overridden.png"),
            (&core, "core_only", "core.png"),
        ] {
            crate::io::write_utf8_no_bom(
                &dir.join(format!("data/weapons/proj/{id}.proj")),
                &serde_json::json!({"id":id,"specClass":"missile","sprite":sprite}).to_string(),
            )
            .unwrap();
        }
        let mut trace = crate::services::project::PerformanceTrace::new("catalog.open");
        let manifest =
            crate::services::project::open_project_session_traced(&local, Some(&root), &mut trace)
                .unwrap();
        let groups =
            crate::services::query_csv_source_options(&manifest.session_id, "csv:projectiles.id")
                .unwrap();
        crate::services::project::close_project_session(manifest.session_id).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, crate::models::ResourceSource::Mod);
        assert_eq!(groups[1].origin, crate::models::ResourceSource::Core);
        assert_eq!(
            groups[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            vec!["local", "shared"]
        );
        assert_eq!(groups[1].options[0].value, "core_only");
        assert_eq!(
            groups[1].options[0].resource_ref.as_ref().unwrap().source,
            crate::models::ResourceSource::Core
        );
        root.close().unwrap();
    }
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::io::write_utf8_no_bom;

    #[test]
    fn config_catalog_sources() {
        let root = project_workspace("config_catalogs");
        let local = root.join("mod");
        let core = root.join("starsector-core");
        for dir in [&local, &core] {
            std::fs::create_dir_all(dir.join("data/config")).unwrap();
        }
        let mut trace = crate::services::project::PerformanceTrace::new("catalog.open");
        let manifest = open_project_session_traced(&local, Some(&root), &mut trace).unwrap();
        for &(source, relative, section) in CONFIG_OPTION_SOURCES {
            assert!(
                query_csv_source_options(&manifest.session_id, source)
                    .unwrap()
                    .is_empty()
            );
            let values = |modded| {
                let mut values = serde_json::json!({"shared":{},"core_only":{}});
                if modded {
                    values = serde_json::json!({"shared":{},"本地.样式":{}});
                }
                if source == "config:sounds" {
                    values["plain"] = serde_json::json!([]);
                    values["music"] = serde_json::json!({"track":[]});
                }
                if let Some(key) = section {
                    serde_json::json!({key:values})
                } else {
                    values
                }
            };
            write_utf8_no_bom(&core.join(relative), &values(false).to_string()).unwrap();
            write_utf8_no_bom(&local.join(relative), &values(true).to_string()).unwrap();
            let groups = query_csv_source_options(&manifest.session_id, source).unwrap();
            assert_eq!(groups.len(), 2);
            assert_eq!(groups[0].origin, ResourceSource::Mod);
            assert_eq!(groups[1].origin, ResourceSource::Core);
            let all = groups
                .iter()
                .flat_map(|group| &group.options)
                .collect::<Vec<_>>();
            assert_eq!(
                all.iter().filter(|option| option.value == "shared").count(),
                1
            );
            assert!(all.iter().any(|option| option.value == "本地.样式"));
            assert!(!all.iter().any(|option| option.value == "music"));
            if source == "config:sounds" {
                assert!(all.iter().any(|option| option.value == "plain"));
            }
            std::fs::remove_file(local.join(relative)).unwrap();
            let groups = query_csv_source_options(&manifest.session_id, source).unwrap();
            assert_eq!(groups.len(), 1);
            assert_eq!(groups[0].origin, ResourceSource::Core);
            std::fs::remove_file(core.join(relative)).unwrap();
        }
        write_utf8_no_bom(
            &local.join("data/config/settings.json"),
            r#"{"designTypeColors":[]}"#,
        )
        .unwrap();
        let error =
            query_csv_source_options(&manifest.session_id, "config:designTypes").unwrap_err();
        assert_eq!(error.code(), "misc_config.shape_invalid");
        assert!(
            error
                .location()
                .unwrap()
                .path
                .as_ref()
                .unwrap()
                .ends_with("settings.json")
        );
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_options_return_resource_refs_without_data_urls() {
        let root = project_workspace("source_resource_refs");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_a.ship"),
            r#"{"hullId":"ship_a","hullName":"Spec Ship A","spriteName":"graphics/ships/ship_a.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == "ship_a")
            .unwrap();
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/ship_a.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn source_options_return_complete_stable_mod_then_core_catalog() {
        let root = project_workspace("source_complete_catalog");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/campaign")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/campaign")).unwrap();

        let mut mod_csv = String::from("id,name\r\n");
        for index in 0..501 {
            mod_csv.push_str(&format!("mod_{index:03},Mod {index:03}\r\n"));
        }
        let mut core_csv = String::from("id,name\r\nmod_250,Core Duplicate\r\n");
        for index in 0..501 {
            core_csv.push_str(&format!("core_{index:03},Core {index:03}\r\n"));
        }
        write_utf8_no_bom(&mod_root.join("data/campaign/commodities.csv"), &mod_csv).unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/commodities.csv"),
            &core_csv,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:commodities.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(groups[0].options.len(), 501);
        assert_eq!(groups[1].origin, ResourceSource::Core);
        assert_eq!(groups[1].options.len(), 501);
        assert_eq!(
            groups
                .iter()
                .map(|group| group.options.len())
                .sum::<usize>(),
            1002
        );
        assert_eq!(
            groups[0]
                .options
                .first()
                .map(|option| option.value.as_str()),
            Some("mod_000")
        );
        assert_eq!(
            groups[0].options.last().map(|option| option.value.as_str()),
            Some("mod_500")
        );
        assert_eq!(
            groups[1]
                .options
                .first()
                .map(|option| option.value.as_str()),
            Some("core_000")
        );
        assert_eq!(
            groups[1].options.last().map(|option| option.value.as_str()),
            Some("core_500")
        );
        assert!(
            groups[0]
                .options
                .iter()
                .all(|option| option.origin == ResourceSource::Mod)
        );
        assert!(
            groups[1]
                .options
                .iter()
                .all(|option| option.origin == ResourceSource::Core)
        );
        root.close().unwrap();
    }

    #[test]
    fn mod_id_source_options_include_csv_metadata_and_resource() {
        let root = project_workspace("current_source_resource_refs");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_a.ship"),
            r#"{"hullId":"ship_a","hullName":"Spec Ship A","spriteName":"graphics/ships/ship_a.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Mod)
            .and_then(|group| group.options.first())
            .unwrap();
        assert_eq!(option.label, "Ship A (ship_a)");
        assert_eq!(option.origin, ResourceSource::Mod);
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/ship_a.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn core_id_source_options_include_csv_metadata_and_resource() {
        let root = project_workspace("current_core_source_resource_refs");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        write_utf8_no_bom(&mod_root.join("data/hulls/ship_data.csv"), "id,name\r\n").unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_ship,Core Ship\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Spec Core Ship","spriteName":"graphics/ships/core_ship.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| group.options.first())
            .unwrap();
        assert_eq!(option.label, "Core Ship (core_ship)");
        assert_eq!(option.origin, ResourceSource::Core);
        assert_eq!(
            option
                .resource_ref
                .as_ref()
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/core_ship.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn ship_source_options_use_hull_name_only_when_csv_name_is_missing() {
        let root = project_workspace("ship_source_name_fallback");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/ship_data.csv"),
            "id,name\r\nmod_ship,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_ship.ship"),
            r#"{"hullId":"mod_ship","hullName":"Mod Fallback"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_ship,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Core Fallback"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(
            source_option_label_from_groups(&groups, "mod_ship").as_deref(),
            Some("Mod Fallback (mod_ship)")
        );
        assert_eq!(
            source_option_label_from_groups(&groups, "core_ship").as_deref(),
            Some("Core Fallback (core_ship)")
        );
        root.close().unwrap();
    }

    #[test]
    fn wing_source_options_support_fighter_ids_and_tags() {
        let root = project_workspace("wing_source_options");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("data/variants/fighters")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/wing_data.csv"),
            "id,variant,tags\r\ntalon_wing,talon_Interceptor,hegemony\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/fighters/talon_Interceptor.variant"),
            r#"{"variantId":"talon_Interceptor","hullId":"talon","displayName":"截击机"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let id_groups = query_csv_source_options(&manifest.session_id, "csv:wings.id").unwrap();
        let tag_groups = query_csv_source_options(&manifest.session_id, "csv:wings.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(
            source_option_label_from_groups(&id_groups, "talon_wing").as_deref(),
            Some("截击机 (talon_wing)")
        );
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "hegemony").as_deref(),
            Some("hegemony")
        );
        root.close().unwrap();
    }

    #[test]
    fn core_wing_source_options_fail_when_skin_index_fails() {
        let root = project_workspace("core_wing_source_ref_skin_error");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(&mod_root).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls/skins")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/wing_data.csv"),
            "id,variant\r\ncore_wing,core_variant\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/variants/core_variant.variant"),
            r#"{"variantId":"core_variant","hullId":"skin_hull"}"#,
        )
        .unwrap();
        write_utf8_no_bom(&root.join("starsector-core/data/hulls/skins/bad.skin"), "{").unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let error = query_csv_source_options(&manifest.session_id, "csv:wings.id")
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("bad.skin"));
        root.close().unwrap();
    }

    #[test]
    fn core_wing_source_options_do_not_use_mod_variants_for_resource_refs() {
        let root = project_workspace("core_wing_source_ref_uses_core_variants_only");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/variants")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/variants/shared_variant.variant"),
            r#"{"variantId":"shared_variant","hullId":"core_hull"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/wing_data.csv"),
            "id,variant\r\ncore_wing,shared_variant\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_hull.ship"),
            r#"{"hullId":"core_hull","spriteName":"graphics/ships/core_hull.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:wings.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| {
                group
                    .options
                    .iter()
                    .find(|option| option.value == "core_wing")
            })
            .unwrap();
        assert_eq!(option.origin, ResourceSource::Core);
        assert!(option.resource_ref.is_none());
        root.close().unwrap();
    }

    #[test]
    fn variant_id_source_options_combine_mod_and_core_entities() {
        let root = project_workspace("variant_id_source_options");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/variants")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/hulls")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/variants")).unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name\r\ncore_hull,Core Hull\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/variants/mod_fighter.variant"),
            r#"{"variantId":"mod_fighter","hullId":"core_hull","displayName":"Mod 僚机"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/variants/core_fighter.variant"),
            r#"{"variantId":"core_fighter","hullId":"core_hull","displayName":"Core 僚机"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_hull.ship"),
            r#"{"hullId":"core_hull","spriteName":"graphics/ships/core_hull.png"}"#,
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:variants.variantId").unwrap();

        let _ = close_project_session(manifest.session_id);

        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(
            groups[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            vec!["mod_fighter"]
        );
        assert_eq!(groups[1].origin, ResourceSource::Core);
        assert_eq!(
            groups[1]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            vec!["core_fighter"]
        );
        assert_eq!(
            source_option_label_from_groups(&groups, "mod_fighter").as_deref(),
            Some("Core Hull (Mod 僚机)")
        );
        let core_option = groups[1].options.first().unwrap();
        assert!(core_option.resource_ref.is_some());
        root.close().unwrap();
    }

    #[test]
    fn unknown_entity_source_still_fails_as_unknown_table() {
        let root = project_workspace("unknown_entity_source");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error =
            query_csv_source_options(&manifest.session_id, "csv:nonexistent.foo").unwrap_err();

        let _ = close_project_session(manifest.session_id);
        assert!(matches!(
            error,
            crate::errors::AppError::Message {
                code: "source.table_unknown",
                ..
            }
        ));
        root.close().unwrap();
    }

    #[test]
    fn core_weapon_source_options_do_not_use_mod_weapon_specs_for_resource_refs() {
        let root = project_workspace("core_weapon_source_ref_uses_core_specs_only");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/weapons")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/weapons")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/weapons/weapon_data.csv"),
            "id,name\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/weapons/shared_weapon.wpn"),
            r#"{"id":"shared_weapon","turretSprite":"graphics/weapons/mod_shared.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/weapons/weapon_data.csv"),
            "id,name\r\nshared_weapon,Shared Weapon\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups = query_csv_source_options(&manifest.session_id, "csv:weapons.id").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .find(|group| group.origin == ResourceSource::Core)
            .and_then(|group| {
                group
                    .options
                    .iter()
                    .find(|option| option.value == "shared_weapon")
            })
            .unwrap();
        assert_eq!(option.origin, ResourceSource::Core);
        assert!(option.resource_ref.is_none());
        root.close().unwrap();
    }

    #[test]
    fn csv_source_parser_requires_registered_table_key() {
        let result = parse_csv_source("csv:missions.id");

        assert!(result.is_err());
    }

    #[test]
    fn csv_source_options_reject_missing_source_column() {
        let root = project_workspace("source_missing_column");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\r\nship_a,Ship A\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_csv_source_options(&manifest.session_id, "csv:ships.missing")
            .unwrap_err()
            .to_string();

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("csv source column does not exist: ships.missing"));
        root.close().unwrap();
    }

    #[test]
    fn non_id_csv_source_options_do_not_inherit_row_resources() {
        let root = project_workspace("source_non_id_no_resource");
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/commodities.csv"),
            "id,name,tags,icon\r\nore,Ore,bulk,graphics/icons/cargo/ore.png\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let option = groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == "bulk")
            .unwrap();
        assert!(option.resource_ref.is_none());
        root.close().unwrap();
    }

    #[test]
    fn tag_and_hint_source_options_use_separate_known_labels() {
        let root = project_workspace("source_separate_tag_hint_labels");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name,tags,hints\r\nweapon,Weapon,no_drop,PD\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let tag_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.tags").unwrap();
        let hint_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.hints").unwrap();

        let _ = close_project_session(manifest.session_id);
        let tag_label = source_option_label_from_groups(&tag_groups, "no_drop");
        let hint_label = source_option_label_from_groups(&hint_groups, "PD");
        assert_eq!(
            tag_label.as_deref(),
            Some("no_drop (不会作为常规战利品出现)")
        );
        assert_eq!(hint_label.as_deref(), Some("PD (点防御)"));
        root.close().unwrap();
    }

    #[test]
    fn tag_source_options_label_blueprint_package_tags_from_core_special_items() {
        let root = project_workspace("source_core_blueprint_package_tag_labels");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(mod_root.join("data/campaign")).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/data/campaign")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/campaign/commodities.csv"),
            "id,name,tags\r\ncommodity,Commodity,lowtech_bp\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\nLow Tech Blueprint Package,low_tech_package,\"package_bp, codex_unlockable\",lowtech_bp,Unlocks low tech blueprints.\r\n#Disabled Package,disabled,package_bp,lowtech_bp,Disabled description.\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/campaign/commodities.csv"),
            "id,name,tags\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let tag_label = source_option_label_from_groups(&groups, "lowtech_bp");
        let tag_description = source_option_description_from_groups(&groups, "lowtech_bp");
        assert_eq!(
            tag_label.as_deref(),
            Some("lowtech_bp (Low Tech Blueprint Package)")
        );
        assert_eq!(
            tag_description.as_deref(),
            Some("Unlocks low tech blueprints.")
        );
        root.close().unwrap();
    }

    #[test]
    fn tag_source_options_read_mod_blueprint_package_metadata_from_session_rows() {
        let root = project_workspace("source_mod_blueprint_package_session_rows");
        std::fs::create_dir_all(root.join("data/campaign")).unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\n\"#Old Package\",old_package,package_bp,demo_bp,Old description.\r\n#Disabled Package,disabled,package_bp,demo_bp,Disabled description.\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/commodities.csv"),
            "id,name,tags\r\ncommodity,Commodity,demo_bp\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        query_csv_source_options(&manifest.session_id, "csv:specialItems.tags").unwrap();
        write_utf8_no_bom(
            &root.join("data/campaign/special_items.csv"),
            "name,id,tags,plugin params,desc\r\nNew Package,new_package,package_bp,demo_bp,New description.\r\n",
        )
        .unwrap();
        let groups =
            query_csv_source_options(&manifest.session_id, "csv:commodities.tags").unwrap();

        let _ = close_project_session(manifest.session_id);
        let tag_label = source_option_label_from_groups(&groups, "demo_bp");
        let tag_description = source_option_description_from_groups(&groups, "demo_bp");
        assert_eq!(tag_label.as_deref(), Some("demo_bp (#Old Package)"));
        assert_eq!(tag_description.as_deref(), Some("Old description."));
        root.close().unwrap();
    }

    #[test]
    fn source_options_label_core_tag_and_hint_metadata() {
        let root = project_workspace("source_core_tag_hint_metadata");
        std::fs::create_dir_all(root.join("data/weapons")).unwrap();
        write_utf8_no_bom(
            &root.join("data/weapons/weapon_data.csv"),
            "id,name,tags,hints\r\nweapon,Weapon,codex_unlockable,CONSERVE_5\r\nbeam,Beam,beam999,DIRECT_AIM\r\nbad,Bad,energy123,\"CONSERVE_999, beam999\"\r\n",
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let tag_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.tags").unwrap();
        let hint_groups =
            query_csv_source_options(&manifest.session_id, "csv:weapons.hints").unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "codex_unlockable").as_deref(),
            Some("codex_unlockable (数据百科待解锁)")
        );
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "beam999").as_deref(),
            Some("beam999")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "DIRECT_AIM").as_deref(),
            Some("DIRECT_AIM (导弹直线追踪目标)")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "CONSERVE_5").as_deref(),
            Some("CONSERVE_5 (至少保留 5 轮弹药)")
        );
        let kinetic_template = tag_groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == "kinetic*")
            .unwrap();
        assert_eq!(kinetic_template.origin, ResourceSource::Core);
        assert_eq!(kinetic_template.template_value.as_deref(), Some("kinetic0"));
        assert_eq!(kinetic_template.template_max, Some(99));
        assert_eq!(
            source_option_label_from_groups(&tag_groups, "energy123").as_deref(),
            Some("energy123")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "CONSERVE_999").as_deref(),
            Some("CONSERVE_999")
        );
        assert_eq!(
            source_option_label_from_groups(&hint_groups, "beam999").as_deref(),
            Some("beam999")
        );
        root.close().unwrap();
    }

    fn source_option_label_from_groups(
        groups: &[SourceOptionGroup],
        value: &str,
    ) -> Option<String> {
        groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == value)
            .map(|option| option.label.clone())
    }

    fn source_option_description_from_groups(
        groups: &[SourceOptionGroup],
        value: &str,
    ) -> Option<String> {
        groups
            .iter()
            .flat_map(|group| group.options.iter())
            .find(|option| option.value == value)
            .and_then(|option| option.description.clone())
    }
}
