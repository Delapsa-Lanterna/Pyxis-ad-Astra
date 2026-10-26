use crate::{
    errors::AppError,
    models::{
        EntityData, EntityEditInfo, EntityIdentityIntent, EntityIdentityIntentPayload,
        QueryEntityListPayload, QueryEntityPayload,
    },
    services,
};

#[command_macros::command(async)]
pub fn query_entity(payload: QueryEntityPayload) -> Result<Option<EntityData>, AppError> {
    services::query_entity(&payload.session_id, payload.kind, &payload.id)
}

#[command_macros::command(async)]
pub fn query_entity_list(payload: QueryEntityListPayload) -> Result<Vec<EntityData>, AppError> {
    services::query_entity_list(&payload.session_id, payload.kind)
}

#[command_macros::command(async)]
pub fn query_entity_edit_target(payload: QueryEntityPayload) -> Result<EntityEditInfo, AppError> {
    services::query_entity_edit_target(&payload.session_id, payload.kind, &payload.id)
}

#[command_macros::command(async)]
pub fn query_entity_identity_intent(
    payload: EntityIdentityIntentPayload,
) -> Result<EntityIdentityIntent, AppError> {
    services::query_entity_identity_intent(&payload.session_id, &payload.source, &payload.next_id)
}
