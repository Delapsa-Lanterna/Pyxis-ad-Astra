use super::super::model::{ProjectSession, WEAPON_SPRITE_FIELDS, string_field};
use super::table_references::csv_icon_resource_ref;
use super::{HullReferenceResolver, resource_ref};
use crate::domain::entity_identity;
use crate::errors::AppResult;
use crate::io::read_json_file;
use crate::models::JsonComposition;
use crate::models::{CsvTableKey, EntityKind, ResourceOwnerKind, ResourceRef, ResourceSource};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::Path;

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

/// Projects resources from entity content using the captured session for hull inheritance.
pub(in crate::services::project) fn entity_resource_refs(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    data: &Value,
) -> BTreeMap<String, ResourceRef> {
    match kind {
        EntityKind::Ship => ship_resource_refs(id, data),
        EntityKind::Weapon => data
            .get("spec")
            .map(|spec| weapon_resource_refs(id, spec))
            .unwrap_or_default(),
        EntityKind::Projectile => projectile_resource_refs(id, data),
        EntityKind::System => BTreeMap::new(),
        EntityKind::Skill => data
            .get("csvRow")
            .and_then(Value::as_object)
            .and_then(|row| csv_icon_resource_ref(ResourceSource::Mod, CsvTableKey::Skills, row))
            .map(|resource| BTreeMap::from([("icon".to_string(), resource)]))
            .unwrap_or_default(),
        EntityKind::Faction => faction_resource_refs(id, data),
        EntityKind::Mission => mission_resource_refs(id, data),
        EntityKind::Variant => variant_resource_refs(session, ResourceSource::Mod, data),
        EntityKind::Skin => skin_entity_resource_refs(session, id, data),
    }
}

/// Resolves list resources and propagates mission descriptor read or parse errors.
pub(in crate::services::project) fn entity_list_resource_refs(
    session: &ProjectSession,
    kind: EntityKind,
    id: &str,
    data: &Value,
) -> AppResult<BTreeMap<String, ResourceRef>> {
    if kind == EntityKind::Mission {
        return Ok(mission_icon_resource_ref(session, id)?
            .map(|resource| BTreeMap::from([("icon".to_string(), resource)]))
            .unwrap_or_default());
    }
    Ok(entity_resource_refs(session, kind, id, data))
}

fn mission_icon_resource_ref(session: &ProjectSession, id: &str) -> AppResult<Option<ResourceRef>> {
    let clean = entity_identity::validate_entity_id(id, "无效战役 ID")?;
    let descriptor_path = Path::new(&session.manifest.mod_root)
        .join("data/missions")
        .join(clean)
        .join("descriptor.json");
    if !descriptor_path.exists() {
        return Ok(None);
    }
    let descriptor = read_json_file(&descriptor_path)?;
    let Some(icon) = descriptor.get("icon").and_then(Value::as_str) else {
        return Ok(None);
    };
    Ok(Some(resource_ref(
        ResourceSource::Mod,
        &format!("data/missions/{clean}/{icon}"),
        ResourceOwnerKind::Mission,
        id,
        "icon",
    )))
}

pub(in crate::services::project) fn apply_resource_origins(
    resources: &mut BTreeMap<String, ResourceRef>,
    local: &Value,
    composition: &JsonComposition,
) {
    for (key, resource) in resources {
        let field = match key.as_str() {
            "sprite"
                if resource.owner_kind == EntityKind::Ship.into()
                    || resource.owner_kind == EntityKind::Skin.into() =>
            {
                "spriteName"
            }
            _ => key.split('[').next().expect("resource field"),
        };
        if local.get(field).is_some() || composition.replace {
            continue;
        }
        if let Some(layer) = composition
            .layers
            .iter()
            .rev()
            .find(|layer| layer.data.get(field).is_some())
        {
            resource.source = layer.source.source;
            resource.reference = layer.source.reference.as_deref().cloned();
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::services::project::PerformanceTrace;
    use crate::services::project::session::{
        lock_ready_session, open_project_session_traced, session_handle,
    };
    use crate::services::project::test_support::project_workspace;
    use crate::services::project_sync::release_project_session;

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

    #[test]
    fn entity_dispatch_preserves_content_shapes_and_roles() {
        let root = project_workspace("entity_resource_dispatch");
        let manifest = open_project_session_traced(
            &root,
            None,
            &mut PerformanceTrace::new("resources.dispatch"),
        )
        .unwrap();
        let handle = session_handle(&manifest.session_id).unwrap();
        let session = lock_ready_session(&handle).unwrap();
        for (kind, data, key, path) in [
            (
                EntityKind::Ship,
                json!({"spriteName":"graphics/ship.png"}),
                "sprite",
                "graphics/ship.png",
            ),
            (
                EntityKind::Weapon,
                json!({"spec":{"turretSprite":"graphics/weapon.png"},"csvRow":{}}),
                "turretSprite",
                "graphics/weapon.png",
            ),
            (
                EntityKind::Projectile,
                json!({"sprite":"graphics/projectile.png"}),
                "sprite",
                "graphics/projectile.png",
            ),
            (
                EntityKind::Skill,
                json!({"spec":{},"csvRow":{"id":"skill","icon":"graphics/skill.png"}}),
                "icon",
                "graphics/skill.png",
            ),
            (
                EntityKind::Faction,
                json!({"logo":"graphics/logo.png"}),
                "logo",
                "graphics/logo.png",
            ),
            (
                EntityKind::Mission,
                json!({"descriptor":{"icon":"icon.png"}}),
                "icon",
                "data/missions/sample/icon.png",
            ),
            (
                EntityKind::Skin,
                json!({"spriteName":"graphics/skin.png"}),
                "sprite",
                "graphics/skin.png",
            ),
        ] {
            let refs = entity_resource_refs(&session, kind, "sample", &data);
            assert_eq!(refs[key].rel_path, path);
            assert_eq!(refs[key].source, ResourceSource::Mod);
        }
        assert!(
            entity_resource_refs(&session, EntityKind::System, "sample", &json!({})).is_empty()
        );
        assert!(
            entity_resource_refs(
                &session,
                EntityKind::Variant,
                "sample",
                &json!({"hullId":"absent"})
            )
            .is_empty()
        );
        drop(session);
        release_project_session(manifest.session_id).unwrap();
        root.close().unwrap();
    }
}
