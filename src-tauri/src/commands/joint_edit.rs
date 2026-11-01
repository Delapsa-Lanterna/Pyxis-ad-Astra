use crate::errors::AppError;
use crate::models::{JointEditDraft, JointEditPrepared, JointEditQuery, JointEditReadResult};
use crate::services;

#[command_macros::command(async)]
pub fn query_joint_edit(payload: JointEditQuery) -> Result<JointEditReadResult, AppError> {
    match payload.catalog {
        Some(kind) => services::query_variant_catalog(&payload.root, kind, payload.catalog_source)
            .map(JointEditReadResult::Catalog),
        None => services::query_joint_edit_request(&payload)
            .map(|value| JointEditReadResult::Snapshot(Box::new(value))),
    }
}
#[command_macros::command(async)]
pub fn prepare_joint_edit(payload: JointEditDraft) -> Result<JointEditPrepared, AppError> {
    services::prepare_joint_edit(&payload)
}
