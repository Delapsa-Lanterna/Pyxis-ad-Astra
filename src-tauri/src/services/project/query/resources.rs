use super::super::resources::{resource_cache_key, sprite_resource_bytes, sprite_source_context};
use super::super::{
    cache::{lock_ready_session, session_handle},
    definitions::entity_resources::{
        faction_resource_refs, mission_resource_refs, projectile_resource_refs, ship_resource_refs,
        weapon_resource_refs,
    },
};
use crate::{
    errors::AppResult,
    models::{
        DraftResourceEntityKind, ResourceDataUrlBatchEntry, ResourceDataUrlBatchResult, ResourceRef,
    },
};
use std::collections::BTreeMap;

pub fn query_resource_data_urls(
    session_id: &str,
    resources: Vec<ResourceRef>,
) -> AppResult<ResourceDataUrlBatchResult> {
    let context = sprite_source_context(session_id)?;
    let mut loaded: BTreeMap<String, Option<String>> = BTreeMap::new();
    let mut entries = Vec::with_capacity(resources.len());
    for resource in resources {
        let cache_key = resource_cache_key(&resource);
        let data_url = if let Some(data_url) = loaded.get(&cache_key) {
            data_url.clone()
        } else {
            let bytes = sprite_resource_bytes(&context, &resource)?;
            loaded.insert(cache_key, bytes.data_url.clone());
            bytes.data_url
        };
        entries.push(ResourceDataUrlBatchEntry {
            key: resource.key,
            source: resource.source,
            rel_path: resource.rel_path,
            owner_kind: resource.owner_kind,
            owner_id: resource.owner_id,
            data_url,
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
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::models::{ResourceOwnerKind, ResourceRef, ResourceSource};
    use crate::services::project::cache::media::cached_sprite_media_contains;

    use crate::testutil::{temp_dir, temp_linked_dir};

    fn general_purpose_base64(bytes: &[u8]) -> String {
        use base64::{Engine as _, engine::general_purpose};
        general_purpose::STANDARD.encode(bytes)
    }

    #[test]
    fn batch_resource_query_keeps_order_and_uses_empty_for_missing() {
        let root = temp_dir("batch_resource_query");
        std::fs::create_dir_all(root.join("graphics/ships")).unwrap();
        std::fs::write(root.join("graphics/ships/ship.png"), [137, 80, 78, 71]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![
                ResourceRef {
                    source: ResourceSource::Mod,
                    rel_path: "graphics/ships/ship.png".to_string(),
                    owner_kind: ResourceOwnerKind::Ship,
                    owner_id: "ship".to_string(),
                    key: "ship".to_string(),
                },
                ResourceRef {
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
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(result.entries.len(), 2);
        assert_eq!(result.entries[0].key, "ship");
        assert_eq!(result.entries[0].owner_kind, ResourceOwnerKind::Ship);
        assert_eq!(result.entries[0].owner_id, "ship");
        assert!(result.entries[0].data_url.is_some());
        assert_eq!(result.entries[1].key, "missing");
        assert_eq!(result.entries[1].owner_kind, ResourceOwnerKind::Ship);
        assert_eq!(result.entries[1].owner_id, "missing");
        assert!(result.entries[1].data_url.is_none());
    }

    #[test]
    fn core_resource_requires_starsector_root() {
        let root = temp_dir("core_resource_without_root");

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                source: ResourceSource::Core,
                rel_path: "graphics/ships/ship.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "ship".to_string(),
            }],
        )
        .unwrap_err()
        .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("core resource requires starsector root"));
    }

    #[test]
    fn mod_resource_uses_core_fallback_from_session_root() {
        let root = temp_dir("mod_resource_core_fallback");
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
                source: ResourceSource::Mod,
                rel_path: "graphics/ships/core_ship.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        )
        .unwrap();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(result.entries[0].data_url.is_some());
    }

    #[test]
    fn resource_query_rejects_parent_dir_escape() {
        let root = temp_dir("resource_query_parent_escape");

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let error = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                source: ResourceSource::Mod,
                rel_path: "../outside.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        )
        .unwrap_err()
        .to_string();

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert!(error.contains("sprite path is outside resource root"));
    }

    #[test]
    fn resource_query_rejects_mod_link_parent_escape() {
        let Some((root, outside, _linked)) =
            temp_linked_dir("resource_query_link_escape", "linked")
        else {
            return;
        };
        std::fs::write(outside.join("outside.png"), [137, 80, 78, 71]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let result = query_resource_data_urls(
            &manifest.session_id,
            vec![ResourceRef {
                source: ResourceSource::Mod,
                rel_path: "linked/outside.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "sprite".to_string(),
            }],
        );

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        let _ = std::fs::remove_dir_all(outside);
        assert!(result.is_err());
    }

    #[test]
    fn media_cache_refreshes_entry_when_file_content_changes() {
        let root = temp_dir("media_cache_refresh");
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        let sprite = sprite_dir.join("demo.png");
        std::fs::write(&sprite, [1u8]).unwrap();

        let mut trace =
            crate::services::project::performance::PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let resource = ResourceRef {
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
        let _ = std::fs::remove_dir_all(root);
        assert_ne!(first, second);
        assert!(first.ends_with(&general_purpose_base64(&[1u8])));
        assert!(second.ends_with(&general_purpose_base64(&[7u8, 7, 7])));
    }

    #[test]
    fn media_cache_evicts_oldest_beyond_capacity() {
        let root = temp_dir("media_cache_eviction");
        let count = super::super::super::cache::media::media_capacity_for_test() + 3;
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        let mut resources = Vec::new();
        for index in 0..count {
            let name = format!("p{index:04}.png");
            std::fs::write(sprite_dir.join(&name), [index as u8]).unwrap();
            resources.push(ResourceRef {
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
            &resource_cache_key(&ResourceRef {
                source: ResourceSource::Mod,
                rel_path: "graphics/ships/p0000.png".to_string(),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: "p0000.png".to_string(),
            }),
        );
        let newest_still_cached = cached_sprite_media_contains(
            &manifest.session_id,
            &resource_cache_key(&ResourceRef {
                source: ResourceSource::Mod,
                rel_path: format!("graphics/ships/p{:04}.png", count - 1),
                owner_kind: ResourceOwnerKind::Ship,
                owner_id: "ship".to_string(),
                key: format!("p{:04}.png", count - 1),
            }),
        );

        let _ = close_project_session(manifest.session_id);
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(result.entries.len(), count);
        assert!(!oldest_still_cached);
        assert!(newest_still_cached);
    }

    #[test]
    fn closing_session_clears_media_cache() {
        let root = temp_dir("media_cache_close_clears");
        let sprite_dir = root.join("graphics/ships");
        std::fs::create_dir_all(&sprite_dir).unwrap();
        std::fs::write(sprite_dir.join("demo.png"), [137, 80, 78, 71]).unwrap();
        let resource = ResourceRef {
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
            &resource_cache_key(&resource)
        ));

        close_project_session(session_id.clone()).unwrap();

        assert!(!cached_sprite_media_contains(
            &session_id,
            &resource_cache_key(&resource)
        ));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn draft_weapon_resources_are_derived_from_submitted_snapshot() {
        let root = temp_dir("draft_weapon_resources");
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
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn projectile_draft_resources_keep_both_sprite_fields_and_owner() {
        let root = temp_dir("projectile_draft_resources");
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
        assert_eq!(resources.len(), 2);
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
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn config_draft_resources_use_the_current_references_and_owner() {
        let root = temp_dir("config_draft_resources");
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
        std::fs::remove_dir_all(root).unwrap();
    }
}
