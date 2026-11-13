use super::super::model::ProjectSession;
use super::super::session::{lock_ready_session, session_handle};
use super::super::sources::core;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::JsonDocumentFile;
use crate::models::file_content::JsonFileContent;
use crate::models::{
    EntityFileLocation, JsonComposition, JsonSourceLayer, ResourceSource, windows_path_key,
};
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::Path;

pub(crate) fn read_json_document(
    session_id: &str,
    relative: &str,
) -> AppResult<Option<JsonDocumentFile>> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    let path = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "JSON source root")?
        .resolve_relative(relative, "JSON document")?;
    if !path.is_file() {
        return Ok(None);
    }
    if let (Some(source), Some(version)) = (
        session.documents.get(relative),
        session.source_versions.get(relative),
    ) {
        return Ok(Some(JsonDocumentFile {
            document: JsonFileContent::from(source.as_ref()),
            base_versions: vec![version.clone()],
        }));
    }
    let (version, source) = io::read_versioned_json(&path)?;
    Ok(Some(JsonDocumentFile {
        document: JsonFileContent::from(&source),
        base_versions: vec![version],
    }))
}

pub(crate) fn query_json_composition(
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
    let mut roots = BTreeSet::from([windows_path_key(&session.manifest.mod_root)]);
    let mut layers = Vec::new();
    if let Some(game) = &session.manifest.starsector_root
        && let Some(layer) = core::read_core_json_layer(game, relative)?
        && roots.insert(windows_path_key(&layer.source.root))
    {
        layers.push(layer);
    }
    for source in session.preceding_references()? {
        if roots.insert(windows_path_key(&source.identity.mod_root))
            && let Some(mut layer) = source_layer(&source.session, relative)?
        {
            layer.source.reference = Some(Box::new(source.identity.clone()));
            layer.source.source = ResourceSource::Reference;
            layers.push(layer);
        }
    }
    let excluded = if relative == "data/config/settings.json" {
        "vsync refreshRate fps devMode godMode playtestingMode colorblindMode resolutionOverride forceAspectRatio autoturnMode showEnemyWaypoints windowLocationX windowLocationY undecoratedWindow enableSoundFilters allowAnyJavaVersion allowForceQuitInIronMode useDefaultMouseCursor queryMaxAASamples maxAASamples aaSamplesOverride screenScaleOverride refreshRateOverride baseMemoryRequired maxMemoryFractionOfTotal minMemoryMB maxMemoryMB allowJVMRestartFromLauncher allowJVMRestartFromLauncherInDevMode requireTypingDeleteToDeleteSave".split_whitespace().map(str::to_owned).collect()
    } else {
        Vec::new()
    };
    Ok(JsonComposition {
        layers,
        excluded,
        replace: replaces(session.manifest.mod_info.as_ref(), relative),
    })
}
fn replaces(info: Option<&Value>, relative: &str) -> bool {
    relative != "data/config/settings.json"
        && info
            .and_then(|v| v.get("replace"))
            .and_then(Value::as_array)
            .is_some_and(|paths| {
                paths.iter().any(|path| {
                    path.as_str()
                        .is_some_and(|path| path.replace('\\', "/") == relative)
                })
            })
}
fn source_layer(session: &ProjectSession, relative: &str) -> AppResult<Option<JsonSourceLayer>> {
    let boundary = FsRootBoundary::new(Path::new(&session.manifest.mod_root), "JSON layer")?;
    let path = boundary.resolve_relative(relative, "JSON layer")?;
    if !path.is_file() {
        return Ok(None);
    }
    let (version, data) = if let Some(source) = session.documents.get(relative) {
        (
            session.source_versions[relative].clone(),
            source.content.to_json()?,
        )
    } else {
        let (version, source) = io::read_versioned_json(&path)?;
        (version, source.content.to_json()?)
    };
    if session
        .source_versions
        .get(relative)
        .is_some_and(|expected| *expected != version)
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
            path: path.to_string_lossy().into_owned(),
        },
        version,
        data,
        replace: replaces(session.manifest.mod_info.as_ref(), relative),
    }))
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::domain::json_composition;
    use crate::domain::schema;

    use crate::models::*;
    use crate::parsers;
    use crate::services::misc_config;
    use crate::services::project;
    use crate::services::project::query::entities;
    use crate::services::project::query::json_recovery::prepare_json_source_recovery;
    use crate::services::project::{PerformanceTrace, test_support};
    use crate::services::project_save::execute_save_action;
    use crate::services::project_sync::release_project_session;
    use crate::test_support as source_test_support;
    use crate::test_support::work_counts::count;
    use serde_json::json;
    use std::fs;
    #[test]
    fn physical_sources_contribute_once_through_save_and_reopen() {
        if source_test_support::isolated_test() {
            return;
        }
        let work = test_support::project_workspace("composition_physical_sources");
        let relative = "data/variants/probe.variant";
        let mut manifests = Vec::new();
        for (name, groups) in [("starsector-core", 6), ("first", 0), ("local", 1)] {
            let root = work.join(name);
            let path = root.join(relative);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(
                &path,
                json!({"variantId":"probe","hullId":"probe_hull",
                    "weaponGroups":vec![json!({"mode":"LINKED","weapons":{}}); groups],
                    "hullMods":[name]})
                .to_string(),
            )
            .unwrap();
            manifests.push(
                project::open_project_session_traced(
                    &root,
                    Some(&work),
                    &mut PerformanceTrace::new("composition.physical"),
                )
                .unwrap(),
            );
        }
        let core_path = work.join("starsector-core").join(relative);
        for (target, order, sources, expected) in [
            (0, vec![0, 1, 2], vec![], vec!["starsector-core"]),
            (2, vec![0, 1, 2], vec![], vec!["starsector-core", "local"]),
            (2, vec![0, 1, 2], vec![0], vec!["starsector-core", "local"]),
            (
                2,
                vec![0, 1, 2],
                vec![0, 1],
                vec!["starsector-core", "first", "local"],
            ),
            (
                2,
                vec![1, 0, 2],
                vec![1, 0],
                vec!["starsector-core", "first", "local"],
            ),
        ] {
            project::set_reference_order(
                order
                    .iter()
                    .map(|&i| manifests[i].session_id.clone())
                    .collect(),
            )
            .unwrap();
            let source_ids = sources
                .iter()
                .map(|&i| manifests[i].session_id.clone())
                .collect::<Vec<_>>();
            project::set_reference_sources(&source_ids).unwrap();
            let manifest = &manifests[target];
            for attempt in 0..2 {
                let reads = count("read", &core_path);
                let entity =
                    entities::query_entity(&manifest.session_id, EntityKind::Variant, "probe")
                        .unwrap()
                        .unwrap();
                let composition = entity.composition.as_ref().unwrap();
                assert_eq!(composition.layers.len(), expected.len() - 1);
                if attempt == 1 {
                    assert_eq!(count("read", &core_path), reads);
                }
                let effective =
                    json_composition::compose_game_json(composition, &entity.data).unwrap();
                assert_eq!(effective["hullMods"], json!(expected));
                assert_eq!(
                    effective["weaponGroups"].as_array().unwrap().len(),
                    if target == 0 { 6 } else { 7 }
                );
                schema::validate_document(parsers::bundled_schema("variant"), &effective).unwrap();
                assert!(
                    composition
                        .layers
                        .iter()
                        .all(|layer| layer.source.source == ResourceSource::Core
                            || layer.source.reference.as_ref().unwrap().session_id
                                == manifests[1].session_id)
                );
            }
        }
        project::set_reference_sources(&Vec::new()).unwrap();
        for (index, manifest) in manifests.iter().enumerate() {
            let entity = entities::query_entity(&manifest.session_id, EntityKind::Variant, "probe")
                .unwrap()
                .unwrap();
            let mut data = entity.data;
            data["displayName"] = json!("Saved probe");
            let saved = execute_save_action(SaveAction::SaveVariantEntity(JsonFileSave {
                base_versions: entity.base_versions,
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                previous_id: Some("probe".into()),
                next_id: "probe".into(),
                document: file_formats::json_write(&(data.clone())),
                rel_path: Some(relative.into()),
                json_write: Default::default(),
            }))
            .unwrap();
            assert_eq!(saved.changes.len(), 1);
            assert_eq!(
                file_formats::read_json_value(
                    &work
                        .join(["starsector-core", "first", "local"][index])
                        .join(relative)
                )
                .unwrap(),
                data
            );
        }
        for manifest in manifests {
            release_project_session(&manifest.session_id).unwrap();
        }
        for (name, groups, layers) in [("starsector-core", 6, 0), ("first", 6, 1), ("local", 7, 1)]
        {
            let manifest = project::open_project_session_traced(
                &work.join(name),
                Some(&work),
                &mut PerformanceTrace::new("composition.reopen"),
            )
            .unwrap();
            let entity = entities::query_entity(&manifest.session_id, EntityKind::Variant, "probe")
                .unwrap()
                .unwrap();
            let composition = entity.composition.unwrap();
            assert_eq!(composition.layers.len(), layers);
            let effective =
                json_composition::compose_game_json(&composition, &entity.data).unwrap();
            assert_eq!(effective["displayName"], "Saved probe");
            assert_eq!(effective["weaponGroups"].as_array().unwrap().len(), groups);
            schema::validate_document(parsers::bundled_schema("variant"), &effective).unwrap();
            release_project_session(&manifest.session_id).unwrap();
        }
        work.close().unwrap();
    }

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
                document: file_formats::json_write(&(json!({"fixtureValue":2}))),
                json_write: Default::default(),
            }))
            .unwrap();
            assert_eq!(saved.changes.len(), 1, "{relative}");
            assert_eq!(
                file_formats::read_json_value(&root.join(relative)).unwrap(),
                json!({"fixtureValue":2})
            );
        }
        for (kind, relative, data) in configs {
            let file = misc_config::query_project_misc_config(&MiscConfigRead {
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
                document: file_formats::json_write(&(data.clone())),
                json_write: Default::default(),
            }))
            .unwrap();
            assert_eq!(
                file_formats::read_json_value(&root.join(relative)).unwrap(),
                data
            );
        }
        release_project_session(&manifest.session_id).unwrap();
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
        release_project_session(&reopened.session_id).unwrap();
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
                json!({"id":"different","displayName":"Base","logo":"graphics/reference.png","knownShips":{"hulls":["A"]}}),
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
        project::set_reference_sources(&[
            base.session_id.clone(),
            local.session_id.clone(),
            later.session_id.clone(),
        ])
        .unwrap();
        let entity = entities::query_entity(&local.session_id, EntityKind::Faction, "example")
            .unwrap()
            .unwrap();
        let list = entities::query_entity_list(&local.session_id, EntityKind::Faction).unwrap();
        let plan = prepare_json_source_recovery(JsonRecoveryRequest {
            session_id: local.session_id.clone(),
            mod_root: local.mod_root.clone(),
            origin: (&entity.target).into(),
        })
        .unwrap();
        let resource = &entity.resource_refs["logo"];
        assert_eq!(resource.source, ResourceSource::Reference);
        assert_eq!(
            resource.reference.as_ref().unwrap().session_id,
            base.session_id
        );
        assert_eq!(
            serde_json::to_value(&list[0].resource_refs).unwrap(),
            serde_json::to_value(&entity.resource_refs).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&plan.resource_refs).unwrap(),
            serde_json::to_value(&entity.resource_refs).unwrap()
        );
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
            project::set_reference_sources(&ids).unwrap();
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
        project::set_reference_sources(&Vec::new()).unwrap();
        let detached = entities::query_entity(&local.session_id, EntityKind::Faction, "example")
            .unwrap()
            .unwrap();
        assert!(detached.composition.unwrap().layers.is_empty());
        for manifest in [base, local, later] {
            release_project_session(&manifest.session_id).unwrap();
        }
        work.close().unwrap();
    }
}
