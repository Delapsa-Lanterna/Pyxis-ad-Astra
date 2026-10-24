use serde_json::json;

#[test]
fn skin_engine_index_save() {
    use crate::{
        models::{EntityKind, JsonEntityFilePayload},
        services,
        testutil::temp_dir,
    };
    let root = temp_dir("skin_engine_validation");
    std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
    std::fs::write(
        root.join("data/hulls/base.ship"),
        r#"{"hullId":"base","engineSlots":[{},{},{}]}"#,
    )
    .unwrap();
    std::fs::write(
        root.join("data/hulls/skins/middle.skin"),
        r#"{"skinHullId":"middle","baseHullId":"base","removeEngineSlots":[0]}"#,
    )
    .unwrap();
    let manifest = services::project::open_project_session_traced(
        &root,
        None,
        &mut services::project::PerformanceTrace::new("project.openSession"),
    )
    .unwrap();
    let target =
        services::query_entity_edit_target(&manifest.session_id, EntityKind::Skin, "sample")
            .unwrap();
    let write = |index: &str| JsonEntityFilePayload {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        base_versions: target.base_versions.clone(),
        previous_id: None,
        next_id: "sample".into(),
        rel_path: None,
        json_write: Default::default(),
        ordered_json: None,
        data: json!({"skinHullId":"sample","baseHullId":"middle","removeEngineSlots":[0],"engineSlotChanges":{index:{"width":2.5}}}),
    };
    assert_eq!(
        crate::commands::create_skin_entity(write("1"))
            .unwrap_err()
            .code(),
        "config.shape_invalid"
    );
    let path = root.join("data/hulls/skins/sample.skin");
    assert!(!path.exists());
    crate::commands::create_skin_entity(write("0")).unwrap();
    assert!(path.exists());
    let saved = services::query_entity(&manifest.session_id, EntityKind::Skin, "sample")
        .unwrap()
        .unwrap();
    assert_eq!(saved.data["engineSlotChanges"]["0"]["width"], 2.5);
    services::project::close_project_session(manifest.session_id).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
