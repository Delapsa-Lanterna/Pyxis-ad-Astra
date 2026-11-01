use super::super::model::ProjectSession;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::io::FsRootBoundary;
use crate::models::{
    EntityFileLocation, EntityKind, JsonComposition, JsonSourceLayer, ResourceRef, ResourceSource,
};
use crate::services::project::session::{lock_ready_session, session_handle};

use crate::services::project::sources::core;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

pub(in crate::services::project) fn resource_origins(
    resources: &mut BTreeMap<String, ResourceRef>,
    local: &Value,
    composition: &JsonComposition,
) {
    for (key, resource) in resources {
        let field = key.split('[').next().expect("resource field");
        if local.get(field).is_some() || composition.replace {
            continue;
        }
        if let Some(layer) = composition
            .layers
            .iter()
            .rev()
            .find(|layer| layer.data.get(field).is_some())
        {
            resource.source = layer.source.source;
            resource.reference = layer.source.reference.as_deref().cloned();
        }
    }
}

pub(in crate::services) fn composition_for_session(
    session_id: &str,
    relative: &str,
) -> AppResult<JsonComposition> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    json_composition(&session, relative)
}

pub(in crate::services::project) fn json_composition(
    session: &ProjectSession,
    relative: &str,
) -> AppResult<JsonComposition> {
    let mut layers = Vec::new();
    if let Some(game) = &session.manifest.starsector_root
        && let Some(layer) = core::read_core_json_layer(game, relative)?
    {
        layers.push(layer);
    }
    for view in session.preceding_references()? {
        if let Some(mut layer) = source_layer(&view.session, relative)? {
            layer.source.reference = Some(Box::new(view.identity.clone()));
            layer.source.source = ResourceSource::Reference;
            layers.push(layer);
        }
    }
    Ok(JsonComposition {
        layers,
        replace: replaces(session.manifest.mod_info.as_ref(), relative),
        excluded: if relative == "data/config/settings.json" {
            "vsync refreshRate fps devMode godMode playtestingMode colorblindMode resolutionOverride forceAspectRatio autoturnMode showEnemyWaypoints windowLocationX windowLocationY undecoratedWindow enableSoundFilters allowAnyJavaVersion allowForceQuitInIronMode useDefaultMouseCursor queryMaxAASamples maxAASamples aaSamplesOverride screenScaleOverride refreshRateOverride baseMemoryRequired maxMemoryFractionOfTotal minMemoryMB maxMemoryMB allowJVMRestartFromLauncher allowJVMRestartFromLauncherInDevMode requireTypingDeleteToDeleteSave".split_whitespace().map(str::to_string).collect()
        } else {
            Vec::new()
        },
    })
}

fn replaces(info: Option<&Value>, relative: &str) -> bool {
    !relative.ends_with("settings.json")
        && info
            .and_then(|value| value.get("replace"))
            .and_then(Value::as_array)
            .is_some_and(|paths| {
                paths.iter().any(|path| {
                    path.as_str()
                        .is_some_and(|path| path.replace('\\', "/") == relative)
                })
            })
}

fn source_layer(session: &ProjectSession, relative: &str) -> AppResult<Option<JsonSourceLayer>> {
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "JSON source root")?;
    let path = boundary.resolve_relative(relative, "JSON source")?;
    if !path.is_file() {
        return Ok(None);
    }
    let retained = [
        EntityKind::Faction,
        EntityKind::Ship,
        EntityKind::Weapon,
        EntityKind::Projectile,
        EntityKind::System,
        EntityKind::Skill,
    ]
    .into_iter()
    .filter_map(|kind| session.spec_records(kind))
    .flat_map(|records| records.values())
    .find(|record| record.location.rel_path == relative);
    let (version, data) = if let Some(record) = retained {
        (
            session.source_versions[relative].clone(),
            record.data.clone(),
        )
    } else {
        io::read_versioned_json(&path)?
    };
    if session
        .source_versions
        .get(relative)
        .is_some_and(|expected| expected != &version)
    {
        return Err(
            AppError::message("reference.changed", "引用来源已变化，请刷新来源").at_path(&path),
        );
    }
    Ok(Some(JsonSourceLayer {
        source: EntityFileLocation {
            reference: None,
            source: ResourceSource::Mod,
            root: session.manifest.mod_root.clone(),
            rel_path: relative.into(),
            path: path.to_string_lossy().into(),
        },
        version,
        data,
        replace: replaces(session.manifest.mod_info.as_ref(), relative),
    }))
}

#[cfg(test)]
mod tests {
    #[cfg(test)]
    use crate::domain::json_composition;
    use crate::models::*;
    #[cfg(test)]
    use crate::services::misc_config;
    use crate::services::project;
    #[cfg(test)]
    use crate::services::project::query::entities;
    #[cfg(test)]
    use crate::services::project::sources::core;
    #[cfg(test)]
    use crate::services::project::{PerformanceTrace, test_support};
    use crate::services::project_save::execute_save_action;
    #[cfg(test)]
    use crate::test_support::work_counts::count;
    #[cfg(test)]
    use crate::{io, test_support as source_test_support};
    use serde_json::json;
    #[cfg(test)]
    use std::{fs, thread};

