use crate::domain::save_edits;
use crate::errors::AppResult;
use crate::io;
use crate::models::{
    EntityIdentityChange, EntityKind, JsonFileDelete, JsonFileSave, SaveEdit, WriteResult,
};
use crate::services;
use serde_json::Value as JsonValue;
use std::path::Path;
use std::sync::Arc;

pub fn write_variant_request(input: JsonFileSave) -> AppResult<WriteResult<JsonValue>> {
    services::save_file_entity(input, EntityKind::Variant)
}
pub fn prepare_file_save(
    input: &mut JsonFileSave,
    edits: &[SaveEdit],
    identities: &[EntityIdentityChange],
    kind: EntityKind,
) -> AppResult<()> {
    for identity in identities {
        if identity.before.kind == kind && input.previous_id.as_deref() == Some(&identity.before.id)
        {
            if input.next_id == identity.before.id {
                input.next_id = identity.after.id.clone();
            }
            input.previous_id = Some(identity.after.id.clone());
            input.rel_path = Some(identity.after.write.rel_path.clone());
        }
    }
    let snapshot = services::query_entity_edit_target(
        &input.session_id,
        kind,
        input.previous_id.as_deref().unwrap_or(&input.next_id),
    )?;
    if !edits.is_empty() && Path::new(&snapshot.target.write.path).is_file() {
        let source = Arc::new(io::read_json_file(Path::new(&snapshot.target.write.path))?);
        input.document = save_edits::prepare_json_write(source, edits, input.document.layout)?;
    }
    input.base_versions = snapshot.base_versions;
    Ok(())
}
pub fn write_skin_request(input: JsonFileSave) -> AppResult<WriteResult<JsonValue>> {
    services::save_file_entity(input, EntityKind::Skin)
}
pub fn create_entity_request(
    input: JsonFileSave,
    kind: EntityKind,
) -> AppResult<WriteResult<JsonValue>> {
    services::create_json_entity_file(input, kind)
}
pub fn delete_entity_request(input: JsonFileDelete, kind: EntityKind) -> AppResult<WriteResult> {
    services::delete_json_entity_file(input, kind)
}
