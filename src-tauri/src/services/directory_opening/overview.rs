use crate::{
    errors::AppResult,
    io::{FsRootBoundary, read_json_file, validate_walk_entry},
    models::{GameModSummary, GameOverviewData, GameScanWarning, GameWarningEditTarget},
};
use serde_json::Value;
use std::{collections::HashMap, fs, path::Path};

/// A malformed root is an error; per-Mod problems stay in the overview's
/// warnings so one broken Mod never hides the rest of the game.
pub fn scan_game_overview(starsector_root: &Path) -> AppResult<GameOverviewData> {
    let boundary = FsRootBoundary::new(starsector_root, "starsector root")?;
    Ok(scan_game_overview_root(boundary.root()))
}

fn scan_game_overview_root(starsector_root: &Path) -> GameOverviewData {
    let mods_dir = starsector_root.join("mods");
    let mut warnings = Vec::new();
    let mut mods = Vec::new();

    if !starsector_root.join("starsector-core").exists() {
        warnings.push(GameScanWarning {
            code: "scan.core_missing".to_string(),
            location: None,
            path: starsector_root
                .join("starsector-core")
                .to_string_lossy()
                .to_string(),
            message: "缺少 starsector-core，原版资源回退不可用".to_string(),
            edit_target: None,
        });
    }

    match fs::read_dir(&mods_dir) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        warnings.push(GameScanWarning {
                            code: "io.unexpected".to_string(),
                            location: None,
                            path: mods_dir.to_string_lossy().to_string(),
                            message: format!("读取 mods 目录项失败: {error}"),
                            edit_target: None,
                        });
                        continue;
                    }
                };
                let mod_root = entry.path();
                if let Err(error) = validate_walk_entry(&mod_root, "mods directory") {
                    warnings.push(GameScanWarning {
                        code: error.code().to_string(),
                        location: error.location().cloned(),
                        path: mod_root.to_string_lossy().to_string(),
                        message: format!("Mod 路径使用链接或不可读取，已跳过: {error}"),
                        edit_target: None,
                    });
                    continue;
                }
                if !mod_root.is_dir() {
                    continue;
                }
                let mod_info_path = mod_root.join("mod_info.json");
                if !mod_info_path.exists() {
                    warnings.push(GameScanWarning {
                        code: "scan.mod_info_missing".to_string(),
                        location: None,
                        path: mod_root.to_string_lossy().to_string(),
                        message: "缺少 mod_info.json，已跳过".to_string(),
                        edit_target: None,
                    });
                    continue;
                }
                match read_json_file(&mod_info_path) {
                    Ok(info) => mods.push(summary_from_mod_info(&mod_root, &info)),
                    Err(error) => warnings.push(GameScanWarning {
                        code: error.code().to_string(),
                        location: error.location().cloned(),
                        path: mod_info_path.to_string_lossy().to_string(),
                        message: format!("读取 mod_info.json 失败: {error}"),
                        edit_target: Some(GameWarningEditTarget {
                            mod_root: mod_root.to_string_lossy().to_string(),
                            path: mod_info_path.to_string_lossy().to_string(),
                        }),
                    }),
                }
            }
        }
        Err(_) if !mods_dir.exists() => {
            warnings.push(GameScanWarning {
                code: "scan.mods_missing".to_string(),
                location: None,
                path: mods_dir.to_string_lossy().to_string(),
                message: "缺少 mods 目录".to_string(),
                edit_target: None,
            });
        }
        Err(error) => {
            warnings.push(GameScanWarning {
                code: "io.unexpected".to_string(),
                location: None,
                path: mods_dir.to_string_lossy().to_string(),
                message: format!("无法读取 mods 目录: {error}"),
                edit_target: None,
            });
        }
    }

    mods.sort_by_key(|summary| summary.name.to_lowercase());
    append_duplicate_id_warnings(&mods, &mut warnings);

    GameOverviewData {
        starsector_root: starsector_root.to_string_lossy().to_string(),
        core_available: starsector_root.join("starsector-core").exists(),
        mods_dir: mods_dir.to_string_lossy().to_string(),
        mods,
        warnings,
    }
}

fn summary_from_mod_info(mod_root: &Path, info: &Value) -> GameModSummary {
    let folder_name = mod_root
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("Mod")
        .to_string();
    GameModSummary {
        mod_root: mod_root.to_string_lossy().to_string(),
        id: value_string(info.get("id")).unwrap_or_else(|| folder_name.clone()),
        name: value_string(info.get("name")).unwrap_or(folder_name),
        version: version_string(info.get("version")).unwrap_or_default(),
        description: value_string(info.get("description")).unwrap_or_default(),
        has_mod_info: true,
    }
}

fn version_string(value: Option<&Value>) -> Option<String> {
    let Some(Value::Object(obj)) = value else {
        return value_string(value);
    };
    let major = version_part(obj.get("major"))?;
    let minor = version_part(obj.get("minor"))?;
    let patch = version_part(obj.get("patch"))?;
    Some(format!("{major}.{minor}.{patch}"))
}

fn version_part(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::String(text)) if !text.trim().is_empty() => Some(text.trim().to_string()),
        _ => None,
    }
}

fn value_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => Some(text.clone()),
        Some(Value::Number(number)) => Some(number.to_string()),
        Some(Value::Bool(flag)) => Some(flag.to_string()),
        Some(other) => serde_json::to_string(other).ok(),
        None => None,
    }
}

