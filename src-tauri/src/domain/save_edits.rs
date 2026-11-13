use super::document_edit::JsonDraft;
use crate::errors::AppResult;
use crate::models::file_content::{DraftEdit, JsonSource, JsonWrite, SaveLayout};
#[cfg(test)]
use crate::parsers::game;
use std::sync::Arc;

pub fn prepare_json_write(
    source: Arc<JsonSource>,
    edits: &[DraftEdit],
    layout: SaveLayout,
) -> AppResult<JsonWrite> {
    let mut draft = JsonDraft::open(source);
    for edit in edits {
        draft.edit(edit)?;
    }
    Ok(draft.request(layout))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::file_formats;
    use serde_json::json;

    #[test]
    fn queued_field_changes_apply_to_current_content_in_order() {
        let source =
            Arc::new(game::read_json(br#"{"speed":80,"name":"before","unknown":42}"#).unwrap());
        let edits = [
            file_formats::replace_edit(vec!["speed".into()], &json!(100)),
            file_formats::replace_edit(vec!["name".into()], &json!("after")),
        ];
        let first = source
            .write(
                &prepare_json_write(source.clone(), &edits, SaveLayout::PreserveStructure).unwrap(),
            )
            .unwrap();
        assert_eq!(
            first.content.to_json().unwrap(),
            json!({"speed":100,"name":"after","unknown":42})
        );
        let source = Arc::new(first);
        let second = prepare_json_write(
            source,
            &[file_formats::replace_edit(
                vec!["speed".into()],
                &json!(120),
            )],
            SaveLayout::PreserveStructure,
        )
        .unwrap();
        assert_eq!(second.content.to_json().unwrap()["speed"], 120);
    }
}
