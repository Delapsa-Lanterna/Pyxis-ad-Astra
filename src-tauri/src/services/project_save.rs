use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::models::{
    EntityIdentityChange, EntityKind, FileChangeReplayDirection, SaveAction, SaveEdit, SaveRequest,
    WriteContent, WriteResult,
};
use crate::services::project::write::{
    config_entity, csv_patch, entity_write::content, joint_edit, json_recovery,
};
use crate::services::{
    json_file, misc_config, project, project_sync, text_editor, write_transactions,
};
use serde::Serialize;
#[cfg(test)]
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use tauri::async_runtime;

pub async fn submit_project_save(
    owner: String,
    request: SaveRequest,
) -> AppResult<WriteResult<Value>> {
    let (root, session, reason) = match &request.action {
        SaveAction::RefreshProjectSources(input) => (
            project::current_project_manifest(&input.session_id)?.mod_root,
            Some(input.session_id.clone()),
            "refresh",
        ),
        action => {
            let scope = action.scope().expect("file action has a scope");
            let reason = match action {
                SaveAction::ApplyFileChangeSet(input) => match input.direction {
                    FileChangeReplayDirection::Undo => "undo",
                    FileChangeReplayDirection::Redo => "redo",
                },
                _ => "save",
            };
            (
                scope.mod_root().to_owned(),
                scope.session_id().cloned(),
                reason,
            )
        }
    };
    let task = project_sync::enqueue(&owner, request.id, &root, session.as_deref())?;
    async_runtime::spawn_blocking(move || {
        let result = project_sync::execute_queued(
            task,
            &root,
            session.as_deref(),
            reason,
            |identities, versions| {
                let mut action = request.action.clone();
                let _lease =
                    project_sync::prepare_versions(&root, action.versions(), versions, identities)?;
                prepare_save_action(&mut action, &request.edits, identities)?;
                execute_save_action(action)
            },
        )?;
        if let Err(error) =
            project::reference_sources_changed(session.as_deref()).and_then(|sources| {
                if let Some(sources) = sources {
                    project_sync::publish_references(sources, project::reference_updates()?)?;
                }
                Ok(())
            })
        {
            diagnostics::failure(
                "save.reference_delivery_failed",
                error,
                json!({"modRoot":root,"sessionId":session}),
            );
        }
        Ok(result)
    })
    .await
    .map_err(|error| AppError::message("write.execution_wait", error.to_string()))?
}
fn prepare_save_action(
    action: &mut SaveAction,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    match action {
        SaveAction::SaveEditorSpec(input) => content::prepare_spec_save(input, edits, identities),
        SaveAction::SaveTextFile(input) => text_editor::prepare_text_save(input, identities),
        SaveAction::SaveCsvPatch(input) => csv_patch::prepare_csv_save(input, edits),
        SaveAction::SaveJointEdit(input) => {
            joint_edit::prepare_joint_save(input, edits, identities)
        }
        SaveAction::SaveModInfo(input) => config_entity::prepare_mod_save(input, edits),
        SaveAction::SaveIndexedConfigEntity(input) => {
            config_entity::prepare_indexed_request(input, edits, identities)
        }
        SaveAction::SaveVariantEntity(input) => {
            json_file::prepare_file_save(input, edits, identities, EntityKind::Variant)
        }
        SaveAction::SaveSkinEntity(input) => {
            json_file::prepare_file_save(input, edits, identities, EntityKind::Skin)
        }
        SaveAction::SaveMiscConfig(input) => misc_config::prepare_misc_save(input, edits),
        _ => Ok(()),
    }
}
pub(crate) fn execute_save_action(mut action: SaveAction) -> AppResult<WriteResult<Value>> {
    match action {
        SaveAction::ApplyFileChangeSet(input) => {
            return json_result(write_transactions::replay(
                &input.session_id,
                &input.mod_root,
                input.direction,
                input.entry_id,
                input.revision,
            )?);
        }
        SaveAction::RefreshProjectSources(input) => {
            return json_result(project::refresh_root_sources(
                &input.session_id,
                input.sources,
            )?);
        }
        _ => {}
    }
    let versions = action.versions().to_vec();
    let transaction =
        write_transactions::begin(action.scope().expect("file action scope"), &versions)?;
    let (result, label) = match action {
        SaveAction::SaveEditorSpec(input) => (
            json_result(content::write_spec_request(input)?)?,
            "保存编辑器规格",
        ),
        SaveAction::SaveTextFile(input) => (
            text_editor::save_project_text_file(&input.mod_root, &input.path, input.text)?,
            "保存文本",
        ),
        SaveAction::TranscodeFileToUtf8(input) => (
            json_result(text_editor::transcode_file_to_utf8(
                &input.mod_root,
                &input.path,
                &input.encoding,
            )?)?,
            "转换文本编码",
        ),
        SaveAction::SaveCsvPatch(input) => (
            json_result(csv_patch::write_csv_request(input)?)?,
            "保存 CSV",
        ),
        SaveAction::SaveJointEdit(input) => (
            json_result(joint_edit::save_joint_edit(&input)?)?,
            "联合保存",
        ),
        SaveAction::SaveModInfo(input) => (config_entity::save_mod_info(input)?, "保存 Mod 信息"),
        SaveAction::SaveIndexedConfigEntity(input) => {
            (config_entity::write_indexed_request(input)?, "保存配置实体")
        }
        SaveAction::CreateIndexedConfigEntity(input) => (
            config_entity::create_indexed_request(input)?,
            "创建配置实体",
        ),
        SaveAction::DeleteIndexedConfigEntity(input) => (
            config_entity::delete_indexed_request(input)?,
            "删除配置实体",
        ),
        SaveAction::SaveVariantEntity(input) => {
            (json_file::write_variant_request(input)?, "保存装配")
        }
        SaveAction::CreateVariantEntity(input) => (
            json_file::create_entity_request(input, EntityKind::Variant)?,
            "创建装配",
        ),
        SaveAction::DeleteVariantEntity(input) => (
            json_result(json_file::delete_entity_request(
                input,
                EntityKind::Variant,
            )?)?,
            "删除装配",
        ),
        SaveAction::SaveSkinEntity(input) => (json_file::write_skin_request(input)?, "保存皮肤"),
        SaveAction::CreateSkinEntity(input) => (
            json_file::create_entity_request(input, EntityKind::Skin)?,
            "创建皮肤",
        ),
        SaveAction::DeleteSkinEntity(input) => (
            json_result(json_file::delete_entity_request(input, EntityKind::Skin)?)?,
            "删除皮肤",
        ),
        SaveAction::RecreateJsonSources(input) => (
            json_result(json_recovery::restore_source_request(input)?)?,
            "重新创建 JSON 来源",
        ),
        SaveAction::SaveMiscConfig(input) => {
            (misc_config::write_misc_request(input)?, "保存杂项配置")
        }
        SaveAction::DeleteMiscConfig(input) => (
            json_result(misc_config::delete_misc_config(
                &input.mod_root,
                input.kind,
                &input.base_versions,
            )?)?,
            "删除杂项配置",
        ),
        SaveAction::ApplyFileChangeSet(_) | SaveAction::RefreshProjectSources(_) => {
            unreachable!("non-file action returned before transaction")
        }
    };
    transaction.commit(result, label)
}
fn json_result<T: Serialize>(result: WriteResult<T>) -> AppResult<WriteResult<Value>> {
    Ok(WriteResult {
        session_updates: result.session_updates,
        identity_changes: result.identity_changes,
        changes: result.changes,
        invalidation: result.invalidation,
        key_map: result.key_map,
        content: result
            .content
            .map(|content| {
                serde_json::to_value(content.value).map(|value| WriteContent {
                    target: content.target,
                    value,
                })
            })
            .transpose()?,
        base_versions: result.base_versions,
        history: result.history,
    })
}
#[cfg(test)]
pub fn execute_typed_save<T: DeserializeOwned>(action: SaveAction) -> AppResult<WriteResult<T>> {
    Ok(serde_json::from_value(serde_json::to_value(
        execute_save_action(action)?,
    )?)?)
}

