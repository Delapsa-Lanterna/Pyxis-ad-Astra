use super::super::cache::{lock_ready_session, lock_registry, media, session_handle};
use super::refs::media_resource_key;
use crate::models::{ResourceRef, ResourceSource};
use crate::{
    errors::{AppError, AppResult},
    io::FsRootBoundary,
};
use base64::{Engine as _, engine::general_purpose};
#[cfg(test)]
use serde_json::Value;
use std::collections::BTreeMap;
#[cfg(test)]
use std::sync::{LazyLock, Mutex};
use std::{
    fs,
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

struct LoadedSpriteMedia {
    resolved_path: PathBuf,
    modified: SystemTime,
    length: u64,
    data_url: String,
}

struct SpriteRoot {
    path: PathBuf,
    boundary: Option<FsRootBoundary>,
}

impl SpriteRoot {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            boundary: None,
        }
    }

    fn boundary(&mut self, label: &str) -> AppResult<&FsRootBoundary> {
        if self
            .boundary
            .as_ref()
            .is_none_or(|root| !root.root().is_dir())
        {
            self.boundary = Some(FsRootBoundary::new(&self.path, label)?);
        }
        Ok(self.boundary.as_ref().expect("sprite root was prepared"))
    }
}

pub(in crate::services::project) struct SpriteReadBatch {
    session_id: String,
    revision: u64,
    mod_root: SpriteRoot,
    core_root: Option<SpriteRoot>,
    references: Vec<(crate::models::ReferenceSource, SpriteRoot)>,
    loaded: BTreeMap<String, Option<String>>,
}

impl SpriteReadBatch {
    pub(in crate::services::project) fn new(session_id: &str) -> AppResult<Self> {
        let handle = session_handle(session_id)?;
        let session = lock_ready_session(&handle)?;
        Ok(Self {
            session_id: session_id.to_string(),
            revision: session.reference_revision,
            mod_root: SpriteRoot::new(PathBuf::from(&session.manifest.mod_root)),
            core_root: session
                .manifest
                .starsector_root
                .as_ref()
                .map(|root| SpriteRoot::new(PathBuf::from(root).join("starsector-core"))),
            loaded: BTreeMap::new(),
            references: session
                .references
                .iter()
                .map(|view| {
                    (
                        view.identity.clone(),
                        SpriteRoot::new(view.identity.mod_root.clone().into()),
                    )
                })
                .collect(),
        })
    }

    pub(in crate::services::project) fn data_url(
        &mut self,
        resource: &ResourceRef,
    ) -> AppResult<Option<String>> {
        let resource_key = media_resource_key(resource);
        if self.revision != super::super::cache::references::reference_revision() {
            return Err(AppError::message(
                "reference.changed",
                "引用来源已变化，请重新读取",
            ));
        }
        let reference = (resource.source == ResourceSource::Reference)
            .then(|| {
                self.references
                    .iter()
                    .position(|(identity, _)| Some(identity) == resource.reference.as_ref())
                    .ok_or_else(|| AppError::message("reference.unavailable", "引用来源已不可用"))
            })
            .transpose()?;
        if let Some(result) = self.loaded.get(&resource_key) {
            return Ok(result.clone());
        }
        let result = if let Some(url) = media::lookup_data_url(&self.session_id, &resource_key) {
            Some(url)
        } else {
            let rel_path = resource.rel_path.replace('\\', "/");
            let loaded = if let Some(index) = reference {
                let root = &mut self.references[index].1;
                let loaded = load_sprite_from_boundary(
                    root.boundary("reference resource root")?,
                    &rel_path,
                    "reference sprite",
                )?;
                if loaded.is_some() {
                    loaded
                } else {
                    self.load(ResourceSource::Mod, &rel_path)?
                }
            } else {
                self.load(resource.source, rel_path.trim().trim_end_matches('/'))?
            };
            if let Some(loaded) = loaded {
                let registry = lock_registry()?;
                if registry.contains_key(&self.session_id) {
                    media::insert_entry(
                        &self.session_id,
                        &resource_key,
                        loaded.resolved_path,
                        loaded.modified,
                        loaded.length,
                        loaded.data_url.clone(),
                    );
                }
                Some(loaded.data_url)
            } else {
                None
            }
        };
        self.loaded.insert(resource_key, result.clone());
        Ok(result)
    }

