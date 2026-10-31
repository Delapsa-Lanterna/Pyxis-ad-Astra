use crate::{
    errors::{AppError, AppResult},
    models::{
        EntityIdentityChange, EntityKind, FileChangeReplayDirection, SaveAction, SaveRequest,
        WriteResult,
    },
    services,
};
use serde::Serialize;
use serde_json::Value;

pub async fn submit_project_save(
    owner: String,
    request: SaveRequest,
) -> AppResult<WriteResult<Value>> {
    let (root, session_id, reason) = match &request.action {
        SaveAction::RefreshProjectSources(input) => (
            services::project::current_projection(&input.session_id)?
                .manifest
                .mod_root,
            Some(input.session_id.clone()),
            "refresh",
        ),
        action => {
            let scope = action.scope().expect("file action owns its project scope");
            let reason = match action {
                SaveAction::ApplyFileChangeSet(input) => match input.direction {
                    FileChangeReplayDirection::Undo => "undo",
                    FileChangeReplayDirection::Redo => "redo",
                },
                _ => "save",
            };
            (
                scope.mod_root().to_string(),
                scope.session_id().cloned(),
                reason,
            )
        }
    };
    let work = services::project_sync::enqueue(&owner, request.id, &root, session_id.as_deref())?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = services::project_sync::execute_queued(
            work.clone(),
            &root,
            session_id.as_deref(),
            reason,
            |identities, versions| {
                let mut action = request.action.clone();
                let _lease = services::project_sync::prepare_versions(
                    &root,
                    action.versions(),
                    versions,
                    identities,
                )?;
                prepare_save_action(&mut action, &request.edits, identities)?;
                execute_save_action(action)
            },
        )?;
        // Reference delivery must preserve the outcome of the completed file transaction.
        if let Err(error) = services::project::reference_sources_changed(session_id.as_deref())
            .and_then(|snapshot| {
                if let Some(snapshot) = snapshot {
                    services::project_sync::publish_references(
                        snapshot,
                        services::project::reference_updates()?,
                    )?;
                }
                Ok(())
            })
        {
            crate::diagnostics::record(format!("reference refresh delivery: {error}"));
        }
        Ok(result)
    })
    .await
    .map_err(|error| AppError::message("write.execution_wait", error.to_string()))?
}

fn prepare_save_action(
    action: &mut SaveAction,
    edits: &[crate::models::SaveEdit],
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    match action {
        SaveAction::SaveEditorSpec(input) => services::prepare_spec_save(input, edits, identities),
        SaveAction::SaveTextFile(input) => {
            services::file_editor::prepare_text_save(input, identities)
        }
        SaveAction::SaveCsvPatch(input) => services::prepare_csv_save(input, edits),
        SaveAction::SaveJointEdit(input) => services::prepare_joint_save(input, edits, identities),
        SaveAction::SaveModInfo(input) => services::config_entity::prepare_mod_save(input, edits),
        SaveAction::SaveIndexedConfigEntity(input) => {
            services::config_entity::prepare_indexed_request(input, edits, identities)
        }
        SaveAction::SaveVariantEntity(input) => {
            services::json_file::prepare_file_save(input, edits, identities, EntityKind::Variant)
        }
        SaveAction::SaveSkinEntity(input) => {
            services::json_file::prepare_file_save(input, edits, identities, EntityKind::Skin)
        }
        SaveAction::SaveMiscConfig(input) => services::misc_config::prepare_misc_save(input, edits),
        _ => Ok(()),
    }
}

