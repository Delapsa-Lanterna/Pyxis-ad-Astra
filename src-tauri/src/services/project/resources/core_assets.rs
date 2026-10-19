use crate::{errors::AppResult, models::DiscoveredField};
use std::collections::BTreeMap;

pub(crate) fn scan_core_fields(
    starsector_root: &str,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    super::super::sources::core::load_core_fields(starsector_root)
}

pub(crate) fn scan_core_graphics(starsector_root: &str) -> AppResult<Vec<String>> {
    super::super::sources::core::load_core_graphics(starsector_root)
}
