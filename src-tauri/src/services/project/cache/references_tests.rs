use super::*;
use crate::{
    io::write_utf8_no_bom,
    services::project::{query, session},
    testutil::TestWorkspace,
};
use serde_json::json;
use std::{fs, path::Path};

fn content(root: &Path, label: &str, ids: &[&str], byte: u8) {
    for directory in [
        "data/weapons/proj",
        "data/hulls/skins",
        "data/variants",
        "data/config",
        "graphics",
    ] {
        fs::create_dir_all(root.join(directory)).unwrap();
    }
    write_utf8_no_bom(
        &root.join("mod_info.json"),
        &json!({"id":label,"name":label}).to_string(),
    )
    .unwrap();
    let mut weapons = "id,name,type,size,OPs\n".to_owned();
    for id in ids {
        weapons.push_str(&format!("{id},{label},ENERGY,SMALL,1\n"));
        write_utf8_no_bom(&root.join(format!("data/weapons/{id}.wpn")), &json!({
            "id":id,"specClass":"projectile","type":"ENERGY","size":"SMALL","tag":label,
            "turretSprite":"graphics/shared.png","projectileSpecId":"shot","renderHints":["RENDER_LOADED_MISSILES"]
        }).to_string()).unwrap();
    }
    write_utf8_no_bom(&root.join("data/weapons/weapon_data.csv"), &weapons).unwrap();
    write_utf8_no_bom(
        &root.join("data/weapons/proj/shot.proj"),
        &json!({"id":"shot","sprite":"graphics/shared.png","tag":label}).to_string(),
    )
    .unwrap();
    write_utf8_no_bom(
        &root.join("data/hulls/ship_data.csv"),
        &format!("id,name\nhull,{label}\n"),
    )
    .unwrap();
    write_utf8_no_bom(&root.join("data/hulls/hull.ship"), &json!({"hullId":"hull","hullName":label,"spriteName":"graphics/shared.png",
        "hints":["MODULE"],"weaponSlots":[{"id":"GUN","type":"ENERGY","size":"SMALL","locations":[[0,0]],"angle":0,"arc":90}],
        "engineSlots":[],"builtInWeapons":{},"hullSize":"FRIGATE","center":[0,0],"width":10,"height":10}).to_string()).unwrap();
    write_utf8_no_bom(
        &root.join("data/variants/module.variant"),
        &json!({"variantId":"module","hullId":format!("{label}_skin"),"displayName":label,
            "weaponGroups":[{"mode":"LINKED","autofire":false,"weapons":{"GUN":ids[0]}}]})
        .to_string(),
    )
    .unwrap();
    write_utf8_no_bom(
        &root.join(format!("data/hulls/skins/{label}.skin")),
        &json!({"skinHullId":format!("{label}_skin"),"baseHullId":"hull"}).to_string(),
    )
    .unwrap();
    write_utf8_no_bom(
        &root.join("data/hulls/wing_data.csv"),
        &format!("id,variant\n{label}_wing,module\n"),
    )
    .unwrap();
    write_utf8_no_bom(&root.join("data/config/settings.json"), &json!({"designTypeColors":ids.iter().map(|id|(id.to_string(),json!([byte,0,0,255]))).collect::<serde_json::Map<_,_>>()}).to_string()).unwrap();
    fs::write(root.join("graphics/shared.png"), [byte]).unwrap();
    fs::write(root.join(format!("graphics/{label}.png")), [byte]).unwrap();
}

