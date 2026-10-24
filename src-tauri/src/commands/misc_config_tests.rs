#![cfg(test)]

use crate::{
    commands::{
        delete_misc_config, prepare_json_source_recovery, query_misc_config_file,
        query_misc_config_files, recreate_json_sources, save_misc_config,
    },
    io::file_version,
    models::{
        FileChangeReplayDirection, FileVersion, JsonDocumentOrigin, JsonRecoveryRequest,
        MiscConfigDelete, MiscConfigKind, MiscConfigRead, MiscConfigScope, MiscConfigWrite,
        RecreateJsonSourcesPayload,
    },
    services::{project, write_transactions},
    testutil::temp_dir,
};
use serde_json::{Value, json};
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    scope: MiscConfigScope,
}
#[test]
#[cfg(windows)]
fn reject_linked_source() {
    let (root, outside, link) =
        crate::testutil::temp_junction_dir("misc_config_boundary", "data/strings");
    let mod_root = root.to_string_lossy().into_owned();
    let entries = crate::services::misc_config::query_misc_config_files(&mod_root).unwrap();
    assert_eq!(
        entries.len(),
        crate::domain::misc_config::MISC_CONFIG_FILES.len()
    );
    assert!(matches!(
        entries[0].state,
        crate::models::MiscConfigState::Error
    ));
    assert_eq!(
        entries[0].error.as_ref().unwrap().code,
        "path.link_rejected"
    );
    assert_eq!(
        crate::services::misc_config::query_misc_config_file(&mod_root, MiscConfigKind::Strings)
            .unwrap_err()
            .code(),
        "path.link_rejected"
    );
    let result = crate::services::misc_config::save_misc_config(
        MiscConfigWrite {
            kind: MiscConfigKind::Strings,
            session_id: "boundary-fixture".into(),
            mod_root,
            data: json!({}),
            ordered_json: "{}".into(),
            json_write: Default::default(),
            base_versions: vec![],
        },
        None,
    );
    assert_eq!(result.unwrap_err().code(), "path.link_rejected");
    assert!(!outside.join("strings.json").exists());
    std::fs::remove_dir(link).unwrap();
    std::fs::remove_dir_all(root).unwrap();
    std::fs::remove_dir_all(outside).unwrap();
}
impl Fixture {
    fn new() -> Self {
        let root = temp_dir("misc_config");
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        Self {
            root,
            scope: MiscConfigScope {
                session_id: manifest.session_id,
                mod_root: manifest.mod_root,
            },
        }
    }
    fn path(&self) -> PathBuf {
        self.root.join("data/strings/strings.json")
    }
    fn read(&self) -> Result<Option<crate::models::MiscConfigFile>, crate::errors::AppError> {
        query_misc_config_file(MiscConfigRead {
            session_id: self.scope.session_id.clone(),
            mod_root: self.scope.mod_root.clone(),
            kind: MiscConfigKind::Strings,
        })
    }
    fn save(
        &self,
        data: Value,
        base_versions: Vec<FileVersion>,
    ) -> Result<crate::models::WriteResult<Value>, crate::errors::AppError> {
        save_misc_config(MiscConfigWrite {
            session_id: self.scope.session_id.clone(),
            mod_root: self.scope.mod_root.clone(),
            kind: MiscConfigKind::Strings,
            ordered_json: data.to_string(),
            data,
            base_versions,
            json_write: crate::models::JsonWriteOptions {
                preserve_original_json: true,
                confirmed_sources: vec![],
            },
        })
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        project::close_project_session(self.scope.session_id.clone()).unwrap();
        std::fs::remove_dir_all(&self.root).unwrap();
    }
}

