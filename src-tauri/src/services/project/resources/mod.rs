pub(in crate::services) mod core_assets;
pub(in crate::services::project) mod entity_references;
pub(in crate::services) mod fonts;
mod hull_references;
pub(in crate::services) mod media_cache;
pub(in crate::services::project) mod resource_identity;
pub(in crate::services) mod sprites;
pub(in crate::services::project) mod table_references;

pub(super) use hull_references::HullReferenceResolver;
pub(super) use resource_identity::{media_resource_key, resource_ref};
pub(super) use sprites::SpriteReadBatch;
