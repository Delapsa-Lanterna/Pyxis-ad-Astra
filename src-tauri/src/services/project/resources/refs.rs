use super::super::cache::{loaded_csv_rows, loaded_registered_csv_rows};
use super::super::model::{ProjectSession, string_field, string_from_row};
use crate::errors::{AppError, AppResult};
use crate::models::{CsvTableKey, ResourceOwnerKind, ResourceRef, ResourceSource, SkinFile};
use crate::services::project::model::LoadedSpecRecord;
use crate::services::project::sources::core::{
    load_core_csv_table, load_core_ship_files, load_core_skin_files,
};
use serde_json::json;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

pub(in crate::services::project) fn media_resource_key(resource: &ResourceRef) -> String {
    json!([
        resource.source.as_str(),
        normalized_media_rel_path(&resource.rel_path),
        resource.reference,
        super::super::cache::references::reference_revision(),
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
    resolved_reference: Option<crate::models::ReferenceSource>,
}

impl<'a> HullReferenceResolver<'a> {
    pub fn new(session: &'a ProjectSession) -> Self {
        Self {
            session,
            core_ships: None,
            core_skins: None,
            core_names: None,
            resolved_reference: None,
        }
    }

    pub fn field(
        &mut self,
        source: ResourceSource,
        id: &str,
        field: &str,
    ) -> AppResult<Option<(String, ResourceSource, ResourceOwnerKind)>> {
        let mut current = id.to_string();
        self.resolved_reference = None;
        let mut seen = BTreeSet::new();
        let mut owner = ResourceOwnerKind::Ship;
        loop {
            if !seen.insert(current.clone()) {
                return Err(AppError::message(
                    "skin.base_cycle",
                    format!("循环船体皮肤引用: {id}"),
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
            let external = if source != ResourceSource::Core {
                self.session.references.iter().find_map(|view| {
                    view.spec(crate::models::EntityKind::Skin, &current)
                        .or_else(|| view.spec(crate::models::EntityKind::Ship, &current))
                        .map(|record| (view, record))
                })
            } else {
                None
            };
            let (data, origin) = if let Some(data) = local {
                (data, ResourceSource::Mod)
            } else if let Some((view, record)) = &external {
                self.resolved_reference = Some(view.identity.clone());
                if field == "hullName"
                    && let Some(name) = view
                        .table(CsvTableKey::Ships)?
                        .iter()
                        .find(|row| {
                            row.data.get("id").and_then(serde_json::Value::as_str) == Some(&current)
                        })
                        .and_then(|row| string_from_row(&row.data, "name"))
                {
                    return Ok(Some((name, ResourceSource::Reference, owner)));
                }
                (&record.data, ResourceSource::Reference)
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
        let value = self.field(source, id, "spriteName")?;
        Ok(value.map(|(path, origin, owner)| {
            let mut resource = resource_ref(origin, &path, owner, id, "thumbnail");
            if origin == ResourceSource::Reference {
                resource.reference = self.resolved_reference.clone();
            }
            resource
        }))
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
        reference: None,
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
