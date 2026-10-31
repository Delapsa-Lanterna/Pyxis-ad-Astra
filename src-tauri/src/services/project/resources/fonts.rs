use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, read_utf8_no_bom},
    models::font::{FontId, OriginalFontPage, OriginalFontResult},
};
use base64::{Engine as _, engine::general_purpose};
use std::{collections::BTreeSet, fs, path::Path};

pub fn query_original_font(
    session_id: &str,
    font_id: FontId,
    font_directory: Option<&str>,
) -> AppResult<OriginalFontResult> {
    let handle = super::super::session::session_handle(session_id)?;
    let session = super::super::session::lock_session(&handle)?;
    let root = session.manifest.starsector_root.clone();
    drop(session);
    if let Some(directory) = font_directory {
        return read_font_directory(Path::new(directory), font_id);
    }
    let Some(root) = root else {
        return Ok(OriginalFontResult::Unavailable);
    };
    read_original_font(Path::new(&root), font_id)
}

fn read_original_font(root: &Path, font_id: FontId) -> AppResult<OriginalFontResult> {
    let game = FsRootBoundary::new(root, "font game root")?;
    let core_path = game.resolve_relative("starsector-core", "font core root")?;
    if !core_path.is_dir() {
        return Ok(OriginalFontResult::Unavailable);
    }
    let core = FsRootBoundary::new(&core_path, "font core root")?;
    let directory = core.resolve_relative("graphics/fonts", "font directory")?;
    let mut result = read_font_directory(&directory, font_id)?;
    if let OriginalFontResult::Available { root, .. } = &mut result {
        *root = game.root().to_string_lossy().into_owned();
    }
    Ok(result)
}

