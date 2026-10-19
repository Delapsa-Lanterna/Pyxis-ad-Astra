#![cfg(test)]

use super::*;
use crate::io::{file_version, read_versioned_json, verify_versions};

#[test]
fn source_version_matches_content() {
    let root = crate::testutil::temp_dir("paired_source");
    let path = root.join("document.ship");
    std::fs::write(&path, b"\xef\xbb\xbf{\"hullId\":\"before\"}").unwrap();
    let (version, value) = read_versioned_json(&path).unwrap();
    assert_eq!(value["hullId"], "before");
    assert_eq!(version, file_version(&path).unwrap());
    std::fs::write(&path, r#"{"hullId":"after"}"#).unwrap();
    assert_eq!(
        verify_versions(&root.to_string_lossy(), &[version])
            .unwrap_err()
            .code(),
        "write.version_conflict"
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn source_cache_partial_reuse() {
    let root = crate::testutil::temp_dir("partial_source_cache");
    let cache = crate::testutil::temp_dir("partial_source_cache_store");
    configure_persistent_index_cache(&cache).unwrap();
    let first = root.join("first.ship");
    let second = root.join("second.ship");
    std::fs::write(&first, r#"{"hullId":"first"}"#).unwrap();
    std::fs::write(&second, r#"{"hullId":"second"}"#).unwrap();
    let mut initial = SourceReader::new(&root).unwrap();
    initial.json(&first).unwrap();
    initial.json(&second).unwrap();
    initial.flush();
    std::fs::write(&first, r#"{"hullId":"changed"}"#).unwrap();
    let mut reopened = SourceReader::new(&root).unwrap();
    assert_eq!(reopened.json(&first).unwrap()["hullId"], "changed");
    assert_eq!(reopened.json(&second).unwrap()["hullId"], "second");
    assert!(reopened.reused());
    assert_eq!(
        reopened.versions["first.ship"],
        file_version(&first).unwrap()
    );
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(cache).unwrap();
}

#[test]
fn directory_version_matches_io() {
    let root = crate::testutil::temp_dir("source_directory_version");
    let directory = root.join("data/missions/example/nested");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("file.txt"), "content").unwrap();
    std::fs::write(root.join("data/missions/example/image.bin"), [0, 255, 4]).unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    sources
        .capture_changed_versions(&["data/missions/example"])
        .unwrap();
    assert_eq!(
        sources.versions["data/missions/example"],
        file_version(&root.join("data/missions/example")).unwrap()
    );
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn csv_parse_handoff() {
    let root = crate::testutil::temp_dir("source_csv_acceptance");
    let file = root.join("table.csv");
    std::fs::write(&file, "id,name\nitem,Example\n#note,Hidden\n,\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    assert_eq!(sources.count(&file, "id").unwrap(), 1);
    let table = sources.tables.remove("table.csv").unwrap();
    assert_eq!(table.rows.len(), 3);
    assert!(table.rows[1].is_comment);
    assert_eq!(sources.versions["table.csv"], file_version(&file).unwrap());
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn core_refresh_keeps_mod_baseline() {
    use crate::models::{InvalidatedResourceScope, ResourceSource};
    let root = crate::testutil::temp_dir("separate_source_roots");
    let mod_root = root.join("mod");
    let game = root.join("game");
    for base in [&mod_root, &game.join("starsector-core")] {
        std::fs::create_dir_all(base.join("data/hulls")).unwrap();
        std::fs::write(
            base.join("data/hulls/example.ship"),
            r#"{"hullId":"example"}"#,
        )
        .unwrap();
    }
    let manifest = super::super::open_project_session_traced(
        &mod_root,
        Some(&game),
        &mut super::super::PerformanceTrace::new("test"),
    )
    .unwrap();
    std::fs::write(mod_root.join("data/hulls/example.ship"), "{").unwrap();
    std::fs::write(
        game.join("starsector-core/data/hulls/example.ship"),
        r#"{"hullId":"updated"}"#,
    )
    .unwrap();
    let refreshed = super::super::refresh_project_sources(
        &manifest.session_id,
        vec![InvalidatedResourceScope {
            source: ResourceSource::Core,
            rel_path: "data/hulls/example.ship".into(),
        }],
    )
    .unwrap();
    assert_eq!(refreshed.manifest.entity_summaries.ships, 1);
    assert!(
        core::load_core_ship_files(&game.to_string_lossy())
            .unwrap()
            .contains_key("updated")
    );
    super::super::close_project_session(manifest.session_id).unwrap();
    core::invalidate_core_cache(&game.to_string_lossy()).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn joint_parent_version_matches() {
    use crate::models::{JointEditKind, JointEditRoot, JointValue};
    let root = crate::testutil::temp_dir("joint_parent_credential");
    std::fs::create_dir_all(root.join("data/variants")).unwrap();
    std::fs::create_dir_all(root.join("data/hulls")).unwrap();
    std::fs::write(root.join("data/hulls/hull.ship"), r#"{"hullId":"hull"}"#).unwrap();
    for (id, modules) in [("child", "{}"), ("parent", r#"{"slot":"child"}"#)] {
        std::fs::write(
            root.join(format!("data/variants/{id}.variant")),
            format!(r#"{{"variantId":"{id}","hullId":"hull","modules":{modules}}}"#),
        )
        .unwrap();
    }
    let manifest = super::super::open_project_session_traced(
        &root,
        None,
        &mut super::super::PerformanceTrace::new("test"),
    )
    .unwrap();
    let parent = root.join("data/variants/parent.variant");
    std::fs::write(&parent, r#"{"variantId":"parent","hullId":"hull","modules":{"slot":"child"},"displayName":"updated"}"#).unwrap();
    let snapshot = super::super::query::joint_edit::query_joint_edit(&JointEditRoot {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        kind: JointEditKind::Variant,
        id: "child".into(),
    })
    .unwrap();
    let record = snapshot
        .records
        .iter()
        .find(|record| {
            record
                .source
                .as_ref()
                .is_some_and(|source| source.rel_path == "data/variants/parent.variant")
        })
        .unwrap();
    let JointValue::Present(data) = &record.value else {
        panic!("parent content");
    };
    assert_eq!(data["displayName"], "updated");
    let expected = record.source_version.as_ref().unwrap();
    assert_eq!(expected, &file_version(&parent).unwrap());
    assert!(record.base_versions.contains(expected));
    verify_versions(&manifest.mod_root, &snapshot.base_versions).unwrap();
    super::super::close_project_session(manifest.session_id).unwrap();
    std::fs::remove_dir_all(root).unwrap();
}
