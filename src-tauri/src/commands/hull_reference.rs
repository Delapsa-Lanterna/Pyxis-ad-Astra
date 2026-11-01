use crate::errors::AppError;
use crate::models::{HullReferencesPayload, HullReferencesResult};
use crate::services;

#[command_macros::command(async)]
pub fn query_hull_references(
    payload: HullReferencesPayload,
) -> Result<HullReferencesResult, AppError> {
    services::query_hull_references(&payload.session_id, &payload.reference_ids)
}
