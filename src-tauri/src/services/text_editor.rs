use crate::domain::document_edit::JsonDraft;
use crate::domain::entity_definitions;
use crate::domain::schema::{ScalarKind, ScalarRule};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models;
use crate::models::file_content::DraftEdit;
use crate::models::file_content::SaveLayout;
use crate::models::file_value::Value as FileValue;
use crate::models::{
    EntityIdentityChange, EntityKind, FileChangeReplayDirection, TextFileData, TextSave,
    WriteContentTarget, WriteResult,
};
use crate::models::{TextBatchSave, windows_path_key};
use crate::parsers::game;
use crate::parsers::game::text;
use crate::services::{project, query_file_entity_target};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;
use std::sync::Arc;

pub fn load_text_file(root: &str, path: String) -> AppResult<TextFileData> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let path = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute(Path::new(&path), "text source")?;
    let (version, bytes) = io::read_versioned_bytes(&path)?;
    let decoded = text::decode_plain(&bytes, "utf-8")
        .map_err(|error| AppError::from(error).at_path(&path))?;
    Ok(TextFileData {
        entity: None,
        path: path.to_string_lossy().into_owned(),
        text: decoded,
        base_versions: vec![version],
    })
}
pub fn load_project_text_file(
    session: Option<&str>,
    root: &str,
    path: String,
) -> AppResult<TextFileData> {
    if let Some(session) = session {
        project::ensure_project_session_mod_root(session, root)?;
    }
    let mut result = load_text_file(root, path)?;
    if let Some(session) = session {
        result.entity = query_file_entity_target(session, &result.path)?;
        if let Some(entity) = &result.entity {
            result.base_versions = entity.base_versions.clone();
        }
    }
    Ok(result)
}
/// The submitted text is authoritative, including incomplete syntax.
pub fn save_text_file(root: &str, path: &str, text: String) -> AppResult<WriteResult> {
    let lease = io::acquire_root_write_lock(Path::new(root))?;
    let path = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute_target(Path::new(path), "text output")?;
    let changes = vec![io::build_text_change(&path, Some(text))?];
    lease.apply_changes(&changes, FileChangeReplayDirection::Redo)?;
    Ok(WriteResult::from_changes(changes))
}
pub fn save_project_text_file(
    root: &str,
    path: &str,
    text: String,
) -> AppResult<WriteResult<Value>> {
    let target = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute_target(Path::new(path), "text output")?;
    let path = target.to_string_lossy().into_owned();
    let actual = json!({"text":text});
    Ok(save_text_file(root, &path, text)?.with_content(WriteContentTarget::Text { path }, actual))
}