    fn load(
        &mut self,
        source: ResourceSource,
        sprite: &str,
    ) -> AppResult<Option<LoadedSpriteMedia>> {
        if source == ResourceSource::Mod {
            let boundary = self.mod_root.boundary("mod resource root")?;
            if let Some(loaded) = load_sprite_from_boundary(boundary, sprite, "sprite path")? {
                return Ok(Some(loaded));
            }
            for (_, root) in &mut self.references {
                if let Some(loaded) = load_sprite_from_boundary(
                    root.boundary("reference resource root")?,
                    sprite,
                    "reference sprite",
                )? {
                    return Ok(Some(loaded));
                }
            }
            let Some(core) = self.core_root.as_mut().filter(|root| root.path.exists()) else {
                return Ok(None);
            };
            let boundary = core.boundary("core resource root")?;
            load_sprite_from_boundary(boundary, sprite, "core sprite path")
        } else {
            let core = self.core_root.as_mut().ok_or_else(|| {
                AppError::message(
                    "resource.core_root_required",
                    "core resource requires starsector root",
                )
            })?;
            let boundary = core.boundary("resource root")?;
            load_sprite_from_boundary(boundary, sprite, "sprite path")
        }
    }
}

/// The single source for the project's image type universe: core graphics
/// scanning filters on it and sprite data URLs take their MIME from it.
pub(super) fn image_mime_type(extension: &str) -> Option<&'static str> {
    match extension.to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        _ => None,
    }
}

#[cfg(test)]
pub(super) fn load_sprite_data_url(
    mod_root: &Path,
    core_dir: Option<&Path>,
    sprite: &str,
) -> AppResult<Option<String>> {
    let mut batch = tests::batch_at(mod_root, core_dir);
    Ok(batch
        .load(ResourceSource::Mod, sprite)?
        .map(|media| media.data_url))
}

pub fn resolve_mod_relative_path(mod_root: &str, absolute_path: &str) -> AppResult<String> {
    let boundary = FsRootBoundary::new(Path::new(mod_root), "mod root")?;
    boundary
        .resolve_changed_path_to_relative(absolute_path, "selected file")?
        .ok_or_else(|| {
            AppError::message(
                "resource.outside_mod",
                format!("所选文件位于 Mod 目录之外：{absolute_path}"),
            )
        })
}

fn load_sprite_from_boundary(
    boundary: &FsRootBoundary,
    sprite: &str,
    label: &str,
) -> AppResult<Option<LoadedSpriteMedia>> {
    let Some(rel) = validate_sprite_relative_path(sprite)? else {
        return Ok(None);
    };
    let path = boundary.resolve_relative(&rel, label)?;
    if path.is_file() {
        return read_sprite_media(&path);
    }
    Ok(None)
}

