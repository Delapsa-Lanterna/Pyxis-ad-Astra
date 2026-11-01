use super::super::model::{ProjectSession, WEAPON_SPRITE_FIELDS, string_field};
use super::super::resources::{HullReferenceResolver, resource_ref};
use crate::models::{EntityKind, ResourceOwnerKind, ResourceRef, ResourceSource};
use serde_json::Value;
use std::collections::BTreeMap;

pub(in crate::services::project) fn ship_resource_refs(
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    if let Some(sprite) = string_field(data, "spriteName") {
        refs.insert(
            "sprite".to_string(),
            resource_ref(
                ResourceSource::Mod,
                &sprite,
                ResourceOwnerKind::Ship,
                id,
                "sprite",
            ),
        );
    }
    refs
}

pub(in crate::services::project) fn weapon_resource_refs(
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    for field in WEAPON_SPRITE_FIELDS {
        if let Some(sprite) = string_field(data, field) {
            refs.insert(
                field.to_string(),
                resource_ref(
                    ResourceSource::Mod,
                    &sprite,
                    ResourceOwnerKind::Weapon,
                    id,
                    field,
                ),
            );
        }
    }
    if data.get("specClass").and_then(Value::as_str) == Some("beam") {
        effect_resource_refs(id, data, &mut refs);
    }
    refs
}

pub(in crate::services::project) fn projectile_resource_refs(
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = ["sprite", "bulletSprite", "glowSprite"]
        .into_iter()
        .filter_map(|field| {
            string_field(data, field).map(|sprite| {
                (
                    field.to_string(),
                    resource_ref(
                        ResourceSource::Mod,
                        &sprite,
                        EntityKind::Projectile.into(),
                        id,
                        field,
                    ),
                )
            })
        })
        .collect();
    effect_resource_refs(id, data, &mut refs);
    refs
}

fn effect_resource_refs(id: &str, data: &Value, refs: &mut BTreeMap<String, ResourceRef>) {
    let texture = data.get("textureType");
    let pair = match texture.and_then(Value::as_str).unwrap_or("SMOOTH") {
        "MEDIUM" => ("beamfringec", "beamcorec"),
        "ROUGH" => ("beamfringe", "beamcore"),
        "CHUNKY" => ("beam_chunky_fringe", "beam_chunky_core"),
        "ROUGH2" => ("beam_rough2_fringe", "beam_rough2_core"),
        "WEAVE" => ("beam_weave_fringe", "beam_weave_core"),
        "LASER" => ("beam_laser_fringe", "beam_laser_core"),
        _ => ("beamfringeb", "beamcoreb"),
    };
    let spawn = data
        .get("spawnType")
        .and_then(Value::as_str)
        .unwrap_or("BALLISTIC");
    let beam = data.get("specClass").and_then(Value::as_str) == Some("beam");
    let mut paths = vec![("hitGlow", "graphics/fx/hit_glow.png".to_string())];
    if beam || spawn == "BEAM" || spawn == "BALLISTIC_AS_BEAM" {
        for (index, (key, name)) in [("fringeTexture", pair.0), ("coreTexture", pair.1)]
            .into_iter()
            .enumerate()
        {
            let path = texture
                .and_then(Value::as_array)
                .and_then(|items| items.get(index))
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("graphics/fx/{name}.png"));
            paths.push((key, path));
        }
    } else if spawn == "PLASMA" {
        paths.push(("plasmaRay", "graphics/fx/torpedoray32.png".into()));
    } else if data.get("specClass").and_then(Value::as_str) == Some("missile") {
        paths.push(("contrailTexture", "graphics/fx/contrail64b.png".into()));
    } else {
        paths.push(("projectileTrail", "graphics/fx/projtrail.png".into()));
        paths.push(("projectileBody", "graphics/fx/projbody.png".into()));
    }
    for (key, path) in paths {
        refs.insert(
            key.into(),
            resource_ref(
                ResourceSource::Mod,
                &path,
                ResourceOwnerKind::Weapon,
                id,
                key,
            ),
        );
    }
    if texture.is_some_and(Value::is_array) {
        for (index, key) in ["fringeTexture", "coreTexture"].into_iter().enumerate() {
            if let Some(mut resource) = refs.get(key).cloned() {
                resource.key = format!("textureType[{index}]");
                refs.insert(resource.key.clone(), resource);
            }
        }
    }
}

