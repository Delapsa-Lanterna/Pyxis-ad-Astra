#![cfg(test)]
use super::*;
use crate::services::project::prepare_joint_edit;
use crate::{
    io::{read_csv_data, write_utf8_no_bom},
    services::{project, write_transactions},
    testutil::temp_dir,
};
use serde_json::json;
use std::{collections::BTreeMap, path::PathBuf};

fn fixture() -> (PathBuf, JointEditRoot) {
    let dir = temp_dir("joint_graph");
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
fn cleanup(dir: PathBuf, root: &JointEditRoot) {
    project::close_project_session(root.session_id.clone()).unwrap();
    std::fs::remove_dir_all(dir).unwrap();
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
                .any(|record| record.target.write().rel_path.ends_with(".wpn"))
        );
    }
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
                _ => continue,
            }
            input
                .values
                .insert(record.key.clone(), JointValue::Present(value));
        }
    }
    let saved = submit(&input).unwrap();
    assert_eq!(saved.refreshed_entity.unwrap().root.id, "A");
    let rows = read_csv_data(&dir.join("data/hulls/ship_data.csv"))
        .unwrap()
        .rows;
    assert_eq!(rows[1].data["id"], "A");
    assert_eq!(rows[1].data["name"], "Renamed");
    let descriptions = read_csv_data(&dir.join("data/strings/descriptions.csv")).unwrap();
    assert_eq!(descriptions.rows[0].data["id"], "A");
    assert_eq!(descriptions.rows[0].data["text1"], "Original");
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
fn core_override_keeps_original() {
    let dir = temp_dir("joint_core_mod");
    let game = temp_dir("joint_core_game");
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
    let copied = submit(&input).unwrap();
    assert_eq!(copied.changes.len(), 3);
    assert_eq!(copied.key_map.len(), 2);
    assert_eq!(
        crate::io::read_json_file(&dir.join("data/hulls/base.ship")).unwrap()["hullName"],
        "Core"
    );
    input = payload(copied.refreshed_entity.unwrap());
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
    let refreshed = result.refreshed_entity.unwrap();
    assert!(
        refreshed
            .records
            .iter()
            .filter(|record| matches!(record.value, JointValue::Present(_)))
            .all(|record| record.source.as_ref().unwrap().source == ResourceSource::Mod)
    );
    cleanup(dir, &root);
    std::fs::remove_dir_all(game).unwrap();
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
    assert_eq!(shared.referenced_by, vec!["Ship:a", "Ship:b"]);
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
    assert_eq!(hull.referenced_by, vec!["Ship:a", "Variant:var"]);
    cleanup(dir, &root);
}

#[test]
fn core_system_uses_actual_source() {
    let (dir, root) = fixture();
    let game = temp_dir("joint_system_core");
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
    std::fs::remove_dir_all(game).unwrap();
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
    let result = submit(&input).unwrap();
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
        root: JointEditRoot {
            id: "unsaved-id".into(),
            ..root.clone()
        },
        row_key: Some(row_key.clone()),
        values: None,
    };
    assert_eq!(
        project::query_joint_edit_request(&query).unwrap().root.id,
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
    let projection = project::query_joint_edit_request(&query).unwrap();
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
fn core_header_and_sensor_sources() {
    let (dir, root) = fixture();
    project::close_project_session(root.session_id.clone()).unwrap();
    let game = temp_dir("joint_reference_core");
    let core = game.join("starsector-core");
    std::fs::create_dir_all(core.join("data/config")).unwrap();
    std::fs::create_dir_all(core.join("data/hulls")).unwrap();
    std::fs::create_dir_all(dir.join("data/config")).unwrap();
    write_utf8_no_bom(
        &core.join("data/config/settings.json"),
        r#"{"baseSensorFrigate":30,"baseSensorDestroyer":60,"unrelated":99}"#,
    )
    .unwrap();
    write_utf8_no_bom(
        &dir.join("data/config/settings.json"),
        r#"{"baseSensorFrigate":42}"#,
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
    std::fs::remove_dir_all(game).unwrap();
}
