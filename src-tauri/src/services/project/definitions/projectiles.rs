use crate::services::project::sources::documents::LoadedSpecRecord;
use crate::{errors::AppResult, models::ResourceSource};
use std::collections::BTreeMap;
#[cfg(test)]
use std::path::Path;

/// Merges Mod projectile specs over core fallbacks; a Mod spec with the same
/// id always wins, core-only specs fill the rest.
#[cfg(test)]
pub(in crate::services::project) fn load_projectile_specs(
    mod_root: &Path,
    core_projectiles: Option<&BTreeMap<String, LoadedSpecRecord>>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    load_projectile_specs_from(
        &mut super::super::sources::SourceReader::new(mod_root)?,
        core_projectiles,
    )
}
pub(in crate::services::project) fn load_projectile_specs_from(
    sources: &mut super::super::sources::SourceReader,
    core_projectiles: Option<&BTreeMap<String, LoadedSpecRecord>>,
) -> AppResult<BTreeMap<String, LoadedSpecRecord>> {
    let mut result = BTreeMap::new();
    result.extend(super::super::sources::documents::load_spec_records_from(
        sources,
        "data/weapons/proj",
        "proj",
        "id",
        ResourceSource::Mod,
    )?);
    if let Some(core_projectiles) = core_projectiles {
        for (id, value) in core_projectiles {
            result.entry(id.clone()).or_insert_with(|| value.clone());
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    use crate::services::project::test_support::project_workspace;
    use std::fs;

    #[test]
    fn mod_projectile_overrides_core_fallback() {
        let root = project_workspace("projectile_fallback");
        let mod_proj = root.join("mod/data/weapons/proj");
        let core_proj = root.join("core/starsector-core/data/weapons/proj");
        fs::create_dir_all(&mod_proj).unwrap();
        fs::create_dir_all(&core_proj).unwrap();
        write_utf8_no_bom(&mod_proj.join("same.proj"), r#"{"id":"same","damage":2}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("same.proj"), r#"{"id":"same","damage":1}"#).unwrap();
        write_utf8_no_bom(&core_proj.join("core_only.proj"), r#"{"id":"core_only"}"#).unwrap();

        let core_projectiles = crate::services::project::sources::documents::load_spec_records(
            &root.join("core/starsector-core"),
            "data/weapons/proj",
            "proj",
            "id",
            ResourceSource::Core,
        )
        .unwrap();
        let loaded = load_projectile_specs(&root.join("mod"), Some(&core_projectiles)).unwrap();

        assert_eq!(loaded["same"].data["damage"], 2);
        assert!(loaded["core_only"].data.is_object());
        root.close().unwrap();
    }
}
