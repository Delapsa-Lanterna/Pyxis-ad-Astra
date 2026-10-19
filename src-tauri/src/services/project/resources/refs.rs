use super::super::cache::{loaded_csv_rows, loaded_registered_csv_rows};
use super::super::cache::{lock_ready_session, lock_registry, media, session_handle};
use super::super::model::{ProjectSession, string_field, string_from_row};
use super::sprites;
use crate::errors::{AppError, AppResult};
use crate::models::{CsvTableKey, ResourceOwnerKind, ResourceRef, ResourceSource, SkinFile};
use crate::services::project::model::LoadedSpecRecord;
use crate::services::project::sources::core::{
    load_core_csv_table, load_core_ship_files, load_core_skin_files,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::Arc;

/// The session-owned inputs to sprite loading, cloned out of the session under
/// a short lock so batch loading never holds the session (or registry) lock.
pub(in crate::services::project) struct SpriteSourceContext {
    session_id: String,
    mod_root: String,
    starsector_root: Option<String>,
}

pub(in crate::services::project) fn sprite_source_context(
    session_id: &str,
) -> AppResult<SpriteSourceContext> {
    let handle = session_handle(session_id)?;
    let session = lock_ready_session(&handle)?;
    Ok(SpriteSourceContext {
        session_id: session_id.to_string(),
        mod_root: session.manifest.mod_root.clone(),
        starsector_root: session.manifest.starsector_root.clone(),
    })
}

pub(in crate::services::project) struct SpriteResourceBytes {
    pub(in crate::services::project) data_url: Option<String>,
}

pub(in crate::services::project) fn sprite_resource_bytes(
    context: &SpriteSourceContext,
    resource: &ResourceRef,
) -> AppResult<SpriteResourceBytes> {
    let resource_key = media_resource_key(resource);
    if let Some(data_url) = media::lookup_data_url(&context.session_id, &resource_key) {
        return Ok(SpriteResourceBytes {
            data_url: Some(data_url),
        });
    }
    let rel_path = resource.rel_path.replace('\\', "/");
    let rel_path = rel_path.trim().trim_end_matches('/');
    let loaded = match resource.source {
        ResourceSource::Core => {
            let root = context
                .starsector_root
                .as_ref()
                .map(|root| PathBuf::from(root).join("starsector-core"))
                .ok_or_else(|| {
                    AppError::message(
                        "resource.core_root_required",
                        "core resource requires starsector root",
                    )
                })?;
            sprites::load_sprite_bytes_from_root(&root, rel_path)?
        }
        ResourceSource::Mod => {
            let mod_root = PathBuf::from(&context.mod_root);
            let core_dir = context
                .starsector_root
                .as_ref()
                .map(|root| PathBuf::from(root).join("starsector-core"));
            sprites::load_sprite_bytes(&mod_root, core_dir.as_deref(), rel_path)?
        }
    };
    let data_url = loaded.as_ref().map(|bytes| bytes.data_url.clone());
    if let Some(bytes) = loaded {
        let registry = lock_registry()?;
        if registry.contains_key(&context.session_id) {
            media::insert_entry(
                &context.session_id,
                &resource_key,
                bytes.resolved_path,
                bytes.modified,
                bytes.length,
                bytes.data_url,
            );
        }
    }
    Ok(SpriteResourceBytes { data_url })
}

pub(in crate::services::project) fn media_resource_key(resource: &ResourceRef) -> String {
    json!([
        resource.source.as_str(),
        normalized_media_rel_path(&resource.rel_path),
    ])
    .to_string()
}

fn normalized_media_rel_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim()
        .trim_end_matches('/')
        .to_lowercase()
}

pub(in crate::services::project) struct HullReferenceResolver<'a> {
    session: &'a ProjectSession,
    core_ships: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
    core_skins: Option<Arc<Vec<SkinFile>>>,
    core_names: Option<BTreeMap<String, String>>,
}

impl<'a> HullReferenceResolver<'a> {
    pub fn new(session: &'a ProjectSession) -> Self {
        Self {
            session,
            core_ships: None,
            core_skins: None,
            core_names: None,
        }
    }

