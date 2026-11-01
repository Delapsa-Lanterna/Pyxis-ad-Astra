use super::super::super::model::ProjectSession;
use crate::domain::variant_modules;
use crate::errors::AppResult;
use crate::io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file};
use crate::models::{EntityIdentityChange, EntityKind};
use std::path::Path;

pub(in crate::services::project) fn stage_variant_parents(
    session: &ProjectSession,
    builder: &mut FileChangeSetBuilder,
    json: &mut JsonWriteBatch,
    identity: &EntityIdentityChange,
) -> AppResult<()> {
    if identity.before.kind != EntityKind::Variant || identity.before.id == identity.after.id {
        return Ok(());
    }
    let boundary =
        FsRootBoundary::new(Path::new(&session.manifest.mod_root), "variant parent root")?;
    for parent in session.variant_files.iter() {
        if parent.variant_id == identity.before.id {
            continue;
        }
        let path = boundary.resolve_relative(&parent.rel_path, "variant parent")?;
        let mut content = read_json_file(&path)?;
        if variant_modules::rename_module_reference(
            &mut content,
            &identity.before.id,
            &identity.after.id,
        ) {
            let text = json.render(&path, &content, None)?;
            builder.text_file(&parent.rel_path, Some(text))?;
        }
    }
    Ok(())
}
