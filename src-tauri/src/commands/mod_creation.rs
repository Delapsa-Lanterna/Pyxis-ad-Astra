use crate::errors::AppError;
use crate::models::{CreateModPayload, CreatedMod};
use crate::services::mod_creation;

#[command_macros::command(async)]
pub fn create_mod(payload: CreateModPayload) -> Result<CreatedMod, AppError> {
    mod_creation::create_mod(payload.destination, payload.template)
}