fn append_duplicate_id_warnings(mods: &[GameModSummary], warnings: &mut Vec<GameScanWarning>) {
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for summary in mods {
        *counts.entry(summary.id.as_str()).or_default() += 1;
    }
    for summary in mods {
        if counts.get(summary.id.as_str()).copied().unwrap_or_default() > 1 {
            warnings.push(GameScanWarning {
                code: "scan.mod_id_duplicate".to_string(),
                location: summary.has_mod_info.then(|| crate::errors::ErrorLocation {
                    path: Some(
                        Path::new(&summary.mod_root)
                            .join("mod_info.json")
                            .to_string_lossy()
                            .to_string(),
                    ),
                    line: None,
                    column: None,
                }),
                path: summary.mod_root.clone(),
                message: format!("重复 Mod id: {}", summary.id),
                edit_target: summary.has_mod_info.then(|| GameWarningEditTarget {
                    mod_root: summary.mod_root.clone(),
                    path: Path::new(&summary.mod_root)
                        .join("mod_info.json")
                        .to_string_lossy()
                        .to_string(),
                }),
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::test_support::TestWorkspace;
    use std::{fs, path::Path};

    #[test]
    fn scan_game_overview_reads_mod_summaries_only() {
        let root = TestWorkspace::new("game_overview");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods/demo")).unwrap();
        fs::create_dir_all(root.join("mods/demo/data/hulls")).unwrap();
        write_utf8_no_bom(
            &root.join("mods/demo/mod_info.json"),
            r#"{"id":"demo","name":"Demo Mod","version":{"major":1,"minor":2,"patch":3}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("mods/demo/data/hulls/ship_data.csv"),
            "id,name\r\nship,Ship\r\n",
        )
        .unwrap();

        let overview = scan_game_overview(&root).unwrap();

        assert!(overview.core_available);
        assert_eq!(overview.mods.len(), 1);
        assert_eq!(overview.mods[0].id, "demo");
        assert_eq!(overview.mods[0].version, "1.2.3");
        assert!(overview.mods[0].has_mod_info);
        assert!(overview.warnings.is_empty());
        root.close().unwrap();
    }

    #[test]
    fn scan_game_overview_uses_canonical_root() {
        let root = TestWorkspace::new("game_overview_canonical");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(root.join("mods")).unwrap();

        let overview = scan_game_overview(&root.join(".")).unwrap();

        let expected_root = path_string(&root);
        assert_eq!(overview.starsector_root, expected_root);
        assert!(overview.core_available);
        assert!(overview.mods.is_empty());
        root.close().unwrap();
    }

    #[test]
    fn scan_game_overview_rejects_parent_dir_root() {
        let root = TestWorkspace::new("game_overview_parent_dir");

        let error = scan_game_overview(&root.literal_path(".."))
            .unwrap_err()
            .to_string();

        assert!(error.contains("invalid starsector root path"));
        root.close().unwrap();
    }

    #[test]
    fn scan_game_overview_warns_duplicate_ids_and_missing_core() {
        let root = TestWorkspace::new("game_warnings");
        fs::create_dir_all(root.join("mods/a")).unwrap();
        fs::create_dir_all(root.join("mods/b")).unwrap();
        fs::create_dir_all(root.join("mods/no_info")).unwrap();
        write_utf8_no_bom(&root.join("mods/a/mod_info.json"), r#"{"id":"dup"}"#).unwrap();
        write_utf8_no_bom(&root.join("mods/b/mod_info.json"), r#"{"id":"dup"}"#).unwrap();

        let overview = scan_game_overview(&root).unwrap();

        assert!(!overview.core_available);
        assert_eq!(overview.mods.len(), 2);
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("starsector-core"))
        );
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("缺少 mod_info.json"))
        );
        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("重复 Mod id"))
        );
        let duplicates: Vec<_> = overview
            .warnings
            .iter()
            .filter(|warning| warning.code == "scan.mod_id_duplicate")
            .collect();
        assert_eq!(duplicates.len(), 2);
        for warning in duplicates {
            let target = warning.edit_target.as_ref().unwrap();
            assert_eq!(
                Path::new(&target.mod_root).join("mod_info.json"),
                Path::new(&target.path)
            );
            assert_eq!(
                warning.location.as_ref().unwrap().path.as_deref(),
                Some(target.path.as_str())
            );
        }
        root.close().unwrap();
    }

    #[test]
    fn scan_game_overview_authorizes_invalid_mod_info_for_recovery_editing() {
        let root = TestWorkspace::new("game_invalid_mod_info_edit_target");
        let mod_root = root.join("mods/broken");
        let mod_info_path = mod_root.join("mod_info.json");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::create_dir_all(&mod_root).unwrap();
        write_utf8_no_bom(
            &mod_info_path,
            "{\n  \"id\": \"broken\"\n  \"name\": \"Broken\"\n}",
        )
        .unwrap();

        let overview = scan_game_overview(&root).unwrap();

        let warning = overview
            .warnings
            .iter()
            .find(|warning| warning.edit_target.is_some())
            .unwrap();
        let target = warning.edit_target.as_ref().unwrap();
        let expected_mod_root = path_string(&mod_root);
        let expected_path = path_string(&mod_info_path);
        assert_eq!(target.mod_root, expected_mod_root);
        assert_eq!(target.path, expected_path);
        assert_eq!(warning.path, expected_path);
        assert!(warning.message.contains("line 3 column"));
        root.close().unwrap();
    }

    #[test]
    fn scan_game_overview_reports_unreadable_mods_path_reason() {
        let root = TestWorkspace::new("game_mods_path_error");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        fs::write(root.join("mods"), "not a directory").unwrap();

        let overview = scan_game_overview(&root).unwrap();

        assert!(
            overview
                .warnings
                .iter()
                .any(|w| w.message.contains("无法读取 mods 目录:"))
        );
        root.close().unwrap();
    }

    fn path_string(path: &Path) -> String {
        let path = path.canonicalize().unwrap_or_else(|_| path.to_path_buf());
        path.to_string_lossy().to_string()
    }
}
