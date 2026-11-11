use super::SourceReader;
use crate::errors::{AppError, AppResult, ErrorLocation};
use crate::io;
use crate::models::file_content::{JsonFileContent, JsonSource};
use crate::models::{self, GameScanWarning, GameWarningEditTarget, SkinFile, VariantFile};
#[cfg(test)]
use crate::test_support::work_counts;
use serde_json::Value;
#[cfg(test)]
use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[cfg(test)]
thread_local! { static LOAD_COUNTS: Cell<(usize,usize)> = const { Cell::new((0,0)) }; }
#[cfg(test)]
pub(in crate::services::project) fn take_load_counts() -> (usize, usize) {
    LOAD_COUNTS.with(|counts| counts.replace((0, 0)))
}
#[cfg(test)]
pub(crate) fn load_variant_files(
    root: &Path,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    load_variant_files_from(&mut SourceReader::new(root)?)
}
fn duplicate(root: &Path, path: &Path, field: &str, id: &str, code: &str) -> GameScanWarning {
    let path = path.to_string_lossy().into_owned();
    GameScanWarning {
        code: code.into(),
        path: path.clone(),
        message: format!("重复 {field} {id}"),
        location: Some(ErrorLocation {
            path: Some(path.clone()),
            ..Default::default()
        }),
        edit_target: Some(GameWarningEditTarget {
            mod_root: root.to_string_lossy().into_owned(),
            path,
        }),
    }
}
pub(in crate::services::project) fn load_variant_files_from(
    reader: &mut SourceReader,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    refresh_variant_files_from(reader, &[])
}
pub(in crate::services::project) fn refresh_variant_files_from(
    reader: &mut SourceReader,
    previous: &[VariantFile],
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (a, b) = counts.get();
        counts.set((a + 1, b));
    });
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = BTreeSet::new();
    let previous = previous
        .iter()
        .map(|file| (file.rel_path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    for path in reader.discover("data/variants", &["variant"], true)? {
        let relative = reader.key(&path);
        let file = if let Some(file) = previous.get(relative.as_str()).filter(|_| {
            !reader
                .changed_paths()
                .iter()
                .any(|changed| io::relative_path_contains(changed, &relative))
        }) {
            (*file).clone()
        } else {
            let source = reader.json_source(&path)?;
            #[cfg(test)]
            work_counts::record("variant-summary", &path);
            variant_summary(reader.root(), &relative, &source).map_err(|error| {
                AppError::context(format!("读取装配失败：{}", path.display()), error).at_path(&path)
            })?
        };
        if !seen.insert(file.variant_id.clone()) {
            warnings.push(duplicate(
                reader.root(),
                &path,
                "variantId",
                &file.variant_id,
                "scan.variant_id_duplicate",
            ));
        } else {
            files.push(file);
        }
    }
    files.sort_by(|a, b| {
        a.hull_id
            .cmp(&b.hull_id)
            .then_with(|| a.variant_id.cmp(&b.variant_id))
    });
    Ok((files, warnings))
}
pub(in crate::services::project) fn load_skin_files_from(
    reader: &mut SourceReader,
) -> AppResult<(Vec<SkinFile>, Vec<GameScanWarning>)> {
    refresh_skin_files_from(reader, &[])
}
pub(in crate::services::project) fn refresh_skin_files_from(
    reader: &mut SourceReader,
    previous: &[SkinFile],
) -> AppResult<(Vec<SkinFile>, Vec<GameScanWarning>)> {
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (a, b) = counts.get();
        counts.set((a, b + 1));
    });
    let mut files = Vec::new();
    let mut warnings = Vec::new();
    let mut seen = BTreeSet::new();
    let previous = previous
        .iter()
        .map(|file| (file.rel_path.as_str(), file))
        .collect::<BTreeMap<_, _>>();
    for path in reader.discover("data/hulls/skins", &["skin"], true)? {
        let relative = reader.key(&path);
        let file = if let Some(file) = previous.get(relative.as_str()).filter(|_| {
            !reader
                .changed_paths()
                .iter()
                .any(|changed| io::relative_path_contains(changed, &relative))
        }) {
            (*file).clone()
        } else {
            let source = reader.json_source(&path)?;
            skin_summary(reader.root(), &relative, &source)?
        };
        if !seen.insert(file.skin_hull_id.clone()) {
            warnings.push(duplicate(
                reader.root(),
                &path,
                "skinHullId",
                &file.skin_hull_id,
                "scan.skin_id_duplicate",
            ));
        } else {
            files.push(file);
        }
    }
    files.sort_by(|a, b| {
        a.base_hull_id
            .cmp(&b.base_hull_id)
            .then_with(|| a.skin_hull_id.cmp(&b.skin_hull_id))
    });
    Ok((files, warnings))
}
fn required(data: &Value, field: &str) -> AppResult<String> {
    data.get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .map(str::to_owned)
        .ok_or_else(|| AppError::message("config.missing_field", format!("缺少字段：{field}")))
}
fn array_len(data: &Value, field: &str) -> usize {
    data[field].as_array().map_or(0, Vec::len)
}
fn object_len(data: &Value, field: &str) -> usize {
    data[field].as_object().map_or(0, |fields| fields.len())
}
pub fn build_variant_file(
    root: &Path,
    relative: &str,
    source: &JsonSource,
) -> AppResult<VariantFile> {
    let mut file = variant_summary(root, relative, source)?;
    file.document = Some(JsonFileContent::from(source));
    Ok(file)
}
fn variant_summary(root: &Path, relative: &str, source: &JsonSource) -> AppResult<VariantFile> {
    let data = source.content.to_json()?;
    Ok(VariantFile {
        variant_id: required(&data, "variantId")?,
        hull_id: required(&data, "hullId")?,
        path: io::forward_slash_path(&root.join(relative)),
        rel_path: relative.into(),
        document: None,
        weapon_group_count: array_len(&data, "weaponGroups"),
        hull_mod_count: array_len(&data, "hullMods"),
        perma_mod_count: array_len(&data, "permaMods"),
        wing_count: array_len(&data, "wings"),
        data,
    })
}
pub fn build_skin_file(root: &Path, relative: &str, source: &JsonSource) -> AppResult<SkinFile> {
    let mut file = skin_summary(root, relative, source)?;
    file.document = Some(JsonFileContent::from(source));
    Ok(file)
}
fn skin_summary(root: &Path, relative: &str, source: &JsonSource) -> AppResult<SkinFile> {
    let data = source.content.to_json()?;
    Ok(SkinFile {
        skin_hull_id: models::file_content_id(&data, "skinHullId", Path::new(relative)),
        base_hull_id: data["baseHullId"].as_str().unwrap_or_default().into(),
        path: io::forward_slash_path(&root.join(relative)),
        rel_path: relative.into(),
        document: None,
        built_in_mod_count: array_len(&data, "builtInMods"),
        built_in_weapon_count: object_len(&data, "builtInWeapons"),
        built_in_wing_count: array_len(&data, "builtInWings"),
        weapon_slot_change_count: object_len(&data, "weaponSlotChanges"),
        engine_slot_change_count: object_len(&data, "engineSlotChanges"),
        data,
    })
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