#[cfg(test)]
mod tests {
    use crate::test_support::file_formats;

    use crate::services;
    use crate::services::project_sync::release_project_session;

    use super::*;
    #[cfg(test)]
    use crate::io;
    use crate::models::*;
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use crate::services::{project, project_sync};
    #[cfg(test)]
    use std::collections::BTreeSet;
    use std::io::ErrorKind;
    use std::path::Path;
    use std::sync::mpsc;
    use std::time::Duration;
    #[cfg(test)]
    use std::{fs, thread};
    use tauri::Error;
    #[cfg(test)]
    use tauri::async_runtime;
    #[cfg(test)]
    use tauri::ipc::{Channel, InvokeResponseBody};

    #[test]
    fn ordinary_save_recreates_captured_text_spec_json_and_complete_csv() {
        for kind in [
            "text",
            "spec",
            "variant",
            "skin",
            "mod-info",
            "csv",
            "faction",
            "mission-descriptor",
            "mission-text",
            "mission-index",
        ] {
            let root = project_workspace(&format!("missing_save_{kind}"));
            for directory in [
                "data/hulls",
                "data/variants",
                "data/hulls/skins",
                "data/world/factions",
                "data/missions/a",
            ] {
                fs::create_dir_all(root.join(directory)).unwrap();
            }
            for (relative, text) in [
                ("notes.txt", "original"),
                ("mod_info.json", r#"{"id":"example","name":"Original"}"#),
                (
                    "data/world/factions/a.faction",
                    r#"{"id":"a","displayName":"Original"}"#,
                ),
                (
                    "data/world/factions/factions.csv",
                    "id,file,custom\na,data/world/factions/a.faction,001\nb,data/world/factions/b.faction,002\n",
                ),
                ("data/missions/a/descriptor.json", r#"{"title":"Original"}"#),
                ("data/missions/a/mission_text.txt", "Original text"),
                ("data/missions/a/extra.js", "untouched"),
                (
                    "data/missions/mission_list.csv",
                    "mission,custom\na,001\nb,002\n",
                ),
                (
                    "data/hulls/a.ship",
                    r#"{"hullId":"a","hullName":"Original","width":10}"#,
                ),
                (
                    "data/variants/a.variant",
                    r#"{"variantId":"a","hullId":"a","fluxVents":1}"#,
                ),
                (
                    "data/hulls/skins/a.skin",
                    r#"{"skinHullId":"a","baseHullId":"a","hullName":"Original"}"#,
                ),
                (
                    "data/hulls/ship_data.csv",
                    "id,name,custom\na,Original,001\nb,Other,002\n#note,Comment,003\n",
                ),
            ] {
                fs::write(root.join(relative), text).unwrap();
            }
            let manifest = project::open_project_session_traced(
                &root,
                None,
                &mut PerformanceTrace::new("missing.save"),
            )
            .unwrap();
            let (action, relative) = match kind {
                "text" => (
                    SaveAction::SaveTextFile(TextSave {
                        session_id: Some(manifest.session_id.clone()),
                        mod_root: manifest.mod_root.clone(),
                        path: root.join("notes.txt").to_string_lossy().into(),
                        text: "Captured text".into(),
                        base_versions: vec![io::file_version(&root.join("notes.txt")).unwrap()],
                    }),
                    "notes.txt",
                ),
                "spec" => {
                    let info = services::query_entity_edit_target(
                        &manifest.session_id,
                        EntityKind::Ship,
                        "a",
                    )
                    .unwrap();
                    (
                        SaveAction::SaveEditorSpec(SpecSave {
                            session_id: manifest.session_id.clone(),
                            mod_root: manifest.mod_root.clone(),
                            target: info.target,
                            base_versions: info.base_versions,
                            document: file_formats::json_write(
                                &(serde_json::json!({"hullId":"a","hullName":"Captured","width":20})),
                            ),
                            json_write: Default::default(),
                        }),
                        "data/hulls/a.ship",
                    )
                }
                "variant" | "skin" => {
                    let entity = if kind == "variant" {
                        EntityKind::Variant
                    } else {
                        EntityKind::Skin
                    };
                    let info =
                        services::query_entity_edit_target(&manifest.session_id, entity, "a")
                            .unwrap();
                    let input = JsonFileSave {
                        session_id: manifest.session_id.clone(),
                        mod_root: manifest.mod_root.clone(),
                        previous_id: Some("a".into()),
                        next_id: "a".into(),
                        rel_path: Some(info.target.write.rel_path),
                        base_versions: info.base_versions,
                        document: file_formats::json_write(
                            &(if kind == "variant" {
                                serde_json::json!({"variantId":"a","hullId":"a","fluxVents":2})
                            } else {
                                serde_json::json!({"skinHullId":"a","baseHullId":"a","hullName":"Captured"})
                            }),
                        ),
                        json_write: Default::default(),
                    };
                    (
                        if kind == "variant" {
                            SaveAction::SaveVariantEntity(input)
                        } else {
                            SaveAction::SaveSkinEntity(input)
                        },
                        if kind == "variant" {
                            "data/variants/a.variant"
                        } else {
                            "data/hulls/skins/a.skin"
                        },
                    )
                }
                "mod-info" => (
                    SaveAction::SaveModInfo(ModInfoSave {
                        session_id: manifest.session_id.clone(),
                        mod_root: manifest.mod_root.clone(),
                        base_versions: manifest.base_versions.clone(),
                        document: file_formats::json_write(
                            &serde_json::json!({"id":"example","name":"Captured","version":"1","gameVersion":"1"}),
                        ),
                        json_write: Default::default(),
                    }),
                    "mod_info.json",
                ),
                "faction" | "mission-descriptor" | "mission-text" | "mission-index" => {
                    let entity = if kind == "faction" {
                        EntityKind::Faction
                    } else {
                        EntityKind::Mission
                    };
                    services::query_entity(&manifest.session_id, entity, "a")
                        .unwrap()
                        .unwrap();
                    let info =
                        services::query_entity_edit_target(&manifest.session_id, entity, "a")
                            .unwrap();
                    (
                        SaveAction::SaveIndexedConfigEntity(IndexedConfigSave {
                            session_id: manifest.session_id.clone(),
                            mod_root: manifest.mod_root.clone(),
                            base_versions: info.base_versions,
                            previous_id: Some("a".into()),
                            next_id: "a".into(),
                            index_row: serde_json::from_value(
                                serde_json::json!({"mission":"a","custom":"001"}),
                            )
                            .unwrap(),
                            content: file_formats::indexed_content(
                                if kind == "faction" {
                                    IndexedConfigKind::Faction
                                } else {
                                    IndexedConfigKind::Mission
                                },
                                &(if kind == "faction" {
                                    serde_json::json!({"file":{
                                        "id":"a","displayName":"Captured","displayNameWithArticle":"a Captured",
                                        "logo":"logo.png","crest":"crest.png","color":[255,255,255,255],
                                        "knownShips":{},"knownFighters":{},"knownWeapons":{},
                                        "factionDoctrine":{"warships":1,"carriers":1,"phaseShips":1,"officerQuality":1,
                                            "shipQuality":1,"numShips":1,"shipSize":1,"aggression":1}
                                    }})
                                } else {
                                    serde_json::json!({"descriptor":{"title":"Captured"},"text":"Captured text"})
                                }),
                            ),
                            json_write: Default::default(),
                        }),
                        match kind {
                            "faction" => "data/world/factions/a.faction",
                            "mission-text" => "data/missions/a/mission_text.txt",
                            "mission-index" => "data/missions/mission_list.csv",
                            _ => "data/missions/a/descriptor.json",
                        },
                    )
                }
                "csv" => {
                    let rows = services::query_csv_table_window(
                        &manifest.session_id,
                        CsvTableKey::Ships,
                        0,
                        1,
                        None,
                        CsvSearchField::IdName,
                    )
                    .unwrap();
                    let mut row = rows.rows[0].data.clone();
                    row.insert("name".into(), "Captured".into());
                    (
                        SaveAction::SaveCsvPatch(CsvSave {
                            session_id: manifest.session_id.clone(),
                            mod_root: manifest.mod_root.clone(),
                            base_versions: rows.base_versions,
                            patches: vec![CsvRowPatch {
                                columns: (row).keys().cloned().collect(),
                                comment_changed: true,

                                row_key: rows.rows[0].row_key.clone(),
                                action: CsvRowPatchAction::Upsert,
                                row,
                                is_comment: false,
                                insert_at: None,
                            }],
                            table: CsvTableKey::Ships,
                            associated_specs: vec![],
                            json_write: Default::default(),
                            row_order: None,
                        }),
                        "data/hulls/ship_data.csv",
                    )
                }
                _ => unreachable!(),
            };
            fs::remove_file(root.join(relative)).unwrap();
            if kind != "text" {
                project::refresh_project_sources(
                    &manifest.session_id,
                    vec![InvalidatedResourceScope {
                        source: ResourceSource::Mod,
                        rel_path: relative.into(),
                    }],
                )
                .unwrap();
            }
            let owner = format!("missing-{kind}");
            let (send, receive) = mpsc::channel();
            project_sync::register(
                &owner,
                Some(manifest.mod_root.clone()),
                Channel::new(move |body| {
                    let InvokeResponseBody::Json(text) = body else {
                        unreachable!()
                    };
                    send.send(serde_json::from_str::<Value>(&text).unwrap())
                        .map_err(|_| Error::Io(ErrorKind::BrokenPipe.into()))?;
                    Ok(())
                }),
            )
            .unwrap();
            let edits = if let SaveAction::SaveCsvPatch(input) = &action {
                vec![file_formats::replace_edit(
                    vec![
                        input.patches[0].row_key.clone(),
                        "data".into(),
                        "name".into(),
                    ],
                    &("Captured".into()),
                )]
            } else {
                vec![file_formats::replace_edit(
                    vec![],
                    &(match &action {
                        SaveAction::SaveModInfo(input) => input.document.content.to_json().unwrap(),
                        SaveAction::SaveEditorSpec(input) => {
                            input.document.content.to_json().unwrap()
                        }
                        SaveAction::SaveIndexedConfigEntity(input) => {
                            input.content.document().content.to_json().unwrap()
                        }
                        _ => Value::Null,
                    }),
                )]
            };
            let request = SaveRequest {
                id: owner.clone(),
                edits,
                action,
            };
            let label = owner.clone();
            let (completed, completion) = mpsc::channel();
            let worker = thread::spawn(move || {
                completed
                    .send(async_runtime::block_on(submit_project_save(label, request)))
                    .map_err(|_| ErrorKind::BrokenPipe)
            });
            // The functional deadline allows file-backed saves to complete under concurrent CI load.
            loop {
                let delivery = receive
                    .recv_timeout(Duration::from_secs(15))
                    .unwrap_or_else(|error| panic!("{kind}: waiting for missing source: {error}"));
                if delivery["kind"] == "missing" {
                    let paths: Vec<String> =
                        serde_json::from_value(delivery["paths"].clone()).unwrap();
                    assert!(paths.iter().any(|path| Path::new(path).ends_with(relative)));
                    project_sync::resolve_sources(&owner, &owner, &paths, true).unwrap();
                    break;
                }
            }
            let result = completion
                .recv_timeout(Duration::from_secs(15))
                .unwrap_or_else(|error| panic!("{kind}: waiting for save completion: {error}"))
                .unwrap();
            worker.join().unwrap().unwrap();
            let delivered = receive
                .try_iter()
                .filter(|delivery| delivery["kind"] == "saved")
                .collect::<Vec<_>>();
            assert_eq!(delivered.len(), 1, "{kind}");
            assert_eq!(result.history.undo_stack.len(), 1, "{kind}");
            assert_eq!(
                result
                    .changes
                    .iter()
                    .map(|change| &change.after_path)
                    .collect::<BTreeSet<_>>()
                    .len(),
                result.changes.len(),
                "{kind}"
            );
            assert!(root.join(relative).is_file(), "{kind}");
            if kind == "text" {
                assert_eq!(
                    fs::read_to_string(root.join(relative)).unwrap(),
                    "Captured text"
                );
            }
            if kind == "spec" {
                assert_eq!(
                    file_formats::read_json_value(&root.join(relative)).unwrap()["width"],
                    20
                );
            }
            if kind == "variant" {
                assert_eq!(
                    file_formats::read_json_value(&root.join(relative)).unwrap()["fluxVents"],
                    2
                );
            }
            if kind == "skin" {
                assert_eq!(
                    file_formats::read_json_value(&root.join(relative)).unwrap()["hullName"],
                    "Captured"
                );
            }
            if kind == "mod-info" {
                assert_eq!(
                    file_formats::read_json_value(&root.join(relative)).unwrap()["name"],
                    "Captured"
                );
            }
            if kind == "csv" {
                let table = file_formats::read_csv_table(&root.join(relative)).unwrap();
                assert_eq!(table.rows.len(), 3);
                assert_eq!(table.rows[0].data["name"], "Captured");
                assert_eq!(table.rows[1].data["custom"], "002");
                assert!(table.rows[2].is_comment);
            }
            if kind == "faction" {
                assert_eq!(
                    file_formats::read_json_value(&root.join(relative)).unwrap()["displayName"],
                    "Captured"
                );
            }
            if kind.starts_with("mission-") {
                assert_eq!(
                    file_formats::read_json_value(&root.join("data/missions/a/descriptor.json"))
                        .unwrap()["title"],
                    "Captured"
                );
                assert_eq!(
                    fs::read_to_string(root.join("data/missions/a/mission_text.txt")).unwrap(),
                    "Captured text"
                );
                assert_eq!(
                    fs::read_to_string(root.join("data/missions/a/extra.js")).unwrap(),
                    "untouched"
                );
                assert_eq!(
                    file_formats::read_csv_table(&root.join("data/missions/mission_list.csv"))
                        .unwrap()
                        .rows[1]
                        .data["custom"],
                    "002"
                );
            }
            project_sync::wait_projects(&[manifest.mod_root]).unwrap();
            project_sync::release_window(&owner).unwrap();
            release_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}
