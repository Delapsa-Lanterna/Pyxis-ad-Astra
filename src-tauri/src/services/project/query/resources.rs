use super::super::definitions::entity_resources::{
    faction_resource_refs, mission_resource_refs, projectile_resource_refs, ship_resource_refs,
    weapon_resource_refs,
};
use super::super::resources::SpriteReadBatch;
use super::super::session::{lock_ready_session, session_handle};
use crate::{
    errors::AppResult,
    models::{
        DraftResourceEntityKind, ResourceDataUrlBatchEntry, ResourceDataUrlBatchResult, ResourceRef,
    },
};
use std::collections::BTreeMap;

pub fn query_engine_render_assets(
    session_id: &str,
    inline_styles: &[serde_json::Value],
) -> AppResult<crate::models::EngineRenderAssets> {
    use super::super::{resources::resource_ref, sources};
    use crate::models::{EngineRenderAssets, ResourceOwnerKind, ResourceSource};
    let handle = session_handle(session_id)?;
    let (mod_root, game_root) = {
        let session = lock_ready_session(&handle)?;
        (
            session.manifest.mod_root.clone(),
            session.manifest.starsector_root.clone(),
        )
    };
    let mut roots = Vec::new();
    if let Some(root) = game_root {
        roots.push(sources::core::core_dir(&root)?);
    }
    let references = lock_ready_session(&handle)?.references.clone();
    roots.extend(
        references
            .iter()
            .rev()
            .map(|view| view.identity.mod_root.clone().into()),
    );
    roots.push(mod_root.into());
    let mut result = EngineRenderAssets {
        styles: BTreeMap::new(),
        versions: Vec::new(),
        resources: BTreeMap::new(),
    };
    for root in roots {
        let (styles, version) = sources::engine_styles::read_engine_styles(&root)?;
        for (key, value) in styles {
            crate::json_overlay::overlay_json_value(
                result.styles.entry(key).or_insert(serde_json::Value::Null),
                value,
            );
        }
        result.versions.push(version);
    }
    let mut paths = std::collections::BTreeSet::new();
    for style in result.styles.values().chain(inline_styles) {
        for field in ["glowSprite", "glowOutline"] {
            if let Some(path) = style
                .get(field)
                .and_then(serde_json::Value::as_str)
                .filter(|path| !path.is_empty())
            {
                paths.insert(path.to_string());
            }
        }
    }
    for (_, path) in [
        ("engineGlow", "graphics/fx/engineglow32.png"),
        ("engineFlame", "graphics/fx/engineflame32.png"),
        ("engineHitGlow", "graphics/fx/hit_glow.png"),
    ] {
        paths.insert(path.into());
    }
    for path in paths {
        result.resources.insert(
            path.clone(),
            resource_ref(
                ResourceSource::Mod,
                &path,
                ResourceOwnerKind::Ship,
                "engines",
                &path,
            ),
        );
    }
    drop(lock_ready_session(&handle)?);
    Ok(result)
}

pub fn query_resource_data_urls(
    session_id: &str,
    resources: Vec<ResourceRef>,
) -> AppResult<ResourceDataUrlBatchResult> {
    let mut batch = SpriteReadBatch::new(session_id)?;
    let mut entries = Vec::with_capacity(resources.len());
    let mut outcomes = BTreeMap::new();
    for resource in resources {
        let key = super::super::resources::media_resource_key(&resource);
        let (data_url, error) = outcomes
            .entry(key)
            .or_insert_with(|| match batch.data_url(&resource) {
                Ok(value) => (value, None),
                Err(error) => (None, Some(error.diagnostic())),
            })
            .clone();
        entries.push(ResourceDataUrlBatchEntry {
            reference: resource.reference,
            key: resource.key,
            source: resource.source,
            rel_path: resource.rel_path,
            owner_kind: resource.owner_kind,
            owner_id: resource.owner_id,
            data_url,
            error,
        });
    }
    Ok(ResourceDataUrlBatchResult { entries })
}

