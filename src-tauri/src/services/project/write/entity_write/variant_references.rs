use crate::domain::document_edit::JsonDraft;
use crate::domain::schema::{ScalarKind, ScalarRule};
use crate::errors::AppResult;
use crate::io::FileChangeSetBuilder;
use crate::models::file_content::DraftEdit;
use crate::models::file_content::SaveLayout;
use crate::models::file_value::{Text, Value};
use crate::models::{EntityEditTarget, EntityKind};
use crate::services::project::model::ProjectSession;

pub(in crate::services::project) fn module_paths(
    content: &Value,
    previous: &str,
) -> Vec<Vec<Text>> {
    let mut paths = Vec::new();
    let mut visit = |fields: &[(Text, Value)], prefix: Vec<Text>| {
        for (key, value) in fields {
            if matches!(value,Value::Text(text) if text.equals(previous)) {
                let mut path = prefix.clone();
                path.push(key.clone());
                paths.push(path);
            }
        }
    };
    match content.get("modules") {
        Some(Value::Object(fields)) => visit(fields, vec!["modules".into()]),
        Some(Value::Array(items)) => {
            for (index, item) in items.iter().enumerate() {
                if let Value::Object(fields) = item {
                    visit(fields, vec!["modules".into(), Text::new(index.to_string())]);
                }
            }
        }
        _ => {}
    }
    paths
}
pub(in crate::services::project) fn stage_variant_parents(
    session: &ProjectSession,
    before: &EntityEditTarget,
    after: &EntityEditTarget,
    builder: &mut FileChangeSetBuilder,
) -> AppResult<()> {
    if before.kind != EntityKind::Variant || before.id == after.id {
        return Ok(());
    }
    let previous = before.id.as_str();
    let next = after.id.as_str();
    let parents = session
        .variant_files
        .iter()
        .filter(|file| file.variant_id != previous)
        .filter_map(|file| {
            let source = &session.documents[&file.rel_path];
            let paths = module_paths(&source.content, previous);
            (!paths.is_empty()).then(|| (file.rel_path.clone(), source.clone(), paths))
        })
        .collect::<Vec<_>>();
    let rule = ScalarRule {
        kind: ScalarKind::Text,
        minimum: None,
        maximum: None,
    };
    for (relative, source, paths) in parents {
        let mut draft = JsonDraft::open(source);
        for path in paths {
            draft.edit(&DraftEdit::Replace {
                path,
                value: rule.prepare(next)?,
            })?;
        }
        builder.text_file(
            relative,
            Some(draft.save(SaveLayout::PreserveStructure)?.text.to_string()),
        )?;
    }
    Ok(())
}