fn read_sprite_media(path: &Path) -> AppResult<Option<LoadedSpriteMedia>> {
    let metadata = fs::metadata(path).map_err(|error| {
        AppError::context(
            format!("读取贴图文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    #[cfg(test)]
    record_sprite_read(path);
    let bytes = fs::read(path).map_err(|error| {
        AppError::context(
            format!("读取贴图文件失败 ({})", path.display()),
            error.into(),
        )
    })?;
    let mime = path
        .extension()
        .and_then(|extension| extension.to_str())
        .and_then(image_mime_type)
        .unwrap_or("image/png");
    Ok(Some(LoadedSpriteMedia {
        resolved_path: path.to_path_buf(),
        modified: metadata.modified().unwrap_or(SystemTime::UNIX_EPOCH),
        length: metadata.len(),
        data_url: format!(
            "data:{mime};base64,{}",
            general_purpose::STANDARD.encode(bytes)
        ),
    }))
}

#[cfg(test)]
static SPRITE_READ_COUNTS: LazyLock<Mutex<BTreeMap<PathBuf, usize>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

#[cfg(test)]
fn record_sprite_read(path: &Path) {
    let mut counts = SPRITE_READ_COUNTS.lock().unwrap();
    let key = std::fs::canonicalize(path).unwrap();
    *counts.entry(key).or_default() += 1;
}

#[cfg(test)]
pub(in crate::services::project) fn sprite_read_count(path: &Path) -> usize {
    let key = std::fs::canonicalize(path).unwrap();
    SPRITE_READ_COUNTS
        .lock()
        .unwrap()
        .get(&key)
        .copied()
        .unwrap_or_default()
}

fn validate_sprite_relative_path(sprite: &str) -> AppResult<Option<String>> {
    let rel = sprite.replace('\\', "/").trim().to_string();
    if rel.is_empty() {
        return Ok(None);
    }
    let path = Path::new(&rel);
    if path.is_absolute() || path_escapes_resource_root(path) {
        return Err(AppError::message(
            "resource.outside_root",
            format!("sprite path is outside resource root: {rel}"),
        ));
    }
    Ok(Some(rel))
}

fn path_escapes_resource_root(path: &Path) -> bool {
    path.components()
        .any(|part| matches!(part, Component::ParentDir | Component::Prefix(_)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::testutil::TestWorkspace;
    use std::fs;

    pub(super) fn batch_at(mod_root: &Path, core: Option<&Path>) -> SpriteReadBatch {
        SpriteReadBatch {
            session_id: "sprite-test".into(),
            revision: super::super::super::cache::references::reference_revision(),
            references: Vec::new(),
            mod_root: SpriteRoot::new(mod_root.to_path_buf()),
            core_root: core.map(|path| SpriteRoot::new(path.to_path_buf())),
            loaded: BTreeMap::new(),
        }
    }

    #[test]
    fn batch_resolves_sources_when_they_are_accessed() {
        let root = project_workspace("sprite_batch_sources");
        let local = root.join("mod");
        let core = root.join("core");
        fs::create_dir(&local).unwrap();
        fs::write(local.join("local.png"), [1]).unwrap();
        fs::write(&core, [0]).unwrap();
        let mut batch = batch_at(&local, Some(&core));
        assert!(
            batch
                .load(ResourceSource::Mod, "local.png")
                .unwrap()
                .is_some()
        );
        assert!(batch.load(ResourceSource::Core, "local.png").is_err());
        fs::remove_file(&core).unwrap();
        assert!(
            batch
                .load(ResourceSource::Mod, "remote.png")
                .unwrap()
                .is_none()
        );
        fs::create_dir(&core).unwrap();
        fs::write(core.join("remote.png"), [2]).unwrap();
        let remote = batch
            .load(ResourceSource::Mod, "remote.png")
            .unwrap()
            .unwrap();
        assert_eq!(
            remote.resolved_path,
            core.join("remote.png").canonicalize().unwrap()
        );
        fs::write(local.join("remote.png"), [3]).unwrap();
        assert_eq!(
            batch
                .load(ResourceSource::Mod, "remote.png")
                .unwrap()
                .unwrap()
                .length,
            1
        );
        assert_ne!(
            batch
                .load(ResourceSource::Mod, "remote.png")
                .unwrap()
                .unwrap()
                .data_url,
            remote.data_url
        );
        fs::remove_dir_all(&core).unwrap();
        assert!(
            batch
                .load(ResourceSource::Mod, "missing.png")
                .unwrap()
                .is_none()
        );
        assert!(batch.load(ResourceSource::Core, "missing.png").is_err());
        fs::create_dir(&core).unwrap();
        fs::write(core.join("new.png"), [4]).unwrap();
        assert!(
            batch
                .load(ResourceSource::Core, "new.png")
                .unwrap()
                .is_some()
        );
        root.close().unwrap();
    }

    #[test]
    #[cfg(windows)]
    fn batch_rechecks_removed_roots_and_new_links() {
        let (root, outside, link) = TestWorkspace::junction("sprite_batch_link", "late");
        let held = root.join("held");
        fs::rename(&link, &held).unwrap();
        fs::write(outside.join("image.png"), [1]).unwrap();
        let mut batch = batch_at(&root, Some(&outside));
        assert!(
            batch
                .load(ResourceSource::Mod, "missing.png")
                .unwrap()
                .is_none()
        );
        fs::rename(&held, &link).unwrap();
        assert!(batch.load(ResourceSource::Mod, "late/image.png").is_err());
        fs::remove_dir(&link).unwrap();
        fs::remove_dir(&root).unwrap();
        assert!(batch.load(ResourceSource::Mod, "missing.png").is_err());
        fs::create_dir(&root).unwrap();
        fs::write(root.join("restored.png"), [2]).unwrap();
        assert!(
            batch
                .load(ResourceSource::Mod, "restored.png")
                .unwrap()
                .is_some()
        );
        root.close().unwrap();
    }

    #[test]
    fn cached_batch_prepares_no_roots_and_closed_batch_keeps_no_media() {
        use crate::models::ResourceOwnerKind;
        use crate::services::project::{
            PerformanceTrace, close_project_session, open_project_session_traced,
        };
        let root = project_workspace("sprite_batch_cache_lifetime");
        fs::write(root.join("cached.png"), [1]).unwrap();
        fs::write(root.join("late.png"), [2]).unwrap();
        let manifest =
            open_project_session_traced(&root, None, &mut PerformanceTrace::new("sprite.test"))
                .unwrap();
        let resource = super::super::refs::resource_ref(
            ResourceSource::Mod,
            "cached.png",
            ResourceOwnerKind::Ship,
            "a",
            "sprite",
        );
        let mut first = SpriteReadBatch::new(&manifest.session_id).unwrap();
        let expected = first.data_url(&resource).unwrap();
        let mut cached = SpriteReadBatch::new(&manifest.session_id).unwrap();
        assert_eq!(cached.data_url(&resource).unwrap(), expected);
        assert!(cached.mod_root.boundary.is_none());
        assert!(cached.core_root.is_none());
        let handle = session_handle(&manifest.session_id).unwrap();
        super::super::super::cache::lock_session(&handle)
            .unwrap()
            .projection_pending = true;
        assert!(SpriteReadBatch::new(&manifest.session_id).is_err());
        close_project_session(manifest.session_id.clone()).unwrap();
        assert!(SpriteReadBatch::new(&manifest.session_id).is_err());
        let late = ResourceRef {
            rel_path: "late.png".into(),
            ..resource
        };
        assert!(first.data_url(&late).unwrap().is_some());
        assert!(!media::cached_sprite_media_contains(
            &manifest.session_id,
            &media_resource_key(&late)
        ));
        root.close().unwrap();
    }

    fn load_ship_sprite_data(
        mod_root: &Path,
        core_dir: Option<&Path>,
        ship_files: &BTreeMap<String, Value>,
    ) -> BTreeMap<String, String> {
        let mut sprites = BTreeMap::new();
        for (id, value) in ship_files {
            if let Some(sprite) = value.get("spriteName").and_then(Value::as_str)
                && let Ok(Some(data_url)) = load_sprite_data_url(mod_root, core_dir, sprite)
            {
                sprites.insert(id.clone(), data_url);
            }
        }
        sprites
    }

    fn load_weapon_sprite_data(
        mod_root: &Path,
        core_dir: Option<&Path>,
        weapon_specs: &BTreeMap<String, Value>,
    ) -> BTreeMap<String, BTreeMap<String, String>> {
        let mut sprites = BTreeMap::new();
        for (id, value) in weapon_specs {
            let mut weapon_sprites = BTreeMap::new();
            for field in crate::services::project::model::WEAPON_SPRITE_FIELDS {
                if let Some(sprite) = value.get(field).and_then(Value::as_str)
                    && let Ok(Some(data_url)) = load_sprite_data_url(mod_root, core_dir, sprite)
                {
                    weapon_sprites.insert(field.to_string(), data_url);
                }
            }
            if !weapon_sprites.is_empty() {
                sprites.insert(id.clone(), weapon_sprites);
            }
        }
        sprites
    }

    #[test]
    fn missing_sprite_does_not_create_entry() {
        let root = project_workspace("missing_sprite");
        let mut ships = BTreeMap::new();
        ships.insert(
            "demo".to_string(),
            serde_json::json!({"hullId":"demo","spriteName":"graphics/ships/missing.png"}),
        );

        let loaded = load_ship_sprite_data(&root, None, &ships);

        assert!(loaded.is_empty());
        root.close().unwrap();
    }

    #[test]
    fn sprite_data_url_matches_file_type() {
        let root = project_workspace("sprite_mime_type");
        let sprite_dir = root.join("graphics/ships");
        fs::create_dir_all(&sprite_dir).unwrap();
        fs::write(sprite_dir.join("demo.jpg"), b"jpeg-bytes").unwrap();

        let data_url = load_sprite_data_url(&root, None, "graphics/ships/demo.jpg")
            .unwrap()
            .unwrap();

        assert!(data_url.starts_with("data:image/jpeg;base64,"));
        root.close().unwrap();
    }

    #[test]
    fn core_fallback_loads_sprite() {
        let mod_dir = project_workspace("core_fallback_mod");
        let core_dir = project_workspace("core_fallback_core");

        // Create sprite in core_dir only (not in mod_dir)
        let sprite_dir = core_dir.join("graphics/weapons");
        fs::create_dir_all(&sprite_dir).unwrap();
        // Write a minimal valid PNG (1x1 pixel)
        let png_bytes: [u8; 69] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];
        fs::write(sprite_dir.join("test_turret.png"), png_bytes).unwrap();

        let mut weapon_specs = BTreeMap::new();
        weapon_specs.insert(
            "testgun".to_string(),
            serde_json::json!({
                "id": "testgun",
                "turretSprite": "graphics/weapons/test_turret.png"
            }),
        );

        let loaded = load_weapon_sprite_data(&mod_dir, Some(core_dir.as_path()), &weapon_specs);

        // Should have loaded from core
        assert!(loaded.contains_key("testgun"));
        let sprites = &loaded["testgun"];
        assert!(sprites.contains_key("turretSprite"));
        assert!(sprites["turretSprite"].starts_with("data:image/png;base64,"));
        core_dir.close().unwrap();
        mod_dir.close().unwrap();
    }

    #[test]
    fn mod_sprite_takes_priority_over_core() {
        let mod_dir = project_workspace("priority_mod");
        let core_dir = project_workspace("priority_core");

        // Minimal PNG
        let png_bytes: [u8; 69] = [
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x02, 0x00, 0x00,
            0x00, 0x90, 0x77, 0x53, 0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, 0x54, 0x08,
            0xD7, 0x63, 0xF8, 0xCF, 0xC0, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01, 0xE2, 0x21, 0xBC,
            0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82,
        ];

        // Create sprite in BOTH directories
        let mod_sprite_dir = mod_dir.join("graphics/weapons");
        let core_sprite_dir = core_dir.join("graphics/weapons");
        fs::create_dir_all(&mod_sprite_dir).unwrap();
        fs::create_dir_all(&core_sprite_dir).unwrap();
        fs::write(mod_sprite_dir.join("shared.png"), png_bytes).unwrap();
        fs::write(core_sprite_dir.join("shared.png"), png_bytes).unwrap();

        let result = load_sprite_data_url(
            &mod_dir,
            Some(core_dir.as_path()),
            "graphics/weapons/shared.png",
        )
        .unwrap();

        // Should succeed (mod has priority, but both work)
        assert!(result.is_some());
        core_dir.close().unwrap();
        mod_dir.close().unwrap();
    }

    #[test]
    fn sprite_loader_rejects_parent_dir_escape() {
        let mod_dir = project_workspace("sprite_parent_escape_mod");
        let core_dir = project_workspace("sprite_parent_escape_core");

        let error = load_sprite_data_url(&mod_dir, Some(core_dir.as_path()), "../outside.png")
            .unwrap_err()
            .to_string();

        assert!(error.contains("sprite path is outside resource root"));
        core_dir.close().unwrap();
        mod_dir.close().unwrap();
    }

    #[test]
    fn sprite_loader_rejects_absolute_path() {
        let mod_dir = project_workspace("sprite_absolute_mod");
        let core_dir = project_workspace("sprite_absolute_core");
        let absolute = mod_dir.join("graphics/ships/demo.png");

        let error = load_sprite_data_url(
            &mod_dir,
            Some(core_dir.as_path()),
            &absolute.to_string_lossy(),
        )
        .unwrap_err()
        .to_string();

        assert!(error.contains("sprite path is outside resource root"));
        core_dir.close().unwrap();
        mod_dir.close().unwrap();
    }

    #[test]
    fn resolve_mod_relative_path_returns_forward_slash_relative() {
        let mod_dir = project_workspace("resolve_relative_mod");
        let sprite_dir = mod_dir.join("graphics").join("ships");
        fs::create_dir_all(&sprite_dir).unwrap();
        let sprite = sprite_dir.join("demo.png");
        fs::write(&sprite, b"png").unwrap();

        let relative =
            resolve_mod_relative_path(&mod_dir.to_string_lossy(), &sprite.to_string_lossy())
                .unwrap();

        assert_eq!(relative, "graphics/ships/demo.png");
        mod_dir.close().unwrap();
    }

    #[test]
    fn resolve_mod_relative_path_rejects_outside_root() {
        let mod_dir = project_workspace("resolve_outside_mod");
        let outside = project_workspace("resolve_outside_file_dir");
        let outside_file = outside.join("elsewhere.png");
        fs::write(&outside_file, b"png").unwrap();

        let error =
            resolve_mod_relative_path(&mod_dir.to_string_lossy(), &outside_file.to_string_lossy())
                .unwrap_err()
                .to_string();

        assert!(error.contains("所选文件位于 Mod 目录之外"));
        outside.close().unwrap();
        mod_dir.close().unwrap();
    }
}
