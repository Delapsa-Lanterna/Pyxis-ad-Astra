use super::super::{
    cache::{
        ensure_registered_table_rows, loaded_registered_csv_rows, lock_ready_session,
        registered_session_table, session_handle,
    },
    definitions::table_definitions::csv_table_row_resource_ref,
    model::SessionCsvRow,
};
use crate::{
    errors::{AppError, AppResult},
    models::{
        CsvRowPreview, CsvRowRecord, CsvSearchField, CsvTableIndex, CsvTableKey, CsvTableRowsRead,
    },
};

pub fn query_csv_table_index(
    session_id: &str,
    table: CsvTableKey,
    initial_count: usize,
    search: Option<String>,
    search_field: CsvSearchField,
) -> AppResult<CsvTableIndex> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let table_data = registered_session_table(&session, table)?;
    let rows_ref = loaded_registered_csv_rows(&session, table)?;
    let search = search.unwrap_or_default().trim().to_lowercase();
    let filtered: Vec<&SessionCsvRow> = rows_ref
        .iter()
        .filter(|row| csv_row_matches(row, &search, search_field, table))
        .collect();
    let rows = filtered
        .iter()
        .take(initial_count)
        .map(|row| CsvRowRecord {
            row_key: row.row_key.clone(),
            data: row.data.clone(),
            is_comment: row.is_comment,
        })
        .collect();
    let mut base_versions = vec![super::super::versions::version_for_path(
        &session,
        &table_data.path,
    )];
    if let Some(spec) = crate::domain::editor_config_definitions::associated_spec_definition(table)
    {
        base_versions.extend(
            session
                .source_versions
                .iter()
                .filter(|(path, _)| {
                    path.starts_with(&format!("{}/", spec.dir)) && path.ends_with(spec.extension)
                })
                .map(|(_, version)| version.clone()),
        );
    }
    Ok(CsvTableIndex {
        base_versions,
        table,
        header: table_data.header.clone(),
        total_rows: rows_ref.len(),
        row_keys: filtered.iter().map(|row| row.row_key.clone()).collect(),
        rows,
    })
}