fn open(root: &Path, game: Option<&Path>) -> ProjectManifest {
    let mut trace = crate::services::project::PerformanceTrace::new("project.openSession");
    session::open_project_session_traced(root, game, &mut trace).unwrap()
}
fn owner(groups: &[SourceOptionGroup], value: &str) -> ResourceSource {
    groups
        .iter()
        .find(|group| group.options.iter().any(|option| option.value == value))
        .unwrap()
        .origin
}
fn options(manifest: &ProjectManifest, source: &str) -> Vec<SourceOptionGroup> {
    query::source_options::query_csv_source_options(&manifest.session_id, source).unwrap()
}
fn option_resource<'a>(groups: &'a [SourceOptionGroup], value: &str) -> &'a ResourceRef {
    groups
        .iter()
        .flat_map(|group| &group.options)
        .find(|option| option.value == value)
        .unwrap()
        .resource_ref
        .as_ref()
        .unwrap()
}
fn entity(manifest: &ProjectManifest, kind: EntityKind, id: &str) -> EntityData {
    query::entities::query_entity(&manifest.session_id, kind, id)
        .unwrap()
        .unwrap()
}
fn entity_source(entity: &EntityData) -> &ReferenceSource {
    entity
        .target
        .source
        .as_ref()
        .unwrap()
        .reference
        .as_deref()
        .unwrap()
}
fn resource_source(resource: &ResourceRef) -> &str {
    &resource.reference.as_ref().unwrap().session_id
}
fn refresh(manifest: &ProjectManifest, relative: &str) {
    session::refresh_project_sources(
        &manifest.session_id,
        vec![InvalidatedResourceScope {
            source: ResourceSource::Mod,
            rel_path: relative.into(),
        }],
    )
    .unwrap();
}

