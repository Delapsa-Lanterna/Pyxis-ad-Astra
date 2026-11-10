use super::read_versioned_bytes;
use crate::errors::{AppError, AppResult};
use crate::io::FileChangeSetBuilder;
use crate::models::FileVersion;
use crate::models::file_content::{JsonSource, JsonWrite};
use crate::parsers::game;
#[cfg(test)]
use crate::test_support::work_counts;
use std::path::Path;

/// The source is chosen by the save owner; this step stages the actual format result.
pub(crate) fn stage_json_document(
    builder: &mut FileChangeSetBuilder,
    relative: &str,
    source: Option<&JsonSource>,
    request: &JsonWrite,
) -> AppResult<JsonSource> {
    let actual = match source {
        Some(source) => source.write(request)?,
        None => JsonSource::create(request)?,
    };
    builder.text_file(relative, Some(actual.text.to_string()))?;
    Ok(actual)
}
pub fn read_json_file(path: &Path) -> AppResult<JsonSource> {
    read_versioned_json(path).map(|(_, source)| source)
}
pub fn read_versioned_json(path: &Path) -> AppResult<(FileVersion, JsonSource)> {
    let (version, bytes) = read_versioned_bytes(path)?;
    #[cfg(test)]
    work_counts::record("parse", path);
    let source = game::read_json(&bytes).map_err(|error| {
        AppError::context(
            format!("读取 JSON 失败：{}", path.display()),
            AppError::from(error),
        )
        .at_path(path)
    })?;
    Ok((version, source))
}

#[cfg(test)]
mod tests {
    use crate::models::file_content::PreparedValue;

    use super::*;
    use crate::domain::document_edit::JsonDraft;
    use crate::io;
    use crate::models::file_content::DraftEdit;
    use crate::models::file_content::{JsonSource, OutputFormat, SaveLayout};
    use crate::models::file_value::Text;
    use crate::test_support::{TestWorkspace, file_formats, work_counts};
    use serde_json::json;
    use std::{fs, path::PathBuf, sync::Arc};

    #[test]
    fn json_read_attaches_actual_path_to_parser_position() {
        let dir = TestWorkspace::new("json_error_location");
        let path = dir.join("nested.skin");
        io::write_utf8_no_bom(&path, "{\n\"id\":1,\"id\":2}").unwrap();
        let error = read_json_file(&path).unwrap_err();
        assert_eq!(error.code(), "json.duplicate_key");
        assert_eq!(error.location().unwrap().path.as_deref(), path.to_str());
        assert_eq!(error.location().unwrap().line, Some(2));
        dir.close().unwrap();
    }
    #[test]
    fn json_write_preserves_all_business_dictionary_keys() {
        let content =
            json!({"_source":"business","nested":{"_slot":"weapon"},"array":[{"_tool":1}]});
        let result = JsonSource::create(&file_formats::json_write(&content)).unwrap();
        assert_eq!(result.content.to_json().unwrap(), content);
    }
    #[test]
    fn local_array_write_keeps_comments_and_tail() {
        let source = Arc::new(game::read_json(b"{a:[1,,2], # keep\n b:3}\nEND").unwrap());
        let mut draft = JsonDraft::open(source);
        draft
            .edit(file_formats::replace_edit(vec!["b".into()], &json!(4)))
            .unwrap();
        let actual = draft.save(SaveLayout::PreserveStructure).unwrap();
        assert_eq!(&*actual.text, "{a:[1,,2], # keep\n b:4}\nEND");
    }
    #[test]
    fn adding_a_variant_weapon_group_preserves_existing_json_text() {
        let text = "{\n  hullId: 'demo',\n  weaponGroups: [\n    { mode: 'LINKED', weapons: { A: 'one' } },\n    { mode: 'ALTERNATING', weapons: { B: 'two' } }\n  ],\n  unknown: '007'\n}";
        let mut draft = JsonDraft::open(Arc::new(game::read_json(text.as_bytes()).unwrap()));
        let request = file_formats::json_write(&json!({"mode":"LINKED","weapons":{}}));
        draft
            .edit(DraftEdit::ArraySplice {
                path: vec![Text::new("weaponGroups")],
                index: 2,
                delete: 0,
                insert: vec![PreparedValue {
                    value: request.content,
                    target: request.target,
                }],
            })
            .unwrap();
        let actual = draft.save(SaveLayout::PreserveStructure).unwrap();
        assert!(
            actual
                .text
                .contains("{ mode: 'LINKED', weapons: { A: 'one' } }")
        );
        assert!(
            actual
                .text
                .contains("{ mode: 'ALTERNATING', weapons: { B: 'two' } }")
        );
        assert!(actual.text.contains("unknown: '007'"));
    }
    #[test]
    fn suffixed_numbers_survive_large_file_edit_and_disk_round_trip() {
        let dir = TestWorkspace::new("suffix_large_round_trip");
        let path = dir.join("sample.json");
        let prefix = "{value:0.625f,zero:.0F,note:'";
        let padding = "a".repeat(1048576 - prefix.len() - 1);
        let text = format!("{prefix}{padding}界',speed:1 # inline\n}} # tail\nEND");
        io::write_utf8_no_bom(&path, &text).unwrap();
        let source = read_json_file(&path).unwrap();
        let value = source.content.to_json().unwrap();
        assert_eq!(value["value"], 0.625);
        assert_eq!(value["zero"], 0.0);
        assert_eq!(value["note"], format!("{padding}界"));
        let mut draft = JsonDraft::open(Arc::new(source));
        draft
            .edit(file_formats::replace_edit(vec!["speed".into()], &json!(2)))
            .unwrap();
        let actual = draft.save(SaveLayout::PreserveStructure).unwrap();
        assert!(actual.text.contains("value:0.625f"));
        assert!(actual.text.contains("speed:2 # inline"));
        assert!(actual.text.ends_with("} # tail\nEND"));
        io::write_utf8_no_bom(&path, &actual.text).unwrap();
        assert_eq!(read_json_file(&path).unwrap().content, actual.content);
        assert_eq!(work_counts::count("read", &path), 2);
        dir.close().unwrap();
    }
    #[test]
    fn incompatible_requested_integer_format_is_rejected() {
        let mut request = file_formats::json_write(&json!(1.5));
        request.target.output = OutputFormat::Integer;
        assert!(JsonSource::create(&request).is_err());
    }
    #[test]
    fn collected_real_json_fixtures_round_trip_in_memory() {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("testdata/json");
        let mut checked = 0;
        for entry in fs::read_dir(root).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                continue;
            }
            let source = read_json_file(&path).unwrap();
            let mut request = file_formats::json_write(&source.content.to_json().unwrap());
            request.layout = SaveLayout::Expanded;
            let actual = JsonSource::create(&request).unwrap();
            assert_eq!(actual.content, source.content, "{}", path.display());
            checked += 1;
        }
        assert_eq!(checked, 21);
    }
}
