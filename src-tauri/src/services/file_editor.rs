use crate::domain::entity_definitions;
use crate::errors::{AppError, AppResult};
use crate::io::{
    FsRootBoundary, RootWriteLock, acquire_root_write_lock, build_text_change,
    read_text_bytes_no_bom, read_utf8_no_bom,
};
use crate::models::{
    EditableFileData, EntityIdentityChange, EntityKind, FileChangeReplayDirection, TextSave,
    WriteContentTarget, WriteResult,
};
use crate::services::project;
use crate::{io, models, parsers, services};
use encoding_rs::Encoding;
use serde_json::Value;
use std::path::Path;
use std::str;

pub fn save_text_file(mod_root: &str, path: &str, text: String) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    save_text_file_with_lock(mod_root, path, text, write_lock)
}

pub fn load_project_editable_file(
    session_id: Option<&str>,
    mod_root: &str,
    path: String,
) -> AppResult<EditableFileData> {
    if let Some(session_id) = session_id {
        project::ensure_project_session_mod_root(session_id, mod_root)?;
    }
    let mut loaded = load_editable_file(mod_root, path)?;
    if let Some(session_id) = session_id {
        loaded.entity = services::query_file_entity_target(session_id, &loaded.path)?;
        if let Some(entity) = &loaded.entity {
            loaded.base_versions = entity.base_versions.clone();
        }
    }
    Ok(loaded)
}

/// Text saves write the submitted text at its own path. Entity files are not renamed and linked
/// records are not rewritten; the committed change is re-read like any external modification.
pub fn save_project_text_file(
    mod_root: &str,
    path: &str,
    text: String,
) -> AppResult<WriteResult<Value>> {
    let path = FsRootBoundary::new(Path::new(mod_root), "mod root")?
        .resolve_absolute(Path::new(path), "file path")?;
    let path = path.to_string_lossy();
    Ok(save_text_file(mod_root, &path, text.clone())?.with_content(
        WriteContentTarget::Text {
            path: path.to_string(),
        },
        serde_json::json!({"text":text}),
    ))
}

pub fn prepare_text_save(
    input: &mut TextSave,
    identities: &[EntityIdentityChange],
) -> AppResult<()> {
    let TextSave {
        session_id,
        mod_root,
        path,
        base_versions: versions,
        ..
    } = input;
    for identity in identities {
        if models::windows_path_key(path) == models::windows_path_key(&identity.before.write.path) {
            *path = identity.after.write.path.clone();
        }
    }
    if io::source_recreation_allowed(mod_root, path) && !Path::new(path).exists() {
        return Ok(());
    }
    let current = load_project_editable_file(session_id.as_deref(), mod_root, path.clone())?;
    *versions = current.base_versions;
    Ok(())
}

pub fn follow_text_identity(kind: EntityKind, text: &str, next_id: &str) -> AppResult<String> {
    let definition = entity_definitions::entity_spec_definition(kind)
        .expect("recognized file has spec definition");
    parsers::replace_root_string(text, definition.id_field, next_id)
}

fn save_text_file_with_lock(
    mod_root: &str,
    path: &str,
    text: String,
    _write_lock: RootWriteLock,
) -> AppResult<WriteResult> {
    let path = Path::new(path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let path = boundary.resolve_absolute(path, "file path")?;
    let changes = vec![build_text_change(&path, Some(text))?];
    _write_lock.apply_changes(&changes, FileChangeReplayDirection::Redo)?;
    Ok(WriteResult::from_changes(changes))
}

pub fn load_editable_file(mod_root: &str, path: String) -> AppResult<EditableFileData> {
    let _lease = acquire_root_write_lock(Path::new(mod_root))?;
    let target = Path::new(&path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let target = boundary.resolve_absolute(target, "file path")?;
    let base_versions = vec![io::file_version(&target)?];
    read_utf8_no_bom(&target).map(|text| EditableFileData {
        entity: None,
        path: target.display().to_string(),
        text,
        base_versions,
    })
}

/// Converts a legacy-encoded file to UTF-8 through the sanctioned text-write
/// changeset. Decoding follows the user-chosen source encoding only — there is
/// no automatic detection — and a file that is already valid UTF-8 is refused
/// so a repeated click cannot re-mangle the converted content.
pub fn transcode_file_to_utf8(
    mod_root: &str,
    path: &str,
    encoding: &str,
) -> AppResult<WriteResult> {
    let write_lock = acquire_root_write_lock(Path::new(mod_root))?;
    let target = Path::new(path);
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    let target = boundary.resolve_absolute(target, "file path")?;
    let bytes = read_text_bytes_no_bom(&target)?;
    if str::from_utf8(&bytes).is_ok() {
        return Err(AppError::message(
            "text.transcode_not_needed",
            format!("{} is already valid UTF-8", target.display()),
        ));
    }
    let encoding = Encoding::for_label(encoding.as_bytes()).ok_or_else(|| {
        AppError::message(
            "text.transcode_encoding_unknown",
            format!("unknown source encoding: {encoding}"),
        )
    })?;
    let (text, _, had_errors) = encoding.decode(&bytes);
    if had_errors {
        return Err(AppError::message(
            "text.transcode_undecodable",
            format!(
                "{} cannot be fully decoded as {}",
                target.display(),
                encoding.name()
            ),
        ));
    }
    save_text_file_with_lock(mod_root, path, text.into_owned(), write_lock)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;
    use crate::test_support::TestWorkspace;
    #[cfg(test)]
    use encoding_rs::GB18030;
    use std::fs;

    #[test]
    fn recovery_editor_loads_file_inside_mod_root() {
        let root = project_workspace("recovery_editor_loads_inside_root");
        let target = root.join("mod_info.json");
        write_utf8_no_bom(&target, "{\"id\":\"demo\"}").unwrap();

        let loaded = load_editable_file(
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
    fn load_editable_file_rejects_path_outside_mod_root() {
        let root = project_workspace("load_editable_file_rejects_external_root");
        let outside = project_workspace("load_editable_file_rejects_external_outside");
        let outside_file = outside.join("outside.txt");
        write_utf8_no_bom(&outside_file, "bad").unwrap();

        let result = load_editable_file(
            &root.to_string_lossy(),
            outside_file.to_string_lossy().to_string(),
        );

        assert!(result.is_err());
        outside.close().unwrap();
        root.close().unwrap();
    }

    #[test]
    fn load_editable_file_rejects_parent_dir_escape() {
        let root = project_workspace("load_editable_file_rejects_parent_dir_escape");
        let escaped = root.join("..").join("outside.txt");

        let result = load_editable_file(
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
    fn load_editable_file_rejects_link_parent_escape() {
        let (root, outside, linked) =
            TestWorkspace::directory_link("load_text_link_escape", "linked").unwrap();
        write_utf8_no_bom(&outside.join("outside.txt"), "bad").unwrap();

        let result = load_editable_file(
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
        .unwrap_err();
        assert_eq!(repeated.code(), "text.transcode_not_needed");
        assert_eq!(fs::read(&target).unwrap(), converted);
        root.close().unwrap();
    }

    #[test]
    fn transcode_refuses_already_utf8_file() {
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

        assert_eq!(result.unwrap_err().code(), "text.transcode_not_needed");
        assert_eq!(fs::read(&target).unwrap(), edited.as_bytes());
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