pub(in crate::services::project) fn system_resource_refs(
    _id: &str,
    _data: &Value,
) -> BTreeMap<String, ResourceRef> {
    BTreeMap::new()
}

pub(in crate::services::project) fn variant_resource_refs(
    session: &ProjectSession,
    origin: ResourceSource,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    if let Some(hull_id) = string_field(data, "hullId")
        && let Ok(Some(resource)) = HullReferenceResolver::new(session).resource(origin, &hull_id)
    {
        refs.insert("sprite".to_string(), resource);
    }
    refs
}

pub(in crate::services::project) fn skin_entity_resource_refs(
    session: &ProjectSession,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    if let Some(sprite) = string_field(data, "spriteName") {
        refs.insert(
            "sprite".to_string(),
            resource_ref(
                ResourceSource::Mod,
                &sprite,
                ResourceOwnerKind::Skin,
                id,
                "sprite",
            ),
        );
    } else if let Some(base_hull_id) = string_field(data, "baseHullId")
        && let Ok(Some(resource)) =
            HullReferenceResolver::new(session).resource(ResourceSource::Mod, &base_hull_id)
    {
        refs.insert("sprite".to_string(), resource);
    }
    refs
}

pub(in crate::services::project) fn faction_resource_refs(
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    if let Some(logo) = string_field(data, "logo") {
        refs.insert(
            "logo".to_string(),
            resource_ref(
                ResourceSource::Mod,
                &logo,
                ResourceOwnerKind::Faction,
                id,
                "logo",
            ),
        );
    }
    if let Some(crest) = string_field(data, "crest") {
        refs.insert(
            "crest".to_string(),
            resource_ref(
                ResourceSource::Mod,
                &crest,
                ResourceOwnerKind::Faction,
                id,
                "crest",
            ),
        );
    }
    refs
}

pub(in crate::services::project) fn mission_resource_refs(
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    let mut refs = BTreeMap::new();
    if let Some(icon) = data
        .get("descriptor")
        .and_then(|descriptor| descriptor.get("icon"))
        .and_then(Value::as_str)
    {
        refs.insert(
            "icon".to_string(),
            resource_ref(
                ResourceSource::Mod,
                &format!("data/missions/{id}/{icon}"),
                ResourceOwnerKind::Mission,
                id,
                "icon",
            ),
        );
    }
    refs
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(test)]
    use crate::models::EntityKind;
    use serde_json::json;

    #[test]
    fn effects_select_declared_textures_and_keep_business_identity() {
        for (name, suffix) in [
            ("SMOOTH", "beamfringeb"),
            ("MEDIUM", "beamfringec"),
            ("ROUGH", "beamfringe"),
            ("CHUNKY", "beam_chunky_fringe"),
            ("ROUGH2", "beam_rough2_fringe"),
            ("WEAVE", "beam_weave_fringe"),
            ("LASER", "beam_laser_fringe"),
        ] {
            let refs =
                weapon_resource_refs("beam", &json!({"specClass":"beam","textureType":name}));
            assert_eq!(
                refs["fringeTexture"].rel_path,
                format!("graphics/fx/{suffix}.png")
            );
            assert_eq!(refs["fringeTexture"].owner_id, "beam");
        }
        let refs = projectile_resource_refs(
            "pulse",
            &json!({"spawnType":"BEAM", "textureType":["graphics/custom-a.png","graphics/custom-b.png"]}),
        );
        assert_eq!(refs["coreTexture"].rel_path, "graphics/custom-b.png");
        assert_eq!(refs["textureType[0]"].key, "textureType[0]");
        assert_eq!(
            refs["textureType[1]"].rel_path,
            refs["coreTexture"].rel_path
        );
        assert_eq!(
            refs["coreTexture"].owner_kind,
            EntityKind::Projectile.into()
        );
        assert_eq!(refs["fringeTexture"].source, ResourceSource::Mod);
        let refs = projectile_resource_refs("plasma", &json!({"spawnType":"PLASMA"}));
        assert_eq!(refs["plasmaRay"].rel_path, "graphics/fx/torpedoray32.png");
        let refs = projectile_resource_refs(
            "missile",
            &json!({"specClass":"missile","sprite":"graphics/missile.png","glowSprite":"graphics/glow.png"}),
        );
        assert_eq!(refs["glowSprite"].rel_path, "graphics/glow.png");
    }
}
