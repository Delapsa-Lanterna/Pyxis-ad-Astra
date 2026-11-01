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
    #[cfg(test)]
    use crate::services::project::{
        PerformanceTrace, close_project_session, open_project_session_traced,
    };
    #[cfg(test)]
    use crate::{io, services};
    #[cfg(test)]
    use std::fs;
    use std::path::Path;

    #[test]
    fn session_versions_cover_mission_directory_and_skin_resource_override() {
        let root = project_workspace("versioned_mission_skin");
        fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
        fs::write(
            root.join("data/hulls/base.ship"),
            r#"{"hullId":"base","spriteName":"graphics/base.png"}"#,
        )
        .unwrap();
        fs::write(
            root.join("data/hulls/skins/skin.skin"),
            r#"{"skinHullId":"skin","baseHullId":"base","spriteName":"graphics/skin.png"}"#,
        )
        .unwrap();
        fs::create_dir_all(root.join("data/missions/demo")).unwrap();
        fs::write(
            root.join("data/missions/mission_list.csv"),
            "mission\ndemo\n",
        )
        .unwrap();
        fs::write(
            root.join("data/missions/demo/descriptor.json"),
            "{\"title\":\"demo\"}",
        )
        .unwrap();
        let mut trace = PerformanceTrace::new("project.openSession");
        let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
        let skin = services::query_entity(&manifest.session_id, EntityKind::Skin, "skin")
            .unwrap()
            .unwrap();
        assert_eq!(skin.resource_refs["sprite"].rel_path, "graphics/skin.png");
        assert_eq!(skin.base_versions.len(), 1);
        assert!(skin.base_versions[0].fingerprint.is_some());
        let mission =
            services::query_entity_edit_target(&manifest.session_id, EntityKind::Mission, "demo")
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
        io::verify_versions(&manifest.mod_root, &mission).unwrap();
        fs::write(root.join("data/missions/demo/new.txt"), "external").unwrap();
        assert!(io::verify_versions(&manifest.mod_root, &mission).is_err());
        close_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
