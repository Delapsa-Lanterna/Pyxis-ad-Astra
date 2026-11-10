use crate::errors::{AppError, AppResult};
use crate::models::file_content::{ChildFormats, JsonSource, JsonTarget, JsonWrite, SaveLayout};
use crate::models::file_content::{DraftEdit, PreparedValue};
use crate::models::file_value::{Text, Value};
use std::sync::Arc;

#[cfg(test)]
mod tests {
    #[cfg(test)]
    mod source_values {
        use crate::domain::document_edit::JsonDraft;
        use crate::domain::schema::{ScalarKind, ScalarRule};
        use crate::models::file_content::SaveLayout;
        use crate::parsers::game;
        use std::sync::Arc;

        #[test]
        fn unchanged_file_values_retain_exact_spelling() {
            let source =
                game::read_json(b"{id:'entry',count:1f,speed:0.1f,items:[2.0,3]} #tail").unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            let rule = ScalarRule {
                kind: ScalarKind::Text,
                minimum: None,
                maximum: None,
            };
            draft
                .replace(&["id".into()], rule.prepare("next").unwrap())
                .unwrap();
            let saved = draft.save(SaveLayout::PreserveStructure).unwrap();
            assert_eq!(
                &*saved.text,
                "{id:\"next\",count:1f,speed:0.1f,items:[2.0,3]} #tail"
            );
        }

        #[test]
        fn scalar_editing_is_owned_by_the_document_rule() {
            for (kind, expected) in [(ScalarKind::Integer, "2"), (ScalarKind::Float, "2.0")] {
                for input in ["2", "2.0", "2f"] {
                    let source = game::read_json(b"{value:1f,keep:.5f}").unwrap();
                    let mut draft = JsonDraft::open(Arc::new(source));
                    let rule = ScalarRule {
                        kind,
                        minimum: None,
                        maximum: None,
                    };
                    draft
                        .replace(&["value".into()], rule.prepare(input).unwrap())
                        .unwrap();
                    assert_eq!(
                        &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                        format!("{{value:{expected},keep:.5f}}")
                    );
                    assert!(rule.prepare("2wrong").is_err());
                }
            }
        }

        #[test]
        fn source_content_keeps_values_outside_standard_json() {
            let source = game::read_json(
                br#"{huge:9007199254740993,unit:"\uD800",items:[1e309],name:'entry'}"#,
            )
            .unwrap();
            let original = source.content.clone();
            let mut draft = JsonDraft::open(Arc::new(source));
            let rule = ScalarRule {
                kind: ScalarKind::Text,
                minimum: None,
                maximum: None,
            };
            draft
                .replace(&["name".into()], rule.prepare("after").unwrap())
                .unwrap();
            let saved = draft.save(SaveLayout::PreserveStructure).unwrap();
            for key in ["huge", "unit", "items"] {
                assert_eq!(original.get(key), saved.content.get(key));
            }
        }
    }

    #[cfg(test)]
    mod structure {
        use crate::models::file_content::PreparedValue;
        use crate::parsers::game;

        use crate::domain::document_edit::JsonDraft;
        use crate::domain::schema::{ScalarKind, ScalarRule};
        use crate::models::file_content::DraftEdit;
        use crate::models::file_content::{CsvWrite, SaveLayout};
        use crate::models::file_value::Value;
        use std::sync::Arc;

        fn text(input: &str) -> PreparedValue {
            ScalarRule {
                kind: ScalarKind::Text,
                minimum: None,
                maximum: None,
            }
            .prepare(input)
            .unwrap()
        }

        #[test]
        fn duplicate_array_items_keep_their_own_spelling_and_slot_comments() {
            let source =
                game::read_json(b"{items:[\n  1.0, # first\n  1e0, # second\n  2.0 # third\n]}")
                    .unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            draft
                .edit(DraftEdit::Reorder {
                    path: vec!["items".into()],
                    order: vec![1, 2, 0],
                })
                .unwrap();
            let actual = draft.save(SaveLayout::PreserveStructure).unwrap();
            assert_eq!(
                &*actual.text,
                "{items:[\n  1e0, # first\n  2.0, # second\n  1.0 # third\n]}"
            );
            let expanded = draft.save(SaveLayout::Expanded).unwrap();
            assert_eq!(
                &*expanded.text,
                "{\n  \"items\": [\n    1e0,\n    2.0,\n    1.0\n  ]\n}"
            );
        }

