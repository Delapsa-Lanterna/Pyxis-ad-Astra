use crate::errors::AppResult;
use crate::models::DiscoveredField;
use crate::services::app_settings;
use crate::services::project::session::{lock_ready_session, session_handle};
use crate::services::project::sources;
use crate::services::project::sources::core;
use std::collections::BTreeMap;

pub(crate) fn query_core_root(
    session_id: Option<&str>,
    game_root: Option<&str>,
) -> AppResult<Option<String>> {
    if let Some(id) = session_id {
        let handle = session_handle(id)?;
        return Ok(lock_ready_session(&handle)?
            .manifest
            .starsector_root
            .clone());
    }
    sources::resolve_core_root(app_settings::starsector_root()?.as_deref(), game_root, None)
        .map(|root| root.map(|root| root.to_string_lossy().into_owned()))
}

pub(crate) fn scan_core_fields(
    starsector_root: &str,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    core::load_core_fields(starsector_root)
}

pub(crate) fn scan_core_graphics(starsector_root: &str) -> AppResult<Vec<String>> {
    core::load_core_graphics(starsector_root)
}
