use crate::errors::{AppError, AppResult, ErrorLocation};
use crate::io::forward_slash_relative_path;
use crate::models;
use crate::models::{GameScanWarning, GameWarningEditTarget, SkinFile, VariantFile};
use crate::services::project::sources::SourceReader;
use serde_json::Value;
#[cfg(test)]
use std::cell::Cell;
use std::collections::HashMap;
use std::path::Path;

#[cfg(test)]
thread_local! { static LOAD_COUNTS: Cell<(usize, usize)> = const { Cell::new((0, 0)) }; }
#[cfg(test)]
pub(in crate::services::project) fn take_load_counts() -> (usize, usize) {
    LOAD_COUNTS.with(|counts| counts.replace((0, 0)))
}

#[cfg(test)]
pub(crate) fn load_variant_files(
    mod_root: &Path,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    load_variant_files_from(&mut SourceReader::new(mod_root)?)
}
pub(in crate::services::project) fn load_variant_files_from(
    sources: &mut SourceReader,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    let mod_root = sources.root().to_path_buf();
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (variant, skin) = counts.get();
        counts.set((variant + 1, skin));
    });
    let mut seen = HashMap::new();
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for (path, data) in sources.walk("data/variants", "variant")? {
        let rel_path = forward_slash_relative_path(&mod_root, &path);
        let file = build_variant_file(&mod_root, &rel_path, &data)
            .map_err(|error| AppError::context(path.display().to_string(), error).at_path(&path))?;
        if let Some(previous) =
            seen.insert(file.variant_id.clone(), path.to_string_lossy().to_string())
        {
            warnings.push(GameScanWarning {
                code: "scan.variant_id_duplicate".to_string(),
                location: Some(ErrorLocation {
                    path: Some(path.to_string_lossy().to_string()),
                    line: None,
                    column: None,
                }),
                path: path.to_string_lossy().to_string(),
                message: format!(
                    "重复 variantId {}，已保留第一个文件并跳过后续文件：{previous}",
                    file.variant_id
                ),
                edit_target: Some(GameWarningEditTarget {
                    mod_root: mod_root.to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                }),
            });
            continue;
        }
        files.push(file);
    }
    files.sort_by(|a, b| {
        a.hull_id
            .cmp(&b.hull_id)
            .then_with(|| a.variant_id.cmp(&b.variant_id))
    });
    Ok((files, warnings))
}

pub(in crate::services::project) fn load_skin_files_from(
    sources: &mut SourceReader,
) -> AppResult<(Vec<SkinFile>, Vec<GameScanWarning>)> {
    let mod_root = sources.root().to_path_buf();
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (variant, skin) = counts.get();
        counts.set((variant, skin + 1));
    });
    let mut seen = HashMap::new();
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    for (path, data) in sources.walk("data/hulls/skins", "skin")? {
        let rel_path = forward_slash_relative_path(&mod_root, &path);
        let file = build_skin_file(&mod_root, &rel_path, &data)
            .map_err(|error| AppError::context(path.display().to_string(), error).at_path(&path))?;
        if let Some(previous) = seen.insert(
            file.skin_hull_id.clone(),
            path.to_string_lossy().to_string(),
        ) {
            warnings.push(GameScanWarning {
                code: "scan.skin_id_duplicate".to_string(),
                location: Some(ErrorLocation {
                    path: Some(path.to_string_lossy().to_string()),
                    line: None,
                    column: None,
                }),
                path: path.to_string_lossy().to_string(),
                message: format!(
                    "重复 skinHullId {}，已保留第一个文件并跳过后续文件：{previous}",
                    file.skin_hull_id
                ),
                edit_target: Some(GameWarningEditTarget {
                    mod_root: mod_root.to_string_lossy().to_string(),
                    path: path.to_string_lossy().to_string(),
                }),
            });
            continue;
        }
        files.push(file);
    }
    files.sort_by(|a, b| {
        a.base_hull_id
            .cmp(&b.base_hull_id)
            .then_with(|| a.skin_hull_id.cmp(&b.skin_hull_id))
    });
    Ok((files, warnings))
}

pub fn build_variant_file(mod_root: &Path, rel_path: &str, data: &Value) -> AppResult<VariantFile> {
    let variant_id = required_string(data, "variantId", "装配")?;
    let hull_id = required_string(data, "hullId", "装配")?;
    Ok(VariantFile {
        variant_id,
        hull_id,
        path: mod_root.join(rel_path).to_string_lossy().to_string(),
        rel_path: rel_path.to_string(),
        weapon_group_count: array_len(data.get("weaponGroups")),
        hull_mod_count: array_len(data.get("hullMods")),
        perma_mod_count: array_len(data.get("permaMods")),
        wing_count: array_len(data.get("wings")),
        data: data.clone(),
    })
}