#[test]
fn create_edit_delete_history() {
    let f = Fixture::new();
    let directory = query_misc_config_files(f.scope.clone()).unwrap();
    assert_eq!(
        directory.len(),
        crate::domain::misc_config::MISC_CONFIG_FILES.len()
    );
    assert!(matches!(
        directory[0].state,
        crate::models::MiscConfigState::Missing
    ));
    assert!(f.read().unwrap().is_none());
    let missing = file_version(&f.path()).unwrap();
    assert_eq!(
        f.save(json!({}), vec![]).unwrap_err().code(),
        "write.version_scope_missing"
    );
    let created = f.save(json!({}), vec![missing.clone()]).unwrap();
    assert!(f.path().is_file());
    assert_eq!(
        f.save(json!({}), vec![missing]).unwrap_err().code(),
        "write.version_conflict"
    );
    let content = json!({"组.一":{"_句":"001","中文":"  hello\n$token \"quoted\"  "},"other":{}});
    let saved = f.save(content.clone(), created.base_versions).unwrap();
    assert_eq!(f.read().unwrap().unwrap().data, content);
    assert_eq!(
        query_misc_config_files(f.scope.clone()).unwrap()[0].state,
        crate::models::MiscConfigState::Present
    );
    assert!(
        saved
            .invalidation
            .paths
            .iter()
            .any(|path| std::path::Path::new(path) == f.path().canonicalize().unwrap())
    );
    let bytes = std::fs::read(f.path()).unwrap();
    let deleted = delete_misc_config(MiscConfigDelete {
        session_id: f.scope.session_id.clone(),
        mod_root: f.scope.mod_root.clone(),
        kind: MiscConfigKind::Strings,
        base_versions: saved.base_versions,
    })
    .unwrap();
    assert!(!f.path().exists());
    let history = deleted.history;
    let undone = write_transactions::replay(
        &f.scope.session_id,
        &f.scope.mod_root,
        FileChangeReplayDirection::Undo,
        history.undo_stack.last().unwrap().id,
        history.revision,
    )
    .unwrap();
    assert_eq!(std::fs::read(f.path()).unwrap(), bytes);
    let history = undone.history;
    write_transactions::replay(
        &f.scope.session_id,
        &f.scope.mod_root,
        FileChangeReplayDirection::Redo,
        history.redo_stack.last().unwrap().id,
        history.revision,
    )
    .unwrap();
    assert!(!f.path().exists());
}

#[test]
fn comments_shape_scope() {
    let f = Fixture::new();
    std::fs::create_dir_all(f.path().parent().unwrap()).unwrap();
    std::fs::write(
        f.path(),
        "{\n # retained comment\n dialogue:{a:\"001\",b:\"keep\"}\n}\n",
    )
    .unwrap();
    let read = f.read().unwrap().unwrap();
    let saved = f
        .save(
            json!({"dialogue":{"a":"123","b":"keep"}}),
            read.base_versions,
        )
        .unwrap();
    let text = std::fs::read_to_string(f.path()).unwrap();
    assert!(text.contains("# retained comment"));
    assert!(text.find("a:").unwrap() < text.find("b:").unwrap());
    for value in [
        json!([]),
        json!({"dialogue":1}),
        json!({"dialogue":{"a":123}}),
    ] {
        assert_eq!(
            f.save(value, saved.base_versions.clone())
                .unwrap_err()
                .code(),
            "misc_config.shape_invalid"
        );
        assert_eq!(std::fs::read_to_string(f.path()).unwrap(), text);
    }
    let mut scope = f.scope.clone();
    scope.mod_root = f.root.parent().unwrap().to_string_lossy().into();
    assert_eq!(
        query_misc_config_files(scope).unwrap_err().code(),
        "session.mod_root_mismatch"
    );
    std::fs::write(f.path(), "{\n\"dialogue\": [\n}").unwrap();
    assert_eq!(
        query_misc_config_files(f.scope.clone()).unwrap()[0].state,
        crate::models::MiscConfigState::Present
    );
    let error = f.read().unwrap_err();
    assert_eq!(error.code(), "parse.json_syntax");
    let location = error.location().unwrap();
    assert!(location.line.is_some());
    assert_eq!(
        PathBuf::from(location.path.as_ref().unwrap()),
        f.path().canonicalize().unwrap()
    );
    assert!(serde_json::from_value::<MiscConfigKind>(json!("unknownFile")).is_err());
}

