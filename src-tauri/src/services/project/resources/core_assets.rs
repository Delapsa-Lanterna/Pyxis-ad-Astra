use crate::{errors::AppResult, models::DiscoveredField};
use std::collections::BTreeMap;

pub(crate) fn query_core_root(
    session_id: Option<&str>,
    game_root: Option<&str>,
) -> AppResult<Option<String>> {
    if let Some(id) = session_id {
        let handle = super::super::cache::session_handle(id)?;
        return Ok(super::super::cache::lock_ready_session(&handle)?
            .manifest
            .starsector_root
            .clone());
    }
    super::super::sources::resolve_core_root(
        crate::services::app_settings::starsector_root()?.as_deref(),
        game_root,
        None,
    )
    .map(|root| root.map(|root| root.to_string_lossy().into_owned()))
}

pub(crate) fn scan_core_fields(
    starsector_root: &str,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    super::super::sources::core::load_core_fields(starsector_root)
}

pub(crate) fn scan_core_graphics(starsector_root: &str) -> AppResult<Vec<String>> {
    super::super::sources::core::load_core_graphics(starsector_root)
}
