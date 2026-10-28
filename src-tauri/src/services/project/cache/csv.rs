use crate::{
    errors::{AppError, AppResult},
    io::read_versioned_csv,
    models::{CsvTable, CsvTableKey},
};
use std::path::Path;

use super::super::model::{
    MISSION_LIST_TABLE_KEY, ProjectSession, SessionCsvRow, SessionCsvTable,
    mission_list_default_header,
};
use super::super::sources::core::load_core_csv_table;

pub(in crate::services::project) fn read_table_snapshot(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<(Vec<String>, Vec<SessionCsvRow>, u64)> {
    let state = registered_session_table(session, table)?;
    let path = Path::new(&session.manifest.mod_root).join(&state.path);
    let csv = if path
        .try_exists()
        .map_err(|error| AppError::from(error).at_path(&path))?
    {
        read_versioned_csv(&path)?.1
    } else {
        if let Some(retained) = missing_table_source(session, &state.path, &path)? {
            let rows = retained
                .rows
                .as_ref()
                .expect("retained CSV has complete rows");
            #[cfg(test)]
            crate::io::csv_files::record_csv_row_copies(rows.len());
            return Ok((retained.header.clone(), rows.clone(), retained.next_row_seq));
        }
        CsvTable {
            header: state.header.clone(),
            rows: Vec::new(),
            path: state.path.clone(),
        }
    };
    table_snapshot_from_csv(state, table, csv)
}

pub(crate) fn read_retained_csv(session: &ProjectSession, relative: &str) -> AppResult<CsvTable> {
    let path = Path::new(&session.manifest.mod_root).join(relative);
    if path
        .try_exists()
        .map_err(|error| AppError::from(error).at_path(&path))?
    {
        #[cfg(test)]
        if relative == "data/world/factions/factions.csv" {
            crate::io::faction_index::record_faction_index_read();
        }
        return crate::io::read_csv_data(&path);
    }
    if let Some(state) = missing_table_source(session, relative, &path)? {
        let rows = state.rows.as_ref().expect("retained CSV has complete rows");
        #[cfg(test)]
        crate::io::csv_files::record_csv_row_copies(rows.len());
        return Ok(CsvTable {
            header: state.header.clone(),
            rows: rows
                .iter()
                .map(|row| crate::models::CsvRow {
                    data: row.data.clone(),
                    is_comment: row.is_comment,
                })
                .collect(),
            path: path.to_string_lossy().into(),
        });
    }
    crate::io::read_csv_data(&path)
}

fn missing_table_source<'a>(
    session: &'a ProjectSession,
    relative: &str,
    path: &Path,
) -> AppResult<Option<&'a SessionCsvTable>> {
    let retained = session
        .csv_tables
        .values()
        .find(|table| table.path == relative && table.rows.is_some());
    if retained.is_none()
        && session
            .source_versions
            .get(relative)
            .is_some_and(|version| version.fingerprint.is_some())
    {
        return Err(AppError::message(
            "write.recovery_content_missing",
            "缺失 CSV 的完整内容尚未加载，无法重建",
        )
        .at_path(path));
    }
    Ok(retained)
}

pub(in crate::services::project) fn table_snapshot_from_csv(
    state: &SessionCsvTable,
    table: CsvTableKey,
    csv: CsvTable,
) -> AppResult<(Vec<String>, Vec<SessionCsvRow>, u64)> {
    let identity = super::super::model::csv_table_spec(table).entity_id_field;
    let key = |data: &serde_json::Map<String, serde_json::Value>, comment: bool| {
        serde_json::to_string(&(
            comment,
            data.get(identity),
            if table == CsvTableKey::Descriptions {
                data.get("type")
            } else {
                None
            },
            if comment || !data.contains_key(identity) {
                Some(data)
            } else {
                None
            },
        ))
    };
    let mut known = std::collections::BTreeMap::<String, std::collections::VecDeque<String>>::new();
    for row in state.rows.as_deref().unwrap_or(&[]) {
        known
            .entry(key(&row.data, row.is_comment)?)
            .or_default()
            .push_back(row.row_key.clone());
    }
    let mut next_seq = state.next_row_seq;
    let rows = csv
        .rows
        .into_iter()
        .map(|row| {
            let matched = known
                .get_mut(&key(&row.data, row.is_comment)?)
                .and_then(std::collections::VecDeque::pop_front);
            let row_key = matched.unwrap_or_else(|| {
                let key = format!("{}:row:{next_seq}", table.as_str());
                next_seq += 1;
                key
            });
            Ok(SessionCsvRow {
                row_key,
                data: row.data,
                is_comment: row.is_comment,
            })
        })
        .collect::<AppResult<Vec<_>>>()?;
    Ok((csv.header, rows, next_seq))
}

pub(crate) fn session_table<'a>(
    session: &'a ProjectSession,
    table: &str,
) -> AppResult<&'a SessionCsvTable> {
    session
        .csv_tables
        .get(table)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {table}")))
}

pub(crate) fn registered_session_table(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&SessionCsvTable> {
    session_table(session, table.as_str())
}

pub(crate) fn loaded_csv_rows<'a>(
    table: &'a SessionCsvTable,
    table_label: &str,
) -> AppResult<&'a [SessionCsvRow]> {
    table.rows.as_deref().ok_or_else(|| {
        AppError::message(
            "table.rows_not_loaded",
            format!("CSV rows are not loaded: {table_label}"),
        )
    })
}

pub(crate) fn loaded_registered_csv_rows(
    session: &ProjectSession,
    table: CsvTableKey,
) -> AppResult<&[SessionCsvRow]> {
    loaded_csv_rows(registered_session_table(session, table)?, table.as_str())
}

