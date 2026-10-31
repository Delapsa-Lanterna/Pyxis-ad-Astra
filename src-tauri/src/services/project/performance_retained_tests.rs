#![cfg(test)]
use crate::services::project::test_support::project_workspace;

use super::query::csv_window::{query_csv_table_index, query_csv_table_rows};
use super::{PerformanceTrace, close_project_session, open_project_session_traced};
use crate::models::{CsvSearchField, CsvTableKey, FileVersion};
use std::time::Instant;

struct ReadIndex {
    total: usize,
    keys: Vec<String>,
    versions: Vec<FileVersion>,
    first_rows: usize,
}

fn summarize(mut values: Vec<f64>) -> serde_json::Value {
    values.sort_by(f64::total_cmp);
    serde_json::json!({
        "n": values.len(),
        "min": values[0],
        "max": values[values.len() - 1],
        "mean": values.iter().sum::<f64>() / values.len() as f64,
        "median": if values.len().is_multiple_of(2) { (values[values.len() / 2 - 1] + values[values.len() / 2]) / 2.0 } else { values[values.len() / 2] },
        "p95": values[(values.len() * 95).div_ceil(100) - 1],
    })
}

fn read_index(session: &str) -> ReadIndex {
    let index = query_csv_table_index(
        session,
        CsvTableKey::Ships,
        240,
        None,
        CsvSearchField::IdName,
    )
    .unwrap();
    ReadIndex {
        total: index.total_rows,
        keys: index.row_keys,
        versions: index.base_versions,
        first_rows: index.rows.len(),
    }
}

#[test]
#[ignore = "explicit production CSV performance run"]
fn retained_csv_performance() {
    for count in [50, 300, 2000] {
        let root = project_workspace(&format!("retained_csv_perf_{count}"));
        std::fs::create_dir_all(root.join("data/hulls")).unwrap();
        let header = std::iter::once("id".to_string())
            .chain((1..40).map(|column| format!("field_{column}")))
            .collect::<Vec<_>>()
            .join(",");
        let mut text = header + "\n";
        for row in 0..count {
            text.push_str(
                &std::iter::once(format!("row_{row}"))
                    .chain((1..40).map(|_| row.to_string()))
                    .collect::<Vec<_>>()
                    .join(","),
            );
            text.push('\n');
        }
        crate::io::write_utf8_no_bom(&root.join("data/hulls/ship_data.csv"), &text).unwrap();
        let mut cold = Vec::new();
        let mut opening = Vec::new();
        for _ in 0..30 {
            let started = Instant::now();
            let mut trace = PerformanceTrace::new("retained.csv.performance");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            opening.push(started.elapsed().as_secs_f64() * 1000.0);
            let started = Instant::now();
            let index = read_index(&manifest.session_id);
            cold.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(index.total, count);
            assert_eq!(index.first_rows, count.min(240));
            close_project_session(manifest.session_id).unwrap();
        }
        let mut trace = PerformanceTrace::new("retained.csv.performance");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let mut index = read_index(&manifest.session_id);
        let mut warm = Vec::new();
        let mut rows = Vec::new();
        let mut writes = Vec::new();
        let mut search = Vec::new();
        crate::io::csv_files::take_csv_work();
        for sample in 0..30 {
            let started = Instant::now();
            let current = read_index(&manifest.session_id);
            warm.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(current.total, count);
            let batch = count.min(160);
            let start = (sample * 617) % (count - batch + 1);
            let started = Instant::now();
            let loaded = query_csv_table_rows(
                &manifest.session_id,
                CsvTableKey::Ships,
                index.keys[start..start + batch].to_vec(),
            )
            .unwrap();
            rows.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(loaded.rows.len(), batch);
            let started = Instant::now();
            let found = query_csv_table_index(
                &manifest.session_id,
                CsvTableKey::Ships,
                10,
                Some("row_".into()),
                CsvSearchField::IdName,
            )
            .unwrap();
            search.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(found.total_rows, count);
            assert_eq!(found.rows.len(), count.min(10));
        }
        let query_work = crate::io::csv_files::take_csv_work();
        assert_eq!(
            query_work,
            (0, 0, 30 * (count.min(240) + count.min(160) + count.min(10)))
        );
        for _ in 0..30 {
            let started = Instant::now();
            let result = crate::services::project_save::execute_save_action(
                crate::models::SaveAction::SaveCsvPatch(crate::models::CsvSave {
                    session_id: manifest.session_id.clone(),
                    mod_root: manifest.mod_root.clone(),
                    table: CsvTableKey::Ships,
                    base_versions: index.versions.clone(),
                    patches: vec![],
                    associated_specs: vec![],
                    json_write: Default::default(),
                    row_order: Some(index.keys.iter().rev().cloned().collect()),
                }),
            )
            .unwrap();
            writes.push(started.elapsed().as_secs_f64() * 1000.0);
            assert_eq!(result.changes.len(), 1);
            index.keys.reverse();
            index.versions = result.base_versions;
        }
        let save_work = crate::io::csv_files::take_csv_work();
        let mut recovery = Vec::new();
        let file = root.join("data/hulls/ship_data.csv");
        for _ in 0..7 {
            std::fs::remove_file(&file).unwrap();
            let started = Instant::now();
            let result = crate::io::with_write_retry(
                &root,
                |_| panic!("retained CSV recovery is complete"),
                || {
                    crate::io::accept_source_recreation(
                        &manifest.mod_root,
                        vec![
                            std::path::Path::new(&manifest.mod_root)
                                .join("data/hulls/ship_data.csv")
                                .to_string_lossy()
                                .into(),
                        ],
                    )?;
                    crate::services::project_save::execute_save_action(
                        crate::models::SaveAction::SaveCsvPatch(crate::models::CsvSave {
                            session_id: manifest.session_id.clone(),
                            mod_root: manifest.mod_root.clone(),
                            table: CsvTableKey::Ships,
                            base_versions: index.versions.clone(),
                            patches: vec![],
                            associated_specs: vec![],
                            json_write: Default::default(),
                            row_order: None,
                        }),
                    )
                },
            )
            .unwrap();
            recovery.push(started.elapsed().as_secs_f64() * 1000.0);
            index.versions = result.base_versions;
        }
        let recovery_work = crate::io::csv_files::take_csv_work();
        assert_eq!(recovery_work.0, 0);
        assert_eq!(recovery_work.1, 7);
        assert_eq!(recovery_work.2, count * 7);
        println!(
            "RETAINED_CSV_PERF {}",
            serde_json::json!({"count":count,"columns":40,"bytes":text.len(),"openSession":summarize(opening.clone()),"coldIndex":summarize(cold.clone()),"warmIndex":summarize(warm.clone()),"rows":summarize(rows.clone()),"search":summarize(search.clone()),"saveOrder":summarize(writes.clone()),"recovery":summarize(recovery.clone()),"queryWork":query_work,"saveWork":save_work,"recoveryWork":recovery_work,"samples":{"openSession":opening,"coldIndex":cold,"warmIndex":warm,"rows":rows,"search":search,"saveOrder":writes,"recovery":recovery}})
        );
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
