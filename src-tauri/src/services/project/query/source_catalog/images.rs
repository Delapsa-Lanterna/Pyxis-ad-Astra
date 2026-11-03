use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, forward_slash_relative_path, validate_walk_entry};
use crate::models::{ResourceSource, SourceOption, SourceOptionGroup};
use crate::services::project::session::{lock_ready_session, session_handle};
use crate::services::project::sources::core;
use std::collections::BTreeSet;
use std::path::Path;
use walkdir::WalkDir;

pub fn query_image_source_options(
    session_id: &str,
    directories: &[String],
    mission_id: Option<&str>,
) -> AppResult<Vec<SourceOptionGroup>> {
    let handle = session_handle(session_id)?;
    let (mod_root, game_root, references) = {
        let session = lock_ready_session(&handle)?;
        (
            session.manifest.mod_root.clone(),
            session.manifest.starsector_root.clone(),
            session.references.clone(),
        )
    };
    if directories.is_empty() {
        return Ok(Vec::new());
    }
    let mut roots = vec![(ResourceSource::Mod, mod_root.into(), None)];
    roots.extend(references.iter().map(|view| {
        (
            ResourceSource::Reference,
            view.identity.mod_root.clone().into(),
            Some(view.identity.clone()),
        )
    }));
    if let Some(root) = game_root {
        roots.push((ResourceSource::Core, core::core_dir(&root)?, None));
    }
    let mut seen = BTreeSet::new();
    let mut groups = Vec::new();
    for (origin, root, reference) in roots {
        let boundary = FsRootBoundary::new(&root, "image source root")?;
        let base = mission_id
            .map(|id| {
                boundary.resolve_relative(&format!("data/missions/{id}"), "mission image root")
            })
            .transpose()?
            .unwrap_or(root);
        if !base.exists() {
            continue;
        }
        let boundary = FsRootBoundary::new(&base, "image path base")?;
        let mut paths = BTreeSet::new();
        for directory in directories {
            let path = if directory == "." {
                boundary.root().to_path_buf()
            } else {
                boundary.resolve_relative(directory, "image directory")?
            };
            if !path.exists() {
                continue;
            }
            for entry in WalkDir::new(&path) {
                let entry = entry.map_err(|error| {
                    AppError::message("io.walk_failed", error.to_string()).at_path(&path)
                })?;
                validate_walk_entry(entry.path(), "image candidate")?;
                if entry.file_type().is_file()
                    && matches!(
                        entry
                            .path()
                            .extension()
                            .and_then(|extension| extension.to_str()),
                        Some("png" | "jpg" | "jpeg" | "gif")
                    )
                {
                    let path = boundary.resolve_absolute(entry.path(), "image candidate")?;
                    paths.insert(forward_slash_relative_path(boundary.root(), &path));
                }
            }
        }
        let options = paths
            .into_iter()
            .filter(|path| seen.insert(path.clone()))
            .map(|value| SourceOption {
                label: Path::new(&value)
                    .file_name()
                    .expect("image has a file name")
                    .to_string_lossy()
                    .into_owned(),
                value,
                origin,
                description: None,
                resource_ref: None,
                template_value: None,
                template_max: None,
            })
            .collect::<Vec<_>>();
        if !options.is_empty() {
            groups.push(SourceOptionGroup {
                origin,
                options,
                reference,
            });
        }
    }
    drop(lock_ready_session(&handle)?);
    Ok(groups)
}

#[cfg(test)]
mod image_tests {
    use crate::services::project_sync::release_project_session;

    use super::*;
    use crate::services::project::PerformanceTrace;
    use crate::services::project::session::open_project_session_traced;
    use crate::services::project::test_support;
    use crate::services::project::test_support::project_workspace;
    use crate::test_support::TestWorkspace;
    use std::fs;

    #[test]
    fn image_directories_merge_sources_and_keep_mission_paths_relative() {
        let root = project_workspace("image_source_catalog");
        let local = root.join("mod");
        let game = root.join("game");
        let core = game.join("starsector-core");
        for base in [&local, &core] {
            fs::create_dir_all(base.join("graphics/icons/sub")).unwrap();
            fs::create_dir_all(base.join("graphics/other")).unwrap();
            fs::create_dir_all(base.join("data/missions/sample/sub")).unwrap();
            for path in [
                "graphics/icons/shared.png",
                "graphics/icons/sub/a.jpg",
                "graphics/icons/b.jpeg",
                "graphics/icons/c.gif",
                "graphics/icons/ignored.txt",
                "graphics/other/outside.png",
                "data/missions/sample/icon.jpg",
                "data/missions/sample/sub/extra.png",
            ] {
                fs::write(base.join(path), [1]).unwrap();
            }
        }
        fs::write(core.join("graphics/icons/core.png"), [1]).unwrap();
        let manifest = open_project_session_traced(
            &local,
            Some(&game),
            &mut PerformanceTrace::new("images.test"),
        )
        .unwrap();
        let directories = vec![
            "graphics/icons".into(),
            "graphics/icons/sub".into(),
            "missing".into(),
        ];
        let groups = query_image_source_options(&manifest.session_id, &directories, None).unwrap();
        assert_eq!(groups.len(), 2);
        assert_eq!(groups[0].origin, ResourceSource::Mod);
        assert_eq!(groups[0].options.len(), 4);
        assert_eq!(
            groups[1]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["graphics/icons/core.png"]
        );
        assert!(
            groups
                .iter()
                .flat_map(|group| &group.options)
                .all(|option| option.resource_ref.is_none())
        );
        assert_eq!(groups[0].options[0].label, "b.jpeg");
        let mission =
            query_image_source_options(&manifest.session_id, &[".".into()], Some("sample"))
                .unwrap();
        assert_eq!(
            mission[0]
                .options
                .iter()
                .map(|option| option.value.as_str())
                .collect::<Vec<_>>(),
            ["icon.jpg", "sub/extra.png"]
        );
        assert!(
            query_image_source_options(&manifest.session_id, &[], None)
                .unwrap()
                .is_empty()
        );
        assert!(
            query_image_source_options(&manifest.session_id, &["missing".into()], None)
                .unwrap()
                .is_empty()
        );
        for invalid in ["../outside", "/absolute", "graphics/../other"] {
            assert!(
                query_image_source_options(&manifest.session_id, &[invalid.into()], None).is_err()
            );
        }
        assert!(
            query_image_source_options(&manifest.session_id, &[".".into()], Some("../outside"))
                .is_err()
        );
        release_project_session(manifest.session_id.clone()).unwrap();
        assert!(query_image_source_options(&manifest.session_id, &directories, None).is_err());
        root.close().unwrap();
    }

    #[test]
    fn image_directories_reject_linked_children() {
        let (root, outside, _link) =
            TestWorkspace::directory_link("image_catalog_link", "graphics/icons").unwrap();
        let root = root.with_cleanup(test_support::release_workspace);
        fs::write(outside.join("outside.png"), [1]).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("images.test"))
                .unwrap();
        assert!(
            query_image_source_options(&manifest.session_id, &["graphics/icons".into()], None)
                .is_err()
        );
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
