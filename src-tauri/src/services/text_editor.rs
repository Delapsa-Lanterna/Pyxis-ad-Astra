use crate::domain::document_edit::JsonDraft;
use crate::domain::entity_definitions;
use crate::domain::schema::{ScalarKind, ScalarRule};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::file_content::DraftEdit;
use crate::models::file_content::SaveLayout;
use crate::models::file_value::Value as FileValue;
use crate::models::{EntityKind, WriteResult};
use crate::parsers::game;
use crate::parsers::game::text;
use crate::services::text_file_editing;
use std::path::Path;
use std::sync::Arc;

pub fn transcode_file_to_utf8(root: &str, path: &str, encoding: &str) -> AppResult<WriteResult> {
    let _lease = io::acquire_root_write_lock(Path::new(root))?;
    let target = FsRootBoundary::new(Path::new(root), "text root")?
        .resolve_absolute(Path::new(path), "encoded source")?;
    let (_, bytes) = io::read_versioned_bytes(&target)?;
    let decoded = text::decode_plain(&bytes, encoding)
        .map_err(|error| AppError::from(error).at_path(&target))?;
    text_file_editing::save_text_file(root, path, decoded)
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
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use encoding_rs::{GB18030, WINDOWS_1252};
    use std::fs;

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
