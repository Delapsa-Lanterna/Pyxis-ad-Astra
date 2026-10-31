#![cfg(test)]
use crate::services::project::test_support::project_workspace;
#[path = "joint_skin_tests.rs"]
mod skin_tests;
use super::super::csv_staging;
use super::*;

use crate::services::prepare_joint_edit;
use crate::{
    io::{read_csv_data, write_utf8_no_bom},
    services::{project, write_transactions},
    test_support::TestWorkspace,
};
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf};

fn fixture() -> (TestWorkspace, JointEditRoot) {
    let dir = project_workspace("joint_graph");
    for relative in [
        "data/hulls",
        "data/variants",
        "data/weapons",
        "data/strings",
    ] {
        std::fs::create_dir_all(dir.join(relative)).unwrap();
    }
    write_utf8_no_bom(
        &dir.join("data/hulls/ship_data.csv"),
        "name,id,tags,custom\n# comment,a,,keep\nShip,a,demo_bp,007\nOther,b,,other\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/wing_data.csv"),
        "id,variant,num\nwing,var,3\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/weapons/weapon_data.csv"),
        "id,name,damage/shot\nweapon,Weapon,12\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/strings/descriptions.csv"),
        "id,type,text1,notes\na,SHIP,Original,007\nweapon,WEAPON,Weapon text,\n",
    )
    .unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/a.ship"),r#"{"hullId":"a","hullName":"Ship","spriteName":"graphics/a.png","builtInWeapons":{"slot":"weapon"},"custom":{"a":1,"b":2}}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/weapons/weapon.wpn"),
        r#"{"id":"weapon","specClass":"beam","size":"SMALL"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/var.variant"),
        r#"{"variantId":"var","hullId":"a","fluxVents":2,"weaponGroups":[],"wings":[]}"#,
    )
    .unwrap();
    let mut trace = project::PerformanceTrace::new("joint.test");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        mod_root: manifest.mod_root,
        kind: JointEditKind::Ship,
        id: "a".into(),
    };
    (dir, root)
}
fn payload(snapshot: JointEditSnapshot) -> JointEditSubmission {
    JointEditSubmission {
        values: snapshot
            .records
            .iter()
            .map(|record| (record.key.clone(), record.value.clone()))
            .collect(),
        base_versions: snapshot.base_versions.clone(),
        snapshot,
        json_write: Default::default(),
        create_overrides: Vec::new(),
    }
}
fn submit(
    payload: &JointEditSubmission,
) -> crate::errors::AppResult<WriteResult<JointEditSnapshot>> {
    let transaction = write_transactions::begin(payload, &payload.base_versions)?;
    transaction.commit(save_joint_edit(payload)?, "联合测试")
}
fn cleanup(dir: TestWorkspace, root: &JointEditRoot) {
    project::close_project_session(root.session_id.clone()).unwrap();
    dir.close().unwrap();
}

#[test]
fn queued_joint_save_graph_builds() {
    use super::super::super::query::joint_edit::take_joint_graph_builds;
    for (kind, id, binding, field, value) in [
        (JointEditKind::Ship, "a", "spec", "hullName", json!("Saved")),
        (
            JointEditKind::Weapon,
            "weapon",
            "spec",
            "size",
            json!("MEDIUM"),
        ),
        (JointEditKind::Wing, "wing", "csv", "num", json!(5)),
        (
            JointEditKind::Variant,
            "var",
            "variant",
            "fluxVents",
            json!(7),
        ),
        (JointEditKind::Skin, "child", "spec", "maxSpeed", json!(180)),
    ] {
        let (dir, mut root) = if kind == JointEditKind::Skin {
            skin_tests::skin_fixture()
        } else {
            fixture()
        };
        root.kind = kind;
        root.id = id.into();
        let snapshot = query_joint_edit(&root).unwrap();
        let key = snapshot.bindings[binding].clone();
        let mut input = payload(snapshot);
        take_joint_graph_builds();
        crate::services::prepare_joint_save(
            &mut input,
            &[SaveEdit::Set {
                path: vec![key.clone(), "value".into(), field.into()],
                value: value.clone(),
            }],
            &[],
        )
        .unwrap();
        let result = submit(&input).unwrap();
        assert_eq!(take_joint_graph_builds(), 1, "{kind:?}");
        assert_eq!(result.changes.len(), 1, "{kind:?}");
        assert_eq!(result.history.undo_stack.len(), 1, "{kind:?}");
        let saved = result.content.unwrap().value;
        let record = saved
            .records
            .iter()
            .find(|record| record.key == key)
            .unwrap();
        let JointValue::Present(data) = &record.value else {
            panic!("saved record exists")
        };
        assert_eq!(data[field], value, "{kind:?}");
        cleanup(dir, &root);
    }
}

#[test]
fn mod_only_joint_save_survives_missing_game_and_core_directories() {
    for remove_game in [false, true] {
        let (dir, mut root) = fixture();
        project::close_project_session(root.session_id.clone()).unwrap();
        let game = project_workspace("joint_missing_original");
        std::fs::create_dir(game.join("starsector-core")).unwrap();
        root.session_id = project::open_project_session_traced(
            &dir,
            Some(&game),
            &mut project::PerformanceTrace::new("joint.missing.core"),
        )
        .unwrap()
        .session_id;
        let snapshot = query_joint_edit(&root).unwrap();
        let mut input = payload(snapshot);
        let key = input.snapshot.bindings["spec"].clone();
        if let JointValue::Present(value) = input.values.get_mut(&key).unwrap() {
            value["hullName"] = json!("Captured");
        }
        if remove_game {
            std::fs::remove_dir_all(&game).unwrap();
        } else {
            std::fs::remove_dir_all(game.join("starsector-core")).unwrap();
        }
        let saved = submit(&input).unwrap();
        assert_eq!(saved.history.undo_stack.len(), 1);
        assert_eq!(
            crate::io::read_json_file(&dir.join("data/hulls/a.ship")).unwrap()["hullName"],
            "Captured"
        );
        cleanup(dir, &root);
        if !remove_game {
            std::fs::remove_dir_all(game).unwrap();
        }
    }
}

#[test]
fn confirmed_joint_save_recreates_spec_and_full_csv_from_loaded_content() {
    let (dir, root) = fixture();
    let snapshot = query_joint_edit(&root).unwrap();
    let mut values = snapshot
        .records
        .iter()
        .map(|record| (record.key.clone(), record.value.clone()))
        .collect::<BTreeMap<_, _>>();
    let spec_key = snapshot.bindings["spec"].clone();
    if let JointValue::Present(value) = values.get_mut(&spec_key).unwrap() {
        value["hullName"] = json!("Captured");
    }
    let csv_key = snapshot.bindings["csv"].clone();
    if let JointValue::Present(value) = values.get_mut(&csv_key).unwrap() {
        value["custom"] = json!("009");
    }
    std::fs::remove_file(dir.join("data/hulls/a.ship")).unwrap();
    std::fs::remove_file(dir.join("data/hulls/ship_data.csv")).unwrap();
    let prepared = prepare_joint_edit(&JointEditDraft {
        baseline: snapshot,
        values,
    })
    .unwrap();
    assert!(prepared.conflicts.is_empty());
    let mut input = payload(prepared.snapshot);
    input.values = prepared.values;
    let saved = crate::io::with_write_retry(
        Path::new(&root.mod_root),
        |_| panic!("loaded recovery sources are complete"),
        || {
            crate::io::accept_source_recreation(
                &root.mod_root,
                vec![
                    PathBuf::from(&root.mod_root)
                        .join("data/hulls/a.ship")
                        .to_string_lossy()
                        .into(),
                    PathBuf::from(&root.mod_root)
                        .join("data/hulls/ship_data.csv")
                        .to_string_lossy()
                        .into(),
                ],
            )?;
            crate::services::prepare_joint_save(
                &mut input,
                &[
                    SaveEdit::Set {
                        path: vec![spec_key.clone(), "value".into(), "hullName".into()],
                        value: json!("Captured"),
                    },
                    SaveEdit::Set {
                        path: vec![csv_key.clone(), "value".into(), "custom".into()],
                        value: json!("009"),
                    },
                ],
                &[],
            )?;
            submit(&input)
        },
    )
    .unwrap();
    assert_eq!(saved.history.undo_stack.len(), 1);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/hulls/a.ship")).unwrap()["hullName"],
        "Captured"
    );
    let table = read_csv_data(&dir.join("data/hulls/ship_data.csv")).unwrap();
    assert_eq!(table.rows.len(), 3);
    assert_eq!(table.rows[1].data["custom"], "009");
    assert_eq!(table.rows[2].data["id"], "b");
    assert!(table.rows[0].is_comment);
    cleanup(dir, &root);
}

