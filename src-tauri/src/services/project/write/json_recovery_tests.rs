#![cfg(test)]

use crate::{
    commands::prepare_json_source_recovery,
    models::{
        EntityKind, JsonDocumentOrigin, JsonRecoveryRequest, JsonSourceIdentity, JsonSourceRestore,
    },
    services::{project, query_entity},
    testutil::temp_dir,
};
use serde_json::{Value, json};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    request: JsonRecoveryRequest,
    baseline: Value,
    paths: Vec<String>,
}
impl Fixture {
    fn new(kind: &str) -> Self {
        let root = temp_dir("json_recovery");
        let (origin, baseline, files) = match kind {
            "modInfo" => (
                JsonDocumentOrigin::ModInfo,
                json!({"file":{"id":"sample","name":"Saved"}}),
                vec![("mod_info.json", "{\"id\":\"sample\",\"name\":\"Saved\"}")],
            ),
            "variant" => (
                entity(EntityKind::Variant, "data/variants/nested/original.variant"),
                json!({"variantId":"sample","hullId":"hull","displayName":"Saved"}),
                vec![(
                    "data/variants/nested/original.variant",
                    "{\"variantId\":\"sample\",\"hullId\":\"hull\",\"displayName\":\"Saved\"}",
                )],
            ),
            "skin" => (
                entity(EntityKind::Skin, "data/hulls/skins/nested/original.skin"),
                json!({"skinHullId":"sample","baseHullId":"hull","name":"Saved"}),
                vec![(
                    "data/hulls/skins/nested/original.skin",
                    "{\"skinHullId\":\"sample\",\"baseHullId\":\"hull\",\"name\":\"Saved\"}",
                )],
            ),
            "faction" => (
                entity(
                    EntityKind::Faction,
                    "data/world/factions/nested/original.faction",
                ),
                json!({"file":{"id":"sample","displayName":"Saved"}}),
                vec![
                    (
                        "data/world/factions/nested/original.faction",
                        "{\"id\":\"sample\",\"displayName\":\"Saved\"}",
                    ),
                    (
                        "data/world/factions/factions.csv",
                        "id,file,note
sample,data/world/factions/nested/original.faction,kept
other,data/world/factions/other.faction,unrelated
",
                    ),
                ],
            ),
            "mission" => (
                entity(EntityKind::Mission, "data/missions/sample"),
                json!({"list":{"mission":"sample","custom":"kept"},"descriptor":{"title":"Saved"},"text":{"content":"Saved text"}}),
                vec![
                    (
                        "data/missions/sample/descriptor.json",
                        "{\"title\":\"Saved\"}",
                    ),
                    ("data/missions/sample/mission_text.txt", "Saved text"),
                    (
                        "data/missions/mission_list.csv",
                        "mission,custom
sample,kept
other,unrelated
",
                    ),
                ],
            ),
            _ => unreachable!(),
        };
        for (relative, text) in &files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        if let JsonDocumentOrigin::Entity { target } = &origin {
            query_entity(&manifest.session_id, target.kind, &target.id)
                .unwrap()
                .unwrap();
        }
        Self {
            root,
            request: JsonRecoveryRequest {
                session_id: manifest.session_id,
                mod_root: manifest.mod_root,
                origin,
            },
            baseline,
            paths: files.iter().map(|(path, _)| path.to_string()).collect(),
        }
    }
    fn restore(
        &self,
        plan: crate::models::JsonRecoveryPlan,
    ) -> Result<crate::models::WriteResult<crate::models::JsonRecoveryPlan>, crate::errors::AppError>
    {
        crate::testutil::commit_saved::<crate::models::JsonRecoveryPlan>(
            crate::models::SaveAction::RecreateJsonSources(JsonSourceRestore {
                session_id: self.request.session_id.clone(),
                mod_root: self.request.mod_root.clone(),
                plan,
                baseline: self.baseline.clone(),
            }),
        )
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        project::close_project_session(self.request.session_id.clone()).unwrap();
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}
fn entity(kind: EntityKind, relative: &str) -> JsonDocumentOrigin {
    JsonDocumentOrigin::Entity {
        target: JsonSourceIdentity {
            kind,
            id: "sample".into(),
            rel_path: Some(relative.into()),
        },
    }
}
#[test]
fn restore_sources_and_history() {
    for kind in ["modInfo", "variant", "skin", "faction", "mission"] {
        let count = if kind == "mission" {
            3
        } else if kind == "faction" {
            2
        } else {
            1
        };
        for mask in 1..(1 << count) {
            let fixture = Fixture::new(kind);
            let original = fixture
                .paths
                .iter()
                .map(|path| std::fs::read(fixture.root.join(path)).unwrap())
                .collect::<Vec<_>>();
            let missing = fixture
                .paths
                .iter()
                .enumerate()
                .filter(|(index, _)| mask & (1 << index) != 0)
                .map(|(_, path)| path.clone())
                .collect::<Vec<_>>();
            for path in &missing {
                std::fs::remove_file(fixture.root.join(path)).unwrap();
            }
            let plan = prepare_json_source_recovery(fixture.request.clone()).unwrap();
            assert_eq!(plan.missing_paths, missing, "{kind}: {mask}");
            let result = fixture.restore(plan).unwrap();
            assert!(
                result
                    .content
                    .as_ref()
                    .unwrap()
                    .value
                    .missing_paths
                    .is_empty(),
                "{kind}: {mask}"
            );
            assert_eq!(result.changes.len(), missing.len(), "{kind}: {mask}");
            for (index, path) in fixture.paths.iter().enumerate() {
                assert!(fixture.root.join(path).is_file(), "{path}");
                if path.ends_with(".csv") {
                    let table = crate::io::read_csv_data(&fixture.root.join(path)).unwrap();
                    assert_eq!(table.rows.len(), 2, "{kind}: shared index");
                    assert!(
                        table
                            .rows
                            .iter()
                            .any(|row| row.data.values().any(|value| value == "unrelated"))
                    );
                }
                if !missing.contains(path) {
                    assert_eq!(
                        std::fs::read(fixture.root.join(path)).unwrap(),
                        original[index]
                    );
                }
            }
            let history = &result.history;
            let entry = history.undo_stack.last().unwrap();
            let undone = crate::services::write_transactions::replay(
                &fixture.request.session_id,
                &fixture.request.mod_root,
                crate::models::FileChangeReplayDirection::Undo,
                entry.id,
                history.revision,
            )
            .unwrap();
            for path in &missing {
                assert!(!fixture.root.join(path).exists());
            }
            let entry = undone.history.redo_stack.last().unwrap();
            crate::services::write_transactions::replay(
                &fixture.request.session_id,
                &fixture.request.mod_root,
                crate::models::FileChangeReplayDirection::Redo,
                entry.id,
                undone.history.revision,
            )
            .unwrap();
            for path in &missing {
                assert!(fixture.root.join(path).is_file());
            }
        }
    }
}
#[test]
fn reject_stale_recovery() {
    for kind in ["modInfo", "variant", "skin", "faction", "mission"] {
        let fixture = Fixture::new(kind);
        std::fs::remove_file(fixture.root.join(&fixture.paths[0])).unwrap();
        let plan = prepare_json_source_recovery(fixture.request.clone()).unwrap();
        std::fs::write(fixture.root.join(&fixture.paths[0]), "{}").unwrap();
        let error = fixture.restore(plan).unwrap_err();
        assert_eq!(error.code(), "write.version_conflict", "{kind}");
        assert_eq!(
            std::fs::read_to_string(fixture.root.join(&fixture.paths[0])).unwrap(),
            "{}"
        );
    }
}
#[test]
fn recovery_snapshot_versions() {
    for kind in ["modInfo", "variant", "skin", "faction", "mission"] {
        let fixture = Fixture::new(kind);
        let plan = prepare_json_source_recovery(fixture.request.clone()).unwrap();
        assert!(plan.missing_paths.is_empty(), "{kind}");
        for path in &fixture.paths {
            let expected = crate::io::file_version(&fixture.root.join(path)).unwrap();
            assert!(plan.base_versions.contains(&expected), "{kind}: {path}");
        }
        if kind == "mission" {
            assert_eq!(plan.current_sources["text"], "Saved text");
            assert_eq!(
                plan.current_sources["index"]["rows"][0]["data"]["custom"],
                "kept"
            );
        } else {
            assert!(plan.current_sources["file"].is_object());
        }
    }
    let fixture = Fixture::new("faction");
    std::fs::write(
        fixture.root.join(&fixture.paths[0]),
        r#"{"id":"sample","crest":"graphics/current.png"}"#,
    )
    .unwrap();
    let plan = prepare_json_source_recovery(fixture.request.clone()).unwrap();
    assert_eq!(plan.resource_refs["crest"].rel_path, "graphics/current.png");
}
#[test]
fn repair_faction_reference() {
    let fixture = Fixture::new("faction");
    let path = fixture.root.join(&fixture.paths[0]);
    let external = "{ \"id\": \"sample\", \"displayName\": \"External\" }";
    std::fs::write(&path, external).unwrap();
    std::fs::write(
        fixture.root.join(&fixture.paths[1]),
        "id,file,note
",
    )
    .unwrap();
    let plan = prepare_json_source_recovery(fixture.request.clone()).unwrap();
    assert_eq!(plan.missing_paths, [fixture.paths[1].clone()]);
    let result = fixture.restore(plan).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), external);
    assert_eq!(
        result.content.unwrap().value.current_sources["file"]["displayName"],
        "External"
    );
}