    #[test]
    fn twelve_file_kinds_keep_local_contents_through_save_and_reopen() {
        let work = test_support::project_workspace("composition_twelve_kinds");
        let root = work.join("mods/local");
        fs::create_dir_all(&root).unwrap();
        let specs = [
            (
                EntityKind::Faction,
                "data/world/factions/sample.faction",
                "id",
            ),
            (EntityKind::Ship, "data/hulls/sample.ship", "hullId"),
            (EntityKind::Weapon, "data/weapons/sample.wpn", "id"),
            (
                EntityKind::Projectile,
                "data/weapons/proj/sample.proj",
                "id",
            ),
            (EntityKind::System, "data/shipsystems/sample.system", "id"),
            (
                EntityKind::Skill,
                "data/characters/skills/sample.skill",
                "id",
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins/sample.skin",
                "skinHullId",
            ),
        ];
        let configs = [
            (
                MiscConfigKind::Strings,
                "data/strings/strings.json",
                json!({"group":{"text":"hello"}}),
            ),
            (
                MiscConfigKind::EngineStyles,
                "data/config/engine_styles.json",
                json!({"sample":{"engineColor":[1,2,3,4]}}),
            ),
            (
                MiscConfigKind::HullStyles,
                "data/config/hull_styles.json",
                json!({"sample":{"slotCover":"image.png"}}),
            ),
            (
                MiscConfigKind::Sounds,
                "data/config/sounds.json",
                json!({"sample":[{"file":"sound.ogg"}]}),
            ),
            (
                MiscConfigKind::Settings,
                "data/config/settings.json",
                json!({"designTypeColors":{"sample":[1,2,3,4]}}),
            ),
        ];
        for (_, relative, field) in specs {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, "{fixtureValue:1}").unwrap();
            let base = work.join("starsector-core").join(relative);
            fs::create_dir_all(base.parent().unwrap()).unwrap();
            fs::write(
                base,
                json!({field:"base_identity","baseField":"base"}).to_string(),
            )
            .unwrap();
        }
        for (_, relative, _) in &configs {
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, "{}").unwrap();
        }
        let manifest = project::open_project_session_traced(
            &root,
            Some(&work),
            &mut PerformanceTrace::new("composition.open"),
        )
        .unwrap();
        for (kind, relative, field) in specs {
            let entity = entities::query_entity(&manifest.session_id, kind, "sample")
                .unwrap()
                .unwrap();
            let local = if matches!(kind, EntityKind::Weapon | EntityKind::Skill) {
                &entity.data["spec"]
            } else {
                &entity.data
            };
            assert!(local.get(field).is_none());
            let effective =
                json_composition::compose_game_json(entity.composition.as_ref().unwrap(), local)
                    .unwrap();
            assert_eq!(effective[field], "base_identity");
            let saved = execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: entity.target,
                base_versions: entity.base_versions,
                data: json!({"fixtureValue":2}),
                json_write: Default::default(),
                ordered_json: None,
            }))
            .unwrap();
            assert_eq!(saved.changes.len(), 1, "{relative}");
            assert_eq!(
                io::read_json_file(&root.join(relative)).unwrap(),
                json!({"fixtureValue":2})
            );
        }
        for (kind, relative, data) in configs {
            let file = misc_config::query_project_misc_config(MiscConfigRead {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                kind,
            })
            .unwrap()
            .unwrap();
            execute_save_action(SaveAction::SaveMiscConfig(MiscConfigWrite {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                kind,
                base_versions: file.base_versions,
                data: data.clone(),
                ordered_json: data.to_string(),
                json_write: Default::default(),
            }))
            .unwrap();
            assert_eq!(io::read_json_file(&root.join(relative)).unwrap(), data);
        }
        project::close_project_session(manifest.session_id).unwrap();
        let reopened = project::open_project_session_traced(
            &root,
            Some(&work),
            &mut PerformanceTrace::new("composition.reopen"),
        )
        .unwrap();
        for (kind, _, _) in specs {
            assert!(
                entities::query_entity(&reopened.session_id, kind, "sample")
                    .unwrap()
                    .is_some()
            );
        }
        project::close_project_session(reopened.session_id).unwrap();
        work.close().unwrap();
    }

    #[test]
    fn ordered_references_use_saved_contents_and_release_on_disable() {
        if source_test_support::isolated_test() {
            return;
        }
        let work = test_support::project_workspace("composition_order");
        for (name, data) in [
            (
                "base",
                json!({"id":"different","displayName":"Base","knownShips":{"hulls":["A"]}}),
            ),
            ("local", json!({"knownShips":{"hulls":["B"]}})),
            ("later", json!({"knownShips":{"hulls":["C"]}})),
        ] {
            let path = work.join(name).join("data/world/factions/example.faction");
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(path, data.to_string()).unwrap();
        }
        let open = |name| {
            project::open_project_session_traced(
                &work.join(name),
                None,
                &mut PerformanceTrace::new("composition.order"),
            )
            .unwrap()
        };
        let base = open("base");
        let local = open("local");
        let later = open("later");
        project::set_reference_order(vec![
            base.session_id.clone(),
            local.session_id.clone(),
            later.session_id.clone(),
        ])
        .unwrap();
        project::set_reference_sources(vec![
            base.session_id.clone(),
            local.session_id.clone(),
            later.session_id.clone(),
        ])
        .unwrap();
        let entity = entities::query_entity(&local.session_id, EntityKind::Faction, "example")
            .unwrap()
            .unwrap();
        let composition = entity.composition.unwrap();
        assert_eq!(composition.layers.len(), 1);
        let effective = json_composition::compose_game_json(&composition, &entity.data).unwrap();
        assert_eq!(effective["id"], "different");
        assert_eq!(effective["knownShips"]["hulls"], json!(["A", "B"]));
        let own = entities::query_entity(&base.session_id, EntityKind::Faction, "different")
            .unwrap()
            .unwrap();
        assert!(own.composition.unwrap().layers.is_empty());
        for (order, expected) in [
            ([&base, &later, &local], json!(["A", "C", "B"])),
            ([&later, &base, &local], json!(["C", "A", "B"])),
            ([&local, &base, &later], json!(["B"])),
        ] {
            let ids = order.map(|manifest| manifest.session_id.clone()).to_vec();
            project::set_reference_order(ids.clone()).unwrap();
            project::set_reference_sources(ids).unwrap();
            let entity = entities::query_entity(&local.session_id, EntityKind::Faction, "example")
                .unwrap()
                .unwrap();
            let composition = entity.composition.unwrap();
            assert_eq!(
                composition.layers.len(),
                expected.as_array().unwrap().len() - 1
            );
            let effective =
                json_composition::compose_game_json(&composition, &entity.data).unwrap();
            assert_eq!(effective["knownShips"]["hulls"], expected);
        }
        project::set_reference_sources(Vec::new()).unwrap();
        let detached = entities::query_entity(&local.session_id, EntityKind::Faction, "example")
            .unwrap()
            .unwrap();
        assert!(detached.composition.unwrap().layers.is_empty());
        for manifest in [base, local, later] {
            project::close_project_session(manifest.session_id).unwrap();
        }
        work.close().unwrap();
    }

    #[test]
    fn core_composition_reads_once_across_calls_threads_and_invalidation() {
        let work = test_support::project_workspace("composition_read_counts");
        let path = work.join("starsector-core/data/config/settings.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{sample:1}").unwrap();
        let path = path.canonicalize().unwrap();
        let root = work.to_string_lossy().into_owned();
        for _ in 0..2 {
            core::read_core_json_layer(&root, "data/config/settings.json").unwrap();
        }
        assert_eq!(count("read", &path), 1);
        thread::scope(|scope| {
            let tasks = (0..4)
                .map(|_| {
                    scope.spawn(|| {
                        core::read_core_json_layer(&root, "data/config/settings.json").unwrap()
                    })
                })
                .collect::<Vec<_>>();
            for task in tasks {
                task.join().unwrap();
            }
        });
        assert_eq!(count("read", &path), 1);
        fs::write(&path, "{sample:2}").unwrap();
        core::invalidate_core_cache(&root).unwrap();
        let updated = core::read_core_json_layer(&root, "data/config/settings.json")
            .unwrap()
            .unwrap();
        assert_eq!(updated.data["sample"], 2);
        assert_eq!(count("read", &path), 2);
        work.close().unwrap();
    }

    #[test]
    fn keeping_filename_preserves_merge_path_and_missing_id_after_save() {
        let work = test_support::project_workspace("composition_identity_save");
        let path = work.join("data/hulls/sample.ship");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{hullId:'sample',hullName:'Local'}").unwrap();
        let manifest = project::open_project_session_traced(
            &work,
            None,
            &mut PerformanceTrace::new("composition.identity"),
        )
        .unwrap();
        for (id, data) in [
            ("sample", json!({"hullId":"other","hullName":"Changed"})),
            ("other", json!({"hullName":"Partial"})),
        ] {
            let entity = entities::query_entity(&manifest.session_id, EntityKind::Ship, id)
                .unwrap()
                .unwrap();
            execute_save_action(SaveAction::SaveEditorSpec(SpecSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                target: entity.target,
                base_versions: entity.base_versions,
                data: data.clone(),
                ordered_json: None,
                json_write: JsonWriteOptions {
                    keep_filename: true,
                    ..Default::default()
                },
            }))
            .unwrap();
            assert_eq!(io::read_json_file(&path).unwrap(), data);
        }
        assert!(!work.join("data/hulls/other.ship").exists());
        assert!(
            entities::query_entity(&manifest.session_id, EntityKind::Ship, "sample")
                .unwrap()
                .is_some()
        );
        project::close_project_session(manifest.session_id).unwrap();
        work.close().unwrap();
    }
}
