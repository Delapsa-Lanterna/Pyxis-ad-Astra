use super::super::model::ProjectSession;
use super::super::resources::entity_references::{apply_resource_origins, entity_resource_refs};
use super::super::resources::resource_identity;
use super::json_layers;
use crate::domain::{entity_definitions, json_composition};
use crate::errors::AppResult;
use crate::models::{EntityEditTarget, EntityKind, JsonComposition, ResourceRef, ResourceSource};
use serde_json::Value;
use std::collections::BTreeMap;

pub(in crate::services::project) fn entity_composition(
    session: &ProjectSession,
    target: &EntityEditTarget,
) -> AppResult<Option<JsonComposition>> {
    if !target
        .source
        .as_ref()
        .is_some_and(|source| source.source == ResourceSource::Mod)
        || entity_definitions::entity_spec_definition(target.kind).is_none()
    {
        return Ok(None);
    }
    json_layers::json_composition(session, &target.write.rel_path).map(Some)
}
pub(in crate::services::project) fn entity_presentation(
    session: &ProjectSession,
    target: &EntityEditTarget,
    data: &Value,
    resources: Option<BTreeMap<String, ResourceRef>>,
) -> AppResult<(Option<JsonComposition>, BTreeMap<String, ResourceRef>)> {
    let composition = entity_composition(session, target)?;
    let wrapped = matches!(target.kind, EntityKind::Weapon | EntityKind::Skill);
    let local = if wrapped { &data["spec"] } else { data };
    let mut resources = match (&composition, resources) {
        (None, Some(resources)) => resources,
        _ => {
            let effective = composition
                .as_ref()
                .map(|layers| json_composition::compose_game_json(layers, local))
                .transpose()?
                .unwrap_or_else(|| local.clone());
            let mut data = data.clone();
            if wrapped {
                data["spec"] = effective;
            } else {
                data = effective;
            }
            entity_resource_refs(session, target.kind, &target.id, &data)
        }
    };
    if target.kind != EntityKind::Variant
        && !(target.kind == EntityKind::Skin && data.get("spriteName").is_none())
        && let Some(source) = &target.source
    {
        resource_identity::apply_source_reference(source, &mut resources);
    }
    if let Some(composition) = &composition {
        apply_resource_origins(&mut resources, local, composition);
    }
    Ok((composition, resources))
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::models::*;
    use crate::services::project;
    use crate::services::project::query::entities;
    use crate::services::project::query::json_recovery::prepare_json_source_recovery;
    use crate::services::project::{PerformanceTrace, test_support};
    use crate::services::project_save::execute_save_action;
    use crate::services::project_sync::release_project_session;
    use crate::test_support::work_counts::count;
    use serde_json::json;
    use std::fs;
    #[test]
    fn entity_presentations_share_composed_resources_and_keep_local_content() {
        for (kind, relative, field, base) in [
            (
                EntityKind::Faction,
                "data/world/factions/sample.faction",
                "logo",
                json!({"displayName":"Inherited","logo":"graphics/base.png","color":[1,2,3,255]}),
            ),
            (
                EntityKind::Ship,
                "data/hulls/sample.ship",
                "spriteName",
                json!({"hullName":"Inherited","spriteName":"graphics/base.png"}),
            ),
            (
                EntityKind::Weapon,
                "data/weapons/sample.wpn",
                "turretSprite",
                json!({"turretSprite":"graphics/base.png"}),
            ),
            (
                EntityKind::Projectile,
                "data/weapons/proj/sample.proj",
                "sprite",
                json!({"sprite":"graphics/base.png"}),
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins/sample.skin",
                "spriteName",
                json!({"hullName":"Inherited","spriteName":"graphics/base.png"}),
            ),
            (
                EntityKind::Variant,
                "data/variants/sample.variant",
                "displayName",
                json!({"variantId":"sample","hullId":"base_hull","displayName":"Inherited"}),
            ),
        ] {
            let work = test_support::project_workspace("entity_presentation");
            let root = work.join("mods/local");
            let source = root.join(relative);
            let core_file = work.join("starsector-core").join(relative);
            fs::create_dir_all(source.parent().unwrap()).unwrap();
            fs::create_dir_all(core_file.parent().unwrap()).unwrap();
            let initial = if kind == EntityKind::Variant {
                json!({"variantId":"sample","hullId":"base_hull","localField":1})
            } else {
                json!({"localField":1})
            };
            fs::write(&source, initial.to_string()).unwrap();
            fs::write(&core_file, base.to_string()).unwrap();
            let hull = root.join("data/hulls/base_hull.ship");
            fs::create_dir_all(hull.parent().unwrap()).unwrap();
            fs::write(
                &hull,
                r#"{"hullId":"base_hull","spriteName":"graphics/hull.png"}"#,
            )
            .unwrap();
            let manifest = project::open_project_session_traced(
                &root,
                Some(&work),
                &mut PerformanceTrace::new("presentation.open"),
            )
            .unwrap();
            let mut overridden = initial.clone();
            overridden[field] = json!("graphics/local.png");
            for (local, replace) in [
                (initial.clone(), false),
                (overridden, false),
                (initial, true),
            ] {
                fs::write(&source, local.to_string()).unwrap();
                fs::write(
                    root.join("mod_info.json"),
                    json!({"id":"fixture","replace":if replace { vec![relative] } else { vec![] }})
                        .to_string(),
                )
                .unwrap();
                project::refresh_project_sources(
                    &manifest.session_id,
                    [relative, "mod_info.json"]
                        .map(|path| InvalidatedResourceScope {
                            source: ResourceSource::Mod,
                            rel_path: path.into(),
                        })
                        .to_vec(),
                )
                .unwrap();
                let list = entities::query_entity_list(&manifest.session_id, kind).unwrap();
                let item = list.iter().find(|record| record.id == "sample").unwrap();
                let detail = entities::query_entity(&manifest.session_id, kind, "sample")
                    .unwrap()
                    .unwrap();
                assert_eq!(
                    serde_json::to_value(&item.composition).unwrap(),
                    serde_json::to_value(&detail.composition).unwrap()
                );
                assert_eq!(
                    serde_json::to_value(&item.resource_refs).unwrap(),
                    serde_json::to_value(&detail.resource_refs).unwrap()
                );
                let content = if kind == EntityKind::Weapon {
                    &detail.data["spec"]
                } else {
                    &detail.data
                };
                assert_eq!(content, &local);
                if kind != EntityKind::Variant {
                    let resource_key = if field == "spriteName" {
                        "sprite"
                    } else {
                        field
                    };
                    if replace && local.get(field).is_none() {
                        assert!(!detail.resource_refs.contains_key(resource_key));
                    } else {
                        assert_eq!(
                            detail.resource_refs[resource_key].source,
                            if local.get(field).is_some() {
                                ResourceSource::Mod
                            } else {
                                ResourceSource::Core
                            }
                        );
                    }
                }
                if kind == EntityKind::Faction {
                    let plan = prepare_json_source_recovery(JsonRecoveryRequest {
                        session_id: manifest.session_id.clone(),
                        mod_root: manifest.mod_root.clone(),
                        origin: (&detail.target).into(),
                    })
                    .unwrap();
                    assert_eq!(plan.current_sources["file"], local);
                    assert_eq!(
                        serde_json::to_value(&plan.resource_refs).unwrap(),
                        serde_json::to_value(&detail.resource_refs).unwrap()
                    );
                }
            }
            assert_eq!(count("read", &core_file), 1);
            assert_eq!(count("parse", &core_file), 1);
            release_project_session(&manifest.session_id).unwrap();
            work.close().unwrap();
        }
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
                document: file_formats::json_write(&(data.clone())),
                json_write: JsonWriteOptions {
                    keep_filename: true,
                    ..Default::default()
                },
            }))
            .unwrap();
            assert_eq!(file_formats::read_json_value(&path).unwrap(), data);
        }
        assert!(!work.join("data/hulls/other.ship").exists());
        assert!(
            entities::query_entity(&manifest.session_id, EntityKind::Ship, "sample")
                .unwrap()
                .is_some()
        );
        release_project_session(&manifest.session_id).unwrap();
        work.close().unwrap();
    }
}
