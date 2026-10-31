#![cfg(test)]
use crate::services::project::test_support::project_workspace;

use super::*;
use crate::io::{file_version, read_versioned_json, verify_versions};

#[test]
fn source_reads_parses_and_directory_walks_are_reused_per_reader() {
    let root = project_workspace("source_work_counts");
    std::fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
    let json = root.join("data/hulls/nested/sample.ship");
    let csv = root.join("data/hulls/table.csv");
    std::fs::write(&json, r#"{"hullId":"sample"}"#).unwrap();
    std::fs::write(&csv, "id,name\nsample,Sample\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    crate::io::csv_files::take_csv_work();
    for _ in 0..2 {
        assert_eq!(sources.json(&json).unwrap()["hullId"], "sample");
        assert_eq!(sources.count(&csv, "id").unwrap(), 1);
        assert_eq!(sources.csv(&csv).unwrap().rows.len(), 1);
        assert_eq!(sources.files("data/hulls").unwrap().len(), 2);
        assert_eq!(sources.files("data/hulls/nested").unwrap().len(), 1);
    }
    assert_eq!(crate::test_support::work_counts::count("read", &json), 1);
    assert_eq!(crate::test_support::work_counts::count("parse", &json), 1);
    assert_eq!(crate::io::csv_files::take_csv_work(), (1, 1, 0));
    assert_eq!(
        crate::test_support::work_counts::count("walk", &root.join("data/hulls")),
        1
    );
    assert_eq!(
        crate::test_support::work_counts::count("walk", &root.join("data/hulls/nested")),
        0
    );
    root.close().unwrap();
}

#[test]
fn resolved_source_drives_session_fields_graphics_and_media() {
    use crate::models::{ResourceOwnerKind, ResourceSource};
    use crate::services::project::{
        PerformanceTrace, open_project_session_traced, query, resources,
    };
    let root = project_workspace("effective_core_source");
    let game = root.join("game");
    let selected = root.join("selected");
    let local = game.join("mods/sample");
    let isolated = root.join("isolated");
    for path in [&local, &isolated] {
        std::fs::create_dir_all(path).unwrap();
    }
    for (path, marker) in [(&game, "local"), (&selected, "selected")] {
        for directory in [
            "mods",
            "starsector-core/data/hulls",
            "starsector-core/graphics",
        ] {
            std::fs::create_dir_all(path.join(directory)).unwrap();
        }
        std::fs::write(
            path.join("starsector-core/data/hulls/example.ship"),
            format!(
                r#"{{"hullId":"example","{marker}":true,"spriteName":"graphics/example.png"}}"#
            ),
        )
        .unwrap();
        std::fs::write(path.join("starsector-core/graphics/example.png"), marker).unwrap();
    }
    let selected_text = selected.to_string_lossy();
    let game_text = game.to_string_lossy();
    for mod_root in [&local, &isolated] {
        let effective = resolve_core_root(Some(&selected_text), Some(&game_text), Some(mod_root))
            .unwrap()
            .unwrap();
        assert_eq!(effective, selected.canonicalize().unwrap());
        let manifest = open_project_session_traced(
            mod_root,
            Some(&effective),
            &mut PerformanceTrace::new("test"),
        )
        .unwrap();
        assert_eq!(
            manifest.mod_root,
            mod_root.canonicalize().unwrap().to_string_lossy()
        );
        assert_eq!(
            resources::core_assets::query_core_root(Some(&manifest.session_id), Some(&game_text))
                .unwrap(),
            manifest.starsector_root
        );
        let source = effective.to_string_lossy();
        assert!(
            core::load_core_fields(&source).unwrap()["ship"]
                .iter()
                .any(|field| field.key == "selected")
        );
        assert_eq!(
            core::load_core_graphics(&source).unwrap(),
            vec!["graphics/example.png"]
        );
        let sprite = resources::resource_ref(
            ResourceSource::Mod,
            "graphics/example.png",
            ResourceOwnerKind::Ship,
            "example",
            "spriteName",
        );
        let media =
            query::resources::query_resource_data_urls(&manifest.session_id, vec![sprite]).unwrap();
        assert_eq!(
            media.entries[0].data_url.as_deref(),
            Some("data:image/png;base64,c2VsZWN0ZWQ=")
        );
        let references = query::hull_references::query_hull_references(
            &manifest.session_id,
            &["example".into()],
        )
        .unwrap();
        assert!(references.sprites.contains_key("example"));
        super::super::close_project_session(manifest.session_id).unwrap();
    }
    assert_eq!(
        resolve_core_root(None, Some(&game_text), Some(&isolated)).unwrap(),
        Some(game.canonicalize().unwrap())
    );
    assert_eq!(
        resolve_core_root(None, None, Some(&local)).unwrap(),
        Some(game.canonicalize().unwrap())
    );
    assert!(
        resolve_core_root(None, None, Some(&isolated))
            .unwrap()
            .is_none()
    );
    assert!(
        resolve_core_root(
            Some(&isolated.to_string_lossy()),
            Some(&game_text),
            Some(&local)
        )
        .is_err()
    );
    root.close().unwrap();
}

#[test]
fn source_version_matches_content() {
    let root = project_workspace("paired_source");
    let path = root.join("document.ship");
    std::fs::write(&path, b"\xef\xbb\xbf{\"hullId\":\"before\"}").unwrap();
    let (version, value) = read_versioned_json(&path).unwrap();
    assert_eq!(crate::test_support::work_counts::count("read", &path), 1);
    assert_eq!(value["hullId"], "before");
    assert_eq!(version, file_version(&path).unwrap());
    std::fs::write(&path, r#"{"hullId":"after"}"#).unwrap();
    assert_eq!(
        verify_versions(&root.to_string_lossy(), &[version])
            .unwrap_err()
            .code(),
        "write.version_conflict"
    );
    root.close().unwrap();
}

#[test]
fn source_cache_partial_reuse() {
    if crate::test_support::isolated_test() {
        return;
    }
    let root = project_workspace("partial_source_cache");
    configure_persistent_index_cache(&root.outer().join("cache")).unwrap();
    let first = root.join("first.ship");
    let second = root.join("second.ship");
    std::fs::write(&first, r#"{"hullId":"first"}"#).unwrap();
    std::fs::write(&second, r#"{"hullId":"second"}"#).unwrap();
    let mut initial = SourceReader::new(&root).unwrap();
    initial.json(&first).unwrap();
    initial.json(&second).unwrap();
    assert_eq!(crate::test_support::work_counts::count("parse", &first), 1);
    assert_eq!(crate::test_support::work_counts::count("parse", &second), 1);
    initial.flush();
    std::fs::write(&first, r#"{"hullId":"changed"}"#).unwrap();
    let mut reopened = SourceReader::new(&root).unwrap();
    assert_eq!(reopened.json(&first).unwrap()["hullId"], "changed");
    assert_eq!(reopened.json(&second).unwrap()["hullId"], "second");
    assert!(reopened.reused());
    reopened.json(&first).unwrap();
    reopened.json(&second).unwrap();
    assert_eq!(crate::test_support::work_counts::count("read", &first), 2);
    assert_eq!(crate::test_support::work_counts::count("read", &second), 2);
    assert_eq!(crate::test_support::work_counts::count("parse", &first), 2);
    assert_eq!(crate::test_support::work_counts::count("parse", &second), 1);
    assert_eq!(
        reopened.versions["first.ship"],
        file_version(&first).unwrap()
    );
    root.close().unwrap();
}

#[test]
fn persisted_csv_summary_is_read_once_and_parsed_only_after_content_changes() {
    if crate::test_support::isolated_test() {
        return;
    }
    let root = project_workspace("csv_summary_reuse");
    configure_persistent_index_cache(&root.outer().join("cache")).unwrap();
    let file = root.join("table.csv");
    std::fs::write(&file, "id\nfirst\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    assert_eq!(sources.count(&file, "id").unwrap(), 1);
    sources.flush();
    crate::io::csv_files::take_csv_work();
    let mut reopened = SourceReader::new(&root).unwrap();
    assert_eq!(reopened.count(&file, "id").unwrap(), 1);
    assert_eq!(reopened.count(&file, "id").unwrap(), 1);
    assert_eq!(crate::io::csv_files::take_csv_work(), (1, 0, 0));
    std::fs::write(&file, "id\nfirst\nsecond\n").unwrap();
    let mut changed = SourceReader::new(&root).unwrap();
    assert_eq!(changed.count(&file, "id").unwrap(), 2);
    assert_eq!(changed.count(&file, "id").unwrap(), 2);
    assert_eq!(crate::io::csv_files::take_csv_work(), (1, 1, 0));
    root.close().unwrap();
}

#[test]
fn directory_version_matches_io() {
    let root = project_workspace("source_directory_version");
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
    root.close().unwrap();
}

#[test]
fn csv_parse_handoff() {
    let root = project_workspace("source_csv_acceptance");
    let file = root.join("table.csv");
    std::fs::write(&file, "id,name\nitem,Example\n#note,Hidden\n,\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    assert_eq!(sources.count(&file, "id").unwrap(), 1);
    let table = sources.tables.remove("table.csv").unwrap();
    assert_eq!(table.rows.len(), 3);
    assert!(table.rows[1].is_comment);
    assert_eq!(sources.versions["table.csv"], file_version(&file).unwrap());
    root.close().unwrap();
}

#[test]
fn core_refresh_keeps_mod_baseline() {
    use crate::models::{InvalidatedResourceScope, ResourceSource};
    let root = project_workspace("separate_source_roots");
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
    root.close().unwrap();
}

#[test]
fn joint_parent_version_matches() {
    use crate::models::{JointEditKind, JointEditRoot, JointValue};
    let root = project_workspace("joint_parent_credential");
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
    root.close().unwrap();
}
