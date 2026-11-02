pub(in crate::services) mod core_assets;
pub(in crate::services) mod fonts;
mod refs;
pub(in crate::services) mod sprites;
pub(in crate::services::project) mod table_references;

pub(super) use refs::media_resource_key;
pub(super) use refs::{HullReferenceResolver, resource_ref};

pub(super) use sprites::SpriteReadBatch;
