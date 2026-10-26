use crate::{
    errors::AppError,
    models::{JsonRecoveryPlan, JsonRecoveryRequest, RecreateJsonSourcesPayload, WriteResult},
    services,
};

#[command_macros::command(async)]
pub fn prepare_json_source_recovery(
    payload: JsonRecoveryRequest,
) -> Result<JsonRecoveryPlan, AppError> {
    services::prepare_json_source_recovery(payload)
}

#[command_macros::command(async)]
pub fn recreate_json_sources(
    payload: RecreateJsonSourcesPayload,
) -> Result<WriteResult<JsonRecoveryPlan>, AppError> {
    let transaction = services::write_transactions::begin(&payload, &payload.plan.base_versions)?;
    if payload.session_id != payload.plan.request.session_id
        || payload.mod_root != payload.plan.request.mod_root
    {
        return Err(AppError::message(
            "json.recovery_scope_mismatch",
            "重建计划与项目不匹配",
        ));
    }
    let result = services::recreate_json_sources(payload.plan, payload.baseline)?;
    transaction.commit(result, "重新创建 JSON 来源")
}
