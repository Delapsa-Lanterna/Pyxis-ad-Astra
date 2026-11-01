use crate::errors::AppError;
use crate::models::{JsonRecoveryPlan, JsonRecoveryRequest};
use crate::services;

#[command_macros::command(async)]
pub fn prepare_json_source_recovery(
    payload: JsonRecoveryRequest,
) -> Result<JsonRecoveryPlan, AppError> {
    services::prepare_json_source_recovery(payload)
}
