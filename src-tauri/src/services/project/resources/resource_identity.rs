use crate::models;
use crate::models::{
    EntityFileLocation, ReferenceSource, ResourceOwnerKind, ResourceRef, ResourceSource,
};
use crate::services::project::session::references::reference_revision;
use serde_json::json;
use std::collections::BTreeMap;

pub(in crate::services::project) fn media_resource_key(resource: &ResourceRef) -> String {
    json!([
        resource.source.as_str(),
        normalized_media_rel_path(&resource.rel_path),
        resource.reference,
        reference_revision(),
    ])
    .to_string()
}

fn normalized_media_rel_path(path: &str) -> String {
    models::windows_path_case(path.replace('\\', "/").trim().trim_end_matches('/'))
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

/// Assigns the captured reference identity to an unbound non-Core resource.
pub(in crate::services::project) fn apply_reference_origin(
    resource: &mut ResourceRef,
    identity: &ReferenceSource,
) {
    if resource.source != ResourceSource::Core && resource.reference.is_none() {
        resource.source = ResourceSource::Reference;
        resource.reference = Some(identity.clone());
    }
}

/// Applies the file's captured reference identity to its resource collection.
pub(in crate::services::project) fn apply_source_reference(
    source: &EntityFileLocation,
    resources: &mut BTreeMap<String, ResourceRef>,
) {
    if let Some(identity) = source.reference.as_deref() {
        for resource in resources.values_mut() {
            apply_reference_origin(resource, identity);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reference_origin_retains_resource_content_and_first_reference_identity() {
        let identity = ReferenceSource {
            session_id: "source-a".into(),
            mod_root: "M:/source-a".into(),
        };
        let next = ReferenceSource {
            session_id: "source-b".into(),
            mod_root: "M:/source-b".into(),
        };
        for source in [
            ResourceSource::Mod,
            ResourceSource::Core,
            ResourceSource::Reference,
        ] {
            let mut resource = resource_ref(
                source,
                "graphics/icon.png",
                ResourceOwnerKind::Ship,
                "ship",
                "sprite",
            );
            if source == ResourceSource::Reference {
                resource.reference = Some(next.clone());
            }
            let mut expected = serde_json::to_value(&resource).unwrap();
            if source == ResourceSource::Mod {
                expected["source"] = json!("reference");
                expected["reference"] = json!(identity);
            }
            apply_reference_origin(&mut resource, &identity);
            assert_eq!(serde_json::to_value(&resource).unwrap(), expected);
            apply_reference_origin(&mut resource, &next);
            assert_eq!(serde_json::to_value(&resource).unwrap(), expected);
        }
    }

    #[test]
    fn file_reference_origin_applies_one_identity_to_mixed_resources() {
        let identity = ReferenceSource {
            session_id: "source-a".into(),
            mod_root: "M:/source-a".into(),
        };
        let existing = ReferenceSource {
            session_id: "source-b".into(),
            mod_root: "M:/source-b".into(),
        };
        for source in [
            ResourceSource::Mod,
            ResourceSource::Core,
            ResourceSource::Reference,
        ] {
            let location = EntityFileLocation {
                reference: (source == ResourceSource::Reference)
                    .then(|| Box::new(identity.clone())),
                source,
                root: "M:/source-a".into(),
                rel_path: "data/hulls/ship.ship".into(),
                path: "M:/source-a/data/hulls/ship.ship".into(),
            };
            let mut resources = BTreeMap::new();
            for (key, origin) in [
                ("local", ResourceSource::Mod),
                ("core", ResourceSource::Core),
                ("bound", ResourceSource::Reference),
            ] {
                let mut resource = resource_ref(
                    origin,
                    "graphics/icon.png",
                    ResourceOwnerKind::Ship,
                    "ship",
                    key,
                );
                if origin == ResourceSource::Reference {
                    resource.reference = Some(existing.clone());
                }
                resources.insert(key.into(), resource);
            }
            let mut expected = serde_json::to_value(&resources).unwrap();
            if source == ResourceSource::Reference {
                expected["local"]["source"] = json!("reference");
                expected["local"]["reference"] = json!(identity);
            }
            apply_source_reference(&location, &mut resources);
            assert_eq!(serde_json::to_value(&resources).unwrap(), expected);
        }
    }

    #[test]
    fn media_key_ignores_presentation_owner() {
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
    #[cfg(windows)]
    fn windows_unicode_media_keys_keep_distinct_files() {
        for (a, b, same) in [
            ("İ", "i\u{307}", false),
            ("Ä", "ä", true),
            ("ß", "SS", false),
        ] {
            let resource = |name: &str| {
                resource_ref(
                    ResourceSource::Mod,
                    &format!("graphics/{name}.png"),
                    ResourceOwnerKind::Ship,
                    "ship",
                    "sprite",
                )
            };
            assert_eq!(
                media_resource_key(&resource(a)) == media_resource_key(&resource(b)),
                same
            );
        }
    }
}
