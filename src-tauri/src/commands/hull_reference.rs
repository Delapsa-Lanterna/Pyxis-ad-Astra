use crate::{
    errors::AppError,
    models::{HullReferencesPayload, HullReferencesResult},
    services,
};

#[command_macros::command(async)]
pub fn query_hull_references(
    payload: HullReferencesPayload,
) -> Result<HullReferencesResult, AppError> {
    services::query_hull_references(&payload.session_id, &payload.reference_ids)
}