pub fn query_csv_table_rows(
    session_id: &str,
    table: CsvTableKey,
    row_keys: Vec<String>,
) -> AppResult<CsvTableRowsRead> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let state = session
        .csv_tables
        .get_mut(table.as_str())
        .expect("registered CSV table");
    let rows = state.rows.as_ref().expect("CSV rows have been loaded");
    let positions = state.row_index.get_or_insert_with(|| {
        rows.iter()
            .enumerate()
            .map(|(index, row)| (row.row_key.clone(), index))
            .collect()
    });
    let rows = row_keys
        .into_iter()
        .map(|row_key| {
            let index = *positions.get(&row_key).ok_or_else(|| {
                AppError::message(
                    "table.row_key_unknown",
                    format!("CSV row key does not exist: {row_key}"),
                )
            })?;
            let row = &rows[index];
            Ok(CsvRowRecord {
                row_key,
                data: row.data.clone(),
                is_comment: row.is_comment,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    let base_versions = vec![super::super::versions::version_for_path(
        &session,
        &registered_session_table(&session, table)?.path,
    )];
    Ok(CsvTableRowsRead {
        base_versions,
        table,
        rows,
    })
}

#[cfg(test)]
pub fn query_csv_table_window(
    session_id: &str,
    table: CsvTableKey,
    start: usize,
    count: usize,
    search: Option<String>,
    search_field: CsvSearchField,
) -> AppResult<CsvTableIndex> {
    let mut index = query_csv_table_index(session_id, table, start + count, search, search_field)?;
    index.rows = index.rows.into_iter().skip(start).collect();
    Ok(index)
}

pub fn query_csv_row_preview(
    session_id: &str,
    table: CsvTableKey,
    row_key: &str,
) -> AppResult<CsvRowPreview> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    ensure_registered_table_rows(&mut session, table)?;
    let row = loaded_registered_csv_rows(&session, table)?
        .iter()
        .find(|row| row.row_key == row_key);
    Ok(CsvRowPreview {
        resource_ref: row
            .filter(|row| !row.is_comment)
            .and_then(|row| csv_table_row_resource_ref(&session, table, &row.data)),
    })
}

fn csv_row_matches(
    row: &SessionCsvRow,
    search: &str,
    field: CsvSearchField,
    table: CsvTableKey,
) -> bool {
    if search.is_empty() {
        return true;
    }
    let id_field = super::super::model::csv_table_spec(table).entity_id_field;
    let matches = |key: &str| {
        row.data
            .get(key)
            .and_then(serde_json::Value::as_str)
            .is_some_and(|value| value.to_lowercase().contains(search))
    };
    match field {
        CsvSearchField::IdName => matches(id_field) || matches("name"),
        CsvSearchField::Id => matches(id_field),
        CsvSearchField::Name => matches("name"),
        CsvSearchField::Tags => matches("tags"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn index_and_keyed_batches_preserve_identity_and_refresh_the_lookup_after_a_write() {
        let root = crate::testutil::temp_dir("csv_keyed_batches");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        crate::io::write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name\na,Alpha\n#comment,Comment\n,,\nb,Beta\n",
        )
        .unwrap();
        let mut trace = super::super::super::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::super::open_project_session_traced(&root, None, &mut trace).unwrap();
        let index = query_csv_table_index(
            &manifest.session_id,
            CsvTableKey::Ships,
            1,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        assert_eq!(index.rows.len(), 1);
        assert_eq!(index.row_keys.len(), 4);
        let requested = vec![
            index.row_keys[3].clone(),
            index.row_keys[1].clone(),
            index.row_keys[2].clone(),
        ];
        let batch =
            query_csv_table_rows(&manifest.session_id, CsvTableKey::Ships, requested.clone())
                .unwrap();
        assert_eq!(
            batch
                .rows
                .iter()
                .map(|row| row.row_key.clone())
                .collect::<Vec<_>>(),
            requested
        );
        assert_eq!(batch.rows[0].data["id"], "b");
        assert!(batch.rows[1].is_comment);
        assert_eq!(batch.rows[2].data["id"], "");
        let saved = crate::commands::save_csv_patch(crate::models::SaveCsvPatchPayload {
            session_id: manifest.session_id.clone(),
            mod_root: manifest.mod_root.clone(),
            table: CsvTableKey::Ships,
            base_versions: index.base_versions.clone(),
            patches: vec![],
            associated_specs: vec![],
            json_write: Default::default(),
            row_order: Some(index.row_keys.iter().rev().cloned().collect()),
        })
        .unwrap();
        assert_eq!(saved.changes.len(), 1);
        let batch =
            query_csv_table_rows(&manifest.session_id, CsvTableKey::Ships, requested).unwrap();
        assert_eq!(batch.rows[0].data["id"], "b");
        assert!(batch.rows[1].is_comment);
        let too_many = crate::commands::query_csv_table_rows(crate::models::CsvTableRowsPayload {
            session_id: manifest.session_id.clone(),
            table: CsvTableKey::Ships,
            row_keys: vec![index.row_keys[0].clone(); 161],
        });
        assert!(too_many.is_err());
        assert!(
            query_csv_table_rows(
                &manifest.session_id,
                CsvTableKey::Ships,
                vec!["unknown".into()]
            )
            .is_err()
        );
        super::super::super::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn search_fields_only_match_their_business_columns() {
        let row = SessionCsvRow {
            row_key: "row".to_string(),
            is_comment: false,
            data: json!({"id":"Alpha","name":"银河舰船","tags":"demo_bp,RARE","description":"only-description"})
                .as_object().unwrap().clone(),
        };
        for (field, search, expected) in [
            (CsvSearchField::IdName, "alpha", true),
            (CsvSearchField::IdName, "银河", true),
            (CsvSearchField::IdName, "demo", false),
            (CsvSearchField::Id, "alpha", true),
            (CsvSearchField::Id, "银河", false),
            (CsvSearchField::Name, "银河", true),
            (CsvSearchField::Name, "alpha", false),
            (CsvSearchField::Tags, "bp", true),
            (CsvSearchField::Tags, "rare", true),
            (CsvSearchField::Tags, "alpha", false),
            (CsvSearchField::IdName, "only-description", false),
        ] {
            assert_eq!(
                csv_row_matches(&row, search, field, CsvTableKey::Ships),
                expected
            );
        }
        for field in [
            CsvSearchField::IdName,
            CsvSearchField::Id,
            CsvSearchField::Name,
            CsvSearchField::Tags,
        ] {
            assert!(csv_row_matches(&row, "", field, CsvTableKey::Ships));
        }
    }

    #[test]
    fn search_uses_registered_ids_and_preserves_comment_rows() {
        let row = SessionCsvRow {
            row_key: "row".to_string(),
            is_comment: true,
            data: json!({"variant id":"#demo","id":"wrong-field"})
                .as_object()
                .unwrap()
                .clone(),
        };
        for field in [CsvSearchField::IdName, CsvSearchField::Id] {
            assert!(csv_row_matches(
                &row,
                "demo",
                field,
                CsvTableKey::SimOpponents
            ));
            assert!(!csv_row_matches(
                &row,
                "wrong-field",
                field,
                CsvTableKey::SimOpponents
            ));
        }
        assert!(!csv_row_matches(
            &row,
            "demo",
            CsvSearchField::Name,
            CsvTableKey::SimOpponents
        ));
        assert!(!csv_row_matches(
            &row,
            "demo",
            CsvSearchField::Tags,
            CsvTableKey::SimOpponents
        ));
    }

    #[test]
    fn window_search_normalizes_text_and_returns_exact_counts() {
        let root = crate::testutil::temp_dir("csv_search_fields");
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        crate::io::write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"),
            "id,name,tags,description\r\nAlpha,银河,demo_bp,description\r\nBeta,Alpha,rare,description\r\n#Alpha,注释,disabled,description\r\n").unwrap();
        let mut trace = super::super::super::PerformanceTrace::new("project.openSession");
        let manifest =
            super::super::super::open_project_session_traced(&root, None, &mut trace).unwrap();
        for (field, search, count) in [
            (CsvSearchField::IdName, "  ALPHA  ", 3),
            (CsvSearchField::Id, "alpha", 2),
            (CsvSearchField::Name, "alpha", 1),
            (CsvSearchField::Name, "银河", 1),
            (CsvSearchField::Tags, "BP", 1),
            (CsvSearchField::IdName, "description", 0),
            (CsvSearchField::Tags, "  ", 3),
        ] {
            let window = query_csv_table_window(
                &manifest.session_id,
                CsvTableKey::Ships,
                0,
                80,
                Some(search.to_string()),
                field,
            )
            .unwrap();
            assert_eq!(window.total_rows, 3);
            assert_eq!(window.row_keys.len(), count);
            assert_eq!(window.rows.len(), count);
        }
        super::super::super::close_project_session(manifest.session_id).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
