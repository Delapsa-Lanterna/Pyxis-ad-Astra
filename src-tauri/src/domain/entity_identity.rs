use crate::errors::{AppError, AppResult};
use std::path::{Component, Path};

pub fn validate_entity_id<'a>(id: &'a str, message: &str) -> AppResult<&'a str> {
    let clean = id.trim();
    if !is_entity_id(clean) {
        return Err(AppError::message("config.id_invalid", message));
    }
    Ok(clean)
}

pub fn validate_entity_file_rel_path(
    rel_path: &str,
    root_dir: &str,
    extension: &str,
    message: &str,
) -> AppResult<()> {
    let path = Path::new(rel_path);
    if path.is_absolute()
        || path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
        || path.extension().and_then(|value| value.to_str()) != Some(extension)
        || !path_starts_with_dir(path, root_dir)
    {
        return Err(AppError::message(
            "config.path_unsafe",
            format!("{message}: {rel_path}"),
        ));
    }
    Ok(())
}

fn path_starts_with_dir(path: &Path, root_dir: &str) -> bool {
    let mut path_components = path.components();
    for root_component in Path::new(root_dir).components() {
        if path_components.next() != Some(root_component) {
            return false;
        }
    }
    true
}

pub fn path_is_or_in_dir(path: &str, dir: &str) -> bool {
    path == dir || path.starts_with(&format!("{dir}/"))
}

pub fn path_affects_target(path: &str, target: &str) -> bool {
    path.is_empty() || path == target || target.starts_with(&format!("{path}/"))
}

fn is_entity_id(value: &str) -> bool {
    let mut chars = value.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    first.is_ascii_alphanumeric()
        && chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '_' || ch == '.' || ch == '-')
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_id_accepts_portable_ascii_identifier_segments() {
        assert_eq!(
            validate_entity_id(" demo_id-01.alpha ", "invalid").unwrap(),
            "demo_id-01.alpha"
        );
    }

    #[test]
    fn config_id_rejects_non_identifier_path_segments() {
        for id in [
            "", ".", "..", "a/b", "a\\b", "a b", "-demo", "_demo", "demo:bad",
        ] {
            assert!(validate_entity_id(id, "invalid").is_err(), "{id}");
        }
    }

    #[test]
    fn config_file_rel_path_requires_declared_root_and_extension() {
        validate_entity_file_rel_path(
            "data/variants/nested/demo.variant",
            "data/variants",
            "variant",
            "invalid",
        )
        .unwrap();

        for path in [
            "mod_info.json",
            "data/variants/../demo.variant",
            "data/variants/demo.skin",
            "/data/variants/demo.variant",
        ] {
            assert!(
                validate_entity_file_rel_path(path, "data/variants", "variant", "invalid").is_err(),
                "{path}"
            );
        }
    }
}
