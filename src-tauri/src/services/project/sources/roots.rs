use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
};
use std::path::{Path, PathBuf};

/// Tests the expected game directories at the supplied root.
pub fn is_game_root(path: &Path) -> bool {
    path.join("starsector-core").is_dir() && path.join("mods").is_dir()
}

/// Authorizes a game root and its mods directory, returning canonical paths or the path error.
pub fn resolve_game_mods_directory(starsector_root: &Path) -> AppResult<(PathBuf, PathBuf)> {
    let boundary = FsRootBoundary::new(starsector_root, "starsector root")?;
    let canonical_root = boundary.root().to_path_buf();
    if !is_game_root(&canonical_root) {
        return Err(AppError::message(
            "detect.not_game_root",
            format!(
                "不是有效的 Starsector 游戏目录: {}",
                canonical_root.display()
            ),
        ));
    }
    let mods_dir = FsRootBoundary::new(&canonical_root.join("mods"), "Starsector mods 目录")?
        .root()
        .to_path_buf();
    Ok((canonical_root, mods_dir))
}

/// Tests whether the supplied directory has a Mod descriptor.
pub fn is_mod_root(path: &Path) -> bool {
    path.join("mod_info.json").is_file()
}

/// Infers a game root from the supplied Mod location when its layout matches.
pub fn infer_starsector_root(mod_root: &Path) -> Option<PathBuf> {
    let candidate = mod_root.parent()?.parent()?;
    is_game_root(candidate).then(|| candidate.to_path_buf())
}

/// Resolve one authorized Core source for opening and window queries.
pub(crate) fn resolve_core_root(
    override_root: Option<&str>,
    game_root: Option<&str>,
    mod_root: Option<&Path>,
) -> AppResult<Option<PathBuf>> {
    if let Some(root) = override_root {
        return resolve_game_mods_directory(Path::new(root)).map(|(root, _)| Some(root));
    }
    let root = game_root
        .map(PathBuf::from)
        .or_else(|| mod_root.and_then(infer_starsector_root));
    root.map(|root| {
        FsRootBoundary::new(&root, "starsector root").map(|boundary| boundary.root().to_path_buf())
    })
    .transpose()
}
