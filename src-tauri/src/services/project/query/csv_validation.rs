use super::entities;
use super::source_catalog::values;
use crate::domain::json_composition;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::{
    CsvStationData, CsvTableKey, CsvValidationContext, CsvValidationEntity, EntityKind,
};
use crate::parsers;
use crate::services::project::model;
use crate::services::project::session::{lock_ready_session, session_handle};
use crate::services::project::sources::core;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

pub fn query_csv_validation(
    session_id: &str,
    requested_entities: Vec<CsvValidationEntity>,
    sources: Vec<String>,
    files: Vec<String>,
    classes: Vec<String>,
    station_data: Vec<String>,
) -> AppResult<CsvValidationContext> {
    let handle = session_handle(session_id)?;
    let (mut roots, core_root) = {
        let session = lock_ready_session(&handle)?;
        let mut roots = vec![(
            session.manifest.mod_root.clone(),
            session.manifest.mod_info.clone(),
        )];
        roots.extend(session.references.iter().map(|view| {
            (
                view.identity.mod_root.clone(),
                view.session.manifest.mod_info.clone(),
            )
        }));
        let core_path = session
            .manifest
            .starsector_root
            .as_ref()
            .map(|root| core::core_dir(root))
            .transpose()?;
        (roots, core_path)
    };
    let mut result = CsvValidationContext {
        complete: core_root.is_some(),
        ..Default::default()
    };
    if let Some(root) = core_root {
        roots.push((root.to_string_lossy().into_owned(), None));
    }
    let read_aptitudes = requested_entities
        .iter()
        .any(|entity| entity.kind == EntityKind::Skill);
    let mut pending: Vec<_> = requested_entities
        .into_iter()
        .map(|entity| (entity.kind, entity.id))
        .collect();
    let mut seen = BTreeSet::new();
    for raw in station_data {
        let parsed = match parsers::parse_starsector_json(&raw) {
            Ok(data) if data.is_object() => {
                if let Some(variant) = data.get("variant").and_then(Value::as_str) {
                    pending.push((EntityKind::Variant, variant.into()));
                }
                CsvStationData {
                    value: Some(data),
                    error: None,
                }
            }
            Ok(_) => CsvStationData {
                value: None,
                error: Some("空间站数据应为 JSON 对象".into()),
            },
            Err(error) => CsvStationData {
                value: None,
                error: Some(error.to_string()),
            },
        };
        result.station_data.insert(raw, parsed);
    }
    while !pending.is_empty() {
        let mut batches = BTreeMap::<_, Vec<_>>::new();
        for (kind, id) in pending.drain(..) {
            if seen.insert((kind, id.clone())) {
                batches.entry(kind).or_default().push(id);
            }
        }
        for (kind, ids) in batches {
            let records = entities::query_entity_batch(session_id, kind, &ids)?;
            for (id, entity) in ids.into_iter().zip(records) {
                let key = format!(
                    "{}:{id}",
                    serde_json::to_value(kind)?
                        .as_str()
                        .expect("entity kind is a string")
                );
                if let Some(entity) = entity {
                    let local = entity.data.get("spec").unwrap_or(&entity.data);
                    let data = entity
                        .composition
                        .as_ref()
                        .map(|composition| json_composition::compose_game_json(composition, local))
                        .transpose()?
                        .unwrap_or_else(|| local.clone());
                    if kind == EntityKind::Weapon
                        && let Some(projectile) =
                            data.get("projectileSpecId").and_then(Value::as_str)
                    {
                        pending.push((EntityKind::Projectile, projectile.into()));
                    }
                    if kind == EntityKind::Variant
                        && let Some(hull) = data.get("hullId").and_then(Value::as_str)
                    {
                        pending.push((EntityKind::Ship, hull.into()));
                        pending.push((EntityKind::Skin, hull.into()));
                    }
                    if kind == EntityKind::Skin
                        && let Some(base) = data.get("baseHullId").and_then(Value::as_str)
                    {
                        pending.push((EntityKind::Ship, base.into()));
                    }
                    result.entities.insert(key, data);
                }
            }
        }
    }
    for source in sources {
        let groups = values::query_source_option_catalog(session_id, &source)?;
        if let Some(table) = match source.as_str() {
            "csv:industries.id" => Some(CsvTableKey::Industries),
            "csv:commodities.id" => Some(CsvTableKey::Commodities),
            _ => None,
        } {
            let session = lock_ready_session(&handle)?;
            let mut external = BTreeSet::new();
            for view in &session.references {
                external.extend(
                    view.table(table)?
                        .iter()
                        .filter(|row| !row.is_comment)
                        .filter_map(|row| {
                            row.data
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        }),
                );
            }
            if let Some(root) = &session.manifest.starsector_root
                && let Some(csv) =
                    core::load_core_csv_table(root, model::csv_table_spec(table).rel_path)?
            {
                external.extend(
                    csv.rows
                        .iter()
                        .filter(|row| !row.is_comment)
                        .filter_map(|row| {
                            row.data
                                .get("id")
                                .and_then(Value::as_str)
                                .map(str::to_string)
                        }),
                );
            }
            result
                .sources
                .insert(format!("external:{source}"), external.into_iter().collect());
        }
        result.sources.insert(
            source,
            groups
                .into_iter()
                .flat_map(|group| group.options.into_iter().map(|option| option.value))
                .collect(),
        );
    }
    let boundaries = roots
        .iter()
        .map(|(root, _)| FsRootBoundary::new(Path::new(root), "CSV validation source"))
        .collect::<AppResult<Vec<_>>>()?;
    if read_aptitudes {
        for boundary in &boundaries {
            let path = boundary.resolve_relative(
                "data/characters/skills/aptitude_data.csv",
                "CSV aptitude source",
            )?;
            for row in io::read_csv_data(&path)?
                .rows
                .into_iter()
                .filter(|row| !row.is_comment)
            {
                if let (Some(id), Some(effect)) = (
                    row.data.get("id").and_then(Value::as_str),
                    row.data.get("effect_skill_id").and_then(Value::as_str),
                ) {
                    result
                        .sources
                        .entry(format!("aptitudeEffect:{id}"))
                        .or_insert_with(|| vec![effect.into()]);
                }
            }
        }
    }
    for relative in files {
        let found = boundaries
            .iter()
            .map(|boundary| {
                boundary
                    .resolve_relative(&relative, "CSV image")
                    .map(|path| path.is_file())
            })
            .collect::<AppResult<Vec<_>>>()?
            .into_iter()
            .any(|found| found);
        result.files.insert(relative, found);
    }
    if !classes.is_empty() {
        let mut archives = Vec::new();
        for ((_, info), boundary) in roots.iter().zip(&boundaries) {
            let declared = info
                .as_ref()
                .and_then(|info| info.get("jars"))
                .and_then(Value::as_array);
            let jars = declared
                .map(|jars| jars.iter().filter_map(Value::as_str).collect::<Vec<_>>())
                .unwrap_or_else(|| {
                    if info.is_none() {
                        vec![
                            "starfarer.api.jar",
                            "starfarer_obf.jar",
                            "fs.common_obf.jar",
                        ]
                    } else {
                        Vec::new()
                    }
                });
            for jar in jars {
                let path = boundary.resolve_relative(jar, "CSV script archive")?;
                if path.is_file() {
                    archives.push(
                        archive_classes(&io::read_versioned_bytes(&path)?.1)
                            .map_err(|error| error.at_path(&path))?,
                    );
                }
            }
        }
        for class in classes {
            let name = class.replace('.', "/");
            let source_name = name.split('$').next().expect("class source name");
            let paths = [
                format!("{source_name}.java"),
                format!("{name}.class"),
                format!("src/{source_name}.java"),
            ];
            let mut found = false;
            for boundary in &boundaries {
                for relative in &paths {
                    found |= boundary
                        .resolve_relative(relative, "CSV script source")?
                        .is_file();
                }
            }
            let entry = format!("{name}.class");
            found |= archives
                .iter()
                .any(|entries| entries.contains(entry.as_bytes()));
            result.classes.insert(class, found);
        }
    }
    drop(lock_ready_session(&handle)?);
    Ok(result)
}