#[test]
fn recreate_missing_source() {
    let f = Fixture::new();
    let request = JsonRecoveryRequest {
        session_id: f.scope.session_id.clone(),
        mod_root: f.scope.mod_root.clone(),
        origin: JsonDocumentOrigin::MiscConfig {
            file: MiscConfigKind::Strings,
        },
    };
    let plan = prepare_json_source_recovery(request).unwrap();
    assert_eq!(plan.missing_paths, ["data/strings/strings.json"]);
    let restored = recreate_json_sources(RecreateJsonSourcesPayload {
        session_id: f.scope.session_id.clone(),
        mod_root: f.scope.mod_root.clone(),
        plan,
        baseline: json!({"file":{"dialogue":{"line":"001"}}}),
    })
    .unwrap();
    assert!(restored.refreshed_entity.unwrap().missing_paths.is_empty());
    assert_eq!(
        f.read().unwrap().unwrap().data,
        json!({"dialogue":{"line":"001"}})
    );
}

#[test]
fn config_formats_replay() {
    for (kind, content) in [
        (
            MiscConfigKind::EngineStyles,
            json!({"SAMPLE": {"engineColor":[255,100,50,255],"contrailMaxSpeedMult":"0.5f","contrailAngularVelocityMult":1,"contrailParticleSizeMult":1,"contrailParticleDuration":1,"type":"SMOKE","extra":{"keep":true}}}),
        ),
        (
            MiscConfigKind::HullStyles,
            json!({"SAMPLE": {"shieldInnerColor":[20,30,40,255],"engineLoopSet":"engine_loop","extra":["keep"]}}),
        ),
        (
            MiscConfigKind::Sounds,
            json!({"simple":[{"file":"sounds/sample.ogg","pitch":1}],"engine_loop":{"sounds":[{"file":"sounds/loop.ogg"}],"SAMPLE":{"pitch":1,"volume":0.5}},"music":{"sample":[{"source":"sounds/music","files":["a.ogg","b.ogg"],"shuffle":true}]}}),
        ),
        (
            MiscConfigKind::Settings,
            json!({"designTypeColors":{"Sample":[20,30,40,255]},"count":12,"enabled":false,"graphics":{"sample":{"icons":["a","b"]}},"extra":null}),
        ),
    ] {
        let f = Fixture::new();
        let path = f
            .root
            .join(crate::domain::misc_config::misc_config_path(kind));
        let read_payload = || MiscConfigRead {
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            kind,
        };
        let save = |data: Value, base_versions| {
            save_misc_config(MiscConfigWrite {
                kind,
                session_id: f.scope.session_id.clone(),
                mod_root: f.scope.mod_root.clone(),
                ordered_json: data.to_string(),
                data,
                base_versions,
                json_write: crate::models::JsonWriteOptions {
                    preserve_original_json: true,
                    confirmed_sources: vec![],
                },
            })
        };
        assert!(query_misc_config_file(read_payload()).unwrap().is_none());
        let created = save(json!({}), vec![file_version(&path).unwrap()]).unwrap();
        let saved = save(content.clone(), created.base_versions).unwrap();
        let source = match kind {
            MiscConfigKind::HullStyles => Some("config:hullStyles"),
            MiscConfigKind::Sounds => Some("config:sounds"),
            MiscConfigKind::Settings => Some("config:designTypes"),
            _ => None,
        };
        let assert_source = |updates: &[crate::models::CommittedSessionUpdate]| {
            if let Some(source) = source {
                assert!(updates.iter().any(|update| matches!(
                    &update.projection,
                    crate::models::CommittedProjection::Ready { projection }
                        if projection.invalidation.query_scopes.iter().any(|scope| scope.source.as_deref() == Some(source))
                )));
            }
        };
        assert_source(&saved.session_updates);
        assert_eq!(
            query_misc_config_file(read_payload())
                .unwrap()
                .unwrap()
                .data,
            content
        );
        let bytes = std::fs::read(&path).unwrap();
        let deleted = delete_misc_config(MiscConfigDelete {
            kind,
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            base_versions: saved.base_versions,
        })
        .unwrap();
        assert_source(&deleted.session_updates);
        assert!(!path.exists());
        let history = deleted.history;
        let undone = write_transactions::replay(
            &f.scope.session_id,
            &f.scope.mod_root,
            FileChangeReplayDirection::Undo,
            history.undo_stack.last().unwrap().id,
            history.revision,
        )
        .unwrap();
        assert_source(&undone.session_updates);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        let plan = prepare_json_source_recovery(JsonRecoveryRequest {
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            origin: JsonDocumentOrigin::MiscConfig { file: kind },
        })
        .unwrap();
        assert!(plan.missing_paths.is_empty());
        let version = file_version(&path).unwrap();
        std::fs::write(&path, b"{}\n").unwrap();
        assert_eq!(
            save(content.clone(), vec![version]).unwrap_err().code(),
            "write.version_conflict"
        );
        std::fs::remove_file(&path).unwrap();
        let plan = prepare_json_source_recovery(JsonRecoveryRequest {
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            origin: JsonDocumentOrigin::MiscConfig { file: kind },
        })
        .unwrap();
        assert_eq!(
            plan.missing_paths,
            [crate::domain::misc_config::misc_config_path(kind)]
        );
        recreate_json_sources(RecreateJsonSourcesPayload {
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            plan,
            baseline: json!({"file":content}),
        })
        .unwrap();
        assert_eq!(
            query_misc_config_file(read_payload())
                .unwrap()
                .unwrap()
                .data,
            content
        );
        std::fs::write(&path, "{\n\"broken\": [\n}").unwrap();
        let error = query_misc_config_file(read_payload()).unwrap_err();
        assert_eq!(error.code(), "parse.json_syntax");
        let location = error.location().unwrap();
        assert!(location.line.is_some());
        assert_eq!(
            PathBuf::from(location.path.as_ref().unwrap()),
            path.canonicalize().unwrap()
        );
    }
}

