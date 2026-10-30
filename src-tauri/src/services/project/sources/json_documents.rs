use crate::{
    domain::json_documents::{build_skin_file, build_variant_file},
    errors::{AppError, AppResult, ErrorLocation},
    io::forward_slash_relative_path,
    models::{GameScanWarning, GameWarningEditTarget, SkinFile, VariantFile},
};
#[cfg(test)]
use std::path::Path;

#[cfg(test)]
thread_local! { static LOAD_COUNTS: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) }; }
#[cfg(test)]
pub(in crate::services::project) fn take_load_counts() -> (usize, usize) {
    LOAD_COUNTS.with(|counts| counts.replace((0, 0)))
}

#[cfg(test)]
pub(crate) fn load_variant_files(
    mod_root: &Path,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    load_variant_files_from(&mut super::super::sources::SourceReader::new(mod_root)?)
}
pub(in crate::services::project) fn load_variant_files_from(
    sources: &mut super::super::sources::SourceReader,
) -> AppResult<(Vec<VariantFile>, Vec<GameScanWarning>)> {
    let mod_root = sources.root().to_path_buf();
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (variant, skin) = counts.get();
        counts.set((variant + 1, skin));
    });
    let mut seen = std::collections::HashMap::new();
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
    sources: &mut super::super::sources::SourceReader,
) -> AppResult<(Vec<SkinFile>, Vec<GameScanWarning>)> {
    let mod_root = sources.root().to_path_buf();
    #[cfg(test)]
    LOAD_COUNTS.with(|counts| {
        let (variant, skin) = counts.get();
        counts.set((variant, skin + 1));
    });
    let mut seen = std::collections::HashMap::new();
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;

    #[test]
    fn duplicate_variant_ids_keep_first_and_warn() {
        let root = project_workspace("core_kite_duplicate");
        let core_root = root.join("starsector-core");
        std::fs::create_dir_all(core_root.join("data/variants/kite")).unwrap();
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
        std::fs::create_dir_all(root.join("data/variants/kite")).unwrap();
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
            std::fs::create_dir_all(root.join(directory)).unwrap();
            for name in ["first", "second"] {
                write_utf8_no_bom(&root.join(format!("{directory}/{name}.{extension}")), text)
                    .unwrap();
            }
        }
        let mut sources = super::super::super::sources::SourceReader::new(&root).unwrap();
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