pub fn query_draft_resources(
    session_id: &str,
    kind: DraftResourceEntityKind,
    id: &str,
    draft: &serde_json::Value,
) -> AppResult<BTreeMap<String, ResourceRef>> {
    let handle = session_handle(session_id)?;
    let _session = lock_ready_session(&handle)?;
    Ok(match kind {
        DraftResourceEntityKind::Ship => ship_resource_refs(id, draft),
        DraftResourceEntityKind::Weapon => weapon_resource_refs(id, draft),
        DraftResourceEntityKind::Faction => faction_resource_refs(id, draft),
        DraftResourceEntityKind::Mission => mission_resource_refs(id, draft),
        DraftResourceEntityKind::Projectile => projectile_resource_refs(id, draft),
        DraftResourceEntityKind::System => BTreeMap::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::super::super::resources::{media_resource_key, sprites::sprite_read_count};
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::models::{ResourceOwnerKind, ResourceRef, ResourceSource};
    use crate::services::project::cache::media::cached_sprite_media_contains;
    use crate::services::project::test_support::project_workspace;

    use crate::test_support::TestWorkspace;

    #[test]
    fn media_batch_preserves_successes_and_reports_each_failed_identity() {
        let root = project_workspace("partial_media_batch");
        std::fs::create_dir_all(root.join("graphics")).unwrap();
        std::fs::write(root.join("graphics/icon.png"), [1, 2, 3]).unwrap();
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut crate::services::project::PerformanceTrace::new("media.batch"),
        )
        .unwrap();
        let resources: Vec<_> = (0..10)
            .map(|index| ResourceRef {
                reference: None,
                source: if index == 9 {
                    ResourceSource::Reference
                } else {
                    ResourceSource::Mod
                },
                rel_path: "graphics/icon.png".into(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: format!("fixture_{index}"),
                key: "icon".into(),
            })
            .collect();
        let result = query_resource_data_urls(&manifest.session_id, resources.clone()).unwrap();
        assert_eq!(result.entries.len(), 10);
        for (index, entry) in result.entries.iter().enumerate() {
            assert_eq!(entry.owner_id, resources[index].owner_id);
            assert_eq!(entry.data_url.is_some(), index != 9);
            assert_eq!(entry.error.is_some(), index == 9);
        }
        assert_eq!(
            result.entries[9].error.as_ref().unwrap().code,
            "reference.unavailable"
        );
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn engine_assets_merge_sources_and_keep_images_independent_of_styles() {
        let root = project_workspace("engine_assets");
        let local = root.join("mod");
        let game = root.join("game");
        let core = game.join("starsector-core");
        for path in [&local, &core] {
            std::fs::create_dir_all(path.join("data/config")).unwrap();
        }
        let path = local.join("data/config/engine_styles.json");
        std::fs::write(
            core.join("data/config/engine_styles.json"),
            r#"{"A":{"engineColor":[1,2,3],"glowSizeMult":2,"nested":{"a":1}},"B":{"engineColor":[4,5,6]}}"#,
        )
        .unwrap();
        std::fs::write(&path, r#"{"A":{"engineColor":[7,8,9],"nested":{"b":2}}}"#).unwrap();
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&local, Some(&game), &mut trace).unwrap();
        let assets = query_engine_render_assets(
            &manifest.session_id,
            &[serde_json::json!({"glowSprite":"graphics/custom.png"})],
        )
        .unwrap();
        assert_eq!(assets.styles["A"]["glowSizeMult"], 2);
        assert_eq!(
            assets.styles["A"]["nested"],
            serde_json::json!({"a":1,"b":2})
        );
        assert_eq!(
            assets.resources["graphics/custom.png"].rel_path,
            "graphics/custom.png"
        );
        assert_eq!(
            assets.styles["A"]["engineColor"],
            serde_json::json!([7, 8, 9])
        );
        assert_eq!(
            assets.styles["B"]["engineColor"],
            serde_json::json!([4, 5, 6])
        );
        assert_eq!(assets.versions[1], crate::io::file_version(&path).unwrap());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(core.join("data/config/engine_styles.json")).unwrap();
        let empty = query_engine_render_assets(&manifest.session_id, &[]).unwrap();
        assert!(empty.styles.is_empty());
        assert_eq!(empty.resources.len(), 3);
        assert!(
            empty
                .resources
                .values()
                .all(|resource| resource.source == ResourceSource::Mod)
        );
        std::fs::create_dir_all(local.join("graphics/fx")).unwrap();
        std::fs::write(local.join("graphics/fx/engineglow32.png"), [1, 2, 3]).unwrap();
        assert!(
            query_resource_data_urls(
                &manifest.session_id,
                vec![empty.resources["graphics/fx/engineglow32.png"].clone()]
            )
            .unwrap()
            .entries[0]
                .data_url
                .is_some()
        );
        std::fs::write(&path, "[]").unwrap();
        assert_eq!(
            query_engine_render_assets(&manifest.session_id, &[])
                .unwrap_err()
                .code(),
            "parse.json_syntax"
        );
        close_project_session(manifest.session_id.clone()).unwrap();
        assert!(query_engine_render_assets(&manifest.session_id, &[]).is_err());
        root.close().unwrap();
    }

    fn general_purpose_base64(bytes: &[u8]) -> String {
        use base64::{Engine as _, engine::general_purpose};
        general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn batch_resource_query_keeps_order_and_uses_empty_for_missing() {
        let root = project_workspace("batch_resource_query");
        std::fs::create_dir_all(root.join("graphics/ships")).unwrap();
        std::fs::write(root.join("graphics/ships/ship.png"), [137, 80, 78, 71]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Mod,
                    rel_path: "graphics/ships/ship.png".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "ship".to_string(),
                    key: "ship".to_string(),
                },
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Mod,
                    rel_path: "graphics/ships/missing.png".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "missing".to_string(),
                    key: "missing".to_string(),
                },
            ],
        )
        .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].key, "ship");
        assert_eq!(result.entries[0].owner_kind, ResourceOwnerKind::Ship);
        assert_eq!(result.entries[0].owner_id, "ship");
        assert!(result.entries[0].data_url.is_some());
        assert_eq!(result.entries[1].key, "missing");
        assert_eq!(result.entries[1].owner_kind, ResourceOwnerKind::Ship);
        assert_eq!(result.entries[1].owner_id, "missing");
        assert!(result.entries[1].data_url.is_none());
        root.close().unwrap();
    }

    #[test]
    fn batch_resource_query_reads_shared_physical_media_once() {
        let root = project_workspace("batch_resource_query_physical_key");
        let sprite = root.join("graphics/shared/icon.png");
        std::fs::create_dir_all(sprite.parent().unwrap()).unwrap();
        std::fs::write(&sprite, [137, 80, 78, 71]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let before = sprite_read_count(&sprite);
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Mod,
                    rel_path: " graphics\\shared\\ICON.PNG/ ".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "ship".to_string(),
                    key: "icon".to_string(),
                },
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Mod,
                    rel_path: "graphics/shared/icon.png".to_string(),
                    owner_kind: ResourceOwnerKind::Weapon,
                    owner_id: "weapon".to_string(),
                    key: "thumbnail".to_string(),
                },
            ],
        )
        .unwrap();

        assert_eq!(sprite_read_count(&sprite) - before, 1);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].owner_id, "ship");
        assert_eq!(result.entries[1].owner_id, "weapon");
        assert_eq!(result.entries[0].key, "icon");
        assert_eq!(result.entries[1].key, "thumbnail");
        assert_eq!(result.entries[0].owner_kind, ResourceOwnerKind::Ship);
        assert_eq!(result.entries[1].owner_kind, ResourceOwnerKind::Weapon);
        assert!(result.entries[0].data_url.is_some());
        assert_eq!(result.entries[0].data_url, result.entries[1].data_url);
        let cached = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                reference: result.entries[1].reference.clone(),
                source: result.entries[1].source,
                rel_path: result.entries[1].rel_path.clone(),
                owner_kind: result.entries[1].owner_kind,
                owner_id: "third-owner".into(),
                key: result.entries[1].key.clone(),
            }],
        )
        .unwrap();
        assert_eq!(cached.entries[0].data_url, result.entries[0].data_url);
        assert_eq!(sprite_read_count(&sprite) - before, 1);

        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn batch_resource_query_keeps_mod_and_core_media_separate() {
        let root = project_workspace("batch_resource_query_source_key");
        let mod_sprite = root.join("mods/demo/graphics/shared/icon.png");
        let core_sprite = root.join("starsector-core/graphics/shared/icon.png");
        std::fs::create_dir_all(mod_sprite.parent().unwrap()).unwrap();
        std::fs::create_dir_all(core_sprite.parent().unwrap()).unwrap();
        std::fs::write(&mod_sprite, [1u8, 2, 3]).unwrap();
        std::fs::write(&core_sprite, [4u8, 5, 6]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest =
            open_project_session_traced(&root.join("mods/demo"), Some(&root), &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Mod,
                    rel_path: "graphics/shared/icon.png".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "mod".to_string(),
                    key: "icon".to_string(),
                },
                ResourceRef {
                    reference: None,
                    source: ResourceSource::Core,
                    rel_path: "graphics/shared/icon.png".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "core".to_string(),
                    key: "icon".to_string(),
                },
            ],
        )
        .unwrap();

        assert_ne!(result.entries[0].data_url, result.entries[1].data_url);
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn core_resource_requires_starsector_root() {
        let root = project_workspace("core_resource_without_root");

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                reference: None,
                source: ResourceSource::Core,
                rel_path: "graphics/ships/ship.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "ship".to_string(),
            }],
        )
        .unwrap()
        .entries[0]
            .error
            .as_ref()
            .unwrap()
            .message
            .clone();

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("core resource requires starsector root"));
        root.close().unwrap();
    }

    #[test]
    fn mod_resource_uses_core_fallback_from_session_root() {
        let root = project_workspace("mod_resource_core_fallback");
        let mod_root = root.join("mods/demo");
        std::fs::create_dir_all(&mod_root).unwrap();
        std::fs::create_dir_all(root.join("starsector-core/graphics/ships")).unwrap();
        std::fs::write(
            root.join("starsector-core/graphics/ships/core_ship.png"),
            [137, 80, 78, 71],
        )
        .unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: "graphics/ships/core_ship.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        )
        .unwrap();

        let _ = close_project_session(manifest.session_id);
        assert!(result.entries[0].data_url.is_some());
        root.close().unwrap();
    }

    #[test]
    fn resource_query_rejects_parent_dir_escape() {
        let root = project_workspace("resource_query_parent_escape");

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: "../outside.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        )
        .unwrap()
        .entries[0]
            .error
            .as_ref()
            .unwrap()
            .message
            .clone();

        let _ = close_project_session(manifest.session_id);
        assert!(error.contains("sprite path is outside resource root"));
        root.close().unwrap();
    }

    #[test]
    fn resource_query_rejects_mod_link_parent_escape() {
        let (root, outside, _linked) =
            TestWorkspace::directory_link("resource_query_link_escape", "linked").unwrap();
        let root = root.with_cleanup(crate::services::project::test_support::release_workspace);
        std::fs::write(outside.join("outside.png"), [137, 80, 78, 71]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: "linked/outside.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        );

        let _ = close_project_session(manifest.session_id);
        assert!(result.unwrap().entries[0].error.is_some());
        root.close().unwrap();
    }

    #[test]
    fn media_cache_refreshes_entry_when_file_content_changes() {
        let root = project_workspace("media_cache_refresh");
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        let sprite = sprite_dir.join("demo.png");
        std::fs::write(&sprite, [1u8]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let resource = ResourceRef {
            reference: None,
            source: ResourceSource::Mod,
            rel_path: "graphics/ships/demo.png".to_string(),
            owner_kind: ResourceOwnerKind::Ship,
            owner_id: "ship".to_string(),
            key: "ship".to_string(),
        };

        let session_id = manifest.session_id.clone();
        let first = query_resource_data_urls(&session_id, vec![resource.clone()])
            .unwrap()
            .entries[0]
            .data_url
            .clone()
            .unwrap();

        std::fs::write(&sprite, [7u8, 7, 7]).unwrap();
        let second = query_resource_data_urls(&session_id, vec![resource])
            .unwrap()
            .entries[0]
            .data_url
            .clone()
            .unwrap();

        close_project_session(session_id).unwrap();
        assert_ne!(first, second);
        assert!(first.ends_with(&general_purpose_base64(&[1u8])));
        assert!(second.ends_with(&general_purpose_base64(&[7u8, 7, 7])));
        root.close().unwrap();
    }

    #[test]
    fn media_cache_evicts_oldest_beyond_capacity() {
        let root = project_workspace("media_cache_eviction");
        let count = super::super::super::cache::media::media_capacity_for_test() + 3;
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        let mut resources = Vec::new();
        for index in 0..count {
            let name = format!("p{index:04}.png");
            std::fs::write(sprite_dir.join(&name), [index as u8]).unwrap();
            resources.push(ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: format!("graphics/ships/{name}"),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: name.clone(),
            });
        }

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let result = query_resource_data_urls(&manifest.session_id.clone(), resources).unwrap();

        let oldest_still_cached = cached_sprite_media_contains(
            &manifest.session_id,
            &media_resource_key(&ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: "graphics/ships/p0000.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "p0000.png".to_string(),
            }),
        );
        let newest_still_cached = cached_sprite_media_contains(
            &manifest.session_id,
            &media_resource_key(&ResourceRef {
                reference: None,
                source: ResourceSource::Mod,
                rel_path: format!("graphics/ships/p{:04}.png", count - 1),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: format!("p{:04}.png", count - 1),
            }),
        );

        let _ = close_project_session(manifest.session_id);
        assert_eq!(result.entries.len(), count);
        assert!(!oldest_still_cached);
        assert!(newest_still_cached);
        root.close().unwrap();
    }

    #[test]
    fn closing_session_clears_media_cache() {
        let root = project_workspace("media_cache_close_clears");
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        std::fs::write(sprite_dir.join("demo.png"), [137, 80, 78, 71]).unwrap();
        let resource = ResourceRef {
            reference: None,
            source: ResourceSource::Mod,
            rel_path: "graphics/ships/demo.png".to_string(),
            owner_kind: ResourceOwnerKind::Ship,
            owner_id: "ship".to_string(),
            key: "ship".to_string(),
        };

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let session_id = manifest.session_id.clone();
        query_resource_data_urls(&session_id, vec![resource.clone()]).unwrap();
        assert!(cached_sprite_media_contains(
            &session_id,
            &media_resource_key(&resource)
        ));

        close_project_session(session_id.clone()).unwrap();

        assert!(!cached_sprite_media_contains(
            &session_id,
            &media_resource_key(&resource)
        ));
        root.close().unwrap();
    }

    #[test]
    fn draft_weapon_resources_are_derived_from_submitted_snapshot() {
        let root = project_workspace("draft_weapon_resources");
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let draft = serde_json::json!({"id":"weapon", "turretSprite":"graphics/draft.png"});
        let resources = query_draft_resources(
            &manifest.session_id,
            DraftResourceEntityKind::Weapon,
            "weapon",
            &draft,
        )
        .unwrap();
        assert_eq!(resources["turretSprite"].rel_path, "graphics/draft.png");
        assert_eq!(resources["turretSprite"].owner_id, "weapon");
        assert_eq!(resources["turretSprite"].key, "turretSprite");
        close_project_session(manifest.session_id).unwrap();
        assert!(
            query_draft_resources("closed", DraftResourceEntityKind::Weapon, "weapon", &draft)
                .is_err()
        );
        root.close().unwrap();
    }

    #[test]
    fn projectile_draft_resources_keep_both_sprite_fields_and_owner() {
        let root = project_workspace("projectile_draft_resources");
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let draft = serde_json::json!({"sprite":"graphics/missile.png", "bulletSprite":"graphics/shot.png"});
        let resources = query_draft_resources(
            &manifest.session_id,
            DraftResourceEntityKind::Projectile,
            "shot",
            &draft,
        )
        .unwrap();
        assert_eq!(resources.len(), 5);
        for (field, path) in [
            ("sprite", "graphics/missile.png"),
            ("bulletSprite", "graphics/shot.png"),
        ] {
            assert_eq!(resources[field].rel_path, path);
            assert_eq!(resources[field].key, field);
            assert_eq!(resources[field].owner_id, "shot");
            assert_eq!(
                resources[field].owner_kind,
                crate::models::EntityKind::Projectile.into()
            );
        }
        close_project_session(manifest.session_id.clone()).unwrap();
        assert!(
            query_draft_resources(
                &manifest.session_id,
                DraftResourceEntityKind::Projectile,
                "shot",
                &draft,
            )
            .is_err()
        );
        root.close().unwrap();
    }

    #[test]
    fn config_draft_resources_use_the_current_references_and_owner() {
        let root = project_workspace("config_draft_resources");
        let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let faction = query_draft_resources(
            &manifest.session_id,
            DraftResourceEntityKind::Faction,
            "faction",
            &serde_json::json!({"logo":"graphics/new.png", "crest":"graphics/crest.png"}),
        )
        .unwrap();
        assert_eq!(faction["logo"].rel_path, "graphics/new.png");
        assert_eq!(faction["crest"].owner_id, "faction");
        let mission = query_draft_resources(
            &manifest.session_id,
            DraftResourceEntityKind::Mission,
            "mission",
            &serde_json::json!({"descriptor":{"icon":"new.png"}}),
        )
        .unwrap();
        assert_eq!(mission["icon"].rel_path, "data/missions/mission/new.png");
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