#[test]
fn variant_modules_atomic_history() {
    let (dir, mut root) = fixture();
    write_utf8_no_bom(&dir.join("data/hulls/a.ship"), r#"{"hullId":"a","weaponSlots":[{"id":"M1","type":"STATION_MODULE"},{"id":"M2","type":"STATION_MODULE"}]}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/variants/var.variant"), r#"{"variantId":"var","hullId":"a","fluxVents":2,"modules":[{"M2":"module"},{"M1":"module"}],"unknown":"007"}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/module.variant"),
        r#"{"variantId":"module","hullId":"a","fluxVents":1,"unknown":true}"#,
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("variant.modules");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    let snapshot = query_joint_edit(&root).unwrap();
    let main_key = snapshot.bindings["variant"].clone();
    let main = &snapshot.variants[&main_key];
    assert_eq!(
        main.modules
            .iter()
            .map(|module| module.slot_id.as_str())
            .collect::<Vec<_>>(),
        ["M2", "M1"]
    );
    assert_eq!(main.modules[0].variant_key, main.modules[1].variant_key);
    let module_key = main.modules[0].variant_key.clone();
    let module = snapshot
        .records
        .iter()
        .find(|record| record.key == module_key)
        .unwrap();
    assert!(module.referenced_by.contains(&"Variant:var".into()));
    let mut write = payload(snapshot);
    write
        .values
        .retain(|key, _| key == &main_key || key == &module_key);
    for (key, vents) in [(&main_key, 5), (&module_key, 8)] {
        if let JointValue::Present(data) = write.values.get_mut(key).unwrap() {
            data["fluxVents"] = json!(vents);
        }
    }
    let result = submit(&write).unwrap();
    assert_eq!(result.changes.len(), 2);
    let main = crate::io::read_json_file(&dir.join("data/variants/var.variant")).unwrap();
    assert_eq!(main["modules"], json!([{"M2":"module"},{"M1":"module"}]));
    assert_eq!(main["unknown"], "007");
    let restored = write_transactions::replay(
        &root.session_id,
        &root.mod_root,
        FileChangeReplayDirection::Undo,
        result.history.undo_stack[0].id,
        result.history.revision,
    )
    .unwrap();
    assert_eq!(restored.changes.len(), 2);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/module.variant")).unwrap()["fluxVents"],
        1
    );
    cleanup(dir, &root);
}

#[test]
fn variant_rename_all_mod_parents() {
    let (dir, mut root) = fixture();
    for (name, modules) in [
        ("parent_a", json!({"A":"var"})),
        ("parent_b", json!([{"B":"var"},{"C":"var"}])),
    ] {
        write_utf8_no_bom(
            &dir.join(format!("data/variants/{name}.variant")),
            &json!({"variantId":name,"hullId":"a","modules":modules,"unknown":"007"}).to_string(),
        )
        .unwrap();
    }
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("variant.rename.parents");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    let info =
        crate::services::query_entity_edit_target(&root.session_id, EntityKind::Variant, "var")
            .unwrap();
    assert_eq!(info.base_versions.len(), 3);
    let mut versions = info.base_versions;
    versions.push(crate::io::file_version(&dir.join("data/variants/new.variant")).unwrap());
    let result = crate::services::write_transactions::commit_action(
        crate::models::SaveAction::SaveVariantEntity(crate::models::JsonFileSave {
            session_id: root.session_id.clone(),
            mod_root: root.mod_root.clone(),
            previous_id: Some("var".into()),
            next_id: "new".into(),
            rel_path: Some("data/variants/var.variant".into()),
            data: json!({"variantId":"new","hullId":"a","fluxVents":3}),
            json_write: Default::default(),
            ordered_json: None,
            base_versions: versions,
        }),
    )
    .unwrap();
    assert_eq!(result.changes.len(), 3);
    assert_eq!(result.history.undo_stack.len(), 1);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/parent_a.variant")).unwrap()["modules"],
        json!({"A":"new"})
    );
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/parent_b.variant")).unwrap()["modules"],
        json!([{"B":"new"},{"C":"new"}])
    );
    let undo = write_transactions::replay(
        &root.session_id,
        &root.mod_root,
        FileChangeReplayDirection::Undo,
        result.history.undo_stack[0].id,
        result.history.revision,
    )
    .unwrap();
    assert_eq!(undo.changes.len(), 3);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/parent_a.variant")).unwrap()["modules"],
        json!({"A":"var"})
    );
    cleanup(dir, &root);
}

#[test]
fn joint_variant_rename_parents() {
    let (dir, mut root) = fixture();
    write_utf8_no_bom(
        &dir.join("data/variants/parent.variant"),
        r#"{"variantId":"parent","hullId":"a","modules":[{"M":"var"}],"displayName":"keep"}"#,
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("variant.joint.rename");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    let mut write = payload(query_joint_edit(&root).unwrap());
    let key = write.snapshot.bindings["variant"].clone();
    write.values.retain(|record, _| record == &key);
    if let JointValue::Present(data) = write.values.get_mut(&key).unwrap() {
        data["variantId"] = json!("new");
    }
    write
        .base_versions
        .push(crate::io::file_version(&dir.join("data/variants/new.variant")).unwrap());
    let result = submit(&write).unwrap();
    assert_eq!(result.changes.len(), 2);
    let data = crate::io::read_json_file(&dir.join("data/variants/parent.variant")).unwrap();
    assert_eq!(data["modules"], json!([{"M":"new"}]));
    assert_eq!(data["displayName"], "keep");
    cleanup(dir, &root);
}

#[test]
fn variant_skin_slots_and_sources() {
    let (dir, mut root) = fixture();
    std::fs::create_dir_all(dir.join("data/hulls/skins")).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/a.ship"), r#"{"hullId":"a","weaponSlots":[{"id":"A","type":"BALLISTIC","size":"SMALL"},{"id":"B","type":"MISSILE","size":"SMALL"}],"builtInWeapons":{"B":"weapon"},"builtInMods":["old"],"builtInWings":["wing"]}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/skin.skin"), r#"{"skinHullId":"skin","baseHullId":"a","ordnancePoints":120,"fighterBays":2,"weaponSlotChanges":{"A":{"size":"LARGE","type":"HYBRID"}},"removeWeaponSlots":["B"],"removeBuiltInMods":["old"],"builtInMods":["new"]}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/var.variant"),
        r#"{"variantId":"var","hullId":"skin","fluxVents":2}"#,
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("variant.skin");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    let snapshot = query_joint_edit(&root).unwrap();
    let hull = &snapshot.variants[&snapshot.bindings["variant"]];
    assert_eq!(hull.slots.len(), 1);
    assert_eq!(hull.slots[0]["size"], "LARGE");
    assert_eq!(hull.built_in_mods, ["new"]);
    assert!(hull.built_in_weapons.is_empty());
    assert_eq!(hull.built_in_wings, ["wing"]);
    assert_eq!(
        hull.fields["ordnance points"].last().unwrap().path,
        "ordnancePoints"
    );
    assert_eq!(
        hull.fields["fighter bays"].last().unwrap().path,
        "fighterBays"
    );
    assert_eq!(
        hull.display_bindings["csv"],
        hull.fields["name"][0].record_key
    );
    let description = snapshot
        .records
        .iter()
        .find(|record| record.key == hull.display_bindings["description"])
        .unwrap();
    assert!(
        matches!(&description.target, JointRecordTarget::Csv { identity, .. } if identity["id"] == "skin" && identity["type"] == "SHIP")
    );
    cleanup(dir, &root);
}

#[test]
fn module_variant_catalog_lightweight_sources_and_skins() {
    let (dir, mut root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    let game = project_workspace("module_catalog");
    for (relative, content) in [
        (
            "data/hulls/ship_data.csv",
            "id,name,hints\na,,MODULE\nb,Other,NOT_MODULE\n",
        ),
        (
            "data/hulls/b.ship",
            r#"{"hullId":"b","hullName":"Other","spriteName":"graphics/b.png"}"#,
        ),
        (
            "data/hulls/skins/removed.skin",
            r#"{"skinHullId":"removed","baseHullId":"a","removeHints":["MODULE"]}"#,
        ),
        (
            "data/hulls/skins/added.skin",
            r#"{"skinHullId":"added","baseHullId":"b","addHints":["MODULE"],"hullName":"Skin name"}"#,
        ),
        (
            "data/variants/twin.variant",
            r#"{"variantId":"twin","hullId":"a","displayName":"Twin"}"#,
        ),
        (
            "data/variants/removed.variant",
            r#"{"variantId":"removed","hullId":"removed"}"#,
        ),
        (
            "data/variants/added.variant",
            r#"{"variantId":"added","hullId":"added"}"#,
        ),
        (
            "data/variants/ordinary.variant",
            r#"{"variantId":"ordinary","hullId":"b"}"#,
        ),
    ] {
        let path = dir.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_utf8_no_bom(&path, content).unwrap();
    }
    for (relative, content) in [
        (
            "data/hulls/ship_data.csv",
            "id,name,hints\ncore_ship,Core,MODULE\n",
        ),
        (
            "data/hulls/core.ship",
            r#"{"hullId":"core_ship","spriteName":"graphics/core.png"}"#,
        ),
        (
            "data/variants/core.variant",
            r#"{"variantId":"core","hullId":"core_ship"}"#,
        ),
        (
            "data/variants/var.variant",
            r#"{"variantId":"var","hullId":"core_ship"}"#,
        ),
    ] {
        let path = game.join("starsector-core").join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_utf8_no_bom(&path, content).unwrap();
    }
    let mut trace = project::PerformanceTrace::new("module.catalog.test");
    root.session_id = project::open_project_session_traced(&dir, Some(&game), &mut trace)
        .unwrap()
        .session_id;
    write_utf8_no_bom(
        &dir.join("data/weapons/weapon.wpn"),
        "invalid weapon content",
    )
    .unwrap();
    let local = crate::services::query_variant_catalog(
        &root,
        JointVariantCatalogKind::Variants,
        Some(ResourceSource::Mod),
    )
    .unwrap();
    let mut ids = local
        .catalog
        .entries
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<Vec<_>>();
    ids.sort();
    assert_eq!(ids, ["added", "twin", "var"]);
    for entry in &local.catalog.entries {
        assert_eq!(entry.data.as_object().unwrap().len(), 3);
        assert!(entry.spec.is_none() && entry.preview.is_none() && entry.projectile.is_none());
        assert_eq!(entry.source.source, ResourceSource::Mod);
        assert!(
            entry
                .module_hull
                .as_ref()
                .unwrap()
                .hints
                .iter()
                .any(|hint| hint == "MODULE")
        );
    }
    let twin = local
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "twin")
        .unwrap();
    assert_eq!(twin.module_hull.as_ref().unwrap().name, "Ship");
    assert_eq!(twin.label, "Twin");
    let added = local
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "added")
        .unwrap();
    assert_eq!(added.module_hull.as_ref().unwrap().name, "Skin name");
    let core = crate::services::query_variant_catalog(
        &root,
        JointVariantCatalogKind::Variants,
        Some(ResourceSource::Core),
    )
    .unwrap();
    assert_eq!(core.catalog.entries.len(), 1);
    assert_eq!(core.catalog.entries[0].id, "core");
    assert_eq!(
        core.catalog.entries[0].resource_refs["icon"].source,
        ResourceSource::Core
    );
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn variant_weapon_catalog_sources() {
    let (dir, root) = fixture();
    let snapshot = crate::services::query_variant_catalog(
        &JointEditRoot {
            kind: JointEditKind::Variant,
            id: "var".into(),
            ..root.clone()
        },
        JointVariantCatalogKind::Weapons,
        None,
    )
    .unwrap();
    let catalog = snapshot.catalog;
    assert_eq!(catalog.entries.len(), 1);
    assert_eq!(catalog.entries[0].id, "weapon");
    assert_eq!(catalog.entries[0].spec.as_ref().unwrap()["size"], "SMALL");
    assert_eq!(catalog.entries[0].source.source, ResourceSource::Mod);
    assert!(
        catalog.entries[0]
            .source_version
            .path
            .ends_with("weapon_data.csv")
    );
    cleanup(dir, &root);
}

#[test]
fn weapon_render_hints_skin_chain() {
    let (dir, mut root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    std::fs::create_dir_all(dir.join("data/hulls/skins")).unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/ship_data.csv"),
        "name,id,hints\nShip,a,\"WEAPONS_FRONT_TO_BACK, CIVILIAN\"\n",
    )
    .unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/inner.skin"), r#"{"skinHullId":"inner","baseHullId":"a","removeHints":["WEAPONS_FRONT_TO_BACK"],"addHints":["WEAPONS_BACK_TO_FRONT"]}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/outer.skin"), r#"{"skinHullId":"outer","baseHullId":"inner","removeHints":["WEAPONS_BACK_TO_FRONT"],"addHints":["WEAPONS_FRONT_TO_BACK","PHASE"]}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/var.variant"),
        r#"{"variantId":"var","hullId":"outer"}"#,
    )
    .unwrap();
    let mut trace = project::PerformanceTrace::new("weapon.render.hints");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    let snapshot = query_joint_edit(&root).unwrap();
    let hull = &snapshot.variants[&snapshot.bindings["variant"]];
    assert_eq!(hull.hints, ["CIVILIAN", "PHASE", "WEAPONS_FRONT_TO_BACK"]);
    let outer = hull.skin_keys.last().unwrap();
    let projected = crate::services::query_joint_edit_request(&JointEditQuery {
        root: root.clone(),
        row_key: None,
        new_sources: Vec::new(),
        catalog: None,
        catalog_source: None,
        values: Some(BTreeMap::from([(
            outer.clone(),
            JointValue::Present(json!({
                "skinHullId":"outer", "baseHullId":"inner", "addHints":["WEAPONS_FRONT_TO_BACK"]
            })),
        )])),
    })
    .unwrap();
    assert_eq!(
        projected.variants[&projected.bindings["variant"]].hints,
        ["CIVILIAN", "WEAPONS_BACK_TO_FRONT", "WEAPONS_FRONT_TO_BACK"]
    );
    cleanup(dir, &root);
}