        #[test]
        fn undo_restores_the_original_format_and_redo_restores_the_edit() {
            let source = game::read_json(b"{id:'entry',keep:.5f}").unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            draft.replace(&["id".into()], text("next")).unwrap();
            draft.replace(&["id".into()], text("entry")).unwrap();
            assert!(!draft.modified());
            assert_eq!(
                &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                "{id:'entry',keep:.5f}"
            );
            draft.replace(&["id".into()], text("next")).unwrap();
            assert!(draft.modified());
            assert_eq!(
                &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                "{id:\"next\",keep:.5f}"
            );
        }

        #[test]
        fn edit_during_save_is_applied_to_the_actual_saved_source() {
            let source = Arc::new(game::read_json(b"{id:'entry',keep:.5f}").unwrap());
            let mut draft = JsonDraft::open(source.clone());
            draft.replace(&["id".into()], text("first")).unwrap();
            let capture = draft.request(SaveLayout::PreserveStructure);
            let actual = Arc::new(source.write(&capture).unwrap());
            let mut draft = JsonDraft::open(actual);
            draft.replace(&["id".into()], text("second")).unwrap();
            assert!(draft.modified());
            assert_eq!(
                &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                "{id:\"second\",keep:.5f}"
            );
        }

        #[test]
        fn exact_data_survives_a_javascript_safe_wire_round_trip() {
            let source = game::read_json(
                br#"{large:9007199254740993,unit:"\uD800",overflow:[1e309],decimal:1.0}"#,
            )
            .unwrap();
            let wire = serde_json::to_string(&source.content).unwrap();
            assert!(wire.contains("9007199254740993"));
            let actual: Value = serde_json::from_str(&wire).unwrap();
            assert!(actual.same_content_order(&source.content));
        }

        #[test]
        fn csv_duplicate_rows_and_column_order_keep_physical_spelling() {
            let source = game::read_csv(
                b"id,count,amount\r\nunit,1,\"1.0\"\r\nunit,1,1e0\r\n# note\r\n\r\n",
            )
            .unwrap();
            let mut content = source.document.content.clone();
            content.records.swap(0, 1);
            content.records[0].cells[0] = "next".into();
            let request = CsvWrite {
                content,
                origins: vec![Some(1), Some(0), Some(2), Some(3)],
                columns: vec![Some(0), Some(1), Some(2)],
                layout: SaveLayout::PreserveStructure,
            };
            assert_eq!(
                &*source.write(&request).unwrap().document.source,
                "id,count,amount\r\nnext,1,1e0\r\nunit,1,\"1.0\"\r\n# note\r\n\r\n"
            );
        }

        #[test]
        fn integer_edits_never_round_large_fractional_input_to_an_integer() {
            let rule = ScalarRule {
                kind: ScalarKind::Integer,
                minimum: None,
                maximum: None,
            };
            for invalid in [
                "9007199254740993.1",
                "9223372036854775808",
                "1.0000000000000001",
                "2wrong",
            ] {
                assert!(rule.prepare(invalid).is_err(), "{invalid}");
            }
            for input in [
                "9007199254740993",
                "9007199254740993.0",
                "90071992547409930e-1",
            ] {
                assert_eq!(
                    rule.prepare(input).unwrap().value,
                    Value::Integer(9007199254740993)
                );
            }
        }
    }

    #[cfg(test)]
    mod collections {
        use crate::domain::document_edit::JsonDraft;
        use crate::domain::schema::{ScalarKind, ScalarRule};
        use crate::models::file_content::DraftEdit;
        use crate::models::file_content::SaveLayout;
        use crate::parsers::game;
        use std::sync::Arc;
        #[test]
        fn object_insert_obeys_requested_order_and_local_style() {
            let source = game::read_json(b"{\n\ta : 1, # alpha\n\tc : 3 # gamma\n}").unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            let value = ScalarRule {
                kind: ScalarKind::Integer,
                minimum: None,
                maximum: None,
            }
            .prepare("2")
            .unwrap();
            draft
                .edit(DraftEdit::ObjectSplice {
                    path: vec![],
                    index: 1,
                    delete: 0,
                    insert: vec![("b".into(), value)],
                })
                .unwrap();
            let actual = draft.save(SaveLayout::PreserveStructure).unwrap();
            assert_eq!(
                &*actual.text,
                "{\n\ta : 1, # alpha\n\t\"b\" : 2,\n\tc : 3 # gamma\n}"
            );
        }
        #[test]
        fn swapping_equal_values_is_a_structural_edit() {
            let source = game::read_json(b"{items:[1.0,1e0]}").unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            draft
                .edit(DraftEdit::Reorder {
                    path: vec!["items".into()],
                    order: vec![1, 0],
                })
                .unwrap();
            assert!(draft.modified());
            assert_eq!(
                &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                "{items:[1e0,1.0]}"
            );
        }
    }

