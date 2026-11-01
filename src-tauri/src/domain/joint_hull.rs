use crate::domain::{joint_hull, json_composition, variant_modules};
use crate::errors::{AppError, AppResult};
use crate::models::{
    CsvTableKey, EntityKind, JointEditRecord, JointFieldBinding, JointHullProjection,
    JointModuleBinding, JointRecordTarget, JointValue,
};
#[cfg(test)]
use crate::test_support::work_counts;
use serde_json::Value;
use std::borrow::Cow;
use std::collections::{BTreeMap, BTreeSet};
#[cfg(test)]
use std::path::Path;
use std::sync::LazyLock;

pub fn project_joint_hull(
    records: &[JointEditRecord],
    variant_key: &str,
) -> AppResult<Option<JointHullProjection>> {
    let records = effective_records(records)?;
    let records = records.as_ref();
    let variant = record(records, variant_key);
    let Some(hull_id) = value(variant)
        .and_then(|data| data.get("hullId"))
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    project_hull(records, variant_key, hull_id)
}

pub fn project_ship_hull(
    records: &[JointEditRecord],
    root_key: &str,
) -> AppResult<Option<JointHullProjection>> {
    let records = effective_records(records)?;
    let records = records.as_ref();
    let JointRecordTarget::Spec { target } = &record(records, root_key).target else {
        unreachable!("ship hull root is a spec");
    };
    project_hull(records, root_key, &target.id)
}

fn effective_records(records: &[JointEditRecord]) -> AppResult<Cow<'_, [JointEditRecord]>> {
    if records.iter().all(|record| {
        record
            .composition
            .as_ref()
            .is_none_or(|sources| sources.layers.is_empty())
    }) {
        return Ok(Cow::Borrowed(records));
    }
    records
        .iter()
        .cloned()
        .map(|mut record| {
            if let (Some(sources), JointValue::Present(value)) =
                (&record.composition, &record.value)
            {
                record.value =
                    JointValue::Present(json_composition::compose_game_json(sources, value)?);
            }
            Ok(record)
        })
        .collect::<AppResult<Vec<_>>>()
        .map(Cow::Owned)
}