#[test]
fn variant_wing_catalog_core_reference() {
    let (dir, mut root) = fixture();
    let game = project_workspace("variant_catalog_core");
    let core = game.join("starsector-core");
    std::fs::create_dir_all(core.join("data/hulls")).unwrap();
    std::fs::create_dir_all(core.join("data/variants")).unwrap();
    write_utf8_no_bom(
        &core.join("data/hulls/fighter.ship"),
        r#"{"hullId":"fighter","hullName":"Spec name","spriteName":"graphics/fighter.png"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/hulls/ship_data.csv"),
        "id,name\nfighter,Authority fighter\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/variants/fighter_var.variant"),
        r#"{"variantId":"fighter_var","hullId":"fighter","displayName":"Support Fighter"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/wing_data.csv"),
        "id,variant,num\nwing,fighter_var,3\n",
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("variant.wing.catalog");
    root.session_id = project::open_project_session_traced(&dir, Some(&game), &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    let snapshot =
        crate::services::query_variant_catalog(&root, JointVariantCatalogKind::Wings, None)
            .unwrap();
    let entries = snapshot.catalog.entries;
    assert!(entries[0].preview.is_some());
    assert_eq!(entries[0].label, "Authority fighter Support Fighter");
    assert_eq!(entries[0].source.source, ResourceSource::Mod);
    assert_eq!(
        entries[0].spec_source.as_ref().unwrap().source,
        ResourceSource::Core
    );
    assert_eq!(
        entries[0].resource_refs["icon"].source,
        ResourceSource::Core
    );
    assert!(
        entries[0]
            .spec_version
            .as_ref()
            .unwrap()
            .path
            .ends_with("fighter_var.variant")
    );
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn four_roots_capture_versions() {
    let (dir, root) = fixture();
    for (kind, id) in [
        (JointEditKind::Ship, "a"),
        (JointEditKind::Weapon, "weapon"),
        (JointEditKind::Wing, "wing"),
        (JointEditKind::Variant, "var"),
    ] {
        let snapshot = query_joint_edit(&JointEditRoot {
            kind,
            id: id.into(),
            ..root.clone()
        })
        .unwrap();
        assert!(!snapshot.records.is_empty());
        assert!(snapshot.base_versions.iter().all(|version| {
            windows_path_key(&version.path).starts_with(&windows_path_key(&root.mod_root))
        }));
        assert_eq!(
            snapshot
                .base_versions
                .iter()
                .filter(|version| version.path.ends_with("ship_data.csv"))
                .count(),
            usize::from(kind != JointEditKind::Weapon)
        );
        assert!(
            snapshot
                .records
                .iter()
                .any(|record| record.target.write().rel_path.ends_with(".wpn")),
            "kind={kind:?}; root={}; records={:?}",
            root.mod_root,
            snapshot
                .records
                .iter()
                .map(|record| &record.target)
                .collect::<Vec<_>>()
        );
    }
    write_utf8_no_bom(
        &dir.join("data/hulls/a.ship"),
        r#"{"hullId":"a","weaponSlots":[]}"#,
    )
    .unwrap();
    let changed = query_joint_edit(&root).unwrap();
    assert_eq!(
        changed
            .records
            .iter()
            .filter(|record| record.target.write().rel_path.ends_with(".wpn"))
            .count(),
        0
    );
    cleanup(dir, &root);
}

fn wing_fixture() -> (TestWorkspace, JointEditRoot) {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/ship_data.csv"),"name,id,hitpoints,armor rating,min crew,max speed,shield type,custom\nShip,a,750,200,3,140,NONE,007\nOther,b,1000,300,4,90,NONE,008\n").unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/a.ship"),r#"{"hullId":"a","hullSize":"FIGHTER","spriteName":"graphics/a.png","weaponSlots":[{"id":"one"},{"id":"two"}],"builtInWeapons":{"one":"weapon"},"custom":"keep"}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/b.ship"),
        r#"{"hullId":"b","hullSize":"FIGHTER","weaponSlots":[],"spriteName":"graphics/b.png"}"#,
    )
    .unwrap();
    write_utf8_no_bom(&dir.join("data/variants/var.variant"),r#"{"variantId":"var","hullId":"a","displayName":"Support Fighter","weaponGroups":[{"weapons":{"one":"weapon","two":"weapon"}}],"custom":"keep"}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/wing_data.csv"),"id,variant,num,op cost,range,refit,role,custom\nwing,var,3,12,0,10,SUPPORT,007\nother_wing,var,2,10,100,8,FIGHTER,008\n").unwrap();
    let mut trace = project::PerformanceTrace::new("wing.test");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    (
        dir,
        JointEditRoot {
            session_id: manifest.session_id,
            mod_root: manifest.mod_root,
            kind: JointEditKind::Wing,
            id: "wing".into(),
        },
    )
}

#[test]
fn wing_sources_and_fitted_weapons() {
    let (dir, root) = wing_fixture();
    let snapshot = query_joint_edit(&root).unwrap();
    let hull = snapshot.hull.as_ref().unwrap();
    assert_eq!(
        hull.weapons,
        BTreeMap::from([
            ("one".into(), "weapon".into()),
            ("two".into(), "weapon".into())
        ])
    );
    assert_eq!(hull.fields["min crew"][0].path, "min crew");
    assert_eq!(
        hull.fields["hitpoints"][0].record_key,
        snapshot.bindings["hullCsv"]
    );
    let csv = snapshot
        .records
        .iter()
        .find(|record| record.key == snapshot.bindings["hullCsv"])
        .unwrap();
    assert!(csv.referenced_by.contains(&"Wing:wing".into()));
    assert!(csv.referenced_by.contains(&"Wing:other_wing".into()));
    let description = snapshot
        .records
        .iter()
        .find(|record| record.key == snapshot.bindings["description"])
        .unwrap();
    assert!(
        matches!(&description.target,JointRecordTarget::Csv{identity,..} if identity["id"]=="a" && identity["type"]=="SHIP")
    );
    cleanup(dir, &root);
}

#[test]
fn wing_skin_sources_and_slots() {
    let (dir, mut root) = wing_fixture();
    project::close_project_session(root.session_id).unwrap();
    std::fs::create_dir_all(dir.join("data/hulls/skins")).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/skin.skin"),r#"{"skinHullId":"skin","baseHullId":"a","hullName":"Skin Name","maxSpeed":190,"tech":"Midline","descriptionId":"a","removeWeaponSlots":["one"],"builtInWeapons":{"two":"special"},"spriteName":"graphics/skin.png"}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/variants/var.variant"),r#"{"variantId":"var","hullId":"skin","weaponGroups":[{"weapons":{"one":"weapon","two":"weapon"}}]}"#).unwrap();
    let mut trace = project::PerformanceTrace::new("wing.skin");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    let snapshot = query_joint_edit(&root).unwrap();
    let hull = snapshot.hull.as_ref().unwrap();
    assert_eq!(
        hull.weapons,
        BTreeMap::from([("two".into(), "special".into())])
    );
    assert_eq!(hull.fields["max speed"].last().unwrap().path, "maxSpeed");
    assert_eq!(hull.fields["name"].last().unwrap().path, "hullName");
    assert_eq!(
        hull.fields["tech/manufacturer"].last().unwrap().path,
        "tech"
    );
    assert_eq!(
        hull.display_bindings["csv"],
        hull.fields["min crew"][0].record_key
    );
    assert_eq!(
        hull.display_bindings["description"],
        snapshot.bindings["description"]
    );
    assert_eq!(
        hull.display_bindings.get("system"),
        snapshot.bindings.get("system")
    );
    assert_eq!(hull.sprite.as_ref().unwrap().rel_path, "graphics/skin.png");
    assert_eq!(
        hull.sprite.as_ref().unwrap().owner_kind,
        ResourceOwnerKind::Skin
    );
    let mut payload = payload(snapshot);
    let source = payload.snapshot.hull.as_ref().unwrap().fields["max speed"]
        .last()
        .unwrap()
        .record_key
        .clone();
    let JointValue::Present(data) = payload.values.get_mut(&source).unwrap() else {
        unreachable!()
    };
    data["maxSpeed"] = json!(210);
    let saved = submit(&payload).unwrap();
    assert_eq!(saved.changes.len(), 1);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/hulls/skins/skin.skin")).unwrap()["maxSpeed"],
        json!(210)
    );
    assert_eq!(
        read_csv_data(&dir.join("data/hulls/ship_data.csv"))
            .unwrap()
            .rows[0]
            .data["max speed"],
        json!("140")
    );
    cleanup(dir, &root);
}

