#![cfg(test)]
use super::super::model::csv_table_specs;
use crate::domain::csv_column_order::standard_csv_columns;
use crate::io::read_csv_data;
#[cfg(test)]
use crate::models::SaveAction;
use crate::models::{CsvSave, CsvSearchField};
#[cfg(test)]
use crate::services::project::PerformanceTrace;
use crate::services::project::test_support::project_workspace;
#[cfg(test)]
use crate::services::project_save;
use crate::services::{project, query_csv_table_index};
#[cfg(test)]
use std::fs;

#[test]
fn csv_headers_and_first_save() {
    for spec in csv_table_specs() {
        for source in ["existing", "core", "schema"] {
            let root = project_workspace("csv_first_save");
            let mod_root = root.join("mod");
            let game = root.join("game");
            let core = game.join("starsector-core");
            fs::create_dir_all(&mod_root).unwrap();
            fs::create_dir_all(&core).unwrap();
            let expected = match source {
                "existing" => vec!["custom".to_string(), spec.entity_id_field.to_string()],
                "core" => vec![spec.entity_id_field.to_string(), "coreColumn".to_string()],
                _ => standard_csv_columns(spec.key),
            };
            if source != "schema" {
                let path = if source == "existing" {
                    mod_root.join(spec.rel_path)
                } else {
                    core.join(spec.rel_path)
                };
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, expected.join(",") + "\n").unwrap();
            }
            let manifest = project::open_project_session_traced(
                &mod_root,
                Some(&game),
                &mut PerformanceTrace::new("test"),
            )
            .unwrap();
            let index = query_csv_table_index(
                &manifest.session_id,
                spec.key,
                0,
                None,
                CsvSearchField::IdName,
            )
            .unwrap();
            assert_eq!(index.header, expected, "{}: {source}", spec.key.as_str());
            assert_eq!(index.total_rows, 0);
            let file = mod_root.join(spec.rel_path);
            assert_eq!(file.exists(), source == "existing");
            let result = project_save::execute_save_action(SaveAction::SaveCsvPatch(CsvSave {
                row_order: None,
                base_versions: index.base_versions,
                session_id: manifest.session_id.clone(),
                mod_root: manifest.mod_root,
                table: spec.key,
                patches: Vec::new(),
                associated_specs: Vec::new(),
                json_write: Default::default(),
            }))
            .unwrap();
            let saved = read_csv_data(&file).unwrap();
            assert_eq!(saved.header, expected, "{}: {source}", spec.key.as_str());
            assert!(saved.rows.is_empty());
            assert_eq!(result.changes.len(), 1);
            project::close_project_session(manifest.session_id).unwrap();
            project::invalidate_core_cache(&game.to_string_lossy()).unwrap();
            root.close().unwrap();
        }
    }
}
