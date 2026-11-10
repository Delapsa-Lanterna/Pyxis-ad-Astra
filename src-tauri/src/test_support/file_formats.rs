use crate::domain::schema;
use crate::errors::AppResult;
use crate::io;
use crate::models::EntityKind;
use crate::models::JsonDocumentOrigin;
use crate::models::file_content::RecordKind;
use crate::models::file_content::{ChildFormats, JsonSource, JsonTarget, JsonWrite, SaveLayout};
use crate::models::file_content::{DraftEdit, PreparedValue};
use crate::models::file_value::{Text, Value as FileValue};
use crate::models::{
    AssociatedSpecChange, AssociatedSpecMode, AssociatedSpecResolution, AssociatedSpecWrite,
    CsvRow, CsvRowPatch, CsvTable, CsvTableKey, FileVersion, IndexedConfigContent,
    IndexedConfigKind, JointEditSubmission, JointRecordTarget, JointValue, JsonSourceRestore,
    JsonWriteOptions, WriteResult,
};
use crate::services::{prepare_csv_associated_specs, save_csv_patch_snapshot};
use serde_json::Value;
use std::path::Path;
use std::slice;

pub(crate) fn read_json_value(path: &Path) -> AppResult<Value> {
    io::read_json_file(path)?
        .content
        .to_json()
        .map_err(Into::into)
}
pub(crate) fn read_versioned_json_value(path: &Path) -> AppResult<(FileVersion, Value)> {
    let (version, source) = io::read_versioned_json(path)?;
    Ok((version, source.content.to_json()?))
}
pub(crate) fn read_csv_table(path: &Path) -> AppResult<CsvTable> {
    let source = io::read_csv_data(path)?;
    let content = source.document.content;
    Ok(CsvTable {
        path: path.to_string_lossy().into_owned(),
        header: content.header.clone(),
        rows: content
            .records
            .into_iter()
            .map(|record| CsvRow {
                is_comment: record.kind == RecordKind::Comment,
                data: content
                    .header
                    .iter()
                    .zip(record.cells)
                    .map(|(key, value)| (key.clone(), Value::String(value)))
                    .collect(),
            })
            .collect(),
    })
}
pub(crate) fn json_write(value: &Value) -> JsonWrite {
    let prepared = schema::prepare_value(value).unwrap();
    JsonWrite {
        content: prepared.value,
        target: prepared.target,
        layout: SaveLayout::PreserveStructure,
    }
}
pub(crate) fn json_write_from_source(source: &JsonSource, value: &Value) -> JsonWrite {
    fn formats(value: &FileValue, old: Option<&FileValue>, path: Vec<Text>) -> JsonTarget {
        let mut target = if old.is_some() {
            JsonTarget::source(path.clone())
        } else {
            JsonTarget::generated(Default::default())
        };
        target.children = match value {
            FileValue::Object(fields) => Some(ChildFormats::Object(
                fields
                    .iter()
                    .map(|(key, value)| {
                        let mut next = path.clone();
                        next.push(key.clone());
                        let previous = old.and_then(|old| {
                            if let FileValue::Object(fields) = old {
                                fields
                                    .iter()
                                    .find(|(name, _)| name == key)
                                    .map(|(_, value)| value)
                            } else {
                                None
                            }
                        });
                        (key.clone(), formats(value, previous, next))
                    })
                    .collect(),
            )),
            FileValue::Array(items) => Some(ChildFormats::Array(
                items
                    .iter()
                    .enumerate()
                    .map(|(index, value)| {
                        let mut next = path.clone();
                        next.push(Text::new(index.to_string()));
                        let previous = old.and_then(|old| {
                            if let FileValue::Array(items) = old {
                                items.get(index)
                            } else {
                                None
                            }
                        });
                        formats(value, previous, next)
                    })
                    .collect(),
            )),
            _ => None,
        };
        target
    }
    let mut request = json_write(value);
    request.target = formats(&request.content, Some(&source.content), Vec::new());
    request
}
pub(crate) fn joint_submission(mut request: JointEditSubmission) -> JointEditSubmission {
    for record in &request.snapshot.records {
        let Some(JointValue::Present(value)) = request.values.get(&record.key) else {
            continue;
        };
        match record.target {
            JointRecordTarget::Spec { .. } => {
                if request.values.get(&record.key) == Some(&record.value)
                    && !request.create_overrides.contains(&record.key)
                    && !io::source_recreation_allowed(
                        &request.snapshot.root.mod_root,
                        &record.target.write().path,
                    )
                {
                    continue;
                }
                let write = if let Some(source) = &record.document {
                    json_write_from_source(
                        &JsonSource {
                            text: source.source.clone().into(),
                            content: source.content.clone(),
                        },
                        value,
                    )
                } else {
                    json_write(value)
                };
                request.documents.entry(record.key.clone()).or_insert(write);
            }
            JointRecordTarget::Csv { .. } => {
                let original = match &record.value {
                    JointValue::Present(value) => value.as_object(),
                    _ => None,
                };
                let changed = value
                    .as_object()
                    .unwrap()
                    .iter()
                    .filter(|(key, value)| {
                        request.create_overrides.contains(&record.key)
                            || original.and_then(|row| row.get(*key)) != Some(*value)
                    })
                    .map(|(key, _)| key.clone())
                    .collect::<Vec<_>>();
                let columns = request.csv_columns.entry(record.key.clone()).or_default();
                for key in changed {
                    if !columns.contains(&key) {
                        columns.push(key);
                    }
                }
            }
            _ => {}
        }
    }
    request
}
pub(crate) fn recovery_request(mut request: JsonSourceRestore) -> JsonSourceRestore {
    if matches!(&request.plan.request.origin, JsonDocumentOrigin::Entity { target } if matches!(target.kind, EntityKind::Variant | EntityKind::Skin))
    {
        request
            .documents
            .insert("file".into(), json_write(&request.baseline));
        return request;
    }
    for key in ["file", "descriptor"] {
        if let Some(value) = request.baseline.get(key) {
            request.documents.insert(key.into(), json_write(value));
        }
    }
    request
}
pub(crate) fn replace_edit(path: Vec<String>, value: &Value) -> DraftEdit {
    let write = json_write(value);
    DraftEdit::Replace {
        path: path.into_iter().map(Text::new).collect(),
        value: PreparedValue {
            value: write.content,
            target: write.target,
        },
    }
}
pub(crate) fn prepared_spec_write(
    session: &str,
    table: CsvTableKey,
    change: AssociatedSpecChange,
) -> AppResult<AssociatedSpecWrite> {
    let prepared =
        prepare_csv_associated_specs(session, table, slice::from_ref(&change))?.remove(0);
    let resolution = (!matches!(change, AssociatedSpecChange::Delete { .. })).then_some(
        AssociatedSpecResolution {
            mode: AssociatedSpecMode::Overwrite,
            original: prepared.original,
            destination: prepared.destination,
        },
    );
    Ok(AssociatedSpecWrite {
        change,
        target: prepared.target,
        resolution,
    })
}
pub(crate) fn indexed_content(kind: IndexedConfigKind, value: &Value) -> IndexedConfigContent {
    match kind {
        IndexedConfigKind::Faction => IndexedConfigContent::Faction {
            document: json_write(&value["file"]),
        },
        IndexedConfigKind::Mission => IndexedConfigContent::Mission {
            document: json_write(&value["descriptor"]),
            text: value["text"].as_str().unwrap_or_default().into(),
        },
    }
}
pub(crate) fn save_csv_patch(
    session: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    changes: Vec<AssociatedSpecChange>,
) -> AppResult<WriteResult> {
    save_csv_patch_with_json_options(session, table, patches, changes, Default::default())
}
pub(crate) fn save_csv_patch_with_json_options(
    session: &str,
    table: CsvTableKey,
    patches: Vec<CsvRowPatch>,
    changes: Vec<AssociatedSpecChange>,
    options: JsonWriteOptions,
) -> AppResult<WriteResult> {
    let associated = changes
        .into_iter()
        .map(|change| prepared_spec_write(session, table, change))
        .collect::<AppResult<Vec<_>>>()?;
    save_csv_patch_snapshot(session, table, patches, associated, options, None)
}
