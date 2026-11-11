#![cfg(test)]
#[cfg(test)]
use crate::services::project_sync::release_project_session;
use crate::test_support::file_formats::read_versioned_json_value as read_versioned_json;

use super::*;
#[cfg(test)]
use crate::io::csv_files;
use crate::io::{file_version, verify_versions};
#[cfg(test)]
use crate::models::{
    InvalidatedResourceScope, JointEditDraft, JointEditKind, JointEditRoot, JointValue,
    ResourceOwnerKind, ResourceSource,
};
#[cfg(test)]
use crate::services::project::query::{hull_references, joint_edit, resources as query_resources};
#[cfg(test)]
use crate::services::project::resources::core_assets;
use crate::services::project::session::source_refresh::refresh_mod_root_sources;
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::project::{
    PerformanceTrace, open_project_session_traced, refresh_project_sources, resources,
};
#[cfg(test)]
use crate::test_support::work_counts;
#[cfg(test)]
use crate::test_support::{self, TestWorkspace};
#[cfg(test)]
use std::fs;
use std::slice;

#[test]
fn directory_staging_retains_only_changed_bytes_and_hands_off_the_same_snapshot() {
    let root = project_workspace("source_staged_memory");
    fs::create_dir_all(root.join("data")).unwrap();
    let first = root.join("data/first.ship");
    let second = root.join("data/second.ship");
    fs::write(&first, r#"{"hullId":"first"}"#).unwrap();
    fs::write(&second, r#"{"hullId":"second"}"#).unwrap();
    let mut reader = SourceReader::new(&root).unwrap();
    reader.discover("data", &["ship"], true).unwrap();
    let checked = reader
        .stage_directory("data", |key, _| key == "data/first.ship")
        .unwrap();
    assert_eq!(checked.len(), 2);
    assert_eq!(reader.bytes.len(), 1);
    let first_version = checked[&first.canonicalize().unwrap()].clone();
    fs::write(&first, r#"{"hullId":"later"}"#).unwrap();
    assert_eq!(reader.json(&first).unwrap()["hullId"], "first");
    assert_eq!(reader.versions["data/first.ship"], first_version);
    assert!(reader.bytes.is_empty());
    assert_eq!(work_counts::count("read", &first), 1);
    assert_eq!(work_counts::count("read", &second), 1);
    root.close().unwrap();
}

#[test]
fn staged_directory_rechecks_cached_parent_links_before_reading_bytes() {
    let (root, outside, _) =
        TestWorkspace::directory_link("staged_parent_link", "data/hulls").unwrap();
    let external = outside.join("sample.ship");
    fs::write(&external, r#"{"hullId":"external"}"#).unwrap();
    let mut reader = SourceReader::new(&root).unwrap();
    let cached = reader.root().join("data/hulls/sample.ship");
    reader
        .paths
        .insert("data/hulls".into(), vec![cached.clone()]);
    reader.versions.insert(
        "data/hulls/sample.ship".into(),
        FileVersion {
            path: cached.to_string_lossy().into_owned(),
            fingerprint: Some("cached".into()),
        },
    );
    for _ in 0..2 {
        let error = reader
            .stage_directory("data/hulls", |_, _| true)
            .unwrap_err();
        assert_eq!(error.code(), "path.link_rejected");
    }
    assert_eq!(work_counts::count("read", &external), 0);
    root.close().unwrap();
}

#[test]
fn source_reads_parses_and_directory_walks_are_reused_per_reader() {
    let root = project_workspace("source_work_counts");
    fs::create_dir_all(root.join("data/hulls/nested")).unwrap();
    let json = root.join("data/hulls/nested/sample.ship");
    let csv = root.join("data/hulls/table.csv");
    fs::write(&json, r#"{"hullId":"sample"}"#).unwrap();
    let json = json.canonicalize().unwrap();
    fs::write(&csv, "id,name\nsample,Sample\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    csv_files::take_csv_work();
    for _ in 0..2 {
        assert_eq!(sources.json(&json).unwrap()["hullId"], "sample");
        assert_eq!(sources.count(&csv, "id", |_| true).unwrap(), 1);
        assert_eq!(sources.csv(&csv).unwrap().rows.len(), 1);
        assert_eq!(sources.files("data/hulls").unwrap().len(), 2);
        assert_eq!(sources.files("data/hulls/nested").unwrap().len(), 1);
    }
    assert_eq!(work_counts::count("read", &json), 1);
    assert_eq!(work_counts::count("parse", &json), 1);
    assert_eq!(work_counts::count("source-path", &json), 1);
    assert_eq!(
        sources
            .json(&root.join("data/hulls/nested/sample.ship"))
            .unwrap()["hullId"],
        "sample"
    );
    assert_eq!(work_counts::count("read", &json), 1);
    assert_eq!(work_counts::count("parse", &json), 1);
    assert_eq!(csv_files::take_csv_work(), (1, 1, 0));
    assert_eq!(work_counts::count("walk", &root.join("data/hulls")), 1);
    assert_eq!(
        work_counts::count("walk", &root.join("data/hulls/nested")),
        0
    );
    let path_checks = work_counts::count("source-path", &json);
    fs::write(&json, r#"{"hullId":"changed"}"#).unwrap();
    sources.invalidate_paths(&["data/hulls/nested/sample.ship"]);
    assert_eq!(sources.json(&json).unwrap()["hullId"], "changed");
    assert_eq!(work_counts::count("read", &json), 2);
    assert_eq!(work_counts::count("parse", &json), 2);
    assert_eq!(work_counts::count("source-path", &json), path_checks + 1);
    root.close().unwrap();
}

#[test]
fn resolved_source_drives_session_fields_graphics_and_media() {
    let root = project_workspace("effective_core_source");
    let game = root.join("game");
    let selected = root.join("selected");
    let local = game.join("mods/sample");
    let isolated = root.join("isolated");
    for path in [&local, &isolated] {
        fs::create_dir_all(path).unwrap();
    }
    for (path, marker) in [(&game, "local"), (&selected, "selected")] {
        for directory in [
            "mods",
            "starsector-core/data/hulls",
            "starsector-core/graphics",
        ] {
            fs::create_dir_all(path.join(directory)).unwrap();
        }
        fs::write(
            path.join("starsector-core/data/hulls/example.ship"),
            format!(
                r#"{{"hullId":"example","{marker}":true,"spriteName":"graphics/example.png"}}"#
            ),
        )
        .unwrap();
        fs::write(path.join("starsector-core/graphics/example.png"), marker).unwrap();
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
            core_assets::query_core_root(Some(&manifest.session_id), Some(&game_text)).unwrap(),
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
            query_resources::query_resource_data_urls(&manifest.session_id, vec![sprite]).unwrap();
        assert_eq!(
            media.entries[0].data_url.as_deref(),
            Some("data:image/png;base64,c2VsZWN0ZWQ=")
        );
        let references =
            hull_references::query_hull_references(&manifest.session_id, &["example".into()])
                .unwrap();
        assert!(references.sprites.contains_key("example"));
        release_project_session(manifest.session_id).unwrap();
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
    fs::write(&path, b"\xef\xbb\xbf{\"hullId\":\"before\"}").unwrap();
    let (version, value) = read_versioned_json(&path).unwrap();
    assert_eq!(work_counts::count("read", &path), 1);
    assert_eq!(value["hullId"], "before");
    assert_eq!(version, file_version(&path).unwrap());
    fs::write(&path, r#"{"hullId":"after"}"#).unwrap();
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
    if test_support::isolated_test() {
        return;
    }
    let root = project_workspace("partial_source_cache");
    configure_persistent_index_cache(&root.outer().join("cache")).unwrap();
    let first = root.join("first.ship");
    let second = root.join("second.ship");
    fs::write(&first, r#"{"hullId":"first"}"#).unwrap();
    fs::write(&second, r#"{"hullId":"second","scale":0.625f}"#).unwrap();
    let mut initial = SourceReader::new(&root).unwrap();
    initial.json(&first).unwrap();
    initial.json(&second).unwrap();
    assert_eq!(work_counts::count("parse", &first), 1);
    assert_eq!(work_counts::count("parse", &second), 1);
    initial.flush();
    fs::write(&first, r#"{"hullId":"changed"}"#).unwrap();
    let mut reopened = SourceReader::new(&root).unwrap();
    assert_eq!(reopened.json(&first).unwrap()["hullId"], "changed");
    assert_eq!(reopened.json(&second).unwrap()["hullId"], "second");
    assert_eq!(
        reopened.json(&second).unwrap()["scale"].as_f64(),
        Some(0.625)
    );
    assert!(reopened.reused());
    reopened.json(&first).unwrap();
    reopened.json(&second).unwrap();
    assert_eq!(work_counts::count("read", &first), 2);
    assert_eq!(work_counts::count("read", &second), 2);
    assert_eq!(work_counts::count("parse", &first), 2);
    assert_eq!(work_counts::count("parse", &second), 1);
    assert_eq!(
        reopened.versions["first.ship"],
        file_version(&first).unwrap()
    );
    let cache = reopened.cache_path().unwrap().unwrap();
    let mut snapshot: SourceCache =
        tool_json::parse_persisted_json(&io::read_utf8_no_bom(&cache).unwrap()).unwrap();
    assert_eq!(snapshot.format, SOURCE_CACHE_FORMAT);
    snapshot.format = 0;
    fs::write(&cache, serde_json::to_string(&snapshot).unwrap()).unwrap();
    let mut uncached = SourceReader::new(&root).unwrap();
    assert_eq!(
        uncached.json(&second).unwrap()["scale"].as_f64(),
        Some(0.625)
    );
    assert_eq!(work_counts::count("parse", &second), 2);
    root.close().unwrap();
}

#[test]
fn persisted_csv_summary_is_read_once_and_parsed_only_after_content_changes() {
    if test_support::isolated_test() {
        return;
    }
    let root = project_workspace("csv_summary_reuse");
    configure_persistent_index_cache(&root.outer().join("cache")).unwrap();
    let file = root.join("table.csv");
    fs::write(&file, "id\nfirst\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    assert_eq!(sources.count(&file, "id", |_| true).unwrap(), 1);
    sources.flush();
    csv_files::take_csv_work();
    let mut reopened = SourceReader::new(&root).unwrap();
    assert_eq!(reopened.count(&file, "id", |_| true).unwrap(), 1);
    assert_eq!(reopened.count(&file, "id", |_| true).unwrap(), 1);
    assert_eq!(csv_files::take_csv_work(), (1, 0, 0));
    fs::write(&file, "id\nfirst\nsecond\n").unwrap();
    let mut changed = SourceReader::new(&root).unwrap();
    assert_eq!(changed.count(&file, "id", |_| true).unwrap(), 2);
    assert_eq!(changed.count(&file, "id", |_| true).unwrap(), 2);
    assert_eq!(csv_files::take_csv_work(), (1, 1, 0));
    root.close().unwrap();
}

#[test]
fn directory_version_matches_io() {
    let root = project_workspace("source_directory_version");
    let directory = root.join("data/missions/example/nested");
    fs::create_dir_all(&directory).unwrap();
    fs::write(directory.join("file.txt"), "content").unwrap();
    fs::write(root.join("data/missions/example/image.bin"), [0, 255, 4]).unwrap();
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
    fs::write(&file, "id,name\nitem,Example\n#note,Hidden\n,\n").unwrap();
    let mut sources = SourceReader::new(&root).unwrap();
    assert_eq!(sources.count(&file, "id", |_| true).unwrap(), 1);
    let table = sources.tables.remove("table.csv").unwrap();
    assert_eq!(table.rows.len(), 3);
    assert!(table.rows[1].is_comment);
    assert_eq!(sources.versions["table.csv"], file_version(&file).unwrap());
    root.close().unwrap();
}

#[test]
fn core_refresh_keeps_mod_baseline() {
    let root = project_workspace("separate_source_roots");
    let mod_root = root.join("mod");
    let game = root.join("game");
    for base in [&mod_root, &game.join("starsector-core")] {
        fs::create_dir_all(base.join("data/hulls")).unwrap();
        fs::write(
            base.join("data/hulls/example.ship"),
            r#"{"hullId":"example"}"#,
        )
        .unwrap();
    }
    let manifest =
        open_project_session_traced(&mod_root, Some(&game), &mut PerformanceTrace::new("test"))
            .unwrap();
    fs::write(mod_root.join("data/hulls/example.ship"), "{").unwrap();
    fs::write(
        game.join("starsector-core/data/hulls/example.ship"),
        r#"{"hullId":"updated"}"#,
    )
    .unwrap();
    let refreshed = refresh_project_sources(
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
    release_project_session(manifest.session_id).unwrap();
    core::invalidate_core_cache(&game.to_string_lossy()).unwrap();
    root.close().unwrap();
}

#[test]
fn joint_parent_version_matches() {
    let root = project_workspace("joint_parent_credential");
    fs::create_dir_all(root.join("data/variants")).unwrap();
    fs::create_dir_all(root.join("data/hulls")).unwrap();
    fs::write(root.join("data/hulls/hull.ship"), r#"{"hullId":"hull"}"#).unwrap();
    for (id, modules) in [("child", "{}"), ("parent", r#"{"slot":"child"}"#)] {
        fs::write(
            root.join(format!("data/variants/{id}.variant")),
            format!(r#"{{"variantId":"{id}","hullId":"hull","modules":{modules}}}"#),
        )
        .unwrap();
    }
    let manifest =
        open_project_session_traced(&root, None, &mut PerformanceTrace::new("test")).unwrap();
    let parent = root.join("data/variants/parent.variant");
    fs::write(&parent, r#"{"variantId":"parent","hullId":"hull","modules":{"slot":"child"},"displayName":"updated"}"#).unwrap();
    let snapshot = joint_edit::query_joint_edit(&JointEditRoot {
        session_id: manifest.session_id.clone(),
        mod_root: manifest.mod_root.clone(),
        kind: JointEditKind::Variant,
        id: "child".into(),
    })
    .unwrap();
    let key = snapshot.bindings["variant"].clone();
    let record = snapshot
        .records
        .iter()
        .find(|record| record.key == key)
        .unwrap();
    let mut value = record.value.clone();
    if let JointValue::Present(data) = &mut value {
        data["variantId"] = json!("renamed");
    }
    let snapshot = joint_edit::prepare_joint_edit(&JointEditDraft {
        baseline: snapshot,
        values: BTreeMap::from([(key, value)]),
    })
    .unwrap()
    .snapshot;
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
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}

#[test]
fn source_batch_shares_reads_and_keeps_discovery_separate_from_content() {
    let root = project_workspace("scoped_source_batch");
    fs::create_dir_all(root.join("data/hulls")).unwrap();
    fs::create_dir_all(root.join("graphics")).unwrap();
    let ship = root.join("data/hulls/sample.ship");
    let ignored = root.join("data/hulls/archive.zip");
    let image = root.join("graphics/sample.png");
    fs::write(&ship, r#"{"hullId":"sample"}"#).unwrap();
    fs::write(&ignored, b"archive").unwrap();
    fs::write(&image, b"image").unwrap();
    let mut candidate = SourceReader::new(&root).unwrap();
    assert!(candidate.notice_changed("graphics/sample.png").unwrap());
    candidate.discover("graphics", &["png"], false).unwrap();
    assert!(!candidate.stamps.contains_key("graphics/sample.png"));
    candidate.begin_batch();
    assert!(candidate.rescan_paths().unwrap().is_empty());
    let batch = SourceReadBatch::default();
    for _ in 0..2 {
        let mut reader = SourceReader::new(&root).unwrap();
        reader.use_batch(&batch);
        assert_eq!(reader.walk("data/hulls", "ship").unwrap().len(), 1);
        reader.discover("graphics", &["png"], false).unwrap();
        assert!(reader.tracks("data/hulls/next.ship"));
        assert!(!reader.tracks("data/hulls/archive.zip"));
        assert!(!reader.tracks("graphics/sample.png"));
    }
    assert_eq!(work_counts::count("read", &ship), 1);
    assert_eq!(work_counts::count("walk", &root.join("data/hulls")), 1);
    assert_eq!(work_counts::count("read", &ignored), 0);
    assert_eq!(work_counts::count("read", &image), 0);
    root.close().unwrap();
}

#[test]
fn source_rescan_observes_catalog_membership_and_keeps_media_unread() {
    let root = project_workspace("scoped_catalog_changes");
    fs::create_dir_all(root.join("graphics")).unwrap();
    let image = root.join("graphics/sample.png");
    let archive = root.join("graphics/archive.zip");
    fs::write(&image, b"before").unwrap();
    fs::write(&archive, b"archive").unwrap();
    let mut reader = SourceReader::new(&root).unwrap();
    reader.discover("graphics", &["png"], false).unwrap();
    reader.begin_batch();
    assert!(reader.rescan_paths().unwrap().is_empty());
    for exists in [false, true] {
        if exists {
            fs::write(&image, b"after").unwrap();
        } else {
            fs::remove_file(&image).unwrap();
        }
        reader.begin_batch();
        assert_eq!(reader.rescan_paths().unwrap(), vec!["graphics"]);
        reader.begin_batch();
        assert!(reader.rescan_paths().unwrap().is_empty());
    }
    assert_eq!(work_counts::count("read", &image), 0);
    assert_eq!(work_counts::count("read", &archive), 0);
    root.close().unwrap();
}

#[test]
fn session_startup_captures_consumed_sources_and_full_mission_dependencies() {
    let root = project_workspace("scoped_session_credentials");
    fs::create_dir_all(root.join("data/missions/sample")).unwrap();
    fs::create_dir_all(root.join("data/unused")).unwrap();
    fs::create_dir_all(root.join("graphics")).unwrap();
    let mission = root.join("data/missions/sample/logic.java");
    let archive = root.join("data/unused/archive.zip");
    let image = root.join("graphics/image.png");
    fs::write(&mission, b"mission source").unwrap();
    fs::write(&archive, b"archive").unwrap();
    fs::write(&image, b"image").unwrap();
    let manifest =
        open_project_session_traced(&root, None, &mut PerformanceTrace::new("scope.startup"))
            .unwrap();
    assert_eq!(work_counts::count("read", &archive), 0);
    assert_eq!(work_counts::count("read", &image), 0);
    let changed = refresh_mod_root_sources(
        &manifest.mod_root,
        slice::from_ref(&manifest.session_id),
        &[],
        true,
    )
    .unwrap();
    assert_eq!(changed.session_updates.len(), 1);
    assert_eq!(work_counts::count("read", &archive), 0);
    assert_eq!(work_counts::count("read", &image), 0);
    release_project_session(manifest.session_id).unwrap();
    root.close().unwrap();
}
