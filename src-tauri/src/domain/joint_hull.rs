use crate::{
    errors::{AppError, AppResult},
    models::{
        CsvTableKey, EntityKind, JointEditRecord, JointFieldBinding, JointHullProjection,
        JointRecordTarget, JointValue,
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
    let mut slots = BTreeSet::new();
    if let Some(data) = value(hull) {
        if let Some(items) = data.get("weaponSlots").and_then(Value::as_array) {
            for slot in items {
                if let Some(id) = slot.get("id").and_then(Value::as_str) {
                    slots.insert(id.to_string());
                }
            }
        }
        add_weapons(&mut weapons, data);
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
                        slots.remove(id);
                    }
                }
            }
        }
        add_weapons(&mut weapons, data);
    }
    if let Some(groups) = value(variant)
        .and_then(|data| data.get("weaponGroups"))
        .and_then(Value::as_array)
    {
        for group in groups {
            if let Some(items) = group.get("weapons").and_then(Value::as_object) {
                for (slot, weapon) in items {
                    if slots.contains(slot)
                        && let Some(id) = weapon.as_str()
                    {
                        weapons.entry(slot.clone()).or_insert_with(|| id.into());
                    }
                }
            }
        }
    }
    Ok(Some(JointHullProjection {
        variant_key: variant_key.into(),
        hull_key: hull.key.clone(),
        skin_keys: skins.iter().rev().map(|skin| skin.key.clone()).collect(),
        fields,
        weapons,
        sprite,
    }))
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