#[test]
fn reference_priority_content_and_lifecycle() {
    if crate::testutil::isolated_test() {
        return;
    }
    let root = crate::services::project::test_support::project_workspace("reference_priority");
    let game = root.join("game");
    let core = game.join("starsector-core");
    let b_root = root.join("b");
    fs::create_dir_all(game.join("mods")).unwrap();
    content(&core, "core", &["shared", "core_only"], 4);
    content(&root.join("a"), "alpha", &["local"], 1);
    fs::remove_file(root.join("a/data/weapons/proj/shot.proj")).unwrap();
    fs::remove_file(root.join("a/data/hulls/hull.ship")).unwrap();
    fs::remove_file(root.join("a/data/variants/module.variant")).unwrap();
    content(&b_root, "beta", &["shared", "local", "beta_only"], 2);
    fs::remove_file(b_root.join("data/hulls/hull.ship")).unwrap();
    content(&root.join("c"), "gamma", &["shared", "gamma_only"], 3);
    let a = open(&root.join("a"), Some(&game));
    let b = open(&b_root, None);
    let c = open(&root.join("c"), None);
    let before = options(&a, "csv:weapons.id");
    assert_eq!(owner(&before, "shared"), ResourceSource::Core);
    set_reference_sources(vec![b.session_id.clone(), c.session_id.clone()]).unwrap();
    assert!(
        prepare(&a.session_id).unwrap().1[0]
            .session
            .references
            .is_empty()
    );
    let groups = options(&a, "csv:weapons.id");
    assert_eq!(owner(&groups, "local"), ResourceSource::Mod);
    assert_eq!(owner(&groups, "shared"), ResourceSource::Reference);
    assert_eq!(owner(&groups, "core_only"), ResourceSource::Core);
    let shared = groups
        .iter()
        .find(|group| group.options.iter().any(|option| option.value == "shared"))
        .unwrap();
    assert_eq!(shared.reference.as_ref().unwrap().session_id, b.session_id);
    let image = option_resource(&groups, "shared").clone();
    assert_eq!(image.reference.as_ref().unwrap().mod_root, b.mod_root);
    assert!(
        query::resources::query_resource_data_urls(&a.session_id, vec![image.clone()])
            .unwrap()
            .entries[0]
            .data_url
            .as_ref()
            .unwrap()
            .ends_with("Ag==")
    );
    let weapon = entity(&a, EntityKind::Weapon, "shared");
    assert_eq!(weapon.data["spec"]["tag"], "beta");
    assert_eq!(entity_source(&weapon).session_id, b.session_id);
    assert_eq!(weapon.target.write.root, a.mod_root);
    assert_eq!(weapon.target.state, EntityTargetState::Create);
    assert_eq!(
        entity(&a, EntityKind::Projectile, "shot").data["tag"],
        "beta"
    );
    let images = query::source_options::query_image_source_options(
        &a.session_id,
        &["graphics".into()],
        None,
    )
    .unwrap();
    assert!(images.iter().any(|group| {
        group
            .reference
            .as_ref()
            .is_some_and(|reference| reference.session_id == b.session_id)
    }));
    let configs = options(&a, "config:designTypes");
    assert_eq!(owner(&configs, "shared"), ResourceSource::Reference);
    let target = JointEditRoot {
        session_id: a.session_id.clone(),
        mod_root: a.mod_root.clone(),
        kind: JointEditKind::Weapon,
        id: "shared".into(),
    };
    let graph = query::joint_edit::query_joint_edit(&target).unwrap();
    assert_eq!(
        graph.reference_settings.values["designTypeColors"]["shared"],
        json!([2, 0, 0, 255])
    );
    for (kind, id, expected) in [
        (EntityKind::Variant, "module", &b.session_id),
        (EntityKind::Skin, "beta_skin", &b.session_id),
        (EntityKind::Ship, "hull", &c.session_id),
    ] {
        assert_eq!(&entity_source(&entity(&a, kind, id)).session_id, expected);
    }
    let hulls = query::hull_references::query_hull_references(&a.session_id, &["beta_skin".into()])
        .unwrap();
    assert_eq!(resource_source(&hulls.sprites["beta_skin"]), c.session_id);
    let fields = options(&a, "csv:ships.id");
    assert_eq!(
        resource_source(option_resource(&fields, "beta_skin")),
        c.session_id
    );
    assert_eq!(
        entity(&a, EntityKind::Skin, "beta_skin").resource_refs["sprite"].reference,
        option_resource(&fields, "beta_skin").reference
    );
    assert!(
        hulls.weapon_slots["beta_skin"]
            .iter()
            .any(|slot| slot.id == "GUN" && slot.origin == ResourceSource::Reference)
    );
    for kind in [JointEditKind::Variant, JointEditKind::Wing] {
        let related = query::joint_edit::query_joint_edit(&JointEditRoot {
            kind,
            id: if kind == JointEditKind::Variant {
                "module"
            } else {
                "alpha_wing"
            }
            .into(),
            ..target.clone()
        })
        .unwrap();
        assert!(related.records.iter().any(|record| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Weapon && target.id == "shared")));
    }
    assert!(
        graph
            .records
            .iter()
            .any(|record| record.source.as_ref().is_some_and(|source| source
                .reference
                .as_ref()
                .is_some_and(|reference| reference.session_id == b.session_id)))
    );
    let catalog =
        query::joint_edit::query_variant_catalog(&target, JointVariantCatalogKind::Weapons, None)
            .unwrap();
    let weapon = catalog
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "shared")
        .unwrap();
    assert_eq!(weapon.spec.as_ref().unwrap()["tag"], "beta");
    assert_eq!(weapon.projectile.as_ref().unwrap().data["tag"], "beta");
    let (_, views) = prepare(&a.session_id).unwrap();
    assert!(Arc::ptr_eq(
        &views[0],
        &prepare(&a.session_id).unwrap().1[0]
    ));
    let handle = cache::session_handle(&b.session_id).unwrap();
    assert!(Arc::ptr_eq(
        &views[0].session.weapon_specs,
        &cache::lock_session(&handle).unwrap().weapon_specs
    ));
    let captured = cache::session_handle(&a.session_id).unwrap();
    set_reference_sources(vec![c.session_id.clone(), b.session_id.clone()]).unwrap();
    assert_eq!(
        cache::lock_ready_session(&captured).unwrap().references[0]
            .identity
            .session_id,
        c.session_id
    );
    assert_eq!(
        entity(&a, EntityKind::Weapon, "shared").data["spec"]["tag"],
        "gamma"
    );
    session::close_project_session(c.session_id).unwrap();
    assert_eq!(
        entity(&a, EntityKind::Weapon, "shared").data["spec"]["tag"],
        "beta"
    );
    let reopened = open(&root.join("c"), None);
    set_reference_sources(vec![reopened.session_id.clone(), b.session_id.clone()]).unwrap();
    assert_eq!(
        entity_source(&entity(&a, EntityKind::Weapon, "shared")).session_id,
        reopened.session_id
    );
    session::close_project_session(reopened.session_id).unwrap();
    set_reference_sources(Vec::new()).unwrap();
    assert!(query::resources::query_resource_data_urls(&a.session_id, vec![image]).is_err());
    assert_eq!(
        owner(&options(&a, "csv:weapons.id"), "shared"),
        ResourceSource::Core
    );
    session::close_project_session(a.session_id).unwrap();
    session::close_project_session(b.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn mutual_references_share_views_and_refresh_official_content() {
    if crate::testutil::isolated_test() {
        return;
    }
    let root: TestWorkspace =
        crate::services::project::test_support::project_workspace("reference_mutual");
    content(&root.join("a"), "alpha", &["alpha_only"], 1);
    content(&root.join("b"), "beta", &["shared"], 2);
    let a = open(&root.join("a"), None);
    let b = open(&root.join("b"), None);
    set_reference_sources(vec![b.session_id.clone(), a.session_id.clone()]).unwrap();
    let workers = [&a, &b]
        .into_iter()
        .map(|manifest| {
            let id = manifest.session_id.clone();
            std::thread::spawn(move || {
                query::source_options::query_csv_source_options(&id, "csv:weapons.id").unwrap()
            })
        })
        .collect::<Vec<_>>();
    for worker in workers {
        assert!(!worker.join().unwrap().is_empty());
    }
    let weapon = entity(&a, EntityKind::Weapon, "shared");
    let mut data = weapon.data["spec"].clone();
    data["tag"] = json!("updated");
    write_utf8_no_bom(&root.join("b/data/weapons/shared.wpn"), &data.to_string()).unwrap();
    let target = JointEditRoot {
        session_id: a.session_id.clone(),
        mod_root: a.mod_root.clone(),
        kind: JointEditKind::Weapon,
        id: "shared".into(),
    };
    let frozen = query::joint_edit::query_joint_edit(&target).unwrap();
    let spec = frozen
        .records
        .iter()
        .find(|record| record.key == frozen.bindings["spec"])
        .unwrap();
    assert_eq!(spec.value, JointValue::Present(weapon.data["spec"].clone()));
    assert_ne!(
        spec.source_version.as_ref().unwrap(),
        &crate::io::file_version(&root.join("b/data/weapons/shared.wpn")).unwrap()
    );
    refresh(&b, "data/weapons/shared.wpn");
    reference_sources_changed(Some(&b.session_id)).unwrap();
    assert_eq!(
        entity(&a, EntityKind::Weapon, "shared").data["spec"]["tag"],
        "updated"
    );
    set_reference_sources(Vec::new()).unwrap();
    data["tag"] = json!("reenabled");
    write_utf8_no_bom(&root.join("b/data/weapons/shared.wpn"), &data.to_string()).unwrap();
    refresh(&b, "data/weapons/shared.wpn");
    set_reference_sources(vec![b.session_id.clone()]).unwrap();
    assert_eq!(
        entity(&a, EntityKind::Weapon, "shared").data["spec"]["tag"],
        "reenabled"
    );
    set_reference_sources(Vec::new()).unwrap();
    session::close_project_session(a.session_id).unwrap();
    session::close_project_session(b.session_id).unwrap();
    root.close().unwrap();
}
