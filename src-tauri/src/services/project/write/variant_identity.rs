use super::super::model::ProjectSession;
use crate::{
    errors::AppResult,
    io::{FileChangeSetBuilder, FsRootBoundary, JsonWriteBatch, read_json_file},
    models::{EntityIdentityChange, EntityKind},
};
use std::path::Path;

pub(super) fn stage_variant_parents(
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
    for parent in &session.variant_files {
        if parent.variant_id == identity.before.id {
            continue;
        }
        let path = boundary.resolve_relative(&parent.rel_path, "variant parent")?;
        let mut content = read_json_file(&path)?;
        if crate::domain::joint_hull::rename_module_reference(
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
