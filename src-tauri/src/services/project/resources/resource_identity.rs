use crate::models;
use crate::models::{ResourceOwnerKind, ResourceRef, ResourceSource};
use crate::services::project::session::references::reference_revision;
use serde_json::json;

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

#[cfg(test)]
mod tests {
    use super::*;
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