#[test]
fn wing_joint_save_and_replay() {
    let (dir, root) = wing_fixture();
    let baseline = query_joint_edit(&root).unwrap();
    let mut payload = payload(baseline);
    for (binding, field, value) in [
        ("csv", "op cost", json!("14")),
        ("hullCsv", "hitpoints", json!("900")),
        ("variant", "displayName", json!("New Fighter")),
        ("description", "text1", json!("New description")),
    ] {
        let key = payload.snapshot.bindings[binding].clone();
        let JointValue::Present(data) = payload.values.get_mut(&key).unwrap() else {
            unreachable!()
        };
        data[field] = value;
    }
    let saved = submit(&payload).unwrap();
    assert_eq!(saved.changes.len(), 4);
    assert_eq!(saved.history.undo_stack.len(), 1);
    let refreshed = query_joint_edit(&root).unwrap();
    let csv = refreshed
        .records
        .iter()
        .find(|record| record.key == refreshed.bindings["hullCsv"])
        .unwrap();
    assert!(
        matches!(&csv.value,JointValue::Present(data) if data["hitpoints"]=="900" && data["custom"]=="007")
    );
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/var.variant")).unwrap()["custom"],
        json!("keep")
    );
    let undo = write_transactions::replay(
        &root.session_id,
        &root.mod_root,
        FileChangeReplayDirection::Undo,
        saved.history.undo_stack[0].id,
        saved.history.revision,
    )
    .unwrap();
    assert_eq!(undo.changes.len(), 4);
    assert_eq!(
        read_csv_data(&dir.join("data/hulls/ship_data.csv"))
            .unwrap()
            .rows[0]
            .data["hitpoints"],
        json!("750")
    );
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/variants/var.variant")).unwrap()["displayName"],
        json!("Support Fighter")
    );
    cleanup(dir, &root);
}

#[test]
fn wing_reference_and_graph() {
    let (dir, root) = wing_fixture();
    let mut payload = payload(query_joint_edit(&root).unwrap());
    let key = payload.snapshot.bindings["variant"].clone();
    let JointValue::Present(data) = payload.values.get_mut(&key).unwrap() else {
        unreachable!()
    };
    data["hullId"] = json!("b");
    let saved = submit(&payload).unwrap();
    assert!(saved.content.unwrap().value.hull.is_none());
    let next = query_joint_edit(&root).unwrap();
    let hull = next
        .records
        .iter()
        .find(|record| record.key == next.hull.as_ref().unwrap().hull_key)
        .unwrap();
    assert!(matches!(&hull.target,JointRecordTarget::Spec{target} if target.id=="b"));
    assert_eq!(saved.changes.len(), 1);
    cleanup(dir, &root);
}

#[test]
fn wing_creates_skin_and_versions() {
    let (dir, mut root) = wing_fixture();
    project::close_project_session(root.session_id).unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/var.variant"),
        r#"{"variantId":"var","hullId":"new_skin","weaponGroups":[]}"#,
    )
    .unwrap();
    let mut trace = project::PerformanceTrace::new("wing.create");
    root.session_id = project::open_project_session_traced(&dir, None, &mut trace)
        .unwrap()
        .session_id;
    let baseline = crate::services::query_joint_edit_request(&JointEditQuery {
        catalog: None,
        catalog_source: None,
        root: root.clone(),
        row_key: None,
        values: None,
        new_sources: vec![JointSourceCreate {
            kind: EntityKind::Skin,
            id: "new_skin".into(),
        }],
    })
    .unwrap();
    let key = baseline.bindings["hull"].clone();
    let prepared=prepare_joint_edit(&JointEditDraft{baseline,values:BTreeMap::from([(key,JointValue::Present(json!({"skinHullId":"new_skin","baseHullId":"a","hullName":"New Skin","maxSpeed":180,"descriptionId":"a"})))])}).unwrap();
    assert!(
        prepared
            .snapshot
            .base_versions
            .iter()
            .any(|version| version.path.ends_with("a.ship"))
    );
    let payload = JointEditSubmission {
        base_versions: prepared.snapshot.base_versions.clone(),
        snapshot: prepared.snapshot,
        values: prepared.values,
        json_write: Default::default(),
        create_overrides: Vec::new(),
    };
    let saved = submit(&payload).unwrap();
    assert_eq!(saved.changes.len(), 1);
    let next = query_joint_edit(&root).unwrap();
    assert_eq!(
        next.hull.as_ref().unwrap().fields["max speed"]
            .last()
            .unwrap()
            .path,
        "maxSpeed"
    );
    assert!(dir.join("data/hulls/skins/new_skin.skin").exists());
    cleanup(dir, &root);
}

