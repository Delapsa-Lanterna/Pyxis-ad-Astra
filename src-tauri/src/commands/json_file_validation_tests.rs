#[cfg(test)]
use crate::models::{EntityKind, JsonFileSave, SaveAction};
#[cfg(test)]
use crate::services;
#[cfg(test)]
use crate::services::project::PerformanceTrace;
#[cfg(test)]
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::{project, project_save};
use serde_json::json;
#[cfg(test)]
use std::fs;

#[test]
fn skin_engine_index_save() {
    let root = project_workspace("skin_engine_validation");
    fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
    fs::write(
        root.join("data/hulls/base.ship"),
        r#"{"hullId":"base","engineSlots":[{},{},{}]}"#,
    )
    .unwrap();
    fs::write(
        root.join("data/hulls/skins/middle.skin"),
        r#"{"skinHullId":"middle","baseHullId":"base","removeEngineSlots":[0]}"#,
    )
    .unwrap();
    let manifest = project::open_project_session_traced(
        &root,
        None,
        &mut PerformanceTrace::new("project.openSession"),
    )
    .unwrap();
    let target =
        services::query_entity_edit_target(&manifest.session_id, EntityKind::Skin, "sample")
            .unwrap();
    let write = |index: &str| JsonFileSave {
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
        project_save::execute_save_action(SaveAction::CreateSkinEntity(write("1")))
            .unwrap_err()
            .code(),
        "config.shape_invalid"
    );
    let path = root.join("data/hulls/skins/sample.skin");
    assert!(!path.exists());
    project_save::execute_save_action(SaveAction::CreateSkinEntity(write("0"))).unwrap();
    assert!(path.exists());
    let saved = services::query_entity(&manifest.session_id, EntityKind::Skin, "sample")
        .unwrap()
        .unwrap();
    assert_eq!(saved.data["engineSlotChanges"]["0"]["width"], 2.5);
    project::close_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}