pub(crate) fn execute_save_action(mut action: SaveAction) -> AppResult<WriteResult<Value>> {
    let transaction = match &mut action {
        SaveAction::ApplyFileChangeSet(_) | SaveAction::RefreshProjectSources(_) => None,
        file_action => {
            let versions = file_action.versions().to_vec();
            Some(services::write_transactions::begin(
                file_action
                    .scope()
                    .expect("file action owns its project scope"),
                &versions,
            )?)
        }
    };
    let (result, label) = match action {
        SaveAction::SaveEditorSpec(input) => {
            (services::write_spec_request(input)?, "保存编辑器规格")
        }
        SaveAction::SaveTextFile(input) => (
            services::file_editor::save_project_text_file(
                input.session_id.as_deref(),
                &input.mod_root,
                &input.path,
                input.text,
                &input.base_versions,
                input.json_write,
            )?,
            "保存文本",
        ),
        SaveAction::TranscodeFileToUtf8(input) => (
            json_result(services::file_editor::transcode_file_to_utf8(
                &input.mod_root,
                &input.path,
                &input.encoding,
            )?)?,
            "转换文本编码",
        ),
        SaveAction::SaveCsvPatch(input) => (services::write_csv_request(input)?, "保存 CSV"),
        SaveAction::SaveJointEdit(input) => {
            (json_result(services::save_joint_edit(&input)?)?, "联合保存")
        }
        SaveAction::SaveModInfo(input) => (
            services::config_entity::save_mod_info(
                &input.mod_root,
                input.data,
                input.json_write,
                input.ordered_json.as_deref(),
            )?,
            "保存 Mod 信息",
        ),
        SaveAction::SaveIndexedConfigEntity(input) => {
            let label = if input.kind == crate::models::IndexedConfigKind::Faction {
                "保存势力"
            } else {
                "保存配置实体"
            };
            (
                services::config_entity::write_indexed_request(input)?,
                label,
            )
        }
        SaveAction::CreateIndexedConfigEntity(input) => {
            let label = if input.kind == crate::models::IndexedConfigKind::Faction {
                "创建势力"
            } else {
                "创建配置实体"
            };
            (
                services::config_entity::create_indexed_request(input)?,
                label,
            )
        }
        SaveAction::DeleteIndexedConfigEntity(input) => {
            let label = if input.kind == crate::models::IndexedConfigKind::Faction {
                "删除势力"
            } else {
                "删除配置实体"
            };
            (
                services::config_entity::delete_indexed_request(input)?,
                label,
            )
        }
        SaveAction::SaveVariantEntity(input) => (
            services::json_file::write_variant_request(input)?,
            "保存装配",
        ),
        SaveAction::CreateVariantEntity(input) => (
            services::json_file::create_entity_request(input, EntityKind::Variant)?,
            "创建装配",
        ),
        SaveAction::DeleteVariantEntity(input) => (
            json_result(services::json_file::delete_entity_request(
                input,
                EntityKind::Variant,
            )?)?,
            "删除装配",
        ),
        SaveAction::SaveSkinEntity(input) => {
            (services::json_file::write_skin_request(input)?, "保存皮肤")
        }
        SaveAction::CreateSkinEntity(input) => (
            services::json_file::create_entity_request(input, EntityKind::Skin)?,
            "创建皮肤",
        ),
        SaveAction::DeleteSkinEntity(input) => (
            json_result(services::json_file::delete_entity_request(
                input,
                EntityKind::Skin,
            )?)?,
            "删除皮肤",
        ),
        SaveAction::RecreateJsonSources(input) => (
            json_result(services::restore_source_request(input)?)?,
            "重新创建 JSON 来源",
        ),
        SaveAction::SaveMiscConfig(input) => (
            services::misc_config::write_misc_request(input)?,
            "保存杂项配置",
        ),
        SaveAction::DeleteMiscConfig(input) => (
            json_result(services::misc_config::delete_misc_config(
                &input.mod_root,
                input.kind,
                &input.base_versions,
            )?)?,
            "删除杂项配置",
        ),
        SaveAction::ApplyFileChangeSet(input) => {
            return json_result(services::write_transactions::replay(
                &input.session_id,
                &input.mod_root,
                input.direction,
                input.entry_id,
                input.revision,
            )?);
        }
        SaveAction::RefreshProjectSources(input) => {
            let projection =
                services::project::refresh_project_sources(&input.session_id, input.sources)?;
            let mut result = WriteResult::from_changes(Vec::new());
            result.invalidation = projection.invalidation.clone();
            result
                .session_updates
                .push(crate::models::CommittedSessionUpdate {
                    session_id: input.session_id,
                    mod_root: projection.manifest.mod_root.clone(),
                    projection: std::sync::Arc::new(projection),
                });
            return json_result(result);
        }
    };
    transaction
        .expect("file mutation opens its transaction")
        .commit(result, label)
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
                serde_json::to_value(content.value).map(|value| crate::models::WriteContent {
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
pub fn execute_typed_save<T: serde::de::DeserializeOwned>(
    action: crate::models::SaveAction,
) -> AppResult<WriteResult<T>> {
    let result = execute_save_action(action)?;
    Ok(serde_json::from_value(serde_json::to_value(result)?)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::*;
    use crate::services::project::test_support::project_workspace;
    use std::{path::Path, sync::mpsc, time::Duration};

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
                std::fs::create_dir_all(root.join(directory)).unwrap();
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
                std::fs::write(root.join(relative), text).unwrap();
            }
            let manifest = services::project::open_project_session_traced(
                &root,
                None,
                &mut services::project::PerformanceTrace::new("missing.save"),
            )
            .unwrap();
            let (action, relative) = match kind {
                "text" => (
                    SaveAction::SaveTextFile(TextSave {
                        json_write: Default::default(),
                        session_id: Some(manifest.session_id.clone()),
                        mod_root: manifest.mod_root.clone(),
                        path: root.join("notes.txt").to_string_lossy().into(),
                        text: "Captured text".into(),
                        base_versions: vec![
                            crate::io::file_version(&root.join("notes.txt")).unwrap(),
                        ],
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
                            data: serde_json::json!({"hullId":"a","hullName":"Captured","width":20}),
                            json_write: Default::default(),
                            ordered_json: None,
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
                        data: if kind == "variant" {
                            serde_json::json!({"variantId":"a","hullId":"a","fluxVents":2})
                        } else {
                            serde_json::json!({"skinHullId":"a","baseHullId":"a","hullName":"Captured"})
                        },
                        json_write: Default::default(),
                        ordered_json: None,
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
                        data: serde_json::json!({"id":"example","name":"Captured"}),
                        json_write: Default::default(),
                        ordered_json: None,
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
                            kind: if kind == "faction" {
                                IndexedConfigKind::Faction
                            } else {
                                IndexedConfigKind::Mission
                            },
                            index_row: serde_json::from_value(
                                serde_json::json!({"mission":"a","custom":"001"}),
                            )
                            .unwrap(),
                            entity_data: if kind == "faction" {
                                serde_json::json!({"file":{"id":"a","displayName":"Captured"}})
                            } else {
                                serde_json::json!({"descriptor":{"title":"Captured"},"text":"Captured text"})
                            },
                            json_write: Default::default(),
                            ordered_json: None,
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
            std::fs::remove_file(root.join(relative)).unwrap();
            if kind != "text" {
                services::project::refresh_project_sources(
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
            services::project_sync::register(
                &owner,
                Some(manifest.mod_root.clone()),
                tauri::ipc::Channel::new(move |body| {
                    let tauri::ipc::InvokeResponseBody::Json(text) = body else {
                        unreachable!()
                    };
                    send.send(serde_json::from_str::<Value>(&text).unwrap())
                        .unwrap();
                    Ok(())
                }),
            )
            .unwrap();
            let edits = if let SaveAction::SaveCsvPatch(input) = &action {
                vec![SaveEdit::Set {
                    path: vec![
                        input.patches[0].row_key.clone(),
                        "data".into(),
                        "name".into(),
                    ],
                    value: "Captured".into(),
                }]
            } else {
                vec![SaveEdit::Set {
                    path: vec![],
                    value: match &action {
                        SaveAction::SaveModInfo(input) => input.data.clone(),
                        SaveAction::SaveEditorSpec(input) => input.data.clone(),
                        _ => Value::Null,
                    },
                }]
            };
            let request = SaveRequest {
                id: owner.clone(),
                edits,
                action,
            };
            let label = owner.clone();
            let (completed, completion) = mpsc::channel();
            let worker = std::thread::spawn(move || {
                completed
                    .send(tauri::async_runtime::block_on(submit_project_save(
                        label, request,
                    )))
                    .unwrap();
            });
            loop {
                let delivery = receive.recv_timeout(Duration::from_secs(5)).unwrap();
                if delivery["kind"] == "missing" {
                    let paths: Vec<String> =
                        serde_json::from_value(delivery["paths"].clone()).unwrap();
                    assert!(paths.iter().any(|path| Path::new(path).ends_with(relative)));
                    services::project_sync::resolve_sources(&owner, &owner, &paths, true).unwrap();
                    break;
                }
            }
            let result = completion
                .recv_timeout(Duration::from_secs(5))
                .unwrap()
                .unwrap();
            worker.join().unwrap();
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
                    .collect::<std::collections::BTreeSet<_>>()
                    .len(),
                result.changes.len(),
                "{kind}"
            );
            assert!(root.join(relative).is_file(), "{kind}");
            if kind == "text" {
                assert_eq!(
                    std::fs::read_to_string(root.join(relative)).unwrap(),
                    "Captured text"
                );
            }
            if kind == "spec" {
                assert_eq!(
                    crate::io::read_json_file(&root.join(relative)).unwrap()["width"],
                    20
                );
            }
            if kind == "variant" {
                assert_eq!(
                    crate::io::read_json_file(&root.join(relative)).unwrap()["fluxVents"],
                    2
                );
            }
            if kind == "skin" {
                assert_eq!(
                    crate::io::read_json_file(&root.join(relative)).unwrap()["hullName"],
                    "Captured"
                );
            }
            if kind == "mod-info" {
                assert_eq!(
                    crate::io::read_json_file(&root.join(relative)).unwrap()["name"],
                    "Captured"
                );
            }
            if kind == "csv" {
                let table = crate::io::read_csv_data(&root.join(relative)).unwrap();
                assert_eq!(table.rows.len(), 3);
                assert_eq!(table.rows[0].data["name"], "Captured");
                assert_eq!(table.rows[1].data["custom"], "002");
                assert!(table.rows[2].is_comment);
            }
            if kind == "faction" {
                assert_eq!(
                    crate::io::read_json_file(&root.join(relative)).unwrap()["displayName"],
                    "Captured"
                );
            }
            if kind.starts_with("mission-") {
                assert_eq!(
                    crate::io::read_json_file(&root.join("data/missions/a/descriptor.json"))
                        .unwrap()["title"],
                    "Captured"
                );
                assert_eq!(
                    std::fs::read_to_string(root.join("data/missions/a/mission_text.txt")).unwrap(),
                    "Captured text"
                );
                assert_eq!(
                    std::fs::read_to_string(root.join("data/missions/a/extra.js")).unwrap(),
                    "untouched"
                );
                assert_eq!(
                    crate::io::read_csv_data(&root.join("data/missions/mission_list.csv"))
                        .unwrap()
                        .rows[1]
                        .data["custom"],
                    "002"
                );
            }
            services::project_sync::wait_projects(&[manifest.mod_root]).unwrap();
            services::project_sync::release_window(&owner).unwrap();
            services::project::close_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}
