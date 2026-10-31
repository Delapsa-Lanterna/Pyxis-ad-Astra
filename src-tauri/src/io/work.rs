#![cfg(test)]
use std::{
    collections::BTreeMap,
    path::Path,
    sync::{LazyLock, Mutex},
};

static COUNTS: LazyLock<Mutex<BTreeMap<(&'static str, String), usize>>> =
    LazyLock::new(Default::default);

pub(crate) fn record(operation: &'static str, path: &Path) {
    let key = crate::models::windows_path_key(&path.to_string_lossy());
    *COUNTS.lock().unwrap().entry((operation, key)).or_default() += 1;
}

pub(crate) fn count(operation: &'static str, path: &Path) -> usize {
    let key = crate::models::windows_path_key(&path.to_string_lossy());
    COUNTS
        .lock()
        .unwrap()
        .get(&(operation, key))
        .copied()
        .unwrap_or_default()
}
