mod cache;
mod definitions;
mod invalidation;
mod model;
mod performance;
#[cfg(test)]
mod performance_retained_tests;
pub(in crate::services) mod query;
pub(in crate::services) mod resources;
mod root;
mod session;
mod sources;
#[cfg(test)]
pub(crate) mod test_support;
mod versions;
pub(in crate::services) mod write;

pub(crate) use cache::media::configure_media_cache;
pub(crate) use performance::PerformanceTrace;
pub(crate) use session::open_project_session_traced;
pub(crate) use session::references::reference_updates;
pub(crate) use session::references::{
    reference_revision, reference_sources, reference_sources_changed, set_reference_sources,
};
pub(crate) use session::{affected_session_ids, current_projection, mark_projection_pending};
pub use session::{
    close_project_session, ensure_project_session_mod_root, hold_session_openings,
    invalidate_core_cache, invalidate_project_session, refresh_project_sources,
    registered_session_ids,
};
pub(crate) use sources::configure_persistent_index_cache;
pub(crate) use sources::core::core_dir;
pub(crate) use sources::resolve_core_root;
pub(crate) use sources::roots::{
    infer_starsector_root, is_game_root, is_mod_root, resolve_game_mods_directory,
};

pub(crate) use sources::json_documents::{build_skin_file, build_variant_file};