pub fn build_skin_file(mod_root: &Path, rel_path: &str, data: &Value) -> AppResult<SkinFile> {
    let skin_hull_id = models::file_content_id(data, "skinHullId", Path::new(rel_path));
    let base_hull_id = data
        .get("baseHullId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    Ok(SkinFile {
        skin_hull_id,
        base_hull_id,
        path: mod_root.join(rel_path).to_string_lossy().to_string(),
        rel_path: rel_path.to_string(),
        built_in_mod_count: array_len(data.get("builtInMods")),
        built_in_weapon_count: object_len(data.get("builtInWeapons")),
        built_in_wing_count: array_len(data.get("builtInWings")),
        weapon_slot_change_count: object_len(data.get("weaponSlotChanges")),
        engine_slot_change_count: object_len(data.get("engineSlotChanges")),
        data: data.clone(),
    })
}

fn required_string(value: &Value, key: &str, display_name: &str) -> AppResult<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(str::to_string)
        .ok_or_else(|| {
            AppError::message("config.missing_field", format!("{display_name}缺少 {key}"))
        })
}

fn array_len(value: Option<&Value>) -> usize {
    value.and_then(Value::as_array).map_or(0, Vec::len)
}

fn object_len(value: Option<&Value>) -> usize {
    value
        .and_then(Value::as_object)
        .map_or(0, |object| object.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::services::project::sources::SourceReader;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use std::fs;

    #[test]
    fn duplicate_variant_ids_keep_first_and_warn() {
        let root = project_workspace("core_kite_duplicate");
        let core_root = root.join("starsector-core");
        fs::create_dir_all(core_root.join("data/variants/kite")).unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/kite/kite_Interceptor.variant"),
            r#"{"variantId":"kite_hegemony_Interceptor","hullId":"kite_hegemony"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/kite_hegemony_Interceptor.variant"),
            r#"{"variantId":"kite_hegemony_Interceptor","hullId":"kite_hegemony"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/kite/kite_Stock.variant"),
            r#"{"variantId":"kite_original_Stock","hullId":"kite_original"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/kite_original_Stock.variant"),
            r#"{"variantId":"kite_original_Stock","hullId":"kite_original"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/ziggurat_Experimental.variant"),
            r#"{"variantId":"ziggurat_Experimental","hullId":"ziggurat"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &core_root.join("data/variants/ziggurat_HF.variant"),
            r#"{"variantId":"ziggurat_Experimental","hullId":"ziggurat"}"#,
        )
        .unwrap();

        let (variants, warnings) = load_variant_files(&core_root).unwrap();

        assert_eq!(variants.len(), 3);
        assert_eq!(warnings.len(), 3);
        assert!(
            variants
                .iter()
                .any(|variant| variant.variant_id == "kite_hegemony_Interceptor")
        );
        assert!(
            variants
                .iter()
                .any(|variant| variant.variant_id == "kite_original_Stock")
        );
        assert!(
            variants
                .iter()
                .any(|variant| variant.variant_id == "ziggurat_Experimental")
        );
        assert!(
            warnings
                .iter()
                .any(|warning| warning.message.contains("kite_hegemony_Interceptor"))
        );
        root.close().unwrap();
    }

    #[test]
    fn duplicate_variant_ids_do_not_fail_mod_loading() {
        let root = project_workspace("mod_kite_duplicate");
        fs::create_dir_all(root.join("data/variants/kite")).unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/kite/kite_Interceptor.variant"),
            r#"{"variantId":"kite_hegemony_Interceptor","hullId":"kite_hegemony"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("data/variants/kite_hegemony_Interceptor.variant"),
            r#"{"variantId":"kite_hegemony_Interceptor","hullId":"kite_hegemony"}"#,
        )
        .unwrap();

        let (variants, warnings) = load_variant_files(&root).unwrap();

        assert_eq!(variants.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert!(
            warnings[0]
                .message
                .contains("重复 variantId kite_hegemony_Interceptor")
        );
        root.close().unwrap();
    }

    #[test]
    fn duplicate_document_warnings_deliver_authorized_file_targets() {
        let root = project_workspace("duplicate_document_targets");
        for (directory, extension, text) in [
            (
                "data/variants",
                "variant",
                r#"{"variantId":"fixture","hullId":"hull"}"#,
            ),
            (
                "data/hulls/skins",
                "skin",
                r#"{"skinHullId":"fixture","baseHullId":"hull"}"#,
            ),
        ] {
            fs::create_dir_all(root.join(directory)).unwrap();
            for name in ["first", "second"] {
                write_utf8_no_bom(&root.join(format!("{directory}/{name}.{extension}")), text)
                    .unwrap();
            }
        }
        let mut sources = SourceReader::new(&root).unwrap();
        let (_, variants) = load_variant_files_from(&mut sources).unwrap();
        let (_, skins) = load_skin_files_from(&mut sources).unwrap();
        for warnings in [variants, skins] {
            assert_eq!(warnings.len(), 1);
            let warning = &warnings[0];
            let target = warning.edit_target.as_ref().unwrap();
            assert_eq!(target.path, warning.path);
            assert_eq!(
                warning.location.as_ref().unwrap().path.as_deref(),
                Some(target.path.as_str())
            );
            assert_eq!(target.mod_root, sources.root().to_string_lossy());
        }
        drop(sources);
        root.close().unwrap();
    }
}
