use super::super::cache::{lock_session, session_handle};
use crate::{
    errors::{AppError, AppResult},
    io::{
        FsRootBoundary, acquire_root_write_lock, decode_text, file_version, read_versioned_bytes,
        read_versioned_csv, read_versioned_json,
    },
    models::{EntityKind, JsonDocumentOrigin, JsonRecoveryPlan, JsonRecoveryRequest},
};
use serde_json::Value;
use std::{collections::BTreeMap, path::Path};

pub fn prepare_json_source_recovery(request: JsonRecoveryRequest) -> AppResult<JsonRecoveryPlan> {
    crate::services::project::ensure_project_session_mod_root(
        &request.session_id,
        &request.mod_root,
    )?;
    let _lease = acquire_root_write_lock(Path::new(&request.mod_root))?;
    let boundary = FsRootBoundary::new(Path::new(&request.mod_root), "JSON recovery root")?;
    let original = match &request.origin {
        JsonDocumentOrigin::ModInfo | JsonDocumentOrigin::MiscConfig { .. } => None,
        JsonDocumentOrigin::Entity { target } => {
            Some(json_recovery_origin(&request.session_id, target)?)
        }
    };
    let paths = match original.as_ref() {
        None => vec![(
            "file",
            match request.origin {
                JsonDocumentOrigin::MiscConfig { file } => {
                    crate::domain::misc_config::misc_config_path(file)
                }
                _ => "mod_info.json",
            }
            .to_string(),
            true,
        )],
        Some(target) => match target.kind {
            EntityKind::Variant | EntityKind::Skin => {
                vec![("file", target.write.rel_path.clone(), true)]
            }
            EntityKind::Faction => vec![
                ("file", target.write.rel_path.clone(), true),
                ("index", "data/world/factions/factions.csv".into(), false),
            ],
            EntityKind::Mission => vec![
                (
                    "descriptor",
                    format!("{}/descriptor.json", target.write.rel_path),
                    true,
                ),
                (
                    "text",
                    format!("{}/mission_text.txt", target.write.rel_path),
                    false,
                ),
                ("index", "data/missions/mission_list.csv".into(), false),
            ],
            _ => {
                return Err(AppError::message(
                    "json.recovery_kind_invalid",
                    "该文档种类不支持来源重建",
                ));
            }
        },
    };
    let mut versions = Vec::new();
    let mut missing = Vec::new();
    let mut current = BTreeMap::new();
    let mut index = None;
    for (key, relative, json) in paths {
        let path = boundary.resolve_relative_target(&relative, "JSON recovery source")?;
        let version = if !path
            .try_exists()
            .map_err(|error| AppError::from(error).at_path(&path))?
        {
            missing.push(relative.clone());
            file_version(&path)?
        } else if key == "index" {
            let (version, table) = read_versioned_csv(&path)?;
            current.insert(key.to_string(), serde_json::to_value(&table)?);
            index = Some(table);
            version
        } else if json {
            let (version, value) = read_versioned_json(&path)?;
            if let JsonDocumentOrigin::MiscConfig { file } = request.origin {
                crate::domain::misc_config::validate_misc_config(
                    file,
                    &value,
                    &crate::parsers::bundled_schema(
                        crate::domain::misc_config::misc_config_schema_id(file),
                    )["root"],
                )
                .map_err(|error| error.at_path(&path))?;
            }
            current.insert(key.to_string(), value);
            version
        } else {
            let (version, bytes) = read_versioned_bytes(&path)?;
            current.insert(key.to_string(), Value::String(decode_text(&path, &bytes)?));
            version
        };
        versions.push(version);
    }
    if let Some(target) = original.as_ref() {
        if target.kind == EntityKind::Mission {
            versions.push(file_version(&boundary.resolve_relative_target(
                &target.write.rel_path,
                "mission recovery directory",
            )?)?);
        }
        let index_path = match target.kind {
            EntityKind::Faction => Some("data/world/factions/factions.csv"),
            EntityKind::Mission => Some("data/missions/mission_list.csv"),
            _ => None,
        };
        if let (Some(index_path), Some(table)) = (index_path, index.as_ref()) {
            let linked = if target.kind == EntityKind::Faction {
                crate::io::faction_index_entries(&boundary, table)?
                    .iter()
                    .any(|entry| {
                        crate::io::same_physical_path(&entry.path, Path::new(&target.write.path))
                    })
            } else {
                table.rows.iter().any(|row| {
                    !row.is_comment
                        && row.data.get("mission").and_then(Value::as_str) == Some(&target.id)
                })
            };
            if !linked && !missing.iter().any(|path| path == index_path) {
                missing.push(index_path.to_string());
            }
        }
    }
    let resource_refs = if let Some(target) = original.as_ref() {
        let handle = session_handle(&request.session_id)?;
        let session = lock_session(&handle)?;
        let mission = serde_json::json!({"descriptor": current.get("descriptor")});
        let data = if target.kind == EntityKind::Mission {
            &mission
        } else {
            current.get("file").unwrap_or(&Value::Null)
        };
        let definition =
            super::super::definitions::entity_definitions::entity_definition(target.kind)?;
        (definition.resources)(&session, &target.id, data)
    } else {
        BTreeMap::new()
    };
    Ok(JsonRecoveryPlan {
        request,
        base_versions: versions,
        missing_paths: missing,
        current_sources: current,
        resource_refs,
    })
}

pub(crate) fn json_recovery_origin(
    session_id: &str,
    identity: &crate::models::JsonSourceIdentity,
) -> AppResult<crate::models::EntityEditTarget> {
    let handle = session_handle(session_id)?;
    let session = lock_session(&handle)?;
    session
        .json_origins
        .iter()
        .rev()
        .find(|origin| {
            origin.kind == identity.kind
                && origin.id == identity.id
                && identity
                    .rel_path
                    .as_ref()
                    .is_none_or(|path| path == &origin.write.rel_path)
        })
        .cloned()
        .ok_or_else(|| {
            AppError::message("json.recovery_target_changed", "重建来源不属于已读取的文档")
        })
}

pub(super) fn remember_json_origin(
    session: &mut super::super::model::ProjectSession,
    target: &crate::models::EntityEditTarget,
) {
    if !matches!(
        target.kind,
        EntityKind::Variant | EntityKind::Skin | EntityKind::Faction | EntityKind::Mission
    ) {
        return;
    }
    session.json_origins.retain(|origin| {
        origin.kind != target.kind
            || origin.id != target.id
            || origin.write.rel_path != target.write.rel_path
    });
    session.json_origins.push(target.clone());
}
