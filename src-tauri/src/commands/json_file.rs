#[cfg(test)]
use crate::models::EntityKind;
#[cfg(test)]
use crate::services::json_file::json_file_save_context;

#[cfg(test)]
#[path = "json_file_validation_tests.rs"]
mod validation_tests;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::services::project;
    #[cfg(test)]
    use crate::services::project::PerformanceTrace;
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use std::fs;

    #[test]
    fn spec_save_scope_matches_indexed_filename_without_previous_id() {
        for (kind, dir, extension, id_field, companion) in [
            (
                EntityKind::Variant,
                "data/variants",
                "variant",
                "variantId",
                "hullId",
            ),
            (
                EntityKind::Skin,
                "data/hulls/skins",
                "skin",
                "skinHullId",
                "baseHullId",
            ),
        ] {
            let root = project_workspace(&format!("spec_scope_{extension}"));
            fs::create_dir_all(root.join(dir)).unwrap();
            let indexed = format!("{dir}/filename.{extension}");
            write_utf8_no_bom(
                &root.join(&indexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            let mut trace = PerformanceTrace::new("project.openSession");
            let manifest = project::open_project_session_traced(&root, None, &mut trace).unwrap();
            let unindexed = format!("{dir}/other.{extension}");
            write_utf8_no_bom(
                &root.join(&unindexed),
                &format!("{{\"{id_field}\":\"old\",\"{companion}\":\"hull\"}}"),
            )
            .unwrap();
            assert!(
                json_file_save_context(&manifest.session_id, kind, None, "old", Some(&indexed))
                    .unwrap()
            );
            assert!(
                json_file_save_context(&manifest.session_id, kind, None, "old", Some(&unindexed))
                    .is_err()
            );
            assert!(
                json_file_save_context(
                    &manifest.session_id,
                    kind,
                    Some("missing"),
                    "new",
                    Some(&indexed)
                )
                .is_err()
            );
            assert!(
                !json_file_save_context(&manifest.session_id, kind, None, "new", None).unwrap()
            );
            project::close_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}