#[test]
fn weapon_projection_icons_and_source() {
    let (dir, root) = fixture();
    std::fs::create_dir_all(dir.join("data/config")).unwrap();
    write_utf8_no_bom(&dir.join("data/config/settings.json"), r#"{"graphics":{"ui":{"icon_kinetic":"graphics/kinetic.png","icon_energy":"graphics/energy.png"}}}"#).unwrap();
    let weapon_root = JointEditRoot {
        kind: JointEditKind::Weapon,
        id: "weapon".into(),
        ..root.clone()
    };
    let baseline = query_joint_edit(&weapon_root).unwrap();
    let spec_key = baseline.bindings["spec"].clone();
    let csv_key = baseline.bindings["csv"].clone();
    let draft = BTreeMap::from([
        (
            spec_key,
            JointValue::Present(
                json!({"id":"weapon","specClass":"projectile","projectileSpecId":"missing","descriptionId":"ignored"}),
            ),
        ),
        (
            csv_key.clone(),
            JointValue::Present(json!({"id":"weapon","type":"KINETIC"})),
        ),
    ]);
    let projected = crate::services::query_joint_edit_request(&JointEditQuery {
        catalog: None,
        catalog_source: None,
        root: weapon_root,
        row_key: None,
        values: Some(draft),
        new_sources: Vec::new(),
    })
    .unwrap();
    let csv = projected
        .records
        .iter()
        .find(|record| record.key == csv_key)
        .unwrap();
    assert_eq!(
        csv.resource_refs["damageIcon"].rel_path,
        "graphics/kinetic.png"
    );
    assert_eq!(csv.resource_refs["damageIcon"].source, ResourceSource::Mod);
    assert!(
        projected
            .reference_settings
            .versions
            .iter()
            .any(|version| version.path.ends_with("settings.json"))
    );
    let description = projected
        .records
        .iter()
        .find(|record| record.key == projected.bindings["description"])
        .unwrap();
    assert!(matches!(&description.value,JointValue::Present(data) if data["text1"]=="Weapon text"));
    let projectile = projected
        .records
        .iter()
        .find(|record| record.key == projected.bindings["projectile"])
        .unwrap();
    assert_eq!(projectile.value, JointValue::Missing);
    cleanup(dir, &root);
}

#[test]
fn loaded_missile_resource_projection() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    std::fs::create_dir_all(dir.join("data/weapons/proj")).unwrap();
    write_utf8_no_bom(&dir.join("data/weapons/proj/rocket.proj"),r#"{"id":"rocket","specClass":"missile","sprite":"graphics/rocket.png","size":[12,24],"center":[6,12]}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/weapons/weapon.wpn"),r#"{"id":"weapon","specClass":"projectile","type":"MISSILE","size":"SMALL","projectileSpecId":"rocket","renderHints":["RENDER_LOADED_MISSILES"]}"#).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.missile.resource");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        kind: JointEditKind::Weapon,
        id: "weapon".into(),
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    let record = snapshot
        .records
        .iter()
        .find(|record| record.key == snapshot.bindings["projectile"])
        .unwrap();
    assert_eq!(
        record.resource_refs["sprite"].rel_path,
        "graphics/rocket.png"
    );
    assert_eq!(
        record.resource_refs["sprite"].owner_kind,
        ResourceOwnerKind::from(EntityKind::Projectile)
    );
    cleanup(dir, &root);
}

#[test]
fn one_receipt_saves_and_replays() {
    let (dir, root) = fixture();
    let mut input = payload(query_joint_edit(&root).unwrap());
    for record in &input.snapshot.records {
        if let JointValue::Present(mut value) = record.value.clone() {
            match &record.target {
                JointRecordTarget::Spec { target } if target.kind == EntityKind::Ship => {
                    value["hullName"] = json!("Updated")
                }
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                } => value["name"] = json!("Updated"),
                JointRecordTarget::Csv {
                    table: CsvTableKey::Descriptions,
                    identity,
                    ..
                } if identity["id"] == "a" => value["text1"] = json!("Updated text"),
                _ => continue,
            }
            input
                .values
                .insert(record.key.clone(), JointValue::Present(value));
        }
    }
    let result = submit(&input).unwrap();
    assert_eq!(result.changes.len(), 3);
    assert_eq!(result.history.undo_stack.len(), 1);
    let csv = read_csv_data(&dir.join("data/hulls/ship_data.csv")).unwrap();
    assert_eq!(csv.header, vec!["name", "id", "tags", "custom"]);
    assert!(csv.rows[0].is_comment);
    assert_eq!(csv.rows[1].data["custom"], "007");
    assert_eq!(csv.rows[2].data["name"], "Other");
    let undo = write_transactions::replay(
        &root.session_id,
        &root.mod_root,
        FileChangeReplayDirection::Undo,
        result.history.undo_stack[0].id,
        result.history.revision,
    )
    .unwrap();
    assert_eq!(undo.changes.len(), 3);
    assert_eq!(
        read_csv_data(&dir.join("data/strings/descriptions.csv"))
            .unwrap()
            .rows[0]
            .data["text1"],
        "Original"
    );
    cleanup(dir, &root);
}

#[test]
fn prepare_reports_field_conflicts() {
    let (dir, root) = fixture();
    let baseline = query_joint_edit(&root).unwrap();
    let record=baseline.records.iter().find(|record|matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Ship)).unwrap();
    let mut edited = match &record.value {
        JointValue::Present(value) => value.clone(),
        _ => panic!("ship exists"),
    };
    edited["custom"]["a"] = json!(4);
    edited["hullName"] = json!("Draft");
    let mut disk = edited.clone();
    disk["custom"]["a"] = json!(1);
    disk["custom"]["b"] = json!(9);
    disk["hullName"] = json!("Disk");
    write_utf8_no_bom(&dir.join("data/hulls/a.ship"), &disk.to_string()).unwrap();
    let prepared = prepare_joint_edit(&JointEditDraft {
        baseline: baseline.clone(),
        values: BTreeMap::from([(record.key.clone(), JointValue::Present(edited))]),
    })
    .unwrap();
    assert_eq!(prepared.conflicts.len(), 1);
    assert_eq!(prepared.conflicts[0].path, vec!["hullName"]);
    assert!(
        matches!(&prepared.values[&record.key],JointValue::Present(value) if value["custom"]==json!({"a":4,"b":9}))
    );
    assert_eq!(
        submit(&payload(baseline)).unwrap_err().code(),
        "write.version_conflict"
    );
    cleanup(dir, &root);
}
#[test]
fn ui_and_engine_resource_versions() {
    let (dir, root) = fixture();
    std::fs::create_dir_all(dir.join("data/config")).unwrap();
    write_utf8_no_bom(&dir.join("data/config/settings.json"), r#"{"graphics":{"ui":{"checkmark":"graphics/check.png","checkmark_locked":"graphics/locked.png"}}}"#).unwrap();
    write_utf8_no_bom(
        &dir.join("data/config/engine_styles.json"),
        r#"{"HIGH_TECH":{"engineColor":[100,165,255,255]}}"#,
    )
    .unwrap();
    let snapshot = query_joint_edit(&root).unwrap();
    let engines =
        project::query::resources::query_engine_render_assets(&root.session_id, &[]).unwrap();
    assert_eq!(
        snapshot.reference_settings.resources["checkmark"].rel_path,
        "graphics/check.png"
    );
    assert_eq!(
        engines.resources["graphics/fx/engineglow32.png"].source,
        ResourceSource::Mod
    );
    assert_eq!(
        engines.styles["HIGH_TECH"]["engineColor"],
        json!([100, 165, 255, 255])
    );
    assert_eq!(snapshot.reference_settings.versions.len(), 1);
    assert_eq!(engines.versions.len(), 1);
    cleanup(dir, &root);
}

#[test]
fn hullmod_catalog_ui_icons() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    let game = project_workspace("joint_hullmod_catalog");
    let core = game.join("starsector-core");
    for path in [
        core.join("data/config"),
        core.join("data/hullmods"),
        dir.join("data/config"),
        dir.join("data/hullmods"),
    ] {
        std::fs::create_dir_all(path).unwrap();
    }
    write_utf8_no_bom(&core.join("data/config/settings.json"), r#"{"graphics":{"ui":{"sortIcon":"graphics/core-sort.png","ui_border1b_e":"graphics/core-edge.png"}}}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/config/settings.json"), r#"{"graphics":{"ui":{"sortIcon":"graphics/mod-sort.png","ui_border1b_w":"graphics/mod-edge.png"}}}"#).unwrap();
    write_utf8_no_bom(
        &core.join("data/hullmods/hull_mods.csv"),
        "id,name,sprite\nshared,Core shared,graphics/shared.png\ncore,Core generic,\n",
    )
    .unwrap();
    write_utf8_no_bom(&dir.join("data/hullmods/hull_mods.csv"), "id,name,sprite,desc,hidden\nshared,Mod generic,,Params %s,FALSE\nexplicit,Explicit,graphics/explicit.png,Static,TRUE\n").unwrap();
    let mut trace = project::PerformanceTrace::new("joint.hullmod.resources");
    let manifest = project::open_project_session_traced(&dir, Some(&game), &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let result =
        crate::services::query_variant_catalog(&root, JointVariantCatalogKind::Hullmods, None)
            .unwrap();
    assert_eq!(result.catalog.entries.len(), 3);
    let shared = result
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "shared")
        .unwrap();
    assert_eq!(shared.label, "Mod generic");
    assert_eq!(shared.resource_refs["icon"].source, ResourceSource::Mod);
    assert_eq!(
        shared.resource_refs["icon"].rel_path,
        "graphics/hullmods/generic_mod.png"
    );
    assert_eq!(shared.data["desc"], "Params %s");
    let generic = result
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "core")
        .unwrap();
    assert_eq!(generic.resource_refs["icon"].source, ResourceSource::Core);
    assert_eq!(generic.resource_refs["icon"].owner_id, "core");
    assert_eq!(
        generic.resource_refs["icon"].rel_path,
        "graphics/hullmods/generic_mod.png"
    );
    let explicit = result
        .catalog
        .entries
        .iter()
        .find(|entry| entry.id == "explicit")
        .unwrap();
    assert_eq!(
        explicit.resource_refs["icon"].rel_path,
        "graphics/explicit.png"
    );
    assert_eq!(explicit.data["hidden"], "TRUE");
    assert_eq!(
        result.reference_settings.resources["sortIcon"].source,
        ResourceSource::Mod
    );
    assert_eq!(
        result.reference_settings.resources["ui_border1b_e"].source,
        ResourceSource::Core
    );
    assert_eq!(
        result.reference_settings.resources["ui_border1b_w"].source,
        ResourceSource::Mod
    );
    assert_eq!(result.reference_settings.versions.len(), 2);
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn rename_keeps_csv_field_edits() {
    let (dir, root) = fixture();
    let mut input = payload(query_joint_edit(&root).unwrap());
    for record in &input.snapshot.records {
        if let JointValue::Present(mut value) = record.value.clone() {
            match &record.target {
                JointRecordTarget::Spec { target } if target.kind == EntityKind::Ship => {
                    value["hullId"] = json!("A")
                }
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                } => value["name"] = json!("Renamed"),
                JointRecordTarget::Csv {
                    table: CsvTableKey::Descriptions,
                    identity,
                    ..
                } if identity["id"] == "a" => value["text1"] = json!("Edited description"),
                _ => continue,
            }
            input
                .values
                .insert(record.key.clone(), JointValue::Present(value));
        }
    }
    csv_staging::take_render_counts();
    let saved = submit(&input).unwrap();
    assert_eq!(
        csv_staging::take_render_counts(),
        BTreeMap::from([(CsvTableKey::Ships, 1), (CsvTableKey::Descriptions, 1)])
    );
    assert_eq!(saved.content.unwrap().value.root.id, "A");
    let rows = read_csv_data(&dir.join("data/hulls/ship_data.csv"))
        .unwrap()
        .rows;
    assert_eq!(rows[1].data["id"], "A");
    assert_eq!(rows[1].data["name"], "Renamed");
    let descriptions = read_csv_data(&dir.join("data/strings/descriptions.csv")).unwrap();
    assert_eq!(descriptions.rows[0].data["id"], "A");
    assert_eq!(descriptions.rows[0].data["text1"], "Edited description");
    assert_eq!(descriptions.rows[0].data["notes"], "007");
    assert!(dir.join("data/hulls/A.ship").exists());
    cleanup(dir, &root);
}

