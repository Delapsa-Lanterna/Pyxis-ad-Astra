use crate::{
    errors::AppError,
    models::{CreateModPayload, CreatedMod},
    services,
};

#[command_macros::command(async)]
pub fn create_mod(payload: CreateModPayload) -> Result<CreatedMod, AppError> {
    services::mod_creation::create_mod(payload.destination, payload.template)
}
