use crate::errors::AppResult;
use crate::io::{FsRootBoundary, forward_slash_path};
use crate::models::{EntityFileLocation, ResourceSource};
use crate::services::project::sources::documents::LoadedSpecRecord;
use crate::services::project::sources::{SourceReader, documents};
use crate::{io, models};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
#[cfg(test)]
use std::path::Path;

pub(in crate::services::project) fn faction_blueprint_tags(
    files: &BTreeMap<String, LoadedSpecRecord>,
) -> HashMap<String, String> {
    let mut tags_by_faction = HashMap::new();
    for (id, record) in files {
        let obj = &record.data;
        for section in ["knownShips", "knownWeapons", "knownFighters"] {
            if let Some(tags) = obj
                .get(section)
                .and_then(|value| value.get("tags"))
                .and_then(Value::as_array)
            {
                for tag in tags.iter().filter_map(Value::as_str) {
                    if is_owned_faction_blueprint_tag(tag, id) {
                        tags_by_faction.insert(tag.to_string(), id.clone());
                    }
                }
            }
        }
    }
    tags_by_faction
}

#[cfg(test)]
pub(in crate::services::project) fn load_faction_files(
    mod_root: &Path,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    load_faction_files_from(&mut SourceReader::new(mod_root)?)
}
pub(in crate::services::project) fn load_faction_files_from(
    sources: &mut SourceReader,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mod_root = sources.root().to_path_buf();
    let boundary = FsRootBoundary::new(&mod_root, "faction root")?;
    let table = sources.csv(&sources.path("data/world/factions/factions.csv")?)?;
    let mut defs = documents::load_spec_records_from(
        sources,
        "data/world/factions",
        "faction",
        "id",
        ResourceSource::Mod,
    )?;
    for entry in io::faction_index_entries(&boundary, &table)? {
        if !entry.path.exists() {
            sources
                .versions
                .insert(sources.key(&entry.path), io::file_version(&entry.path)?);
            continue;
        }
        let data = sources.json(&entry.path)?;
        let id = models::file_content_id(&data, "id", &entry.path);
        let rel_path = forward_slash_path(
            entry
                .path
                .strip_prefix(boundary.root())
                .expect("faction belongs to authorized root"),
        );
        defs.insert(
            id.clone(),
            LoadedSpecRecord {
                id,
                location: EntityFileLocation {
                    reference: None,
                    source: ResourceSource::Mod,
                    root: boundary.root().to_string_lossy().to_string(),
                    rel_path,
                    path: entry.path.to_string_lossy().to_string(),
                },
                data,
            },
        );
    }
    Ok(defs)
}

fn is_owned_faction_blueprint_tag(tag: &str, faction_id: &str) -> bool {
    let faction_id = faction_id.trim().to_ascii_lowercase();
    if faction_id.is_empty() {
        return false;
    }
    let tag = tag.trim().to_ascii_lowercase();
    tag == format!("{faction_id}_bp")
        || (tag.starts_with(&format!("{faction_id}_")) && tag.ends_with("_bp"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;
    use serde_json::json;
    use std::fs;

    #[test]
    fn accepts_only_blueprint_tags_derived_from_current_faction_id() {
        assert!(is_owned_faction_blueprint_tag("demo_bp", "demo"));
        assert!(is_owned_faction_blueprint_tag("demo_aux_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("base_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("custom_bp", "demo"));
        assert!(!is_owned_faction_blueprint_tag("demo_bp_extra", "demo"));
    }

    #[test]
    fn faction_blueprint_tags_preserve_owned_tags() {
        let root = project_workspace("faction_foreign_blueprint_tags");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            r#"{"id":"demo","displayName":"Demo","knownShips":{"tags":["demo_bp","custom_bp","base_bp"]}}"#,
        )
        .unwrap();

        let faction_blueprint_tags = faction_blueprint_tags(&load_faction_files(&root).unwrap());

        assert_eq!(
            faction_blueprint_tags.get("demo_bp"),
            Some(&"demo".to_string())
        );
        assert!(!faction_blueprint_tags.contains_key("custom_bp"));
        assert!(!faction_blueprint_tags.contains_key("base_bp"));
        root.close().unwrap();
    }

    #[test]
    fn loads_factions_from_faction_path_csv() {
        let root = project_workspace("faction_path_csv");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "faction\r\ndata/world/factions/plsp.faction\r\ndata/world/factions/celestite.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("plsp.faction"),
            &json!({"id":"plsp","displayName":"Polaris","color":[1,2,3,255]}).to_string(),
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("celestite.faction"),
            &json!({"id":"celestite","displayName":"Celestite","color":[4,5,6,255]}).to_string(),
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("mercenary.faction"),
            &json!({"id":"mercenary","displayName":"Mercenary"}).to_string(),
        )
        .unwrap();

        let files = load_faction_files(&root).unwrap();

        assert!(files.contains_key("plsp"));
        assert!(files.contains_key("celestite"));
        assert!(files.contains_key("mercenary"));
        assert_eq!(files["plsp"].data["displayName"], "Polaris");
        root.close().unwrap();
    }

    #[test]
    fn reports_faction_index_csv_path() {
        let root = project_workspace("faction_bad_csv");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        // Short rows are tolerated now; a real defect must still surface the CSV path.
        write_utf8_no_bom(&dir.join("factions.csv"), "id,file\r\n\"bad\r\n").unwrap();

        let error = load_faction_files(&root).unwrap_err().to_string();

        assert!(error.contains("解析 CSV 失败"));
        assert!(error.contains("factions.csv"));
        root.close().unwrap();
    }

    #[test]
    fn faction_index_reports_non_comment_row_without_id() {
        let root = project_workspace("faction_missing_id");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\n,demo.faction\r\n#comment,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &dir.join("demo.faction"),
            &json!({"id":"demo","displayName":"Demo"}).to_string(),
        )
        .unwrap();

        let error = load_faction_files(&root).unwrap_err().to_string();

        assert!(error.contains("factions.csv"));
        assert!(error.contains("row 2"));
        assert!(error.contains("missing faction id"));
        root.close().unwrap();
    }

    #[test]
    fn indexed_faction_file_parse_errors_are_not_hidden() {
        let root = project_workspace("faction_bad_file");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("demo.faction"), "{").unwrap();

        let load_error = load_faction_files(&root).unwrap_err().to_string();

        assert!(load_error.contains("demo.faction"));
        root.close().unwrap();
    }

    #[test]
    fn indexed_faction_file_must_be_object() {
        let root = project_workspace("faction_non_object_file");
        let dir = root.join("data/world/factions");
        fs::create_dir_all(&dir).unwrap();
        write_utf8_no_bom(
            &dir.join("factions.csv"),
            "id,file\r\ndemo,demo.faction\r\n",
        )
        .unwrap();
        write_utf8_no_bom(&dir.join("demo.faction"), "[]").unwrap();

        let load_error = load_faction_files(&root).unwrap_err().to_string();

        // A non-object root is rejected by the parser per the game's
        // new JSONObject; read_json_file adds the file path.
        assert!(load_error.contains("demo.faction"));
        assert!(load_error.contains("must begin with '{'"));
        root.close().unwrap();
    }
}
