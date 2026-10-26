use crate::{
    errors::AppError,
    models::{
        JointEditDraft, JointEditPrepared, JointEditQuery, JointEditReadResult, JointEditSnapshot,
        JointEditSubmission, WriteResult,
    },
    services,
};

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
#[command_macros::command(async)]
pub fn save_joint_edit(
    payload: JointEditSubmission,
) -> Result<WriteResult<JointEditSnapshot>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::save_joint_edit(&payload)?;
    transaction.commit(result, "联合保存")
}