fn archive_classes(bytes: &[u8]) -> AppResult<BTreeSet<Vec<u8>>> {
    let invalid =
        || AppError::message("csv.script_archive_invalid", "脚本 JAR 的 ZIP 目录无法解析");
    // Central entry names allow one metadata-only pass without inflating class bytecode.
    let tail = bytes.len().saturating_sub(65557);
    let end = tail
        + bytes[tail..]
            .windows(4)
            .rposition(|window| window == b"PK\x05\x06")
            .ok_or_else(invalid)?;
    let mut offset = u32::from_le_bytes(
        bytes
            .get(end + 16..end + 20)
            .ok_or_else(invalid)?
            .try_into()
            .expect("four bytes"),
    ) as usize;
    let mut entries = BTreeSet::new();
    while bytes.get(offset..offset + 4) == Some(b"PK\x01\x02") {
        let header = bytes.get(offset..offset + 46).ok_or_else(invalid)?;
        let name = u16::from_le_bytes([header[28], header[29]]) as usize;
        let extra = u16::from_le_bytes([header[30], header[31]]) as usize;
        let comment = u16::from_le_bytes([header[32], header[33]]) as usize;
        let value = bytes
            .get(offset + 46..offset + 46 + name)
            .ok_or_else(invalid)?;
        if value.ends_with(b".class") {
            entries.insert(value.to_vec());
        }
        offset += 46 + name + extra + comment;
    }
    Ok(entries)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project::{PerformanceTrace, open_project_session_traced};
    use crate::services::project_sync::release_project_session;
    use crate::test_support::work_counts;
    use std::fs;

    #[test]
    fn csv_validation_resolves_specs_images_sources_and_script_entries() {
        let root = project_workspace("csv_validation_sources");
        for directory in ["graphics/icons", "data/hulls", "data/scripts"] {
            fs::create_dir_all(root.join(directory)).unwrap();
        }
        io::write_utf8_no_bom(
            &root.join("mod_info.json"),
            r#"{"id":"sample","jars":["sample.jar"]}"#,
        )
        .unwrap();
        io::write_utf8_no_bom(
            &root.join("data/hulls/ship_data.csv"),
            "id,name,mass,shield type\nentry,Sample,100,NONE\n",
        )
        .unwrap();
        io::write_utf8_no_bom(
            &root.join("data/hulls/entry.ship"),
            r#"{"hullId":"entry","hullSize":"FRIGATE"}"#,
        )
        .unwrap();
        io::write_utf8_no_bom(
            &root.join("data/scripts/Sample.java"),
            "package data.scripts; class Sample {}",
        )
        .unwrap();
        fs::write(root.join("graphics/icons/a.png"), [1]).unwrap();
        let entry = b"sample/Archived.class";
        let mut archive = vec![0; 46];
        archive[..4].copy_from_slice(b"PK\x01\x02");
        archive[28..30].copy_from_slice(&(entry.len() as u16).to_le_bytes());
        archive.extend(entry);
        let mut end = vec![0; 22];
        end[..4].copy_from_slice(b"PK\x05\x06");
        archive.extend(end);
        fs::write(root.join("sample.jar"), archive).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("validation.test"))
                .unwrap();
        let request = || {
            query_csv_validation(
                &manifest.session_id,
                vec![
                    CsvValidationEntity {
                        kind: EntityKind::Ship,
                        id: "entry".into(),
                    },
                    CsvValidationEntity {
                        kind: EntityKind::Ship,
                        id: "entry".into(),
                    },
                    CsvValidationEntity {
                        kind: EntityKind::Ship,
                        id: "missing".into(),
                    },
                ],
                vec!["csv:ships.id".into()],
                vec![
                    "graphics/icons/a.png".into(),
                    "graphics/icons/missing.png".into(),
                ],
                vec![
                    "data.scripts.Sample".into(),
                    "sample.Archived".into(),
                    "sample.Missing".into(),
                ],
                vec![
                    "{variant:'absent',radius:100,fleetName:'Sample'}".into(),
                    "[1]".into(),
                    "{broken".into(),
                ],
            )
        };
        for _ in 0..2 {
            let result = request().unwrap();
            assert_eq!(result.entities.len(), 1);
            assert_eq!(result.entities["ship:entry"]["hullSize"], "FRIGATE");
            assert!(result.sources["csv:ships.id"].contains(&"entry".to_string()));
            assert!(result.files["graphics/icons/a.png"]);
            assert!(!result.files["graphics/icons/missing.png"]);
            assert!(result.classes["data.scripts.Sample"]);
            assert!(result.classes["sample.Archived"]);
            assert!(!result.classes["sample.Missing"]);
            assert_eq!(
                result.station_data["{variant:'absent',radius:100,fleetName:'Sample'}"]
                    .value
                    .as_ref()
                    .unwrap()["radius"],
                100
            );
            assert!(result.station_data["[1]"].error.is_some());
            assert!(result.station_data["{broken"].error.is_some());
        }
        let spec_path = root.join("data/hulls/entry.ship");
        assert_eq!(work_counts::count("read", &spec_path), 1);
        assert_eq!(work_counts::count("parse", &spec_path), 1);
        assert_eq!(work_counts::count("read", &root.join("sample.jar")), 2);
        assert!(
            query_csv_validation(
                &manifest.session_id,
                Vec::new(),
                Vec::new(),
                vec!["../outside.png".into()],
                Vec::new(),
                Vec::new()
            )
            .is_err()
        );
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
