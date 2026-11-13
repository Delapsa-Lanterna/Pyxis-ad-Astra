use crate::domain::text_file;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::{
    EntityIdentityChange, FileChangeReplayDirection, TextBatchSave, TextFileData, TextSave,
    WriteContentTarget, WriteResult, windows_path_key,
};
use crate::parsers::game::text;
use crate::services::{project, query_file_entity_target};
use serde_json::{Value, json};
use std::collections::BTreeSet;
use std::path::Path;

pub fn prepare_text_save(
    input: &mut TextSave,
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    for identity in identities {
        if windows_path_key(&input.path) == windows_path_key(&identity.before.write.path) {
            input.path.clone_from(&identity.after.write.path);
        }
    }
    if io::source_recreation_allowed(&input.mod_root, &input.path)
        && !Path::new(&input.path).exists()
    {
        return Ok(());
    }
    input.base_versions =
        load_project_text_file(input.session_id.as_deref(), &input.mod_root, &input.path)?
            .base_versions;
    Ok(())
}
pub fn load_text_file(root: &str, path: &str) -> AppResult<TextFileData> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let path = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute(Path::new(&path), "text source")?;
    let (version, bytes) = io::read_versioned_bytes(&path)?;
    if text_file::binary(&bytes) {
        return Err(AppError::message("text.binary", "该文件为二进制内容").at_path(&path));
    }
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
    path: &str,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::models::{SaveAction, TextFileWrite};
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    use crate::services::text_file_editing;
    use crate::services::{project_save, project_sync};
    use crate::test_support::TestWorkspace;
    use std::fs;
    #[test]
    fn loads_text_and_detects_binary_from_the_same_bytes() {
        let root = project_workspace("text_file_content");
        let file = root.join("sample.txt");
        fs::write(&file, "中文\r\nplain\rfinal\n").unwrap();
        let loaded =
            load_text_file(&root.to_string_lossy(), file.to_string_lossy().as_ref()).unwrap();
        assert_eq!(loaded.text, "中文\r\nplain\rfinal\n");
        assert_eq!(loaded.base_versions.len(), 1);
        fs::write(&file, b"PK\x03\x04archive").unwrap();
        let error =
            load_text_file(&root.to_string_lossy(), file.to_string_lossy().as_ref()).unwrap_err();
        assert_eq!(error.code(), "text.binary");
        assert_eq!(
            error.location().unwrap().path.as_deref(),
            Some(loaded.path.as_str())
        );
        root.close().unwrap();
    }
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
        project_sync::release_project_session(&manifest.session_id).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn recovery_editor_loads_file_inside_mod_root() {
        let root = project_workspace("recovery_editor_loads_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{\"id\":\"demo\"}").unwrap();

        let loaded = text_file_editing::load_text_file(
            &root.to_string_lossy(),
            target.to_string_lossy().as_ref(),
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

        let result = text_file_editing::save_text_file(
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

        let result = text_file_editing::save_text_file(
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

        let result = text_file_editing::save_text_file(
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

        let result = text_file_editing::load_text_file(
            &root.to_string_lossy(),
            outside_file.to_string_lossy().as_ref(),
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn load_text_file_rejects_parent_dir_escape() {
        let root = project_workspace("load_text_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = text_file_editing::load_text_file(
            &root.to_string_lossy(),
            escaped.to_string_lossy().as_ref(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }

    #[test]
    fn save_text_file_rejects_link_parent_escape() {
        let (root, _outside, linked) =
            TestWorkspace::directory_link("save_text_link_escape", "linked").unwrap();

        let result = text_file_editing::save_text_file(
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

        let result = text_file_editing::load_text_file(
            &root.to_string_lossy(),
            linked.join("outside.txt").to_string_lossy().as_ref(),
        );

        assert!(result.is_err());
        root.close().unwrap();
    }
}