pub(crate) fn session_table_mut<'a>(
    session: &'a mut ProjectSession,
    table: &str,
) -> AppResult<&'a mut SessionCsvTable> {
    session
        .csv_tables
        .get_mut(table)
        .ok_or_else(|| AppError::message("table.unknown", format!("unknown table: {table}")))
}

pub(crate) fn ensure_session_table_rows(
    session: &mut ProjectSession,
    table: &str,
) -> AppResult<()> {
    let needs_load = session_table(session, table)?.rows.is_none();
    if !needs_load {
        return Ok(());
    }
    let rel_path = session_table(session, table)?.path.clone();
    let path = Path::new(&session.manifest.mod_root).join(&rel_path);
    if !path
        .try_exists()
        .map_err(|error| AppError::from(error).at_path(&path))?
    {
        missing_table_source(session, &rel_path, &path)?;
    }
    let (version, mut csv) = read_versioned_csv(&path)?;
    if version.fingerprint.is_none() {
        if table == MISSION_LIST_TABLE_KEY {
            csv.header = mission_list_default_header();
        } else if let Some(table_key) = CsvTableKey::from_key(table) {
            csv.header = match &session.manifest.starsector_root {
                Some(root) => load_core_csv_table(root, table_key)?
                    .map(|core| core.header.clone())
                    .unwrap_or_default(),
                None => Vec::new(),
            };
            if csv.header.is_empty() {
                csv.header = crate::domain::csv_column_order::standard_csv_columns(table_key);
            }
        }
    }
    let row_sequence = session_table(session, table)?.next_row_seq;
    let rows: Vec<SessionCsvRow> = csv
        .rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| SessionCsvRow {
            row_key: format!("{table}:row:{}", row_sequence + index as u64),
            is_comment: row.is_comment,
            data: row.data,
        })
        .collect();
    let next_row_seq = row_sequence + rows.len() as u64;
    let table_state = session_table_mut(session, table)?;
    if table_state.header.is_empty() {
        table_state.header = csv.header;
    }
    table_state.rows = Some(rows);
    table_state.row_index = None;
    table_state.next_row_seq = next_row_seq;
    table_state.saved_text = None;
    session.source_versions.insert(rel_path, version);
    Ok(())
}

pub(crate) fn ensure_registered_table_rows(
    session: &mut ProjectSession,
    table: CsvTableKey,
) -> AppResult<()> {
    ensure_session_table_rows(session, table.as_str())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::temp_dir;
    use crate::{
        io::write_utf8_no_bom,
        models::{EntitySummaries, ProjectManifest},
    };
    use serde_json::{Map, Value};
    use std::{
        collections::{BTreeMap, HashMap},
        fs,
    };

    #[test]
    fn ensure_session_table_rows_rejects_unknown_table() {
        let mut session = ProjectSession {
            loaded_edit_targets: Vec::new(),
            projection_pending: false,
            source_versions: BTreeMap::new(),
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
            faction_files: BTreeMap::new(),
            faction_blueprint_tags: HashMap::new(),
            csv_tables: BTreeMap::new(),
            ship_files: BTreeMap::new(),
            variant_files: Vec::new(),
            skin_files: Vec::new(),
            variant_warnings: Vec::new(),
            skin_warnings: Vec::new(),
            weapon_specs: BTreeMap::new(),
            projectile_specs: BTreeMap::new(),
            system_files: BTreeMap::new(),
            skill_files: BTreeMap::new(),
        };

        let error = ensure_session_table_rows(&mut session, "missing")
            .unwrap_err()
            .to_string();

        assert!(error.contains("unknown table: missing"));
    }

    #[test]
    fn ensure_session_table_rows_preserves_comment_identity_and_business_columns() {
        let root = temp_dir("csv_business_metadata_boundary");
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
            loaded_edit_targets: Vec::new(),
            projection_pending: false,
            source_versions: BTreeMap::new(),
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
            faction_files: BTreeMap::new(),
            faction_blueprint_tags: HashMap::from([("demo_bp".to_string(), "demo".to_string())]),
            csv_tables: BTreeMap::from([
                (
                    CsvTableKey::Ships.as_str().to_string(),
                    SessionCsvTable {
                        row_index: None,
                        header: Vec::new(),
                        path: "data/hulls/ship_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                ),
                (
                    CsvTableKey::Skills.as_str().to_string(),
                    SessionCsvTable {
                        row_index: None,
                        header: Vec::new(),
                        path: "data/characters/skills/skill_data.csv".to_string(),
                        rows: None,
                        next_row_seq: 0,
                        saved_text: None,
                    },
                ),
            ]),
            ship_files: BTreeMap::new(),
            variant_files: Vec::new(),
            skin_files: Vec::new(),
            variant_warnings: Vec::new(),
            skin_warnings: Vec::new(),
            weapon_specs: BTreeMap::new(),
            projectile_specs: BTreeMap::new(),
            system_files: BTreeMap::new(),
            skill_files: BTreeMap::new(),
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
        crate::io::csv_files::take_csv_work();
        let (header, rows, sequence) = read_table_snapshot(&session, CsvTableKey::Ships).unwrap();
        let retained = read_retained_csv(&session, &expected.path).unwrap();
        assert_eq!(header, expected.header);
        let saved_rows = expected.rows.unwrap();
        assert_eq!(rows.len(), saved_rows.len());
        for (restored, saved) in rows.iter().zip(&saved_rows) {
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
        assert_eq!(
            crate::io::csv_files::take_csv_work(),
            (0, 0, 2 * rows.len())
        );

        session
            .csv_tables
            .get_mut(CsvTableKey::Ships.as_str())
            .unwrap()
            .rows = None;
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
        fs::remove_dir_all(root).unwrap();
    }
}
