use crate::domain::entity_definitions::PROJECTILE_SPEC_DEFINITION;
use crate::errors::AppResult;
use crate::models::ResourceSource;
use crate::services::project::sources::documents::LoadedSpecRecord;
use crate::services::project::sources::{SourceReader, documents};
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::Path;

/// Merges Mod projectile specs over core fallbacks; a Mod spec with the same
/// id always wins, core-only specs fill the rest.
#[cfg(test)]
pub(in crate::services::project) fn load_projectile_specs(
    mod_root: &Path,
    core_projectiles: Option<&BTreeMap<String, LoadedSpecRecord>>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    load_projectile_specs_from(&mut SourceReader::new(mod_root)?, core_projectiles)
}
pub(in crate::services::project) fn load_projectile_specs_from(
    sources: &mut SourceReader,
    core_projectiles: Option<&BTreeMap<String, LoadedSpecRecord>>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut result = BTreeMap::new();
    result.extend(documents::load_spec_records_from(
        sources,
        PROJECTILE_SPEC_DEFINITION.source_dirs(),
        "proj",
        "id",
        ResourceSource::Mod,
    )?);
    if let Some(core_projectiles) = core_projectiles {
        for (id, value) in core_projectiles {
            result.entry(id.clone()).or_insert_with(|| value.clone());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::models::{EntityKind, InvalidatedQueryKind, InvalidatedResourceScope};
    use crate::services::project;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::query::{entities, source_catalog::values};
    use crate::services::project::sources::core;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project_sync::release_project_session;
    use crate::test_support::work_counts;
    use serde_json::{Value, json};
    use std::fs;

    #[test]
    fn mod_projectile_overrides_core_fallback() {
        for mod_directory in PROJECTILE_SPEC_DEFINITION.source_dirs() {
            for core_directory in PROJECTILE_SPEC_DEFINITION.source_dirs() {
                assert_mod_projectile_override(mod_directory, core_directory);
            }
        }
    }

    fn assert_mod_projectile_override(mod_directory: &str, core_directory: &str) {
        let root = project_workspace("projectile_fallback");
        let mod_proj = root.join("mod").join(mod_directory);
        let core_proj = root.join("core/starsector-core").join(core_directory);
        fs::create_dir_all(&mod_proj).unwrap();
        fs::create_dir_all(&core_proj).unwrap();
        write_utf8_no_bom(&mod_proj.join("same.proj"), r#"{"id":"same","damage":2}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("same.proj"), r#"{"id":"same","damage":1}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("core_only.proj"), r#"{"id":"core_only"}"#).unwrap();

        let core_projectiles =
            core::load_core_projectile_specs(&root.join("core").to_string_lossy()).unwrap();
        let loaded = load_projectile_specs(&root.join("mod"), Some(&core_projectiles)).unwrap();

        assert_eq!(loaded["same"].data["damage"], 2);
        assert!(loaded["core_only"].data.is_object());
        assert_eq!(loaded.len(), 2);
        for path in [
            mod_proj.join("same.proj"),
            core_proj.join("same.proj"),
            core_proj.join("core_only.proj"),
        ] {
            assert_eq!(work_counts::count("read", &path), 1);
            assert_eq!(work_counts::count("parse", &path), 1);
        }
        root.close().unwrap();
    }

    #[test]
    fn projectile_sources_refresh_queries_and_catalogs() {
        for directory in PROJECTILE_SPEC_DEFINITION.source_dirs() {
            for source in [ResourceSource::Mod, ResourceSource::Core] {
                let root = project_workspace("projectile_source_refresh");
                let local = root.join("mods/local");
                fs::create_dir_all(&local).unwrap();
                let relative = format!("{directory}/nested/fixture.proj");
                let owner = if source == ResourceSource::Mod {
                    local.clone()
                } else {
                    root.join("starsector-core")
                };
                fs::create_dir_all(root.join("starsector-core")).unwrap();
                let path = owner.join(&relative);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                write_utf8_no_bom(&path, r#"{"id":"probe","width":1}"#).unwrap();
                let manifest = project::open_project_session_traced(
                    &local,
                    Some(&root),
                    &mut PerformanceTrace::new("projectile.open"),
                )
                .unwrap();
                assert_eq!(manifest.entity_summaries.projectiles, 1);
                let entity =
                    entities::query_entity(&manifest.session_id, EntityKind::Projectile, "probe")
                        .unwrap()
                        .unwrap();
                assert_eq!(entity.target.source.as_ref().unwrap().rel_path, relative);
                assert_eq!(entity.data["width"], 1);
                for (width, scope) in [
                    (Some(2), relative.as_str()),
                    (None, *directory),
                    (Some(3), *directory),
                ] {
                    if let Some(width) = width {
                        write_utf8_no_bom(&path, &json!({"id":"probe","width":width}).to_string())
                            .unwrap();
                    } else {
                        fs::remove_file(&path).unwrap();
                    }
                    let update = project::refresh_project_sources(
                        &manifest.session_id,
                        vec![InvalidatedResourceScope {
                            source,
                            rel_path: scope.into(),
                        }],
                    )
                    .unwrap();
                    let count = usize::from(width.is_some());
                    assert_eq!(update.manifest.entity_summaries.projectiles, count);
                    let list =
                        entities::query_entity_list(&manifest.session_id, EntityKind::Projectile)
                            .unwrap();
                    assert_eq!(list.len(), count);
                    let detail = entities::query_entity(
                        &manifest.session_id,
                        EntityKind::Projectile,
                        "probe",
                    )
                    .unwrap();
                    assert_eq!(
                        detail.map(|entity| entity.data["width"].clone()),
                        width.map(Value::from)
                    );
                    let groups = values::query_source_option_catalog(
                        &manifest.session_id,
                        "csv:projectiles.id",
                    )
                    .unwrap();
                    assert_eq!(
                        groups
                            .iter()
                            .map(|group| group.options.len())
                            .sum::<usize>(),
                        count
                    );
                    if let Some(entity) = list.first() {
                        assert_eq!(entity.target.source.as_ref().unwrap().rel_path, relative);
                        assert_eq!(groups[0].options[0].value, "probe");
                        assert_eq!(groups[0].origin, source);
                    }
                    for kind in [
                        InvalidatedQueryKind::EntityDetail,
                        InvalidatedQueryKind::EntityList,
                        InvalidatedQueryKind::CsvSourceOptions,
                    ] {
                        assert!(
                            update
                                .invalidation
                                .query_scopes
                                .iter()
                                .any(|scope| scope.kind == kind)
                        );
                    }
                }
                release_project_session(&manifest.session_id).unwrap();
                root.close().unwrap();
            }
        }
    }
}