#[test]
fn late_change_rejects_confirmed_write() {
    let (dir, root) = fixture();
    let baseline = query_joint_edit(&root).unwrap();
    let prepared = prepare_joint_edit(&JointEditDraft {
        baseline: baseline.clone(),
        values: payload(baseline).values,
    })
    .unwrap();
    let mut input = payload(prepared.snapshot);
    let spec=input.snapshot.records.iter().find(|record|matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Ship)).unwrap();
    let key = spec.key.clone();
    if let JointValue::Present(value) = input.values.get_mut(&key).unwrap() {
        value["hullName"] = json!("Draft");
    }
    crate::services::prepare_joint_save(
        &mut input,
        &[SaveEdit::Set {
            path: vec![key, "value".into(), "hullName".into()],
            value: json!("Draft"),
        }],
        &[],
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/strings/descriptions.csv"),
        "id,type,text1,notes\na,SHIP,Later,007\n",
    )
    .unwrap();
    assert_eq!(submit(&input).unwrap_err().code(), "write.version_conflict");
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/hulls/a.ship")).unwrap()["hullName"],
        "Ship"
    );
    assert!(
        write_transactions::query_history(&root.session_id, &root.mod_root)
            .unwrap()
            .undo_stack
            .is_empty()
    );
    cleanup(dir, &root);
}

#[test]
fn queued_joint_changes_follow_consecutive_renames_and_preserve_current_fields() {
    let (dir, root) = fixture();
    let snapshot = query_joint_edit(&root).unwrap();
    let spec = snapshot.bindings["spec"].clone();
    let csv = snapshot.bindings["csv"].clone();
    let mut queued = payload(snapshot.clone());
    let edits = vec![
        SaveEdit::Set {
            path: vec![spec.clone(), "value".into(), "hullName".into()],
            value: json!("Queued"),
        },
        SaveEdit::Set {
            path: vec![csv.clone(), "value".into(), "name".into()],
            value: json!("Queued"),
        },
    ];
    let mut identities = Vec::new();
    let mut latest = snapshot;
    for id in ["renamed", "final"] {
        let mut request = payload(latest);
        let key = request.snapshot.bindings["spec"].clone();
        let JointValue::Present(data) = request.values.get_mut(&key).unwrap() else {
            unreachable!()
        };
        data["hullId"] = json!(id);
        data["custom"]["a"] = json!(7);
        request
            .base_versions
            .push(crate::io::file_version(&dir.join(format!("data/hulls/{id}.ship"))).unwrap());
        let result = submit(&request).unwrap();
        identities.extend(result.identity_changes);
        latest = result.content.unwrap().value;
    }
    let _lease = crate::services::project_sync::prepare_versions(
        &root.mod_root,
        &mut queued.base_versions,
        &latest.base_versions,
        &identities,
    )
    .unwrap();
    crate::services::prepare_joint_save(&mut queued, &edits, &identities).unwrap();
    assert_eq!(queued.snapshot.root.id, "final");
    let result = submit(&queued).unwrap();
    let saved = crate::io::read_json_file(&dir.join("data/hulls/final.ship")).unwrap();
    assert_eq!(saved["hullId"], "final");
    assert_eq!(saved["hullName"], "Queued");
    assert_eq!(saved["custom"]["a"], 7);
    let rows = read_csv_data(&dir.join("data/hulls/ship_data.csv")).unwrap();
    let row = rows
        .rows
        .iter()
        .find(|row| row.data["id"] == "final")
        .unwrap();
    assert_eq!(row.data["name"], "Queued");
    assert_eq!(result.changes.len(), 2);
    cleanup(dir, &root);
}

#[test]
fn core_override_keeps_original() {
    let dir = project_workspace("joint_core_mod");
    let game = project_workspace("joint_core_game");
    std::fs::create_dir_all(&dir).unwrap();
    let core = game.join("starsector-core");
    for relative in [
        "data/hulls",
        "data/weapons",
        "data/weapons/proj",
        "data/variants",
        "data/hulls/skins",
        "data/strings",
    ] {
        std::fs::create_dir_all(core.join(relative)).unwrap();
    }
    write_utf8_no_bom(
        &core.join("data/hulls/ship_data.csv"),
        "id,name,custom\nbase,Core,007\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/hulls/base.ship"),
        r#"{"hullId":"base","hullName":"Core","custom":{"keep":1}}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/strings/descriptions.csv"),
        "id,type,text1\nbase,SHIP,Core text\n",
    )
    .unwrap();
    let mut trace = project::PerformanceTrace::new("joint.core");
    let manifest = project::open_project_session_traced(&dir, Some(&game), &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        mod_root: manifest.mod_root,
        kind: JointEditKind::Ship,
        id: "base".into(),
    };
    let mut input = payload(query_joint_edit(&root).unwrap());
    assert!(
        input
            .snapshot
            .records
            .iter()
            .filter(|record| matches!(record.value, JointValue::Present(_)))
            .all(|record| record.source.as_ref().unwrap().source == ResourceSource::Core)
    );
    input.create_overrides = input
        .snapshot
        .records
        .iter()
        .filter(|record| {
            record
                .source
                .as_ref()
                .is_some_and(|source| source.source == ResourceSource::Core)
        })
        .map(|record| record.key.clone())
        .collect();
    crate::services::prepare_joint_save(&mut input, &[], &[]).unwrap();
    for relative in [
        "data/hulls/base.ship",
        "data/hulls/ship_data.csv",
        "data/strings/descriptions.csv",
    ] {
        let path = core.join(relative);
        let original = std::fs::read(&path).unwrap();
        let mut changed = original.clone();
        changed.push(b'\n');
        for replacement in [Some(changed), None] {
            if let Some(bytes) = replacement {
                std::fs::write(&path, bytes).unwrap();
            } else {
                std::fs::remove_file(&path).unwrap();
            }
            let error = submit(&input).unwrap_err();
            assert_eq!(error.code(), "write.version_conflict", "{relative}");
            assert!(
                write_transactions::query_history(&root.session_id, &root.mod_root)
                    .unwrap()
                    .undo_stack
                    .is_empty()
            );
            assert!(!dir.join("data/hulls/base.ship").exists());
            std::fs::write(&path, &original).unwrap();
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            let held = std::fs::OpenOptions::new()
                .read(true)
                .share_mode(0)
                .open(&path)
                .unwrap();
            let error = submit(&input).unwrap_err();
            drop(held);
            assert_eq!(error.code(), "io.unexpected");
            assert_eq!(
                Path::new(error.location().unwrap().path.as_ref().unwrap())
                    .canonicalize()
                    .unwrap(),
                path.canonicalize().unwrap()
            );
            assert!(!dir.join("data/hulls/base.ship").exists());
        }
    }
    let copied = submit(&input).unwrap();
    assert_eq!(copied.changes.len(), 3);
    assert_eq!(copied.key_map.len(), 2);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/hulls/base.ship")).unwrap()["hullName"],
        "Core"
    );
    input = payload(copied.content.unwrap().value);
    for record in &input.snapshot.records {
        if let JointValue::Present(mut value) = record.value.clone() {
            match &record.target {
                JointRecordTarget::Spec { target } if target.kind == EntityKind::Ship => {
                    value["hullName"] = json!("Override")
                }
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                } => value["name"] = json!("Override"),
                JointRecordTarget::Csv {
                    table: CsvTableKey::Descriptions,
                    ..
                } => value["text1"] = json!("Override text"),
                _ => continue,
            }
            input
                .values
                .insert(record.key.clone(), JointValue::Present(value));
        }
    }
    let result = submit(&input).unwrap();
    assert_eq!(result.changes.len(), 3);
    assert_eq!(result.key_map.len(), 0);
    assert_eq!(
        crate::io::read_json_file(&core.join("data/hulls/base.ship")).unwrap()["hullName"],
        "Core"
    );
    assert_eq!(
        read_csv_data(&dir.join("data/hulls/ship_data.csv"))
            .unwrap()
            .header,
        vec!["id", "name", "custom"]
    );
    let refreshed = result.content.unwrap().value;
    assert!(
        refreshed
            .records
            .iter()
            .filter(|record| matches!(record.value, JointValue::Present(_)))
            .all(|record| record.source.as_ref().unwrap().source == ResourceSource::Mod)
    );
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn skin_modules_and_shared_sources() {
    let (dir, root) = fixture();
    std::fs::create_dir_all(dir.join("data/hulls/skins")).unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/skins/skin.skin"),
        r#"{"skinHullId":"skin","baseHullId":"a"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/b.ship"),
        r#"{"hullId":"b","descriptionId":"a"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/variants/module.variant"),
        r#"{"variantId":"module","hullId":"a","weaponGroups":[],"wings":[]}"#,
    )
    .unwrap();
    write_utf8_no_bom(&dir.join("data/variants/var.variant"),r#"{"variantId":"var","hullId":"skin","modules":{"slot":"module"},"weaponGroups":[],"wings":[]}"#).unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.skin");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        kind: JointEditKind::Variant,
        id: "var".into(),
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    assert!(snapshot.records.iter().any(|record|matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Skin && target.id=="skin")));
    assert!(snapshot.records.iter().any(|record|matches!(&record.target,JointRecordTarget::Spec {target} if target.kind==EntityKind::Variant && target.id=="module")));
    let shared=snapshot.records.iter().find(|record|matches!(&record.target,JointRecordTarget::Csv {table:CsvTableKey::Descriptions,identity,..} if identity["id"]=="a")).unwrap();
    assert_eq!(
        shared.referenced_by,
        vec![
            "Ship:a",
            "Ship:b",
            "Skin:skin",
            "Variant:module",
            "Variant:var",
            "Wing:wing"
        ]
    );
    cleanup(dir, &root);
}

