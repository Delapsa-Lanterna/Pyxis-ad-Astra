use crate::{
    errors::AppError,
    models::{
        JointEditDraft, JointEditPrepared, JointEditQuery, JointEditSnapshot, JointEditSubmission,
        WriteResult,
    },
    services,
};

#[tauri::command(async)]
pub fn query_joint_edit(payload: JointEditQuery) -> Result<JointEditSnapshot, AppError> {
    services::project::query_joint_edit_request(&payload)
}
#[tauri::command(async)]
pub fn prepare_joint_edit(payload: JointEditDraft) -> Result<JointEditPrepared, AppError> {
    services::project::prepare_joint_edit(&payload)
}
#[tauri::command(async)]
pub fn save_joint_edit(
    payload: JointEditSubmission,
) -> Result<WriteResult<JointEditSnapshot>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.base_versions)?;
    let result = services::project::save_joint_edit(&payload)?;
    transaction.commit(result, "联合保存")
}
