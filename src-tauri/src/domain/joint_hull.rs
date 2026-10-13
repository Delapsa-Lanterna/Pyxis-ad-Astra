use crate::{
    errors::{AppError, AppResult},
    models::{
        CsvTableKey, EntityKind, JointEditRecord, JointFieldBinding, JointHullProjection,
        JointModuleBinding, JointRecordTarget, JointValue,
    },
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

pub fn project_joint_hull(
    records: &[JointEditRecord],
    variant_key: &str,
) -> AppResult<Option<JointHullProjection>> {
    let variant = record(records, variant_key);
    let Some(hull_id) = value(variant)
        .and_then(|data| data.get("hullId"))
        .and_then(Value::as_str)
    else {
        return Ok(None);
    };
    let mut current = hull_id;
    let mut skins = Vec::new();
    let mut seen = BTreeSet::new();
    while let Some(skin) = spec(records, EntityKind::Skin, current) {
        if !seen.insert(current) {
            return Err(AppError::message(
                "skin.base_cycle",
                format!("循环舰体皮肤引用: {hull_id}"),
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
            JointFieldBinding {
                record_key: csv.key.clone(),
                path: path.into(),
            },
        );
    }
    let mut weapons = BTreeMap::new();
    if let Some(data) = value(csv).and_then(Value::as_object) {
        for path in data.keys() {
            fields
                .entry(path.clone())
                .or_insert_with(|| JointFieldBinding {
                    record_key: csv.key.clone(),
                    path: path.clone(),
                });
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
    for skin in skins.iter().rev() {
        let Some(data) = value(skin) else { continue };
        for (path, overrides) in [
            ("name", &["hullName"][..]),
            ("tech/manufacturer", &["manufacturer", "tech"][..]),
            ("max speed", &["maxSpeed"][..]),
            ("system id", &["systemId"][..]),
            ("shield efficiency", &["shieldEfficiency"][..]),
            ("ordnance points", &["ordnancePoints"][..]),
            ("fighter bays", &["fighterBays"][..]),
        ] {
            if let Some(key) = overrides.iter().find(|key| data.get(**key).is_some()) {
                fields.insert(
                    path.into(),
                    JointFieldBinding {
                        record_key: skin.key.clone(),
                        path: (*key).into(),
                    },
                );
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
    let system = &fields["system id"];
    if let Some(id) = value(record(records, &system.record_key))
        .and_then(|data| data.get(&system.path))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|id| !id.is_empty())
        && let Some(record) = spec(records, EntityKind::System, id)
    {
        display_bindings.insert("system".into(), record.key.clone());
    }
    Ok(Some(JointHullProjection {
        variant_key: variant_key.into(),
        hull_key: hull.key.clone(),
        skin_keys: skins.iter().rev().map(|skin| skin.key.clone()).collect(),
        fields,
        display_bindings,
        weapons,
        sprite,
        slots,
        built_in_weapons,
        built_in_mods: mods.into_iter().collect(),
        built_in_wings: wings,
        modules: value(variant)
            .map(|data| {
                module_entries(data.get("modules"))
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

pub fn module_entries(value: Option<&Value>) -> Vec<(String, String)> {
    match value {
        Some(Value::Object(items)) => items
            .iter()
            .filter_map(|(slot, id)| id.as_str().map(|id| (slot.clone(), id.into())))
            .collect(),
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(Value::as_object)
            .flat_map(|item| item.iter())
            .filter_map(|(slot, id)| id.as_str().map(|id| (slot.clone(), id.into())))
            .collect(),
        _ => Vec::new(),
    }
}
pub fn rename_module_reference(data: &mut Value, previous: &str, next: &str) -> bool {
    fn replace(items: &mut serde_json::Map<String, Value>, previous: &str, next: &str) -> bool {
        let mut changed = false;
        for value in items.values_mut() {
            if value.as_str() == Some(previous) {
                *value = Value::String(next.into());
                changed = true;
            }
        }
        changed
    }
    match data.get_mut("modules") {
        Some(Value::Object(items)) => replace(items, previous, next),
        Some(Value::Array(items)) => {
            let mut changed = false;
            for item in items.iter_mut().filter_map(Value::as_object_mut) {
                changed |= replace(item, previous, next);
            }
            changed
        }
        _ => false,
    }
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