#[test]
fn config_field_validation() {
    use crate::services::misc_config::validate_misc_config;
    for (kind, value) in [
        (
            MiscConfigKind::EngineStyles,
            json!({"SAMPLE":{"contrailMaxSpeedMult":"1ff"}}),
        ),
        (MiscConfigKind::EngineStyles, json!({"CUSTOM":{}})),
        (
            MiscConfigKind::HullStyles,
            json!({"SAMPLE":{"shieldInnerColor":[0,0,256,255]}}),
        ),
        (MiscConfigKind::Sounds, json!({"sample":[{"file":42}]})),
        (
            MiscConfigKind::Sounds,
            json!({"sample":{"sounds":{},"SAMPLE":{}}}),
        ),
        (
            MiscConfigKind::Sounds,
            json!({"music":{"sample":[{"files":"a.ogg"}]}}),
        ),
        (MiscConfigKind::Settings, json!({"designTypeColors":[]})),
    ] {
        assert_eq!(
            validate_misc_config(kind, &value).unwrap_err().code(),
            "misc_config.shape_invalid"
        );
    }
    for kind in crate::domain::misc_config::MISC_CONFIG_FILES {
        assert!(validate_misc_config(*kind, &json!({})).is_ok());
    }
    for (kind, text) in [
        (
            MiscConfigKind::EngineStyles,
            include_str!("../../../schemas/engine-styles.schema.json"),
        ),
        (
            MiscConfigKind::HullStyles,
            include_str!("../../../schemas/hull-styles.schema.json"),
        ),
    ] {
        let schema = crate::parsers::parse_persisted_json::<Value>(text).unwrap();
        let initial = &schema["root"]["valueSchema"]["default"];
        assert!(validate_misc_config(kind, &json!({"SAMPLE":initial})).is_ok());
    }
    assert!(
        validate_misc_config(
            MiscConfigKind::EngineStyles,
            &json!({"SAMPLE":{"contrailMaxSpeedMult":"-1f","unknown":null}})
        )
        .is_ok()
    );
    assert!(
        validate_misc_config(
            MiscConfigKind::Sounds,
            &json!({"engine_loop":{"SAMPLE":{"pitch":1,"volume":0.5}}})
        )
        .is_ok()
    );
}

