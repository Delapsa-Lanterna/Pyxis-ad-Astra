use crate::domain::document_edit::JsonDraft;
use crate::domain::schema::{ScalarKind, ScalarRule};
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder};
use crate::models::JsonWriteOptions;
use crate::models::file_content::{DraftEdit, JsonTarget, OutputFormat, PreparedValue, SaveLayout};
use crate::models::file_value::{Text, Value};
use std::sync::Arc;

pub(crate) fn stage_replace_paths(
    builder: &mut FileChangeSetBuilder,
    options: &JsonWriteOptions,
) -> AppResult<()> {
    if options.replace_paths.is_empty() {
        return Ok(());
    }
    let path = builder.root().join("mod_info.json");
    let source = Arc::new(io::read_json_file(&path)?);
    let mut draft = JsonDraft::open(source.clone());
    let mut paths = match source.content.get("replace") {
        Some(Value::Array(paths)) => paths.clone(),
        None => Vec::new(),
        _ => {
            return Err(
                AppError::message("json.mod_info_shape", "replace 必须为数组").at_path(&path),
            );
        }
    };
    for path in &options.replace_paths {
        let path = path.replace('\\', "/");
        if path == "data/config/settings.json" {
            return Err(AppError::message(
                "json.replace_unsupported",
                "settings.json 不支持整体取代",
            ));
        }
        if !paths
            .iter()
            .any(|value| matches!(value,Value::Text(text) if text.equals(&path)))
        {
            paths.push(Value::Text(Text::new(path)));
        }
    }
    if let Some(Value::Array(previous)) = source.content.get("replace") {
        if *previous == paths {
            return Ok(());
        }
        let rule = ScalarRule {
            kind: ScalarKind::Text,
            minimum: None,
            maximum: None,
        };
        let inserted = paths[previous.len()..]
            .iter()
            .map(|value| {
                let Value::Text(value) = value else {
                    unreachable!("new replace path is text")
                };
                rule.prepare(value.as_str().expect("normalized path"))
            })
            .collect::<AppResult<_>>()?;
        draft.edit(DraftEdit::ArraySplice {
            path: vec![Text::new("replace")],
            index: previous.len(),
            delete: 0,
            insert: inserted,
        })?;
    } else {
        let Value::Object(fields) = &source.content else {
            unreachable!("JSON root object")
        };
        draft.edit(DraftEdit::ObjectSplice {
            path: Vec::new(),
            index: fields.len(),
            delete: 0,
            insert: vec![(
                Text::new("replace"),
                PreparedValue {
                    value: Value::Array(paths),
                    target: JsonTarget::generated(OutputFormat::Value),
                },
            )],
        })?;
    }
    let actual = draft.save(SaveLayout::PreserveStructure)?;
    builder.text_file("mod_info.json", Some(actual.text.to_string()))?;
    Ok(())
}