pub fn save_text_batch(input: TextBatchSave) -> AppResult<WriteResult> {
    let root = FsRootBoundary::new(Path::new(&input.mod_root), "text batch root")?;
    let mut builder = FileChangeSetBuilder::new(root.root())?;
    let mut occupied = BTreeSet::new();
    for file in input.files {
        let source = root.resolve_absolute(Path::new(&file.path), "text batch source")?;
        let target = root.resolve_absolute_target(
            Path::new(file.target.as_deref().unwrap_or(&file.path)),
            "text batch target",
        )?;
        if !occupied.insert(windows_path_key(&source.to_string_lossy()))
            || (source != target && !occupied.insert(windows_path_key(&target.to_string_lossy())))
        {
            return Err(
                AppError::message("text.batch_overlap", "文本批次包含重叠目标").at_path(&source),
            );
        }
        if !input.base_versions.iter().any(|version| {
            windows_path_key(&version.path) == windows_path_key(&source.to_string_lossy())
        }) {
            return Err(
                AppError::message("text.batch_version", "文本批次缺少来源版本").at_path(&source),
            );
        }
        let before = io::forward_slash_relative_path(root.root(), &source);
        let after = io::forward_slash_relative_path(root.root(), &target);
        if source == target {
            builder.text_file(before, Some(file.text))?;
        } else {
            builder.rename_text_file(&before, &after, file.text)?;
        }
    }
    Ok(WriteResult::from_changes(builder.apply()?))
}
pub fn transcode_file_to_utf8(root: &str, path: &str, encoding: &str) -> AppResult<WriteResult> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let target = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute(Path::new(path), "encoded source")?;
    let (_, bytes) = io::read_versioned_bytes(&target)?;
    let decoded = text::decode_plain(&bytes, encoding)
        .map_err(|error| AppError::from(error).at_path(&target))?;
    save_text_file(root, path, decoded)
}
pub fn prepare_text_save(
    input: &mut TextSave,
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    for identity in identities {
        if models::windows_path_key(&input.path)
            == models::windows_path_key(&identity.before.write.path)
        {
            input.path = identity.after.write.path.clone();
        }
    }
    if io::source_recreation_allowed(&input.mod_root, &input.path)
        && !Path::new(&input.path).exists()
    {
        return Ok(());
    }
    input.base_versions = load_project_text_file(
        input.session_id.as_deref(),
        &input.mod_root,
        input.path.clone(),
    )?
    .base_versions;
    Ok(())
}
pub fn follow_text_identity(kind: EntityKind, source: &str, next: &str) -> AppResult<String> {
    let source = Arc::new(game::read_json(source.as_bytes())?);
    let field = entity_definitions::entity_spec_definition(kind)
        .expect("file entity definition")
        .id_field;
    let prepared = ScalarRule {
        kind: ScalarKind::Text,
        minimum: None,
        maximum: None,
    }
    .prepare(next)?;
    let mut draft = JsonDraft::open(source.clone());
    if source.content.get(field).is_some() {
        draft.replace(&[field.into()], prepared)?;
    } else {
        let FileValue::Object(fields) = &source.content else {
            unreachable!("JSON file root")
        };
        draft.edit(DraftEdit::ObjectSplice {
            path: Vec::new(),
            index: fields.len(),
            delete: 0,
            insert: vec![(field.into(), prepared)],
        })?;
    }
    Ok(draft.save(SaveLayout::PreserveStructure)?.text.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::read_utf8_no_bom;
    use crate::io::write_utf8_no_bom;
    use crate::models::{SaveAction, TextFileWrite};
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    use crate::services::{project_save, project_sync};
    use crate::test_support::TestWorkspace;
    #[cfg(test)]
    use encoding_rs::{GB18030, WINDOWS_1252};
    use std::fs;

    #[test]
    fn batch_save_moves_and_writes_together_and_rejects_stale_sources() {
        let root = project_workspace("text_batch");
        let first = root.join("A.java");
        let second = root.join("B.java");
        let moved = root.join("Beacon.java");
        fs::write(&first, "class A {}").unwrap();
        fs::write(&second, "class B {A a;}").unwrap();
        let manifest =
            project::open_project_session_traced(&root, None, &mut PerformanceTrace::new("batch"))
                .unwrap();
        let input = TextBatchSave {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            base_versions: vec![
                io::file_version(&first).unwrap(),
                io::file_version(&second).unwrap(),
            ],
            files: vec![
                TextFileWrite {
                    path: first.to_string_lossy().into(),
                    target: Some(moved.to_string_lossy().into()),
                    text: "class Beacon {}".into(),
                },
                TextFileWrite {
                    path: second.to_string_lossy().into(),
                    target: None,
                    text: "class B {Beacon a;}".into(),
                },
            ],
        };
        fs::write(&second, "changed").unwrap();
        assert!(
            project_save::execute_save_action(SaveAction::SaveTextBatch(input.clone())).is_err()
        );
        assert!(first.exists());
        assert!(!moved.exists());
        fs::write(&second, "class B {A a;}").unwrap();
        let saved = project_save::execute_save_action(SaveAction::SaveTextBatch(input)).unwrap();
        assert_eq!(saved.changes.len(), 2);
        assert!(!first.exists());
        assert_eq!(fs::read_to_string(&moved).unwrap(), "class Beacon {}");
        assert_eq!(fs::read_to_string(&second).unwrap(), "class B {Beacon a;}");
        project_sync::release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn recovery_editor_loads_file_inside_mod_root() {
        let root = project_workspace("recovery_editor_loads_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{\"id\":\"demo\"}").unwrap();

        let loaded = load_text_file(
            &root.to_string_lossy(),
            target.to_string_lossy().to_string(),
        )
        .unwrap();

        assert_eq!(loaded.text, "{\"id\":\"demo\"}");
        root.close().unwrap();
    }

    #[test]
    fn recovery_editor_saves_file_inside_mod_root() {
        let root = project_workspace("recovery_editor_saves_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{").unwrap();

        let result = save_text_file(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "{}".to_string(),
        )
        .unwrap();
        let saved = fs::read_to_string(&target).unwrap();

        assert_eq!(saved, "{}");
        assert_eq!(result.changes.len(), 1);
        root.close().unwrap();
    }

    #[test]
    fn save_text_file_rejects_path_outside_mod_root() {
        let root = project_workspace("save_text_file_rejects_external_root");
        let outside = project_workspace("save_text_file_rejects_external_outside");

        let result = save_text_file(
            &root.to_string_lossy(),
            &outside.join("outside.txt").to_string_lossy(),
            "bad".to_string(),
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn save_text_file_rejects_parent_dir_escape() {
        let root = project_workspace("save_text_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = save_text_file(
            &root.to_string_lossy(),
            &escaped.to_string_lossy(),
            "bad".to_string(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn load_text_file_rejects_path_outside_mod_root() {
        let root = project_workspace("load_text_file_rejects_external_root");
        let outside = project_workspace("load_text_file_rejects_external_outside");
        let outside_file = outside.join("outside.txt");
        write_utf8_no_bom(&outside_file, "bad").unwrap();

        let result = load_text_file(
            &root.to_string_lossy(),
            outside_file.to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn load_text_file_rejects_parent_dir_escape() {
        let root = project_workspace("load_text_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = load_text_file(
            &root.to_string_lossy(),
            escaped.to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn save_text_file_rejects_link_parent_escape() {
        let (root, _outside, linked) =
            TestWorkspace::directory_link("save_text_link_escape", "linked").unwrap();

        let result = save_text_file(
            &root.to_string_lossy(),
            &linked.join("outside.txt").to_string_lossy(),
            "bad".to_string(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn load_text_file_rejects_link_parent_escape() {
        let (root, outside, linked) =
            TestWorkspace::directory_link("load_text_link_escape", "linked").unwrap();
        write_utf8_no_bom(&outside.join("outside.txt"), "bad").unwrap();

        let result = load_text_file(
            &root.to_string_lossy(),
            linked.join("outside.txt").to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn transcodes_legacy_encoding_to_utf8() {
        let root = project_workspace("transcode_legacy_to_utf8");
        let target = root.join("notes.txt");
        let (encoded, _, _) = GB18030.encode("舰船注释");
        fs::write(&target, encoded).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        )
        .unwrap();
        let saved = fs::read(&target).unwrap();

        assert_eq!(String::from_utf8(saved).unwrap(), "舰船注释");
        assert_eq!(result.changes.len(), 1);
        let converted = fs::read(&target).unwrap();
        let repeated = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "windows-1252",
        )
        .unwrap();
        assert_eq!(repeated.changes.len(), 1);
        assert_eq!(
            fs::read(&target).unwrap(),
            WINDOWS_1252
                .decode_without_bom_handling(&converted)
                .0
                .as_bytes()
        );
        root.close().unwrap();
    }

    #[test]
    fn explicit_source_encoding_interprets_utf8_compatible_bytes() {
        let root = project_workspace("transcode_refuses_utf8");
        let target = root.join("notes.txt");
        fs::write(&target, [0x81u8]).unwrap();
        assert_eq!(
            read_utf8_no_bom(&target).unwrap_err().code(),
            "text.invalid_utf8"
        );
        let edited = "外部已转码并修改\r\n";
        write_utf8_no_bom(&target, edited).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        );

        assert_eq!(result.unwrap().changes.len(), 1);
        assert_eq!(
            fs::read(&target).unwrap(),
            GB18030
                .decode_without_bom_handling(edited.as_bytes())
                .0
                .as_bytes()
        );
        root.close().unwrap();
    }

    #[test]
    fn transcode_refuses_undecodable_bytes() {
        let root = project_workspace("transcode_undecodable");
        let target = root.join("notes.txt");
        // A lone 0x81 is an incomplete GB18030 sequence. Windows-1252 is a
        // total mapping and never reports errors; GB18030 does.
        fs::write(&target, [0x81u8]).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &target.to_string_lossy(),
            "gb18030",
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn transcode_rejects_path_outside_mod_root() {
        let root = project_workspace("transcode_rejects_external_root");
        let outside = project_workspace("transcode_rejects_external_outside");
        let outside_file = outside.join("notes.txt");
        fs::write(&outside_file, [0x81u8]).unwrap();

        let result = transcode_file_to_utf8(
            &root.to_string_lossy(),
            &outside_file.to_string_lossy(),
            "gb18030",
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }
}
