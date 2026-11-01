use super::super::model::{ProjectSession, SessionCsvRow, string_field, string_from_row};
use super::super::resources::{HullReferenceResolver, resource_ref};
use super::super::session::csv_tables::{ensure_registered_table_rows, loaded_registered_csv_rows};
use super::super::session::{lock_ready_session, session_handle};
use crate::errors::{AppError, AppResult};
use crate::models::{
    CsvTableKey, HullReferenceGroup, HullReferenceKind, HullReferenceOption, HullReferencesResult,
    HullWeaponSlot, ReferenceSource, ResourceOwnerKind, ResourceRef, ResourceSource,
};
use crate::services::project::model;
use crate::services::project::sources::core::{
    load_core_csv_table, load_core_ship_files, load_core_skin_files,
};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::ptr;

pub fn query_hull_references(
    session_id: &str,
    reference_ids: &[String],
) -> AppResult<HullReferencesResult> {
    let handle = session_handle(session_id)?;
    let mut session = lock_ready_session(&handle)?;
    build_hull_references(&mut session, reference_ids)
}

pub(super) fn build_hull_references(
    session: &mut ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<HullReferencesResult> {
    if !requested_reference_ids.is_empty() {
        let mut result = HullReferencesResult {
            groups: Vec::new(),
            hull_names: resolve_requested_hull_names(session, requested_reference_ids)?,
            sprites: resolve_requested_hull_sprites(session, requested_reference_ids)?,
            built_in_weapon_slots: BTreeMap::new(),
            weapon_slots: BTreeMap::new(),
            module_slots: BTreeMap::new(),
        };
        resolve_weapon_slots(session, requested_reference_ids, &mut result)?;
        return Ok(result);
    }

    ensure_registered_table_rows(session, CsvTableKey::Ships)?;
    let mut sources = vec![(
        ResourceSource::Mod,
        None,
        session.ship_files.clone(),
        session.skin_files.clone(),
        all_ship_names_from_rows(loaded_registered_csv_rows(session, CsvTableKey::Ships)?),
    )];
    for view in &session.references {
        sources.push((
            ResourceSource::Reference,
            Some(view.identity.clone()),
            view.session.ship_files.clone(),
            view.session.skin_files.clone(),
            all_ship_names_from_rows(&view.table(CsvTableKey::Ships)?),
        ));
    }
    if let Some(root) = session.manifest.starsector_root.as_ref() {
        let names = load_core_csv_table(root, model::csv_table_spec(CsvTableKey::Ships).rel_path)?
            .as_ref()
            .map(|table| {
                all_ship_names_from_data(
                    table
                        .rows
                        .iter()
                        .filter(|row| !row.is_comment)
                        .map(|row| &row.data),
                )
            })
            .unwrap_or_default();
        sources.push((
            ResourceSource::Core,
            None,
            load_core_ship_files(root)?,
            load_core_skin_files(root)?,
            names,
        ));
    }
    let mut resolver = HullReferenceResolver::new(session);
    let mut groups = Vec::new();
    let mut seen = BTreeSet::new();
    for (origin, reference, ships, skins, names) in sources {
        let ships = ships
            .iter()
            .filter(|(id, _)| seen.insert((*id).clone()))
            .map(|(id, ship)| {
                let resource_ref = string_field(&ship.data, "spriteName").map(|sprite| {
                    let mut resource =
                        resource_ref(origin, &sprite, ResourceOwnerKind::Ship, id, "thumbnail");
                    resource.reference = reference.clone();
                    resource
                });
                HullReferenceOption {
                    label: hull_reference_label(
                        id,
                        names
                            .get(id)
                            .cloned()
                            .or_else(|| string_field(&ship.data, "hullName")),
                    ),
                    value: id.clone(),
                    origin,
                    kind: HullReferenceKind::Ship,
                    resource_ref,
                }
            })
            .collect();
        push_non_empty_group(
            &mut groups,
            origin,
            reference.clone(),
            HullReferenceKind::Ship,
            ships,
        );
        let lookup = if origin == ResourceSource::Core {
            origin
        } else {
            ResourceSource::Mod
        };
        let skins = skins
            .iter()
            .filter(|skin| seen.insert(skin.skin_hull_id.clone()))
            .map(|skin| {
                let name = resolver
                    .field(lookup, &skin.skin_hull_id, "hullName")?
                    .map(|(name, _, _)| name);
                Ok(HullReferenceOption {
                    label: hull_reference_label(&skin.skin_hull_id, name),
                    value: skin.skin_hull_id.clone(),
                    origin,
                    kind: HullReferenceKind::Skin,
                    resource_ref: resolver.resource(lookup, &skin.skin_hull_id)?,
                })
            })
            .collect::<AppResult<_>>()?;
        push_non_empty_group(
            &mut groups,
            origin,
            reference,
            HullReferenceKind::Skin,
            skins,
        );
    }

    Ok(HullReferencesResult {
        groups,
        hull_names: BTreeMap::new(),
        sprites: BTreeMap::new(),
        built_in_weapon_slots: BTreeMap::new(),
        weapon_slots: BTreeMap::new(),
        module_slots: BTreeMap::new(),
    })
}

fn resolve_weapon_slots(
    session: &ProjectSession,
    reference_ids: &[String],
    result: &mut HullReferencesResult,
) -> AppResult<()> {
    let core_ships = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| load_core_ship_files(root))
        .transpose()?;
    let core_skins = session
        .manifest
        .starsector_root
        .as_ref()
        .map(|root| load_core_skin_files(root))
        .transpose()?;
    for id in reference_ids {
        let mut chain = Vec::new();
        let mut current = id.as_str();
        let mut seen = BTreeSet::new();
        while let Some(skin) = session
            .skin_files
            .iter()
            .find(|skin| skin.skin_hull_id == current)
            .or_else(|| {
                session
                    .references
                    .iter()
                    .flat_map(|view| view.session.skin_files.iter())
                    .find(|skin| skin.skin_hull_id == current)
            })
            .or_else(|| {
                core_skins
                    .as_ref()
                    .and_then(|skins| skins.iter().find(|skin| skin.skin_hull_id == current))
            })
        {
            if !seen.insert(current) {
                return Err(AppError::message(
                    "skin.base_cycle",
                    format!("循环船体皮肤引用: {id}"),
                ));
            }
            let origin = if session
                .skin_files
                .iter()
                .any(|candidate| ptr::eq(candidate, skin))
            {
                ResourceSource::Mod
            } else if session
                .references
                .iter()
                .flat_map(|view| view.session.skin_files.iter())
                .any(|candidate| ptr::eq(candidate, skin))
            {
                ResourceSource::Reference
            } else {
                ResourceSource::Core
            };
            chain.push((&skin.data, origin));
            current = &skin.base_hull_id;
        }
        let base_origin = if session.ship_files.contains_key(current) {
            ResourceSource::Mod
        } else if session
            .references
            .iter()
            .any(|view| view.session.ship_files.contains_key(current))
        {
            ResourceSource::Reference
        } else {
            ResourceSource::Core
        };
        let ship = session
            .ship_files
            .get(current)
            .or_else(|| {
                session
                    .references
                    .iter()
                    .find_map(|view| view.session.ship_files.get(current))
            })
            .or_else(|| core_ships.as_ref().and_then(|ships| ships.get(current)));
        let mut weapons: Vec<(Value, ResourceSource)> = ship
            .and_then(|ship| ship.data.get("weaponSlots"))
            .and_then(Value::as_array)
            .map(|slots| {
                slots
                    .iter()
                    .map(|slot| (slot.clone(), base_origin))
                    .collect()
            })
            .unwrap_or_default();
        let mut slots: BTreeMap<String, ResourceSource> = ship
            .and_then(|ship| ship.data.get("builtInWeapons"))
            .and_then(Value::as_object)
            .map(|weapons| {
                weapons
                    .keys()
                    .map(|key| (key.clone(), base_origin))
                    .collect()
            })
            .unwrap_or_default();
        for (skin, origin) in chain.into_iter().rev() {
            if let Some(removed) = skin.get("removeWeaponSlots").and_then(Value::as_array) {
                weapons.retain(|(slot, _)| !removed.contains(&slot["id"]));
                for id in removed.iter().filter_map(Value::as_str) {
                    slots.remove(id);
                }
            }
            if let Some(changes) = skin.get("weaponSlotChanges").and_then(Value::as_object) {
                for (slot, source) in &mut weapons {
                    if let Some(change) = slot["id"]
                        .as_str()
                        .and_then(|id| changes.get(id))
                        .and_then(Value::as_object)
                    {
                        slot.as_object_mut()
                            .expect("weapon slot object")
                            .extend(change.clone());
                        *source = origin;
                    }
                }
            }
            if let Some(removed) = skin.get("removeBuiltInWeapons").and_then(Value::as_array) {
                for slot in removed.iter().filter_map(Value::as_str) {
                    slots.remove(slot);
                }
            }
            if let Some(added) = skin.get("builtInWeapons").and_then(Value::as_object) {
                slots.extend(added.keys().map(|key| (key.clone(), origin)));
            }
        }
        let weapons: Vec<_> = weapons
            .into_iter()
            .filter_map(|(slot, origin)| {
                let id = slot["id"].as_str()?.to_owned();
                Some(HullWeaponSlot {
                    id,
                    origin,
                    size: string_field(&slot, "size"),
                    r#type: string_field(&slot, "type"),
                    mount: string_field(&slot, "mount"),
                })
            })
            .collect();
        result.module_slots.insert(
            id.clone(),
            weapons
                .iter()
                .filter(|slot| slot.r#type.as_deref() == Some("STATION_MODULE"))
                .cloned()
                .collect(),
        );
        result.weapon_slots.insert(
            id.clone(),
            weapons
                .iter()
                .filter(|slot| {
                    matches!(
                        slot.r#type.as_deref(),
                        Some(
                            "BALLISTIC"
                                | "ENERGY"
                                | "MISSILE"
                                | "HYBRID"
                                | "SYNERGY"
                                | "COMPOSITE"
                                | "UNIVERSAL"
                        )
                    ) && !slots.contains_key(&slot.id)
                })
                .cloned()
                .collect(),
        );
        let slot_by_id: BTreeMap<_, _> = weapons.iter().map(|slot| (&slot.id, slot)).collect();
        result.built_in_weapon_slots.insert(
            id.clone(),
            slots
                .into_iter()
                .map(|(id, origin)| HullWeaponSlot {
                    size: slot_by_id.get(&id).and_then(|slot| slot.size.clone()),
                    r#type: slot_by_id.get(&id).and_then(|slot| slot.r#type.clone()),
                    mount: slot_by_id.get(&id).and_then(|slot| slot.mount.clone()),
                    id,
                    origin,
                })
                .collect(),
        );
    }
    Ok(())
}

fn resolve_requested_hull_names(
    session: &mut ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<BTreeMap<String, String>> {
    ensure_registered_table_rows(session, CsvTableKey::Ships)?;
    let mut resolver = HullReferenceResolver::new(session);
    let mut names = BTreeMap::new();
    for id in requested_reference_ids {
        if let Some((name, _, _)) = resolver.field(ResourceSource::Mod, id, "hullName")? {
            names.insert(id.clone(), name);
        }
    }
    Ok(names)
}

fn all_ship_names_from_rows(rows: &[SessionCsvRow]) -> BTreeMap<String, String> {
    all_ship_names_from_data(
        rows.iter()
            .filter(|row| !row.is_comment)
            .map(|row| &row.data),
    )
}

fn all_ship_names_from_data<'a>(
    rows: impl Iterator<Item = &'a Map<String, Value>>,
) -> BTreeMap<String, String> {
    rows.filter_map(|row| Some((string_from_row(row, "id")?, string_from_row(row, "name")?)))
        .collect()
}

fn resolve_requested_hull_sprites(
    session: &ProjectSession,
    requested_reference_ids: &[String],
) -> AppResult<BTreeMap<String, ResourceRef>> {
    let mut resolver = HullReferenceResolver::new(session);
    let mut sprites = BTreeMap::new();
    for id in requested_reference_ids {
        if let Some(resource) = resolver.resource(ResourceSource::Mod, id)? {
            sprites.insert(id.clone(), resource);
        }
    }
    Ok(sprites)
}

/// Group identity is structured (origin + kind); the frontend composes its
/// own display label, so no chrome strings live here.
fn push_non_empty_group(
    groups: &mut Vec<HullReferenceGroup>,
    origin: ResourceSource,
    reference: Option<ReferenceSource>,
    kind: HullReferenceKind,
    options: Vec<HullReferenceOption>,
) {
    if options.is_empty() {
        return;
    }
    groups.push(HullReferenceGroup {
        reference,
        origin,
        kind,
        options,
    });
}

fn hull_reference_label(hull_id: &str, name: Option<String>) -> String {
    let name = name.unwrap_or_default();
    if name.trim().is_empty() || name == hull_id {
        hull_id.to_string()
    } else {
        format!("{name} ({hull_id})")
    }
}

#[cfg(test)]
mod tests {
    use super::super::super::session::{close_project_session, open_project_session_traced};
    use super::*;
    use crate::io::write_utf8_no_bom;
    #[cfg(test)]
    use crate::models::{CsvSearchField, EntityKind};
    #[cfg(test)]
    use crate::services::project::performance::PerformanceTrace;
    #[cfg(test)]
    use crate::services::project::query::{csv_window, entities, source_options};
    use crate::services::project::test_support::project_workspace;
    #[cfg(test)]
    use std::fs;

    #[test]
    fn hull_reference_query_returns_mod_and_core_ship_and_skin_refs() {
        let root = project_workspace("hull_reference_query");
        let mod_root = root.join("mods/demo");
        fs::create_dir_all(mod_root.join("data/hulls/skins")).unwrap();
        fs::create_dir_all(root.join("starsector-core/data/hulls/skins")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_ship.ship"),
            r#"{"hullId":"mod_ship","hullName":"Mod Ship","spriteName":"graphics/ships/mod_ship.png","builtInWeapons":{"WS001":"weapon_a","WS002":"weapon_a"},"weaponSlots":[{"id":"WS001","type":"BALLISTIC","size":"SMALL","mount":"HIDDEN"},{"id":"A","type":"ENERGY","size":"MEDIUM","mount":"TURRET"},{"id":"B","type":"UNIVERSAL"},{"id":"C","type":"MISSILE"},{"id":"D","type":"DECORATIVE"},{"id":"E","type":"BUILT_IN"},{"id":"F","type":"LAUNCH_BAY"},{"id":"G","type":"STATION_MODULE"},{"id":"H","type":"SYSTEM"}]}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/mod_fallback.ship"),
            r#"{"hullId":"mod_fallback","hullName":"Mod Fallback","spriteName":"graphics/ships/mod_fallback.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/skins/mod_skin.skin"),
            r#"{"skinHullId":"mod_skin","baseHullId":"mod_ship","removeBuiltInWeapons":["WS001"],"builtInWeapons":{"WS003":"weapon_b"},"removeWeaponSlots":["B"],"weaponSlotChanges":{"A":{"type":"STATION_MODULE","size":"LARGE","mount":"HARDPOINT"}}}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_ship.ship"),
            r#"{"hullId":"core_ship","hullName":"Core Ship","spriteName":"graphics/ships/core_ship.png","builtInWeapons":{"CORE_SLOT":"core_weapon"},"weaponSlots":[{"id":"CORE_EDITABLE","type":"BALLISTIC","size":"SMALL"}]}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/core_fallback.ship"),
            r#"{"hullId":"core_fallback","hullName":"Core Fallback","spriteName":"graphics/ships/core_fallback.png"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/ship_data.csv"),
            "id,name,tags\r\nmod_ship,Mod CSV Ship,\r\nmod_fallback,,\r\nmod_skin,Mod CSV Skin,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/ship_data.csv"),
            "id,name,tags\r\ncore_ship,Core CSV Ship,\r\ncore_fallback,,\r\ncore_skin,Core CSV Skin,\r\n",
        )
        .unwrap();
        write_utf8_no_bom(
            &root.join("starsector-core/data/hulls/skins/core_skin.skin"),
            r#"{"skinHullId":"core_skin","baseHullId":"core_ship","tags":["example_tag","core_tag"]}"#,
        )
        .unwrap();

        let mut trace = PerformanceTrace::new("project.openSession");
        write_utf8_no_bom(&mod_root.join("data/hulls/skins/mod_core.skin"), r#"{"skinHullId":"mod_core","baseHullId":"core_ship","builtInWeapons":{"MOD_SLOT":"mod_weapon"}}"#).unwrap();
        write_utf8_no_bom(&mod_root.join("data/hulls/skins/mod_override.skin"), r#"{"skinHullId":"mod_override","baseHullId":"core_ship","builtInWeapons":{"CORE_SLOT":"mod_weapon"}}"#).unwrap();
        write_utf8_no_bom(&mod_root.join("data/hulls/skins/nested.skin"), r#"{"skinHullId":"nested","baseHullId":"mod_core","hullName":"Nested Hull","tags":["example_tag","example_tag"]}"#).unwrap();
        fs::create_dir_all(mod_root.join("data/variants")).unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/variants/nested.variant"),
            r#"{"variantId":"nested","hullId":"nested"}"#,
        )
        .unwrap();
        write_utf8_no_bom(
            &mod_root.join("data/hulls/wing_data.csv"),
            "id,variant\r\nexample_wing,nested\r\n",
        )
        .unwrap();
        let manifest = open_project_session_traced(&mod_root, Some(&root), &mut trace).unwrap();
        let catalog = query_hull_references(&manifest.session_id, &[]).unwrap();
        let previews = query_hull_references(
            &manifest.session_id,
            &[
                "mod_ship".to_string(),
                "mod_fallback".to_string(),
                "mod_skin".to_string(),
                "core_ship".to_string(),
                "core_fallback".to_string(),
                "core_skin".to_string(),
            ],
        )
        .unwrap();

        assert_eq!(
            previews.weapon_slots["mod_ship"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["A", "B", "C"]
        );
        assert_eq!(
            previews.weapon_slots["mod_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["WS001", "C"]
        );
        assert_eq!(
            previews.module_slots["mod_ship"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["G"]
        );
        assert_eq!(
            previews.module_slots["mod_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["A", "G"]
        );
        let metadata = [
            &previews.weapon_slots["mod_ship"][0],
            &previews.module_slots["mod_skin"][0],
            &previews.built_in_weapon_slots["mod_ship"][0],
            &previews.weapon_slots["core_skin"][0],
        ];
        assert_eq!(
            metadata.map(|slot| slot.size.as_deref().unwrap()),
            ["MEDIUM", "LARGE", "SMALL", "SMALL"]
        );
        assert_eq!(
            metadata.map(|slot| slot.r#type.as_deref().unwrap()),
            ["ENERGY", "STATION_MODULE", "BALLISTIC", "BALLISTIC"]
        );
        assert_eq!(
            metadata.map(|slot| slot.mount.as_deref()),
            [Some("TURRET"), Some("HARDPOINT"), Some("HIDDEN"), None]
        );
        let values: Vec<String> = catalog
            .groups
            .iter()
            .flat_map(|group| group.options.iter().map(|option| option.value.clone()))
            .collect();
        assert!(values.contains(&"mod_ship".to_string()));
        assert!(values.contains(&"mod_fallback".to_string()));
        assert!(values.contains(&"mod_skin".to_string()));
        assert!(values.contains(&"core_ship".to_string()));
        assert!(values.contains(&"core_fallback".to_string()));
        assert!(values.contains(&"core_skin".to_string()));
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_ship")
                .map(|option| option.label.as_str()),
            Some("Mod CSV Ship (mod_ship)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_ship")
                .map(|option| option.label.as_str()),
            Some("Core CSV Ship (core_ship)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_skin")
                .map(|option| option.label.as_str()),
            Some("Mod CSV Skin (mod_skin)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_skin")
                .map(|option| option.label.as_str()),
            Some("Core CSV Skin (core_skin)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "mod_fallback")
                .map(|option| option.label.as_str()),
            Some("Mod Fallback (mod_fallback)")
        );
        assert_eq!(
            catalog
                .groups
                .iter()
                .flat_map(|group| group.options.iter())
                .find(|option| option.value == "core_fallback")
                .map(|option| option.label.as_str()),
            Some("Core Fallback (core_fallback)")
        );
        assert!(catalog.sprites.is_empty());
        assert!(catalog.hull_names.is_empty());
        assert!(catalog.built_in_weapon_slots.is_empty());
        assert_eq!(
            previews.built_in_weapon_slots["mod_ship"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["WS001", "WS002"]
        );
        assert_eq!(
            previews.built_in_weapon_slots["mod_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["WS002", "WS003"]
        );
        assert_eq!(
            previews.built_in_weapon_slots["core_skin"]
                .iter()
                .map(|slot| slot.id.as_str())
                .collect::<Vec<_>>(),
            vec!["CORE_SLOT"]
        );
        assert!(previews.groups.is_empty());
        let inherited = query_hull_references(
            &manifest.session_id,
            &["mod_core".to_string(), "mod_override".to_string()],
        )
        .unwrap();
        assert_eq!(inherited.weapon_slots["mod_core"][0].id, "CORE_EDITABLE");
        assert_eq!(
            inherited.weapon_slots["mod_core"][0].origin,
            ResourceSource::Core
        );
        assert_eq!(
            inherited.built_in_weapon_slots["mod_core"]
                .iter()
                .map(|slot| (slot.id.as_str(), slot.origin))
                .collect::<Vec<_>>(),
            vec![
                ("CORE_SLOT", ResourceSource::Core),
                ("MOD_SLOT", ResourceSource::Mod)
            ]
        );
        assert_eq!(
            inherited.built_in_weapon_slots["mod_override"][0].origin,
            ResourceSource::Mod
        );
        let nested =
            query_hull_references(&manifest.session_id, &["nested".into(), "mod_core".into()])
                .unwrap();
        assert_eq!(nested.sprites["nested"].source, ResourceSource::Core);
        assert_eq!(
            nested.sprites["nested"].rel_path,
            "graphics/ships/core_ship.png"
        );
        let ids =
            source_options::query_csv_source_options(&manifest.session_id, "csv:ships.id").unwrap();
        assert_eq!(
            ids.iter()
                .flat_map(|group| &group.options)
                .find(|item| item.value == "nested")
                .unwrap()
                .label,
            "Nested Hull (nested)"
        );
        let tags = source_options::query_csv_source_options(&manifest.session_id, "csv:ships.tags")
            .unwrap();
        assert_eq!(
            tags.iter()
                .flat_map(|group| &group.options)
                .filter(|item| item.value == "example_tag")
                .count(),
            1
        );
        assert!(
            tags.iter()
                .flat_map(|group| &group.options)
                .any(|item| item.value == "core_tag")
        );
        let variants =
            entities::query_entity_list(&manifest.session_id, EntityKind::Variant).unwrap();
        assert_eq!(
            variants[0].resource_refs["sprite"].rel_path,
            nested.sprites["nested"].rel_path
        );
        let wings = csv_window::query_csv_table_window(
            &manifest.session_id,
            CsvTableKey::Wings,
            0,
            10,
            None,
            CsvSearchField::IdName,
        )
        .unwrap();
        let preview = csv_window::query_csv_row_preview(
            &manifest.session_id,
            CsvTableKey::Wings,
            &wings.rows[0].row_key,
        )
        .unwrap();
        assert_eq!(
            preview.resource_ref.unwrap().rel_path,
            nested.sprites["nested"].rel_path
        );
        assert_eq!(previews.sprites.len(), 6);
        assert_eq!(
            previews.hull_names.get("mod_ship"),
            Some(&"Mod CSV Ship".to_string())
        );
        assert_eq!(
            previews.hull_names.get("core_ship"),
            Some(&"Core CSV Ship".to_string())
        );
        assert_eq!(
            previews.hull_names.get("mod_fallback"),
            Some(&"Mod Fallback".to_string())
        );
        assert_eq!(
            previews.hull_names.get("core_fallback"),
            Some(&"Core Fallback".to_string())
        );
        assert_eq!(
            previews
                .sprites
                .get("core_skin")
                .map(|resource| resource.source.as_str()),
            Some("core")
        );
        assert_eq!(
            previews
                .sprites
                .get("mod_skin")
                .map(|resource| resource.rel_path.as_str()),
            Some("graphics/ships/mod_ship.png")
        );
        let _ = close_project_session(manifest.session_id);
        root.close().unwrap();
    }

    #[test]
    fn cyclic_skin_references_end_with_a_formal_error() {
        for base in ["first", "second"] {
            let root = project_workspace("skin_cycle");
            fs::create_dir_all(root.join("data/hulls/skins")).unwrap();
            write_utf8_no_bom(
                &root.join("data/hulls/skins/first.skin"),
                &serde_json::json!({"skinHullId":"first","baseHullId":base}).to_string(),
            )
            .unwrap();
            write_utf8_no_bom(
                &root.join("data/hulls/skins/second.skin"),
                r#"{"skinHullId":"second","baseHullId":"first"}"#,
            )
            .unwrap();
            let mut trace = PerformanceTrace::new("project.openSession");
            let manifest = open_project_session_traced(&root, None, &mut trace).unwrap();
            assert_eq!(
                query_hull_references(&manifest.session_id, &["first".into()])
                    .unwrap_err()
                    .code(),
                "skin.base_cycle"
            );
            close_project_session(manifest.session_id).unwrap();
            root.close().unwrap();
        }
    }
}
