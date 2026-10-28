use super::model::ProjectSession;
use crate::models::FileVersion;
use std::path::Path;

pub(super) fn version_for_path(session: &ProjectSession, path: &str) -> FileVersion {
    session
        .source_versions
        .get(path)
        .cloned()
        .unwrap_or_else(|| FileVersion {
            path: Path::new(&session.manifest.mod_root)
                .join(path)
                .to_string_lossy()
                .to_string(),
            fingerprint: None,
        })
}

#[cfg(test)]
mod tests {
    use crate::models::EntityKind;
    use crate::services::project::test_support::project_workspace;
    use std::path::Path;
    #[test]
    fn session_versions_cover_mission_directory_and_skin_resource_override() {
        let root = project_workspace("versioned_mission_skin");
        std::fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        std::fs::write(
            root.join("data/hulls/base.ship"),
            r#"{"hullId":"base","spriteName":"graphics/base.png"}"#,
        )
        .unwrap();
        std::fs::write(
            root.join("data/hulls/skins/skin.skin"),
            r#"{"skinHullId":"skin","baseHullId":"base","spriteName":"graphics/skin.png"}"#,
        )
        .unwrap();
        std::fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        std::fs::write(
            root.join("data/missions/mission_list.csv"),
            "mission\ndemo\n",
        )
        .unwrap();
        std::fs::write(
            root.join("data/missions/demo/descriptor.json"),
            "{\"title\":\"demo\"}",
        )
        .unwrap();
        let mut trace = super::super::PerformanceTrace::new("project.openSession");
        let manifest = super::super::open_project_session_traced(&root, None, &mut trace).unwrap();
        let skin = crate::services::query_entity(&manifest.session_id, EntityKind::Skin, "skin")
            .unwrap()
            .unwrap();
        assert_eq!(skin.resource_refs["sprite"].rel_path, "graphics/skin.png");
        assert_eq!(skin.base_versions.len(), 1);
        assert!(skin.base_versions[0].fingerprint.is_some());
        let mission = crate::services::query_entity_edit_target(
            &manifest.session_id,
            EntityKind::Mission,
            "demo",
        )
        .unwrap()
        .base_versions;
        assert_eq!(mission.len(), 4);
        for relative in [
            "data/missions/demo",
            "data/missions/demo/descriptor.json",
            "data/missions/mission_list.csv",
        ] {
            assert!(
                mission
                    .iter()
                    .any(|version| Path::new(&version.path).ends_with(relative)
                        && version.fingerprint.is_some())
            );
        }
        assert!(mission.iter().any(|version| {
            Path::new(&version.path).ends_with("data/missions/demo/mission_text.txt")
                && version.fingerprint.is_none()
        }));
        crate::io::verify_versions(&manifest.mod_root, &mission).unwrap();
        std::fs::write(root.join("data/missions/demo/new.txt"), "external").unwrap();
        assert!(crate::io::verify_versions(&manifest.mod_root, &mission).is_err());
        super::super::close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