    #[cfg(test)]
    mod nested_layout {
        use crate::domain::document_edit::JsonDraft;
        use crate::models::file_content::DraftEdit;
        use crate::models::file_content::SaveLayout;
        use crate::parsers::game;
        use std::sync::Arc;
        #[test]
        fn nested_comments_remain_in_layout_slots() {
            let source =
                game::read_json(b"{items:[{\n a:1.0 # first\n},{\n a:2e0 # second\n}]}").unwrap();
            let mut draft = JsonDraft::open(Arc::new(source));
            draft
                .edit(DraftEdit::Reorder {
                    path: vec!["items".into()],
                    order: vec![1, 0],
                })
                .unwrap();
            assert_eq!(
                &*draft.save(SaveLayout::PreserveStructure).unwrap().text,
                "{items:[{\n a:2e0 # first\n},{\n a:1.0 # second\n}]}"
            );
        }
    }

    #[cfg(test)]
    mod prepared_output {
        use crate::domain::schema;
        use crate::models::file_content::{JsonSource, JsonWrite, SaveLayout};
        use crate::models::file_value::Value;
        use serde_json::json;
        #[test]
        fn template_output_uses_schema_types_and_preserves_undeclared_values() {
            let definition = json!({"sections":[{"fields":[{"key":"rate","type":"float"},{"key":"count","type":"integer"}]}]});
            let prepared =
                schema::prepare_document(&json!({"rate":3,"count":"4.0f","other":5}), &definition)
                    .unwrap();
            let actual = JsonSource::create(&JsonWrite {
                content: prepared.value,
                target: prepared.target,
                layout: SaveLayout::Expanded,
            })
            .unwrap();
            assert_eq!(actual.content.get("rate"), Some(&Value::Float(3.0)));
            assert_eq!(actual.content.get("count"), Some(&Value::Integer(4)));
            assert_eq!(actual.content.get("other"), Some(&Value::Integer(5)));
            assert!(actual.text.contains("\"rate\": 3.0"));
        }
        #[test]
        fn unrepresentable_integer_preparation_keeps_the_callers_input() {
            let definition =
                json!({"root":{"type":"object","nested":[{"key":"count","type":"integer"}]}});
            let input = json!({"count":"4.25"});
            let before = input.clone();
            assert!(schema::prepare_document(&input, &definition).is_err());
            assert_eq!(input, before);
        }
        #[test]
        fn nested_output_formats_are_owned_by_the_nested_schema() {
            let definition = json!({"root":{"type":"object","nested":[{"key":"items","type":"array","item":{"type":"float"}}]}});
            let prepared =
                schema::prepare_document(&json!({"items":[3,"4f"]}), &definition).unwrap();
            let actual = JsonSource::create(&JsonWrite {
                content: prepared.value,
                target: prepared.target,
                layout: SaveLayout::Expanded,
            })
            .unwrap();
            assert_eq!(
                actual.content.get("items"),
                Some(&Value::Array(vec![Value::Float(3.0), Value::Float(4.0)]))
            );
        }
    }
}

fn input_error(message: &str) -> AppError {
    AppError::message("config.value_invalid", message)
}

impl DraftEdit {
    fn path(&self) -> &[Text] {
        match self {
            Self::Replace { path, .. }
            | Self::ArraySplice { path, .. }
            | Self::ObjectSplice { path, .. }
            | Self::Reorder { path, .. } => path,
        }
    }
}

/// Applies caller-owned edits to one exact source and prepares complete output data.
#[derive(Clone, Debug)]
pub struct JsonDraft {
    baseline: Arc<JsonSource>,
    content: Value,
    target: JsonTarget,
}
impl JsonDraft {
    pub fn open(source: Arc<JsonSource>) -> Self {
        Self {
            content: source.content.clone(),
            baseline: source,
            target: JsonTarget::source(Vec::new()),
        }
    }
    pub fn modified(&self) -> bool {
        !self.content.same_content_order(&self.baseline.content)
            || moved(&self.target, &mut Vec::new())
    }
    pub fn replace(&mut self, path: &[String], value: PreparedValue) -> AppResult<()> {
        self.edit(DraftEdit::Replace {
            path: path.iter().map(|part| Text::new(part.clone())).collect(),
            value,
        })
    }
    pub fn edit(&mut self, edit: DraftEdit) -> AppResult<()> {
        apply(&mut self.content, &mut self.target, &edit)
    }
    pub fn request(&self, layout: SaveLayout) -> JsonWrite {
        JsonWrite {
            content: self.content.clone(),
            target: if self.modified() {
                self.target.clone()
            } else {
                JsonTarget::source(Vec::new())
            },
            layout,
        }
    }
    pub fn save(&self, layout: SaveLayout) -> AppResult<Arc<JsonSource>> {
        self.baseline
            .write(&self.request(layout))
            .map(Arc::new)
            .map_err(Into::into)
    }
}

