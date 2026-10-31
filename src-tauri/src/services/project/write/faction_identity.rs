use super::super::session::{lock_session, session_handle};

use crate::services::project::query::entity_targets::query_entity_edit_target;
use crate::{
    errors::{AppError, AppResult},
    io::{FileChangeSetBuilder, FsRootBoundary, acquire_root_write_lock, read_csv_data},
    models::{
        EntityKind, EntityLinkedRecord, IndexedConfigEntityRefresh, JsonWriteOptions, WriteResult,
    },
    parsers::render_csv_text,
};
use serde_json::Value;
use std::path::Path;

pub fn save_faction_entity(
    session_id: &str,
    previous_id: Option<&str>,
    next_id: &str,
    data: Value,
    options: JsonWriteOptions,
    ordered_json: Option<&str>,
) -> AppResult<WriteResult<Value>> {
    let info = query_entity_edit_target(
        session_id,
        EntityKind::Faction,
        previous_id.unwrap_or(next_id),
    )?;
    if previous_id.is_none() && info.target.linked_record.is_some() {
        return Err(AppError::message("config.entity_exists", "势力 ID 已存在"));
    }
    if let Some(previous_id) = previous_id
        && info.target.linked_record.is_none()
    {
        return Err(AppError::message(
            "config.index_missing",
            format!("势力索引不存在: {}", previous_id),
        ));
    }
    let file = data.get("file").ok_or_else(|| {
        AppError::message("config.missing_faction_file", "missing faction file data")
    })?;
    if file.get("id").and_then(Value::as_str) != Some(next_id) {
        return Err(AppError::message(
            "spec.id_mismatch",
            "势力内容 ID 与保存身份不一致",
        ));
    }
    let result = super::entity_identity::save_entity_spec(
        session_id,
        &info.target,
        file.clone(),
        options,
        ordered_json,
    )?;
    let index_rel = "data/world/factions/factions.csv";
    let index = read_csv_data(&Path::new(&info.target.write.root).join(index_rel))?;
    let owner = crate::models::WriteContentTarget::Json {
        origin: (&result.identity_changes[0].after).into(),
    };
    Ok(result.with_content(
        owner,
        serde_json::to_value(IndexedConfigEntityRefresh {
            entity_id: next_id.to_string(),
            index_path: index_rel.to_string(),
            index_header: index.header,
            index_rows: index.rows,
            entity_data: data,
        })?,
    ))
}

pub fn delete_faction_entity(
    session_id: &str,
    id: &str,
    delete_target: bool,
) -> AppResult<WriteResult<Value>> {
    let handle = session_handle(session_id)?;
    let root = lock_session(&handle)?.manifest.mod_root.clone();
    let lease = acquire_root_write_lock(Path::new(&root))?;
    let info = query_entity_edit_target(session_id, EntityKind::Faction, id)?;
    let Some(EntityLinkedRecord::Index { path, row_index }) = &info.target.linked_record else {
        return Err(AppError::message("config.index_missing", "势力索引不存在"));
    };
    let boundary = FsRootBoundary::new(Path::new(&root), "faction delete root")?;
    let mut index = read_csv_data(&boundary.resolve_relative(path, "faction index")?)?;
    index.rows.remove(*row_index);
    let mut builder = FileChangeSetBuilder::new_with_lock(boundary.root(), lease)?;
    builder.text_file(
        path,
        Some(render_csv_text(
            &index.header,
            &index
                .rows
                .iter()
                .map(|row| (&row.data, row.is_comment))
                .collect::<Vec<_>>(),
        )?),
    )?;
    if delete_target {
        builder.text_file(&info.target.write.rel_path, None)?;
    }
    let changes = builder.apply()?;
    Ok(WriteResult::new(changes, Vec::new(), None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::{
        models::IndexedConfigKind,
        models::{IndexedConfigDelete, IndexedConfigSave},
        services::project,
    };
    use serde_json::json;

    #[test]
    fn indexed_actual_target_keeps_columns_positions_versions_and_deletion_scope() {
        let root = project_workspace("faction_actual_index_target");
        std::fs::create_dir_all(root.join("data/world/factions")).unwrap();
        std::fs::create_dir_all(root.join("data/custom/nested")).unwrap();
        let index = root.join("data/world/factions/factions.csv");
        std::fs::write(
            &index,
            "id,file,note\n#comment,,first\nloaded,data/custom/nested/filename.faction,keep\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/custom/nested/filename.faction"),
            r#"{"id":"loaded","displayName":"Loaded"}"#,
        )
        .unwrap();
        let mut trace = project::PerformanceTrace::new("project.openSession");
        let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
        let info = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Faction,
            "loaded",
        )
        .unwrap();
        assert_eq!(
            info.target.write.rel_path,
            "data/custom/nested/filename.faction"
        );
        assert_eq!(info.base_versions.len(), 2);
        assert!(
            info.base_versions
                .iter()
                .all(|version| version.fingerprint.is_some())
        );
        let saved = crate::services::project_save::execute_save_action(
            crate::models::SaveAction::SaveIndexedConfigEntity(IndexedConfigSave {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: info.base_versions,
                kind: IndexedConfigKind::Faction,
                previous_id: Some("loaded".into()),
                next_id: "next".into(),
                index_row: Default::default(),
                entity_data: json!({"file":{"id":"next","displayName":"Saved"}}),
                json_write: Default::default(),
                ordered_json: None,
            }),
        )
        .unwrap();
        let next = crate::services::project::query::entity_targets::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Faction,
            "next",
        )
        .unwrap();
        assert_eq!(saved.base_versions, next.base_versions);
        assert_eq!(
            next.target.write.rel_path,
            "data/custom/nested/next.faction"
        );
        let contents = crate::io::read_csv_data(&index).unwrap();
        assert_eq!(contents.header, ["id", "file", "note"]);
        assert_eq!(contents.rows[0].data["id"], "#comment");
        assert_eq!(contents.rows[1].data["id"], "next");
        assert_eq!(
            contents.rows[1].data["file"],
            "data/custom/nested/next.faction"
        );
        assert_eq!(contents.rows[1].data["note"], "keep");
        let result = crate::services::project_save::execute_save_action(
            crate::models::SaveAction::DeleteIndexedConfigEntity(IndexedConfigDelete {
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root.clone(),
                base_versions: next.base_versions,
                kind: IndexedConfigKind::Faction,
                id: "next".into(),
                delete_target: true,
            }),
        )
        .unwrap();
        assert_eq!(result.changes.len(), 2);
        assert!(!root.join("data/custom/nested/next.faction").exists());
        assert_eq!(crate::io::read_csv_data(&index).unwrap().rows.len(), 1);
        project::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
