use super::*;
use crate::domain::joint_hull::hull_field_value;

fn skin_fixture() -> (PathBuf, JointEditRoot) {
    let (dir, mut root) = fixture();
    project::close_project_session(root.session_id).unwrap();
    std::fs::create_dir_all(dir.join("data/hulls/skins")).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/ship_data.csv"),
        "id,name,fleet pts,base value,max speed,supplies/rec,supplies/mo,fighter bays\na,Base,4,800,120,2,1,1\n").unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/parent.skin"),
        r#"{"skinHullId":"parent","baseHullId":"a","fleetPoints":7,"fpMod":99,"baseValue":1001,"baseValueMult":1.25,"maxSpeed":140}"#).unwrap();
    write_utf8_no_bom(&dir.join("data/hulls/skins/child.skin"),
        r#"{"skinHullId":"child","baseHullId":"parent","hullName":"Child","fpMod":-2,"baseValueMult":0.5,"spriteName":"graphics/child.png"}"#).unwrap();
    let mut trace = project::PerformanceTrace::new("joint.skin");
    let manifest = project::open_project_session_traced(&dir, None, &mut trace).unwrap();
    root.session_id = manifest.session_id;
    root.kind = JointEditKind::Skin;
    root.id = "child".into();
    (dir, root)
}

#[test]
fn skin_root_composes_every_layer_and_keeps_source_inputs() {
    let (dir, root) = skin_fixture();
    let snapshot = query_joint_edit(&root).unwrap();
    let hull = snapshot.hull.as_ref().unwrap();
    assert_eq!(hull.skin_keys.len(), 2);
    assert_eq!(
        hull_field_value(&snapshot.records, &hull.fields["fleet pts"]),
        Some(json!(5.0))
    );
    assert_eq!(
        hull_field_value(&snapshot.records, &hull.fields["base value"]),
        Some(json!(625.0))
    );
    assert_eq!(
        hull_field_value(&snapshot.records, &hull.fields["max speed"]),
        Some(json!(140))
    );
    assert_eq!(hull.fields["max speed"].len(), 3);
    assert_eq!(hull.spec["hullId"], "child");
    assert_eq!(hull.sprite.as_ref().unwrap().rel_path, "graphics/child.png");
    assert_eq!(
        snapshot
            .records
            .iter()
            .find(|record| record.key == snapshot.bindings["spec"])
            .unwrap()
            .target,
        hull_record(&snapshot, "child").target
    );
    cleanup(dir, &root);
}
fn hull_record<'a>(snapshot: &'a JointEditSnapshot, id: &str) -> &'a JointEditRecord {
    snapshot
        .records
        .iter()
        .find(|record| {
            matches!(&record.target, JointRecordTarget::Spec { target }
        if target.kind == EntityKind::Skin && target.id == id)
        })
        .unwrap()
}
#[test]
fn skin_root_saves_independent_layers_and_follows_skin_rename() {
    let (dir, root) = skin_fixture();
    let snapshot = query_joint_edit(&root).unwrap();
    let key = snapshot.bindings["spec"].clone();
    let mut request = payload(snapshot);
    let JointValue::Present(data) = request.values.get_mut(&key).unwrap() else {
        unreachable!()
    };
    data["maxSpeed"] = json!(190);
    let saved = submit(&request).unwrap().refreshed_entity.unwrap();
    assert_eq!(saved.root.kind, JointEditKind::Skin);
    assert_eq!(
        hull_field_value(
            &saved.records,
            &saved.hull.as_ref().unwrap().fields["max speed"]
        ),
        Some(json!(190))
    );
    let mut request = payload(saved);
    let JointValue::Present(data) = request.values.get_mut(&key).unwrap() else {
        unreachable!()
    };
    data.as_object_mut().unwrap().remove("maxSpeed");
    data["skinHullId"] = json!("renamed");
    let prepared = prepare_joint_edit(&JointEditDraft {
        baseline: request.snapshot,
        values: request.values,
    })
    .unwrap();
    let request = JointEditSubmission {
        base_versions: prepared.snapshot.base_versions.clone(),
        snapshot: prepared.snapshot,
        values: prepared.values,
        json_write: Default::default(),
        create_overrides: Vec::new(),
    };
    let saved = submit(&request).unwrap().refreshed_entity.unwrap();
    assert_eq!(saved.root.id, "renamed");
    assert_eq!(
        hull_field_value(
            &saved.records,
            &saved.hull.as_ref().unwrap().fields["max speed"]
        ),
        Some(json!(140))
    );
    assert!(dir.join("data/hulls/skins/renamed.skin").exists());
    cleanup(dir, &root);
}