#[test]
fn engine_source_preservation() {
    let f = Fixture::new();
    let path = f.root.join("data/config/engine_styles.json");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let source = "{\n # retained style comment\n SAMPLE:{contrailMaxSpeedMult:0.5f,contrailAngularVelocityMult:1,contrailParticleSizeMult:1,contrailParticleDuration:1,type:\"GLOW\",engineColor:[1,2,3,255]}\n}\n";
    std::fs::write(&path, source).unwrap();
    let read = query_misc_config_file(MiscConfigRead {
        kind: MiscConfigKind::EngineStyles,
        session_id: f.scope.session_id.clone(),
        mod_root: f.scope.mod_root.clone(),
    })
    .unwrap()
    .unwrap();
    assert_eq!(read.data["SAMPLE"]["contrailMaxSpeedMult"], "0.5f");
    let mut content = read.data;
    content["SAMPLE"]["engineColor"] = json!([10, 20, 30, 255]);
    save_misc_config(MiscConfigWrite {
        kind: MiscConfigKind::EngineStyles,
        session_id: f.scope.session_id.clone(),
        mod_root: f.scope.mod_root.clone(),
        base_versions: read.base_versions,
        ordered_json: content.to_string(),
        data: content,
        json_write: crate::models::JsonWriteOptions {
            preserve_original_json: true,
            confirmed_sources: vec![],
        },
    })
    .unwrap();
    let saved = std::fs::read_to_string(path).unwrap();
    assert!(saved.contains("# retained style comment"));
    assert!(saved.contains("contrailMaxSpeedMult:0.5f"));
    assert!(saved.find("contrailMaxSpeedMult").unwrap() < saved.find("engineColor").unwrap());
}

#[test]
fn merged_config_save_validation() {
    let mut f = Fixture::new();
    let game = f.root.join("game");
    let config = game.join("starsector-core/data/config");
    std::fs::create_dir_all(&config).unwrap();
    let style = &crate::parsers::bundled_schema("engine-styles")["root"]["valueSchema"]["default"];
    std::fs::write(
        config.join("engine_styles.json"),
        json!({"SAMPLE":style}).to_string(),
    )
    .unwrap();
    std::fs::write(config.join("sounds.json"), json!({"sample":{"sounds":[{"file":"sounds/sample.ogg"}],"FRIGATE":{"pitch":1,"volume":1,"sounds":[0]}}}).to_string()).unwrap();
    project::close_project_session(f.scope.session_id.clone()).unwrap();
    let manifest = project::open_project_session_traced(
        &f.root,
        Some(&game),
        &mut project::PerformanceTrace::new("project.openSession"),
    )
    .unwrap();
    f.scope.session_id = manifest.session_id;
    let save = |kind, data: Value| {
        let path = f
            .root
            .join(crate::domain::misc_config::misc_config_path(kind));
        save_misc_config(MiscConfigWrite {
            session_id: f.scope.session_id.clone(),
            mod_root: f.scope.mod_root.clone(),
            kind,
            base_versions: vec![file_version(&path).unwrap()],
            ordered_json: data.to_string(),
            data,
            json_write: Default::default(),
        })
    };
    let partial = json!({"SAMPLE":{"contrailMaxSpeedMult":"1f"}});
    save(MiscConfigKind::EngineStyles, partial.clone()).unwrap();
    let path = f.root.join("data/config/engine_styles.json");
    assert_eq!(crate::io::read_json_file(&path).unwrap(), partial);
    assert!(
        save(
            MiscConfigKind::EngineStyles,
            json!({"SAMPLE":{"mode":"QUAD_STRIP"}})
        )
        .is_err()
    );
    assert_eq!(crate::io::read_json_file(&path).unwrap(), partial);
    let partial = json!({"sample":{"FRIGATE":{"pitch":1,"volume":2}}});
    save(MiscConfigKind::Sounds, partial.clone()).unwrap();
    let path = f.root.join("data/config/sounds.json");
    assert_eq!(crate::io::read_json_file(&path).unwrap(), partial);
    assert!(
        save(
            MiscConfigKind::Sounds,
            json!({"sample":{"FRIGATE":{"pitch":1,"volume":1,"sounds":[1]}}})
        )
        .is_err()
    );
    assert_eq!(crate::io::read_json_file(&path).unwrap(), partial);
    save(
        MiscConfigKind::Sounds,
        json!({"sample":{"FRIGATE":{"pitch":1,"volume":1,"sounds":["0"]}}}),
    )
    .unwrap();
}