fn read_font_directory(directory: &Path, font_id: FontId) -> AppResult<OriginalFontResult> {
    let boundary = FsRootBoundary::new(directory, "font directory")?;
    let path = boundary.resolve_relative(&format!("{}.fnt", font_id.name()), "font definition")?;
    let definition = read_utf8_no_bom(&path)?;
    let mut pages = Vec::new();
    let mut ids = BTreeSet::new();
    for line in definition.lines().filter(|line| line.starts_with("page ")) {
        let malformed = || {
            AppError::message(
                "font.definition_invalid",
                "Invalid bitmap font page declaration",
            )
            .at_path(&path)
        };
        let id = line
            .split_whitespace()
            .find_map(|field| field.strip_prefix("id="))
            .ok_or_else(malformed)?
            .parse::<u32>()
            .map_err(|_| malformed())?;
        let file = line
            .split_once("file=\"")
            .and_then(|(_, tail)| tail.split_once('"').map(|(file, _)| file))
            .ok_or_else(malformed)?;
        if !ids.insert(id) {
            return Err(malformed());
        }
        let image = boundary.resolve_relative(file, "font page")?;
        let bytes = fs::read(&image).map_err(|error| {
            AppError::context("Read font page failed", error.into()).at_path(&image)
        })?;
        #[cfg(test)]
        crate::io::work::record("read", &image);
        pages.push(OriginalFontPage {
            id,
            path: image.to_string_lossy().into_owned(),
            data_url: format!(
                "data:image/png;base64,{}",
                general_purpose::STANDARD.encode(bytes)
            ),
        });
    }
    Ok(OriginalFontResult::Available {
        root: boundary.root().to_string_lossy().into_owned(),
        font_id,
        path: path.to_string_lossy().into_owned(),
        definition,
        pages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::{io::write_utf8_no_bom, test_support::TestWorkspace};

    fn install(root: &Path, marker: &str) {
        let directory = root.join("starsector-core/graphics/fonts");
        fs::create_dir_all(&directory).unwrap();
        write_utf8_no_bom(&directory.join("orbitron12condensed.fnt"), &format!("common lineHeight=15 base=12 scaleW=1 scaleH=1 pages=2\npage id=0 file=\"orbitron12_0.png\"\npage id=1 file=\"page1.png\"\n{marker}")).unwrap();
        fs::write(directory.join("orbitron12_0.png"), [1, 2, 3]).unwrap();
        fs::write(directory.join("page1.png"), [4, 5, 6]).unwrap();
    }

    #[test]
    fn reads_declared_page_names_and_returns_actual_source_paths() {
        let root = project_workspace("original_font_pages");
        install(&root, "original");
        let result = read_original_font(&root, FontId::Orbitron12condensed).unwrap();
        for name in ["orbitron12condensed.fnt", "orbitron12_0.png", "page1.png"] {
            assert_eq!(
                crate::io::work::count(
                    "read",
                    &root.join("starsector-core/graphics/fonts").join(name)
                ),
                1,
                "{name}"
            );
        }
        let OriginalFontResult::Available {
            pages,
            path,
            definition,
            root: effective,
            ..
        } = result
        else {
            panic!("available font");
        };
        assert_eq!(pages.len(), 2);
        assert!(pages[0].path.ends_with("orbitron12_0.png"));
        assert_eq!(pages[0].data_url, "data:image/png;base64,AQID");
        assert_eq!(pages[1].id, 1);
        assert!(path.ends_with("orbitron12condensed.fnt"));
        assert!(definition.contains("original"));
        assert_eq!(Path::new(&effective), root.canonicalize().unwrap());
        root.close().unwrap();
    }

    #[test]
    fn distinguishes_unavailable_core_from_missing_font_and_page_files() {
        let root = project_workspace("original_font_missing");
        assert!(matches!(
            read_original_font(&root, FontId::Victor14).unwrap(),
            OriginalFontResult::Unavailable
        ));
        install(&root, "original");
        let error = read_original_font(&root, FontId::Victor14).unwrap_err();
        assert!(
            error
                .location()
                .unwrap()
                .path
                .as_ref()
                .unwrap()
                .ends_with("victor14.fnt")
        );
        fs::remove_file(root.join("starsector-core/graphics/fonts/page1.png")).unwrap();
        let error = read_original_font(&root, FontId::Orbitron12condensed).unwrap_err();
        assert!(
            error
                .location()
                .unwrap()
                .path
                .as_ref()
                .unwrap()
                .ends_with("page1.png")
        );
        root.close().unwrap();
    }

    #[test]
    fn rejects_malformed_duplicate_and_escaping_page_declarations() {
        let root = project_workspace("original_font_invalid_page");
        install(&root, "original");
        let path = root.join("starsector-core/graphics/fonts/orbitron12condensed.fnt");
        for text in [
            "page id=invalid file=\"page1.png\"",
            "page id=0",
            "page id=0 file=\"page1.png\"\npage id=0 file=\"page1.png\"",
            "page id=0 file=\"../../../outside.png\"",
        ] {
            write_utf8_no_bom(&path, text).unwrap();
            assert!(read_original_font(&root, FontId::Orbitron12condensed).is_err());
        }
        root.close().unwrap();
    }

    #[test]
    fn rejects_linked_font_parent_chains() {
        let (root, outside, _linked) =
            TestWorkspace::directory_link("original_font_link", "starsector-core/graphics/fonts")
                .unwrap();
        write_utf8_no_bom(&outside.join("victor14.fnt"), "page id=0 file=\"page.png\"").unwrap();
        assert!(read_original_font(&root, FontId::Victor14).is_err());
        root.close().unwrap();
    }

    #[test]
    fn captures_session_root_and_uses_custom_font_directory() {
        let root = project_workspace("original_font_session_root");
        let game = project_workspace("original_font_game");
        let other = project_workspace("original_font_other_game");
        write_utf8_no_bom(
            &root.join("mod_info.json"),
            "{\"id\":\"font-test\",\"name\":\"Font Test\"}",
        )
        .unwrap();
        install(&game, "session-source");
        install(&other, "settings-source");
        let mut trace = crate::services::project::PerformanceTrace::new("fonts.test");
        let manifest = super::super::super::session::open_project_session_traced(
            &root,
            Some(&game),
            &mut trace,
        )
        .unwrap();
        let from_session =
            query_original_font(&manifest.session_id, FontId::Orbitron12condensed, None).unwrap();
        let OriginalFontResult::Available { definition, .. } = from_session else {
            panic!("session font");
        };
        assert!(definition.contains("session-source"));
        let directory = other.join("starsector-core/graphics/fonts");
        let custom = query_original_font(
            &manifest.session_id,
            FontId::Orbitron12condensed,
            Some(&directory.to_string_lossy()),
        )
        .unwrap();
        let OriginalFontResult::Available {
            definition,
            root: effective,
            pages,
            ..
        } = custom
        else {
            panic!("custom font");
        };
        assert!(definition.contains("settings-source"));
        assert_eq!(Path::new(&effective), directory.canonicalize().unwrap());
        assert_eq!(pages.len(), 2);
        for missing in [
            other.join("missing"),
            game.join("starsector-core/graphics/fonts"),
        ] {
            assert!(
                query_original_font(
                    &manifest.session_id,
                    FontId::Victor14,
                    Some(&missing.to_string_lossy())
                )
                .is_err()
            );
        }
        super::super::super::session::close_project_session(manifest.session_id.clone()).unwrap();
        assert!(
            query_original_font(&manifest.session_id, FontId::Orbitron12condensed, None).is_err()
        );
        assert!(
            query_original_font(
                &manifest.session_id,
                FontId::Orbitron12condensed,
                Some(&directory.to_string_lossy())
            )
            .is_err()
        );
        for dir in [root, game, other] {
            dir.close().unwrap();
        }
    }
}