#[test]
fn builtin_wings_and_single_user() {
    let (dir, root) = fixture();
    write_utf8_no_bom(
        &dir.join("data/hulls/a.ship"),
        r#"{"hullId":"a","builtInWings":["wing"]}"#,
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.builtin");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    assert!(snapshot.records.iter().any(|record| matches!(
        &record.target,
        JointRecordTarget::Csv {
            table: CsvTableKey::Wings,
            ..
        }
    )));
    assert!(snapshot.records.iter().any(|record| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Variant && target.id == "var")));
    let hull = snapshot.records.iter().find(|record| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::Ship)).unwrap();
    assert_eq!(
        hull.referenced_by,
        vec!["Ship:a", "Variant:var", "Wing:wing"]
    );
    cleanup(dir, &root);
}

#[test]
fn core_system_uses_actual_source() {
    let (dir, root) = fixture();
    let game = project_workspace("joint_system_core");
    let core = game.join("starsector-core");
    std::fs::create_dir_all(core.join("data/shipsystems/nested")).unwrap();
    write_utf8_no_bom(
        &core.join("data/shipsystems/nested/actual.system"),
        r#"{"id":"drive","name":"Core drive","type":"STATS"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/shipsystems/ship_systems.csv"),
        "id,name\ndrive,Drive\n",
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/a.ship"),
        r#"{"hullId":"a","shipSystemId":"drive"}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/hulls/ship_data.csv"),
        "id,name,system id\na,Ship,drive\n",
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.system");
    let manifest = project::open_project_session_traced(&dir, Some(&game), &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let mut input = payload(query_joint_edit(&root).unwrap());
    let record = input.snapshot.records.iter().find(|record| matches!(&record.target, JointRecordTarget::Spec { target } if target.kind == EntityKind::System)).unwrap();
    assert_eq!(record.source.as_ref().unwrap().source, ResourceSource::Core);
    assert_eq!(
        record.source.as_ref().unwrap().rel_path,
        "data/shipsystems/nested/actual.system"
    );
    if let JointValue::Present(value) = input.values.get_mut(&record.key).unwrap() {
        value["name"] = json!("Mod drive");
    }
    let saved = submit(&input).unwrap();
    assert_eq!(saved.changes.len(), 1);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/shipsystems/drive.system")).unwrap()["name"],
        "Mod drive"
    );
    assert_eq!(
        crate::io::read_json_file(&core.join("data/shipsystems/nested/actual.system")).unwrap()["name"],
        "Core drive"
    );
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn missing_columns_keep_comments() {
    let (dir, root) = fixture();
    write_utf8_no_bom(
        &dir.join("data/hulls/ship_data.csv"),
        "id,name,custom,custom2\n#disabled,Disabled,keep,007\na,Ship,a,b\nb,Other,c,d\n",
    )
    .unwrap();
    let mut input = payload(query_joint_edit(&root).unwrap());
    let record = input
        .snapshot
        .records
        .iter()
        .find(|record| {
            matches!(
                &record.target,
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                }
            )
        })
        .unwrap();
    let key = record.key.clone();
    input.values.retain(|entry, _| *entry == key);
    if let JointValue::Present(value) = input.values.get_mut(&key).unwrap() {
        value["hitpoints"] = json!("999");
        value["name"] = json!("#Literal");
    }
    csv_staging::take_render_counts();
    let result = submit(&input).unwrap();
    assert_eq!(
        csv_staging::take_render_counts(),
        BTreeMap::from([(CsvTableKey::Ships, 1)])
    );
    let csv = read_csv_data(&dir.join("data/hulls/ship_data.csv")).unwrap();
    assert_eq!(csv.header, ["name", "id", "hitpoints", "custom", "custom2"]);
    assert!(csv.rows[0].is_comment);
    assert_eq!(csv.rows[0].data["custom2"], "007");
    assert_eq!(csv.rows[1].data["hitpoints"], "999");
    assert!(!csv.rows[1].is_comment);
    assert_eq!(csv.rows[1].data["name"], "#Literal");
    assert_eq!(csv.rows[2].data["name"], "Other");
    write_transactions::replay(
        &root.session_id,
        &root.mod_root,
        FileChangeReplayDirection::Undo,
        result.history.undo_stack[0].id,
        result.history.revision,
    )
    .unwrap();
    assert_eq!(
        read_csv_data(&dir.join("data/hulls/ship_data.csv"))
            .unwrap()
            .header,
        ["id", "name", "custom", "custom2"]
    );
    cleanup(dir, &root);
}

#[test]
fn csv_identity_and_draft_system() {
    let (dir, root) = fixture();
    std::fs::create_dir_all(dir.join("data/shipsystems")).unwrap();
    for id in ["one", "two"] {
        write_utf8_no_bom(
            &dir.join(format!("data/shipsystems/{id}.system")),
            &json!({"id":id,"type":"STATS"}).to_string(),
        )
        .unwrap();
    }
    write_utf8_no_bom(
        &dir.join("data/hulls/ship_data.csv"),
        "id,name,system id\na,Ship,one\n",
    )
    .unwrap();
    project::close_project_session(root.session_id.clone()).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.projection");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let baseline = query_joint_edit(&root).unwrap();
    let row = baseline
        .records
        .iter()
        .find(|record| {
            matches!(
                &record.target,
                JointRecordTarget::Csv {
                    table: CsvTableKey::Ships,
                    ..
                }
            )
        })
        .unwrap();
    let JointRecordTarget::Csv { row_key, .. } = &row.target else {
        unreachable!()
    };
    let mut query = JointEditQuery {
        catalog: None,
        catalog_source: None,
        root: JointEditRoot {
            id: "unsaved-id".into(),
            ..root.clone()
        },
        row_key: Some(row_key.clone()),
        values: None,
        new_sources: Vec::new(),
    };
    assert_eq!(
        crate::services::query_joint_edit_request(&query)
            .unwrap()
            .root
            .id,
        "a"
    );
    let JointValue::Present(mut edited) = row.value.clone() else {
        unreachable!()
    };
    edited["system id"] = json!("two");
    query.values = Some(BTreeMap::from([(
        row.key.clone(),
        JointValue::Present(edited),
    )]));
    let projection = crate::services::query_joint_edit_request(&query).unwrap();
    assert!(projection.records.iter().any(|record| matches!(&record.target, JointRecordTarget::Spec{target} if target.kind==EntityKind::System && target.id=="two")));
    assert!(!projection.records.iter().any(|record| matches!(&record.target, JointRecordTarget::Spec{target} if target.kind==EntityKind::System && target.id=="one")));
    assert_eq!(
        read_csv_data(&dir.join("data/hulls/ship_data.csv"))
            .unwrap()
            .rows[0]
            .data["system id"],
        "one"
    );
    cleanup(dir, &root);
}

#[test]
fn missing_ship_uses_construction() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    std::fs::remove_file(dir.join("data/hulls/a.ship")).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.missing");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    let key = snapshot.bindings["spec"].clone();
    assert_eq!(
        snapshot
            .records
            .iter()
            .find(|record| record.key == key)
            .unwrap()
            .value,
        JointValue::Missing
    );
    let mut input = payload(snapshot);
    input.values = BTreeMap::from([(
        key,
        JointValue::Present(json!({"hullId":"a","hullSize":"DESTROYER"})),
    )]);
    let result = submit(&input).unwrap();
    let data = crate::io::read_json_file(&dir.join("data/hulls/a.ship")).unwrap();
    assert_eq!(data["hullSize"], "DESTROYER");
    assert!(data["weaponSlots"].is_array());
    assert_eq!(result.changes.len(), 1);
    cleanup(dir, &root);
}

#[test]
fn missing_weapon_uses_construction() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    std::fs::remove_file(dir.join("data/weapons/weapon.wpn")).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.weapon.missing");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        kind: JointEditKind::Weapon,
        id: "weapon".into(),
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    let key = snapshot.bindings["spec"].clone();
    let mut input = payload(snapshot);
    input.values = BTreeMap::from([(
        key,
        JointValue::Present(json!({"id":"weapon","specClass":"beam","custom":"kept"})),
    )]);
    let result = submit(&input).unwrap();
    let data = crate::io::read_json_file(&dir.join("data/weapons/weapon.wpn")).unwrap();
    assert_eq!(data["textureType"], "SMOOTH");
    assert_eq!(data["custom"], "kept");
    assert!(data["turretOffsets"].is_array());
    assert_eq!(result.changes.len(), 1);
    cleanup(dir, &root);
}