    pub fn field(
        &mut self,
        source: ResourceSource,
        id: &str,
        field: &str,
    ) -> AppResult<Option<(String, ResourceSource, ResourceOwnerKind)>> {
        let mut current = id.to_string();
        let mut seen = BTreeSet::new();
        let mut owner = ResourceOwnerKind::Ship;
        loop {
            if !seen.insert(current.clone()) {
                return Err(AppError::message(
                    "skin.base_cycle",
                    format!("循环舰体皮肤引用: {id}"),
                ));
            }
            if field == "hullName"
                && source == ResourceSource::Mod
                && let Some(name) = loaded_registered_csv_rows(self.session, CsvTableKey::Ships)?
                    .iter()
                    .filter(|row| !row.is_comment)
                    .find(|row| {
                        row.data.get("id").and_then(serde_json::Value::as_str)
                            == Some(current.as_str())
                    })
                    .and_then(|row| string_from_row(&row.data, "name"))
            {
                return Ok(Some((name, ResourceSource::Mod, owner)));
            }
            let local = if source == ResourceSource::Mod {
                self.session
                    .skin_files
                    .iter()
                    .find(|skin| skin.skin_hull_id == current)
                    .map(|skin| &skin.data)
                    .or_else(|| self.session.ship_files.get(&current).map(|ship| &ship.data))
            } else {
                None
            };
            let (data, origin) = if let Some(data) = local {
                (data, ResourceSource::Mod)
            } else {
                let Some(root) = &self.session.manifest.starsector_root else {
                    return Ok(None);
                };
                if self.core_ships.is_none() {
                    self.core_ships = Some(load_core_ship_files(root)?);
                }
                if field == "hullName" {
                    if self.core_names.is_none() {
                        let table = load_core_csv_table(root, CsvTableKey::Ships)?;
                        self.core_names = Some(
                            table
                                .as_ref()
                                .map(|table| loaded_csv_rows(table, "ships"))
                                .transpose()?
                                .unwrap_or_default()
                                .iter()
                                .filter(|row| !row.is_comment)
                                .filter_map(|row| {
                                    Some((
                                        string_from_row(&row.data, "id")?,
                                        string_from_row(&row.data, "name")?,
                                    ))
                                })
                                .collect(),
                        );
                    }
                    if let Some(name) = self
                        .core_names
                        .as_ref()
                        .expect("Core names are prepared")
                        .get(&current)
                    {
                        return Ok(Some((name.clone(), ResourceSource::Core, owner)));
                    }
                }
                let ship = self
                    .core_ships
                    .as_ref()
                    .expect("Core ships are prepared")
                    .get(&current);
                let data = if let Some(ship) = ship {
                    Some(&ship.data)
                } else {
                    if self.core_skins.is_none() {
                        self.core_skins = Some(load_core_skin_files(root)?);
                    }
                    self.core_skins
                        .as_ref()
                        .expect("Core skins are prepared")
                        .iter()
                        .find(|skin| skin.skin_hull_id == current)
                        .map(|skin| &skin.data)
                };
                let Some(data) = data else { return Ok(None) };
                (data, ResourceSource::Core)
            };
            if seen.len() == 1 && data.get("baseHullId").is_some() {
                owner = ResourceOwnerKind::Skin;
            }
            if let Some(value) = string_field(data, field) {
                return Ok(Some((value, origin, owner)));
            }
            let Some(base) = string_field(data, "baseHullId") else {
                return Ok(None);
            };
            current = base;
        }
    }

    pub fn resource(&mut self, source: ResourceSource, id: &str) -> AppResult<Option<ResourceRef>> {
        Ok(self
            .field(source, id, "spriteName")?
            .map(|(path, origin, owner)| resource_ref(origin, &path, owner, id, "thumbnail")))
    }
}

pub(in crate::services::project) fn resource_ref(
    source: ResourceSource,
    rel_path: &str,
    owner_kind: ResourceOwnerKind,
    owner_id: &str,
    key: &str,
) -> ResourceRef {
    ResourceRef {
        source,
        rel_path: rel_path.replace('\\', "/"),
        owner_kind,
        owner_id: owner_id.to_string(),
        key: key.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::definitions::table_definitions;
    use serde_json::{Map, Value};

    #[test]
    fn media_resource_key_uses_source_and_path_only() {
        let ship = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Ship,
            "ship",
            "icon",
        );
        let weapon = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Weapon,
            "weapon",
            "icon",
        );

        assert_eq!(media_resource_key(&ship), media_resource_key(&weapon));

        let core = resource_ref(
            ResourceSource::Core,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Weapon,
            "weapon",
            "icon",
        );
        assert_ne!(media_resource_key(&ship), media_resource_key(&core));
    }

    #[test]
    fn media_resource_key_normalizes_path() {
        let left = resource_ref(
            ResourceSource::Mod,
            " graphics\\shared\\ICON.png/ ",
            ResourceOwnerKind::Ship,
            "left",
            "icon",
        );
        let right = resource_ref(
            ResourceSource::Mod,
            "graphics/shared/icon.png",
            ResourceOwnerKind::Ship,
            "right",
            "thumbnail",
        );

        assert_eq!(media_resource_key(&left), media_resource_key(&right));
    }

    #[test]
    fn row_icon_resource_ref_requires_owner_id() {
        let mut row = Map::new();
        row.insert(
            "icon".to_string(),
            Value::String("graphics/icons/skill.png".to_string()),
        );

        let resource = table_definitions::csv_table_icon_resource_ref(
            ResourceSource::Mod,
            crate::models::CsvTableKey::Skills,
            &row,
        );

        assert!(resource.is_none());
    }
}