fn project_hull(
    records: &[JointEditRecord],
    variant_key: &str,
    hull_id: &str,
) -> AppResult<Option<JointHullProjection>> {
    let variant = record(records, variant_key);
    let mut current = hull_id;
    let mut skins = Vec::new();
    let mut seen = BTreeSet::new();
    while let Some(skin) = spec(records, EntityKind::Skin, current) {
        if !seen.insert(current) {
            return Err(AppError::message(
                "skin.base_cycle",
                format!("循环船体皮肤引用: {hull_id}"),
            ));
        }
        skins.push(skin);
        let Some(base) = value(skin)
            .and_then(|data| data.get("baseHullId"))
            .and_then(Value::as_str)
        else {
            return Ok(None);
        };
        current = base;
    }
    let hull =
        spec(records, EntityKind::Ship, current).expect("joint graph contains the referenced hull");
    let csv = records.iter().find(|record| matches!(&record.target, JointRecordTarget::Csv {table: CsvTableKey::Ships, identity, ..} if identity.get("id").map(String::as_str) == Some(current))).expect("joint graph contains the hull CSV");
    let mut fields = BTreeMap::new();
    for path in [
        "name",
        "tech/manufacturer",
        "min crew",
        "hitpoints",
        "armor rating",
        "max speed",
        "shield type",
        "defense id",
        "max flux",
        "shield arc",
        "shield efficiency",
        "system id",
        "flux dissipation",
        "shield upkeep",
        "ordnance points",
        "fighter bays",
    ] {
        fields.insert(
            path.into(),
            vec![JointFieldBinding {
                record_key: csv.key.clone(),
                path: path.into(),
            }],
        );
    }
    let mut weapons = BTreeMap::new();
    let mut hints: BTreeSet<String> = value(csv)
        .and_then(|data| data.get("hints"))
        .and_then(Value::as_str)
        .map(|hints| {
            hints
                .split(',')
                .map(str::trim)
                .filter(|hint| !hint.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    if let Some(data) = value(csv).and_then(Value::as_object) {
        for path in data.keys() {
            fields.entry(path.clone()).or_insert_with(|| {
                vec![JointFieldBinding {
                    record_key: csv.key.clone(),
                    path: path.clone(),
                }]
            });
        }
    }
    for (path, paths) in joint_hull::skin_hull_fields() {
        let inputs = fields.entry(path.clone()).or_insert_with(|| {
            vec![JointFieldBinding {
                record_key: csv.key.clone(),
                path: path.clone(),
            }]
        });
        for skin in skins.iter().rev() {
            inputs.extend(paths.iter().map(|path| JointFieldBinding {
                record_key: skin.key.clone(),
                path: path.clone(),
            }));
        }
    }
    let mut slots = Vec::new();
    let mut mods = BTreeSet::new();
    let mut wings = Vec::new();
    if let Some(data) = value(hull) {
        if let Some(items) = data.get("weaponSlots").and_then(Value::as_array) {
            slots = items.clone();
        }
        add_weapons(&mut weapons, data);
        add_mods(&mut mods, data);
        if let Some(items) = data.get("builtInWings").and_then(Value::as_array) {
            wings = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
        }
    }
    let mut sprite = hull.resource_refs.get("sprite").cloned();
    let mut effective_spec = value(hull)
        .cloned()
        .unwrap_or_else(|| serde_json::json!({}));
    for skin in skins.iter().rev() {
        let Some(data) = value(skin) else { continue };
        // ShipHullSpreadsheetLoader supplies base hints; ShipHullSpecLoader applies each Skin.
        if let Some(removed) = data.get("removeHints").and_then(Value::as_array) {
            for hint in removed.iter().filter_map(Value::as_str) {
                hints.remove(hint);
            }
        }
        if let Some(added) = data.get("addHints").and_then(Value::as_array) {
            hints.extend(added.iter().filter_map(Value::as_str).map(str::to_owned));
        }
        for path in ["spriteName", "coversColor"] {
            if let Some(next) = data.get(path) {
                effective_spec[path] = next.clone();
            }
        }
        if let Some(engines) = effective_spec
            .get_mut("engineSlots")
            .and_then(Value::as_array_mut)
        {
            if let Some(removed) = data.get("removeEngineSlots").and_then(Value::as_array) {
                let indices: BTreeSet<_> = removed.iter().filter_map(Value::as_u64).collect();
                let mut index = 0;
                engines.retain(|_| {
                    let keep = !indices.contains(&index);
                    index += 1;
                    keep
                });
            }
            if let Some(changes) = data.get("engineSlotChanges").and_then(Value::as_object) {
                for (index, engine) in engines.iter_mut().enumerate() {
                    if let Some(change) = changes.get(&index.to_string()).and_then(Value::as_object)
                    {
                        engine
                            .as_object_mut()
                            .expect("engine slot is an object")
                            .extend(change.clone());
                    }
                }
            }
        }
        if let Some(resource) = skin.resource_refs.get("sprite") {
            sprite = Some(resource.clone());
        }
        for field in ["removeBuiltInWeapons", "removeWeaponSlots"] {
            if let Some(removed) = data.get(field).and_then(Value::as_array) {
                for id in removed.iter().filter_map(Value::as_str) {
                    weapons.remove(id);
                    if field == "removeWeaponSlots" {
                        slots.retain(|slot| slot.get("id").and_then(Value::as_str) != Some(id));
                    }
                }
            }
        }
        add_weapons(&mut weapons, data);
        if let Some(changes) = data.get("weaponSlotChanges").and_then(Value::as_object) {
            for slot in &mut slots {
                if let Some(change) = slot
                    .get("id")
                    .and_then(Value::as_str)
                    .and_then(|id| changes.get(id))
                    .and_then(Value::as_object)
                {
                    slot.as_object_mut()
                        .expect("slot is an object")
                        .extend(change.clone());
                }
            }
        }
        if let Some(removed) = data.get("removeBuiltInMods").and_then(Value::as_array) {
            for id in removed.iter().filter_map(Value::as_str) {
                mods.remove(id);
            }
        }
        add_mods(&mut mods, data);
        if let Some(items) = data.get("builtInWings").and_then(Value::as_array) {
            wings = items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect();
        }
    }
    effective_spec["weaponSlots"] = serde_json::json!(slots);
    effective_spec["builtInWeapons"] = serde_json::json!(weapons);
    effective_spec["builtInMods"] = serde_json::json!(mods);
    if let Some(skin) = skins.first()
        && let JointRecordTarget::Spec { target } = &skin.target
    {
        effective_spec["hullId"] = serde_json::json!(target.id);
    }
    let built_in_weapons = weapons.clone();
    if let Some(groups) = value(variant)
        .and_then(|data| data.get("weaponGroups"))
        .and_then(Value::as_array)
    {
        for group in groups {
            if let Some(items) = group.get("weapons").and_then(Value::as_object) {
                for (slot, weapon) in items {
                    if slots
                        .iter()
                        .any(|item| item.get("id").and_then(Value::as_str) == Some(slot))
                        && let Some(id) = weapon.as_str()
                    {
                        weapons.entry(slot.clone()).or_insert_with(|| id.into());
                    }
                }
            }
        }
    }
    let mut display_bindings = BTreeMap::from([("csv".into(), csv.key.clone())]);
    let owner = skins.first().copied().unwrap_or(hull);
    let JointRecordTarget::Spec { target } = &owner.target else {
        unreachable!("hull description owner is a spec")
    };
    if let Some(id) = description_id(target.kind, &target.id, value(owner))
        && let Some(record) = records.iter().find(|record| matches!(&record.target,
            JointRecordTarget::Csv { table: CsvTableKey::Descriptions, identity, .. }
            if identity.get("id") == Some(&id) && identity.get("type").map(String::as_str) == Some("SHIP")))
    {
        display_bindings.insert("description".into(), record.key.clone());
    }
    let system = hull_field_value(records, &fields["system id"]);
    if let Some(id) = system
        .as_ref()
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        && let Some(record) = spec(records, EntityKind::System, id)
    {
        display_bindings.insert("system".into(), record.key.clone());
    }
    Ok(Some(JointHullProjection {
        spec: effective_spec,
        variant_key: variant_key.into(),
        hull_key: hull.key.clone(),
        skin_keys: skins.iter().rev().map(|skin| skin.key.clone()).collect(),
        fields,
        display_bindings,
        weapons,
        sprite,
        slots,
        hints: hints.into_iter().collect(),
        built_in_weapons,
        built_in_mods: mods.into_iter().collect(),
        built_in_wings: wings,
        modules: value(variant)
            .map(|data| {
                variant_modules::module_entries(data.get("modules"))
                    .into_iter()
                    .map(|(slot_id, id)| JointModuleBinding {
                        slot_id,
                        variant_key: serde_json::to_string(&("spec", EntityKind::Variant, id))
                            .expect("variant key serializes"),
                    })
                    .collect()
            })
            .unwrap_or_default(),
    }))
}

pub fn hull_field_value(
    records: &[JointEditRecord],
    inputs: &[JointFieldBinding],
) -> Option<Value> {
    let mut effective = None;
    for input in inputs {
        let Some(data) = value(record(records, &input.record_key)) else {
            continue;
        };
        let Some(next) = data.get(&input.path) else {
            continue;
        };
        if input.path == "fpMod" && data.get("fleetPoints").is_some() {
            continue;
        }
        let number = |value: &Value| {
            value
                .as_f64()
                .or_else(|| value.as_str().and_then(|text| text.parse().ok()))
                .unwrap_or(f64::NAN)
        };
        effective = Some(match input.path.as_str() {
            "fpMod" => serde_json::json!(effective.as_ref().map_or(0.0, number) + number(next)),
            "baseValueMult" => {
                serde_json::json!((effective.as_ref().map_or(0.0, number) * number(next)).trunc())
            }
            _ => next.clone(),
        });
    }
    effective
}

pub fn description_id(kind: EntityKind, id: &str, data: Option<&Value>) -> Option<String> {
    let description = match kind {
        EntityKind::Weapon => id.to_string(),
        EntityKind::Skin => data
            .and_then(|value| value.get("descriptionId"))
            .and_then(Value::as_str)
            .unwrap_or(id)
            .to_string(),
        _ => data
            .and_then(|value| value.get("descriptionId"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or(id)
            .to_string(),
    };
    (!description.is_empty()).then_some(description)
}

fn add_mods(mods: &mut BTreeSet<String>, data: &Value) {
    if let Some(items) = data.get("builtInMods").and_then(Value::as_array) {
        mods.extend(items.iter().filter_map(Value::as_str).map(str::to_owned));
    }
}

fn record<'a>(records: &'a [JointEditRecord], key: &str) -> &'a JointEditRecord {
    records
        .iter()
        .find(|record| record.key == key)
        .expect("projection key belongs to the graph")
}
fn spec<'a>(
    records: &'a [JointEditRecord],
    kind: EntityKind,
    id: &str,
) -> Option<&'a JointEditRecord> {
    records.iter().find(|record| matches!(&record.target, JointRecordTarget::Spec {target} if target.kind == kind && target.id == id))
}
fn value(record: &JointEditRecord) -> Option<&Value> {
    match &record.value {
        JointValue::Present(data) => Some(data),
        JointValue::Missing => None,
    }
}
fn add_weapons(weapons: &mut BTreeMap<String, String>, data: &Value) {
    if let Some(items) = data.get("builtInWeapons").and_then(Value::as_object) {
        for (slot, weapon) in items {
            if let Some(id) = weapon.as_str() {
                weapons.insert(slot.clone(), id.into());
            }
        }
    }
}

pub fn skin_hull_fields() -> &'static BTreeMap<String, Vec<String>> {
    static FIELDS: LazyLock<BTreeMap<String, Vec<String>>> = LazyLock::new(|| {
        #[cfg(test)]
        work_counts::record("asset-parse", Path::new("skin-hull-fields"));
        serde_json::from_str(include_str!("../../../schemas/skin-hull-fields.json"))
            .expect("embedded skin hull fields must parse")
    });
    &FIELDS
}