#[test]
fn core_pulse_requires_legal_override() {
    for spec_class in [WeaponSpecClass::Projectile, WeaponSpecClass::Beam] {
        let dir = project_workspace("joint_pulse_mod");
        let game = project_workspace("joint_pulse_game");
        let core = game.join("starsector-core");
        std::fs::create_dir_all(core.join("data/weapons")).unwrap();
        std::fs::create_dir_all(core.join("data/strings")).unwrap();
        let original = r#"{"id":"pulse","specClass":"pulse","custom":{"keep":1}}"#;
        write_utf8_no_bom(&core.join("data/weapons/pulse.wpn"), original).unwrap();
        write_utf8_no_bom(
            &core.join("data/weapons/weapon_data.csv"),
            "id,name\npulse,Core pulse\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &core.join("data/strings/descriptions.csv"),
            "id,type,text1\npulse,WEAPON,Core description\n",
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("joint.pulse");
        let manifest = project::open_project_session_traced(&dir, Some(&game), &mut trace).unwrap();
        let root = JointEditRoot {
            session_id: manifest.session_id,
            mod_root: manifest.mod_root,
            kind: JointEditKind::Weapon,
            id: "pulse".into(),
        };
        let snapshot = query_joint_edit(&root).unwrap();
        let mut input = payload(snapshot);
        input.create_overrides = input
            .snapshot
            .records
            .iter()
            .filter(|record| {
                record
                    .source
                    .as_ref()
                    .is_some_and(|source| source.source == ResourceSource::Core)
            })
            .map(|record| record.key.clone())
            .collect();
        let error = submit(&input).unwrap_err();
        assert_eq!(error.code(), "spec.weapon_class_unsupported");
        assert!(!dir.join("data/weapons/pulse.wpn").exists());
        let key = input.snapshot.bindings["spec"].clone();
        let JointValue::Present(mut data) = input.values[&key].clone() else {
            unreachable!()
        };
        let template = crate::domain::spec_construction::create_associated_spec(
            &AssociatedSpecCreateParams::Weapon {
                id: "pulse".into(),
                spec_class,
            },
        );
        for (field, value) in template.as_object().unwrap() {
            data.as_object_mut()
                .unwrap()
                .entry(field.clone())
                .or_insert_with(|| value.clone());
        }
        data["specClass"] = template["specClass"].clone();
        input.values.insert(key, JointValue::Present(data));
        let receipt = submit(&input).unwrap();
        assert_eq!(receipt.changes.len(), 3);
        let saved = crate::io::read_json_file(&dir.join("data/weapons/pulse.wpn")).unwrap();
        assert_eq!(saved["specClass"], template["specClass"]);
        assert_eq!(saved["custom"]["keep"], 1);
        assert_eq!(
            std::fs::read_to_string(core.join("data/weapons/pulse.wpn")).unwrap(),
            original
        );
        cleanup(dir, &root);
        game.close().unwrap();
    }
}

#[test]
fn core_header_and_sensor_sources() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    let game = project_workspace("joint_reference_core");
    let core = game.join("starsector-core");
    std::fs::create_dir_all(core.join("data/config")).unwrap();
    std::fs::create_dir_all(core.join("data/hulls")).unwrap();
    std::fs::create_dir_all(dir.join("data/config")).unwrap();
    write_utf8_no_bom(
        &core.join("data/config/settings.json"),
        r#"{"baseSensorFrigate":30,"baseSensorDestroyer":60,"unrelated":99,"graphics":{"ui":{"toggle20_on":"graphics/core-on.png","toggle20_off":"graphics/core-off.png","ui_border1_top_left":"graphics/core-frame.png"}}}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/config/settings.json"),
        r#"{"baseSensorFrigate":42,"graphics":{"ui":{"toggle20_on":"graphics/mod-on.png","ui_border1_top_right":"graphics/mod-frame.png"}}}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &core.join("data/hulls/ship_data.csv"),
        "id,hitpoints,name,tags\ncore,100,Core,\n",
    )
    .unwrap();
    let mut trace = project::PerformanceTrace::new("joint.reference");
    let manifest = project::open_project_session_traced(&dir, Some(&game), &mut trace).unwrap();
    let root = JointEditRoot {
        session_id: manifest.session_id,
        ..root
    };
    let snapshot = query_joint_edit(&root).unwrap();
    assert_eq!(snapshot.reference_settings.values["baseSensorFrigate"], 42);
    assert_eq!(
        snapshot.reference_settings.values["baseSensorDestroyer"],
        60
    );
    assert!(!snapshot.reference_settings.values.contains_key("unrelated"));
    assert_eq!(snapshot.reference_settings.versions.len(), 2);
    assert_eq!(
        snapshot.reference_settings.resources["toggle20_on"].source,
        ResourceSource::Mod
    );
    assert_eq!(
        snapshot.reference_settings.resources["toggle20_on"].rel_path,
        "graphics/mod-on.png"
    );
    assert_eq!(
        snapshot.reference_settings.resources["toggle20_off"].source,
        ResourceSource::Core
    );
    assert_eq!(
        snapshot
            .reference_settings
            .resources
            .keys()
            .map(String::as_str)
            .collect::<Vec<_>>(),
        [
            "toggle20_off",
            "toggle20_on",
            "ui_border1_top_left",
            "ui_border1_top_right"
        ]
    );
    assert_eq!(
        snapshot.reference_settings.resources["ui_border1_top_left"].source,
        ResourceSource::Core
    );
    assert_eq!(
        snapshot.reference_settings.resources["ui_border1_top_right"].source,
        ResourceSource::Mod
    );
    let key = snapshot.bindings["csv"].clone();
    let mut input = payload(snapshot);
    input.values.retain(|entry, _| entry == &key);
    if let JointValue::Present(data) = input.values.get_mut(&key).unwrap() {
        data["hitpoints"] = json!("200");
    }
    submit(&input).unwrap();
    let csv = read_csv_data(&dir.join("data/hulls/ship_data.csv")).unwrap();
    assert_eq!(csv.header, ["id", "hitpoints", "name", "tags", "custom"]);
    assert_eq!(csv.rows[1].data["custom"], "007");
    cleanup(dir, &root);
    game.close().unwrap();
}

#[test]
fn variant_catalog_core_repeated_reads() {
    let (dir, mut root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    let game = project_workspace("variant_catalog_core_reads");
    let core = game.join("starsector-core");
    for (relative, content) in [
        (
            "data/weapons/weapon_data.csv",
            "id,name\ncore_weapon,Core weapon\n",
        ),
        (
            "data/weapons/core_weapon.wpn",
            r#"{"id":"core_weapon","specClass":"beam","size":"MEDIUM"}"#,
        ),
        (
            "data/hulls/wing_data.csv",
            "id,variant,num\ncore_wing,core_variant,2\n",
        ),
        (
            "data/hulls/ship_data.csv",
            "id,name\ncore_ship,Core fighter\n",
        ),
        (
            "data/hulls/core_ship.ship",
            r#"{"hullId":"core_ship","hullSize":"FIGHTER","spriteName":"graphics/core.png"}"#,
        ),
        (
            "data/variants/core_variant.variant",
            r#"{"variantId":"core_variant","hullId":"core_ship","displayName":"Support"}"#,
        ),
    ] {
        let path = core.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        write_utf8_no_bom(&path, content).unwrap();
    }
    let mut trace = project::PerformanceTrace::new("variant.catalog.fixture");
    root.session_id = project::open_project_session_traced(&dir, Some(&game), &mut trace)
        .unwrap()
        .session_id;
    root.kind = JointEditKind::Variant;
    root.id = "var".into();
    for (kind, core_id, mod_id) in [
        (JointVariantCatalogKind::Weapons, "core_weapon", "weapon"),
        (JointVariantCatalogKind::Wings, "core_wing", "wing"),
    ] {
        let initial = crate::services::query_variant_catalog(&root, kind, None).unwrap();
        assert_eq!(initial.root, root);
        assert_eq!(initial.catalog.entries.len(), 2);
        for (id, source) in [
            (core_id, ResourceSource::Core),
            (mod_id, ResourceSource::Mod),
        ] {
            let entry = initial
                .catalog
                .entries
                .iter()
                .find(|entry| entry.id == id)
                .unwrap();
            assert_eq!(entry.source.source, source);
            assert_eq!(entry.spec_source.as_ref().unwrap().source, source);
            assert_eq!(
                entry.spec.is_some(),
                matches!(kind, JointVariantCatalogKind::Weapons)
            );
            assert_eq!(
                entry.preview.is_some(),
                matches!(kind, JointVariantCatalogKind::Wings)
            );
        }
        let expected = serde_json::to_vec(&initial).unwrap();
        for sample in 0..10 {
            let timer = trace.timer();
            let read = crate::services::query_variant_catalog(&root, kind, None).unwrap();
            let bytes = serde_json::to_vec(&read).unwrap();
            assert_eq!(bytes, expected);
            println!(
                "CATALOG {:?} sample={} entries={} ms={} bytes={}",
                kind,
                sample,
                read.catalog.entries.len(),
                timer.elapsed_ms(),
                bytes.len()
            );
        }
    }
    cleanup(dir, &root);
    game.close().unwrap();
}
