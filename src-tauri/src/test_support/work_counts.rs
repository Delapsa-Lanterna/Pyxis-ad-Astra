#![cfg(test)]
#[cfg(windows)]
#[cfg(test)]
use crate::test_support;
#[cfg(windows)]
#[cfg(test)]
use crate::test_support::TestWorkspace;
use crate::{io, models};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
#[cfg(windows)]
#[cfg(test)]
use std::{fs, thread};

static COUNTS: LazyLock<Mutex<BTreeMap<(&'static str, String), usize>>> =
    LazyLock::new(Default::default);

pub(crate) fn record(operation: &'static str, path: &Path) {
    let key = resource_key(path);
    *COUNTS.lock().unwrap().entry((operation, key)).or_default() += 1;
}

pub(crate) fn count(operation: &'static str, path: &Path) -> usize {
    let key = resource_key(path);
    COUNTS
        .lock()
        .unwrap()
        .get(&(operation, key))
        .copied()
        .unwrap_or_default()
}

fn resource_key(path: &Path) -> String {
    // Disk aliases share physical identity; embedded assets retain their logical names.
    let path = if path.is_absolute() {
        io::canonical_path(path, "work counter").expect("counted resource has an existing parent")
    } else {
        path.to_path_buf()
    };
    models::windows_path_key(&path.to_string_lossy())
}

#[test]
#[cfg(windows)]
fn aliases_share_counts_across_calls_and_threads() {
    let root = TestWorkspace::new("work_counter_identity");
    let file = root.join("Long resource filename.json");
    fs::write(&file, "{}").unwrap();
    let long = file.canonicalize().unwrap();
    let short = test_support::short_path(&file);
    for (index, path) in [&long, &short].into_iter().enumerate() {
        io::read_versioned_json(path).unwrap();
        for alias in [&file, &long, &short] {
            assert_eq!(count("read", alias), index + 1);
            assert_eq!(count("parse", alias), index + 1);
        }
    }
    thread::scope(|scope| {
        let tasks = [&long, &short, &long, &short]
            .into_iter()
            .map(|path| scope.spawn(|| io::read_versioned_json(path).unwrap()))
            .collect::<Vec<_>>();
        for task in tasks {
            task.join().unwrap();
        }
    });
    for alias in [&file, &long, &short] {
        assert_eq!(count("read", alias), 6);
        assert_eq!(count("parse", alias), 6);
        assert_eq!(count("walk", alias), 0);
    }
    let product = root.join("future-product");
    let short_product = test_support::short_path(&root).join("future-product");
    record("core-product", &product);
    record("core-product", &short_product);
    assert_eq!(count("core-product", &product), 2);
    assert_eq!(count("core-product", &short_product), 2);
    fs::remove_file(&file).unwrap();
    assert_eq!(count("read", &file), 6);
    let embedded = Path::new("work-counter-embedded-fixture");
    record("asset-parse", embedded);
    assert_eq!(count("asset-parse", embedded), 1);
    root.close().unwrap();
}