fn moved(target: &JsonTarget, path: &mut Vec<Text>) -> bool {
    if target.source.as_ref().is_some_and(|source| source != path) {
        return true;
    }
    match &target.children {
        Some(ChildFormats::Object(fields)) => fields.iter().any(|(key, child)| {
            path.push(key.clone());
            let changed = moved(child, path);
            path.pop();
            changed
        }),
        Some(ChildFormats::Array(items)) => items.iter().enumerate().any(|(index, child)| {
            path.push(Text::new(index.to_string()));
            let changed = moved(child, path);
            path.pop();
            changed
        }),
        None => false,
    }
}

fn at<'a>(
    mut value: &'a mut Value,
    mut target: &'a mut JsonTarget,
    path: &[Text],
) -> AppResult<(&'a mut Value, &'a mut JsonTarget)> {
    for part in path {
        target.materialize(value);
        (value, target) = match (value, target.children.as_mut()) {
            (Value::Object(fields), Some(ChildFormats::Object(formats))) => {
                let index = fields
                    .iter()
                    .position(|(key, _)| key == part)
                    .ok_or_else(|| input_error("修改路径不属于当前文档"))?;
                (&mut fields[index].1, &mut formats[index].1)
            }
            (Value::Array(items), Some(ChildFormats::Array(formats))) => {
                let index = part
                    .as_str()
                    .and_then(|s| s.parse::<usize>().ok())
                    .filter(|i| *i < items.len())
                    .ok_or_else(|| input_error("数组位置不属于当前文档"))?;
                (&mut items[index], &mut formats[index])
            }
            _ => return Err(input_error("修改路径要求对象或数组")),
        };
    }
    Ok((value, target))
}

fn apply(content: &mut Value, target: &mut JsonTarget, edit: &DraftEdit) -> AppResult<()> {
    let (content, target) = at(content, target, edit.path())?;
    match edit {
        DraftEdit::Replace { value, .. } => {
            *content = value.value.clone();
            *target = value.target.clone();
        }
        DraftEdit::ArraySplice {
            index,
            delete,
            insert,
            ..
        } => {
            target.materialize(content);
            let (Value::Array(items), Some(ChildFormats::Array(formats))) =
                (content, &mut target.children)
            else {
                return Err(input_error("此操作要求数组"));
            };
            items.splice(
                *index..index + delete,
                insert.iter().map(|value| value.value.clone()),
            );
            formats.splice(
                *index..index + delete,
                insert.iter().map(|value| value.target.clone()),
            );
        }
        DraftEdit::ObjectSplice {
            index,
            delete,
            insert,
            ..
        } => {
            target.materialize(content);
            let (Value::Object(fields), Some(ChildFormats::Object(formats))) =
                (content, &mut target.children)
            else {
                return Err(input_error("此操作要求对象"));
            };
            fields.splice(
                *index..index + delete,
                insert
                    .iter()
                    .map(|(key, value)| (key.clone(), value.value.clone())),
            );
            formats.splice(
                *index..index + delete,
                insert
                    .iter()
                    .map(|(key, value)| (key.clone(), value.target.clone())),
            );
        }
        DraftEdit::Reorder { order, .. } => {
            target.materialize(content);
            match (content, &mut target.children) {
                (Value::Object(items), Some(ChildFormats::Object(formats))) => {
                    reorder(items, order);
                    reorder(formats, order);
                }
                (Value::Array(items), Some(ChildFormats::Array(formats))) => {
                    reorder(items, order);
                    reorder(formats, order);
                }
                _ => return Err(input_error("此操作要求对象或数组")),
            }
        }
    }
    Ok(())
}
fn reorder<T: Clone>(items: &mut Vec<T>, order: &[usize]) {
    *items = order.iter().map(|index| items[*index].clone()).collect();
}
