use crate::{
    errors::AppError,
    models::{JsonRecoveryPlan, JsonRecoveryRequest},
    services,
};

#[command_macros::command(async)]
pub fn prepare_json_source_recovery(
    payload: JsonRecoveryRequest,
) -> Result<JsonRecoveryPlan, AppError> {
    services::prepare_json_source_recovery(payload)
}
