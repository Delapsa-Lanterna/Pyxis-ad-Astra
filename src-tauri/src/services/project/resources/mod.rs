pub(in crate::services) mod core_assets;
pub(in crate::services) mod fonts;
mod refs;
pub(in crate::services) mod sprites;

pub(super) use refs::{
    HullReferenceResolver, media_resource_key, resource_ref, sprite_resource_bytes,
    sprite_source_context,
};
