use super::super::model::{
    self, MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvRow, SessionCsvTable,
};
use super::super::sources::{SourceReader, core, project_csv};
use crate::domain::csv_column_order;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::file_content::{CsvContent, CsvSource};
use crate::models::{CsvRow, CsvTable, CsvTableKey, EntitySummaries};
use crate::parsers::game;
use serde_json::Value;
use std::collections::{BTreeMap, VecDeque};
use std::path::Path;
use std::sync::Arc;

pub(in crate::services::project) fn build_table_entity_summaries_from(
    reader: &mut SourceReader,
    summaries: &EntitySummaries,
) -> AppResult<BTreeMap<CsvTableKey, usize>> {
    model::csv_table_specs()
        .iter()
        .map(|spec| {
            let count = match spec.entity_summary {
                Some(count) => count(summaries),
                None => {
                    reader.count(&reader.path(spec.rel_path)?, spec.entity_id_field, |_| true)?
                }
            };
            Ok((spec.key, count))
        })
        .collect()
}
pub(crate) fn session_table<'a>(
    session: &'a ProjectSession,
    key: &str,
) -> AppResult<&'a SessionCsvTable> {
    session
        .csv_tables
        .get(key)
        .map(Arc::as_ref)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {key}")))
}
pub(crate) fn session_table_mut<'a>(
    session: &'a mut ProjectSession,
    key: &str,
) -> AppResult<&'a mut SessionCsvTable> {
    session
        .csv_tables
        .get_mut(key)
        .map(Arc::make_mut)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {key}")))
}
pub(crate) fn registered_session_table(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&SessionCsvTable> {
    session_table(session, table.as_str())
}
pub(crate) fn loaded_csv_rows<'a>(
    table: &'a SessionCsvTable,
    label: &str,
) -> AppResult<&'a [SessionCsvRow]> {
    table.rows.as_deref().map(Vec::as_slice).ok_or_else(|| {
        AppError::message(
            "table.rows_not_loaded",
            format!("CSV rows are not loaded: {label}"),
        )
    })
}
pub(crate) fn loaded_registered_csv_rows(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&[SessionCsvRow]> {
    loaded_csv_rows(registered_session_table(session, table)?, table.as_str())
}
fn missing_source<'a>(
    session: &'a ProjectSession,
    relative: &str,
) -> AppResult<Option<&'a SessionCsvTable>> {
    let retained = session
        .csv_tables
        .values()
        .find(|table| table.path == relative && table.source.is_some())
        .map(Arc::as_ref);
    if retained.is_none()
        && session
            .source_versions
            .get(relative)
            .is_some_and(|version| version.fingerprint.is_some())
    {
        return Err(AppError::message(
            "write.recovery_content_missing",
            "缺失表格的完整文件基线尚未载入",
        )
        .at_path(Path::new(&session.manifest.mod_root).join(relative)));
    }
    Ok(retained)
}
pub(crate) fn read_retained_csv(session: &ProjectSession, relative: &str) -> AppResult<CsvTable> {
    if let Some(table) = session
        .csv_tables
        .values()
        .find(|table| table.path == relative && table.rows.is_some())
    {
        #[cfg(test)]
        io::record_csv_row_copies(table.rows.as_ref().expect("loaded CSV rows").len());
        return Ok(CsvTable {
            header: table.header.clone(),
            rows: loaded_csv_rows(table, relative)?
                .iter()
                .map(|row| CsvRow {
                    data: row.data.clone(),
                    is_comment: row.is_comment,
                })
                .collect(),
            path: Path::new(&session.manifest.mod_root)
                .join(relative)
                .to_string_lossy()
                .into_owned(),
        });
    }
    if let Some(source) = session
        .csv_tables
        .values()
        .find(|table| table.path == relative)
        .and_then(|table| table.source.as_ref())
    {
        return Ok(project_csv(
            source,
            &Path::new(&session.manifest.mod_root).join(relative),
        ));
    }
    let path = Path::new(&session.manifest.mod_root).join(relative);
    if !path.exists() {
        missing_source(session, relative)?;
        return Ok(CsvTable {
            header: Vec::new(),
            rows: Vec::new(),
            path: path.to_string_lossy().into_owned(),
        });
    }
    Ok(project_csv(&io::read_csv_data(&path)?, &path))
}
pub(crate) fn ensure_registered_table_rows(
    session: &mut ProjectSession,
    table: CsvTableKey,
) -> AppResult<()> {
    ensure_session_table_rows(session, table.as_str())
}
pub(crate) fn ensure_session_table_rows(session: &mut ProjectSession, key: &str) -> AppResult<()> {
    let table = session_table(session, key)?;
    if table.rows.is_some() {
        if table.source.is_none() {
            let path = Path::new(&session.manifest.mod_root).join(&table.path);
            if path.exists() {
                let (version, source) = io::read_versioned_csv(&path)?;
                if session
                    .source_versions
                    .get(&table.path)
                    .is_some_and(|loaded| *loaded != version)
                {
                    return Err(AppError::message(
                        "write.version_conflict",
                        "表格来源已变化，请刷新",
                    )
                    .at_path(&path));
                }
                session_table_mut(session, key)?.source = Some(Arc::new(source));
            }
        }
        return Ok(());
    }
    if table.missing_baseline {
        return Err(AppError::message(
            "write.recovery_content_missing",
            "缺失表格的完整文件基线尚未载入",
        )
        .at_path(Path::new(&session.manifest.mod_root).join(&table.path)));
    }
    let relative = table.path.clone();
    let path = Path::new(&session.manifest.mod_root).join(&relative);
    let (version, source) = if path.exists() {
        let (version, source) = io::read_versioned_csv(&path)?;
        (version, Some(Arc::new(source)))
    } else {
        let source = missing_source(session, &relative)?.and_then(|table| table.source.clone());
        (io::file_version(&path)?, source)
    };
    let csv = if let Some(source) = &source {
        project_csv(source, &path)
    } else {
        let mut header = if key == MISSION_LIST_TABLE_KEY {
            model::mission_list_default_header()
        } else {
            Vec::new()
        };
        if let Some(table) = CsvTableKey::from_key(key) {
            if let Some(root) = &session.manifest.starsector_root {
                header = core::load_core_csv_table(root, &relative)?
                    .map(|table| table.header.clone())
                    .unwrap_or_default();
            }
            if header.is_empty() {
                header = csv_column_order::standard_csv_columns(table);
            }
        }
        CsvTable {
            header,
            rows: Vec::new(),
            path: path.to_string_lossy().into_owned(),
        }
    };
    let table = session_table_mut(session, key)?;
    let start = table.next_row_seq;
    let rows = csv
        .rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| SessionCsvRow {
            row_key: format!("{key}:row:{}", start + index as u64),
            data: row.data,
            is_comment: row.is_comment,
            source_row: source.as_ref().map(|_| index),
        })
        .collect::<Vec<_>>();
    table.next_row_seq = start + rows.len() as u64;
    table.rows = Some(Arc::new(rows));
    table.row_index = None;
    table.header = csv.header;
    table.source = source;
    Arc::make_mut(&mut session.source_versions).insert(relative, version);
    Ok(())
}
/// A disk refresh matches business identities only; saves carry their explicit row mapping.
pub(in crate::services::project) fn table_snapshot_from_csv(
    state: &SessionCsvTable,
    table: CsvTableKey,
    csv: CsvTable,
) -> AppResult<(Vec<String>, Vec<SessionCsvRow>, u64)> {
    let identity = model::csv_table_spec(table).entity_id_field;
    let key = |row: &CsvRow| {
        (
            row.is_comment,
            row.data
                .get(identity)
                .and_then(Value::as_str)
                .map(str::to_owned),
            row.data
                .get("type")
                .and_then(Value::as_str)
                .map(str::to_owned),
        )
    };
    let mut known = BTreeMap::<(bool, Option<String>, Option<String>), VecDeque<String>>::new();
    for row in state.rows.as_deref().map(Vec::as_slice).unwrap_or(&[]) {
        let row_key = key(&CsvRow {
            data: row.data.clone(),
            is_comment: row.is_comment,
        });
        known
            .entry(row_key)
            .or_default()
            .push_back(row.row_key.clone());
    }
    let mut sequence = state.next_row_seq;
    let rows = csv
        .rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            let signature = key(&row);
            let row_key = known
                .get_mut(&signature)
                .and_then(VecDeque::pop_front)
                .unwrap_or_else(|| {
                    let row_key = format!("{}:row:{sequence}", table.as_str());
                    sequence += 1;
                    row_key
                });
            Ok(SessionCsvRow {
                row_key,
                data: row.data,
                is_comment: row.is_comment,
                source_row: Some(index),
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok((csv.header, rows, sequence))
}
pub(in crate::services::project) fn read_table_snapshot(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<(Vec<String>, Vec<SessionCsvRow>, u64)> {
    let state = registered_session_table(session, table)?;
    let csv = read_retained_csv(session, &state.path)?;
    table_snapshot_from_csv(state, table, csv)
}
pub(in crate::services::project) fn empty_csv_source(
    header: &[String],
) -> AppResult<Arc<CsvSource>> {
    let content = CsvContent {
        header: header.to_vec(),
        records: Vec::new(),
    };
    let text = game::write_csv(&content)?;
    Ok(Arc::new(game::read_csv(text.as_bytes())?))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::io::csv_files;
    use crate::io::write_utf8_no_bom;
    use crate::models::{EntitySummaries, ProjectManifest};
    use crate::services::project::test_support::project_workspace;
    use serde_json::{Map, Value};
    use std::collections::{BTreeMap, HashMap};
    use std::fs;

    #[test]
    fn ensure_session_table_rows_rejects_unknown_table() {
        let mut session = ProjectSession {
            documents: Default::default(),
            reference_revision: 0,
            references: Vec::new(),
            loaded_edit_targets: Vec::new(),
            content_pending: false,
            source_versions: Default::default(),
            source_scopes: Default::default(),
            source_stamps: Default::default(),
            manifest: ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: "mod".to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: Default::default(),
            faction_blueprint_tags: HashMap::new(),
            csv_tables: BTreeMap::new(),
            ship_files: Default::default(),
            variant_files: Default::default(),
            skin_files: Default::default(),
            variant_warnings: Vec::new(),
            skin_warnings: Vec::new(),
            weapon_specs: Default::default(),
            projectile_specs: Default::default(),
            system_files: Default::default(),
            skill_files: Default::default(),
        };

        let error = ensure_session_table_rows(&mut session, "missing")
            .unwrap_err()
            .to_string();

        assert!(error.contains("unknown table: missing"));
    }

    #[test]
    fn ensure_session_table_rows_preserves_comment_identity_and_business_columns() {
        let root = project_workspace("csv_business_metadata_boundary");
        fs::create_dir_all(root.join("data/hulls")).unwrap();
        fs::create_dir_all(root.join("data/characters/skills")).unwrap();
        write_utf8_no_bom(
                &root.join("data/hulls/ship_data.csv"),
                "id,tags,_faction,_rowKey\r\nship,demo_bp,business,business-key\r\n#comment,,,\r\n,,,\r\n",
            )
            .unwrap();
        write_utf8_no_bom(
            &root.join("data/characters/skills/skill_data.csv"),
            "id,name\r\nskill,Skill\r\n",
        )
        .unwrap();
        let mut session = ProjectSession {
            documents: Default::default(),
            reference_revision: 0,
            references: Vec::new(),
            loaded_edit_targets: Vec::new(),
            content_pending: false,
            source_versions: Default::default(),
            source_scopes: Default::default(),
            source_stamps: Default::default(),
            manifest: ProjectManifest {
                base_versions: Vec::new(),
                session_id: "test".to_string(),
                mod_root: root.to_string_lossy().to_string(),
                starsector_root: None,
                core_available: false,
                associated_spec_tables: Vec::new(),
                mod_info: Some(Value::Object(Map::new())),
                table_summaries: BTreeMap::new(),
                table_entity_summaries: BTreeMap::new(),
                entity_summaries: EntitySummaries::default(),
                warnings: Vec::new(),
            },
            faction_files: Default::default(),
            faction_blueprint_tags: HashMap::from([("demo_bp".to_string(), "demo".to_string())]),
            csv_tables: BTreeMap::from([
                (
                    CsvTableKey::Ships.as_str().to_string(),
                    SessionCsvTable {
                        missing_baseline: false,
                        row_index: None,
                        header: Vec::new(),
                        path: "data/hulls/ship_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        source: None,
                    },
                ),
                (
                    CsvTableKey::Skills.as_str().to_string(),
                    SessionCsvTable {
                        missing_baseline: false,
                        row_index: None,
                        header: Vec::new(),
                        path: "data/characters/skills/skill_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        source: None,
                    },
                ),
            ])
            .into_iter()
            .map(|(key, table)| (key, Arc::new(table)))
            .collect(),
            ship_files: Default::default(),
            variant_files: Default::default(),
            skin_files: Default::default(),
            variant_warnings: Vec::new(),
            skin_warnings: Vec::new(),
            weapon_specs: Default::default(),
            projectile_specs: Default::default(),
            system_files: Default::default(),
            skill_files: Default::default(),
        };

        ensure_session_table_rows(&mut session, CsvTableKey::Ships.as_str()).unwrap();
        ensure_session_table_rows(&mut session, CsvTableKey::Skills.as_str()).unwrap();

        let ships = loaded_registered_csv_rows(&session, CsvTableKey::Ships).unwrap();
        let skills = loaded_registered_csv_rows(&session, CsvTableKey::Skills).unwrap();
        assert_eq!(ships[0].data["_faction"], "business");
        assert!(!ships[0].is_comment);
        assert!(ships[1].is_comment);
        assert!(!skills[0].is_comment);
        assert_eq!(ships[0].data["_rowKey"], "business-key");

        let expected = session.csv_tables[CsvTableKey::Ships.as_str()].clone();
        fs::remove_file(root.join(&expected.path)).unwrap();
        csv_files::take_csv_work();
        let (header, rows, sequence) = read_table_snapshot(&session, CsvTableKey::Ships).unwrap();
        let retained = read_retained_csv(&session, &expected.path).unwrap();
        assert_eq!(header, expected.header);
        let saved_rows = expected.rows.clone().unwrap();
        assert_eq!(rows.len(), saved_rows.len());
        for (restored, saved) in rows.iter().zip(saved_rows.iter()) {
            assert_eq!(restored.row_key, saved.row_key);
            assert_eq!(restored.data, saved.data);
            assert_eq!(restored.is_comment, saved.is_comment);
        }
        assert_eq!(sequence, expected.next_row_seq);
        assert_eq!(retained.header, header);
        assert_eq!(retained.rows.len(), rows.len());
        for (restored, saved) in retained.rows.iter().zip(&rows) {
            assert_eq!(restored.data, saved.data);
            assert_eq!(restored.is_comment, saved.is_comment);
        }
        assert_eq!(csv_files::take_csv_work(), (0, 0, 2 * rows.len()));

        session
            .csv_tables
            .get_mut(CsvTableKey::Ships.as_str())
            .map(Arc::make_mut)
            .unwrap()
            .rows = None;
        session
            .csv_tables
            .get_mut(CsvTableKey::Ships.as_str())
            .map(Arc::make_mut)
            .unwrap()
            .source = None;
        for error in [
            read_table_snapshot(&session, CsvTableKey::Ships)
                .err()
                .expect("missing unloaded CSV fails"),
            read_retained_csv(&session, &expected.path).unwrap_err(),
            ensure_registered_table_rows(&mut session, CsvTableKey::Ships).unwrap_err(),
        ] {
            assert_eq!(error.code(), "write.recovery_content_missing");
            assert_eq!(
                error.location().unwrap().path.as_deref(),
                root.join(&expected.path).to_str()
            );
        }
        root.close().unwrap();
    }
}
