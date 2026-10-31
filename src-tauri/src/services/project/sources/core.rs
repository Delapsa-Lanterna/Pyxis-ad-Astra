use super::documents::LoadedSpecRecord;
use crate::{
    errors::{AppError, AppResult},
    io::{FsRootBoundary, forward_slash_relative_path, validate_walk_entry},
    models::{
        CsvTable, DiscoveredField, DiscoveredFieldType, EntityFileLocation, ResourceSource,
        SkinFile, VariantFile,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, LazyLock, Mutex, MutexGuard},
};

#[derive(Clone, Copy)]
pub(in crate::services::project) struct CoreSourceRequirements {
    pub ships: bool,
    pub weapons: bool,
    pub variants: bool,
}

#[derive(Clone, Serialize, Deserialize)]
struct CoreCache {
    pub csv_tables: BTreeMap<String, Arc<CsvTable>>,
    pub fields: Option<Arc<BTreeMap<String, Vec<DiscoveredField>>>>,
    pub graphics: Option<Arc<Vec<String>>>,
    pub ship_files: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
    pub variant_files: Option<Arc<Vec<VariantFile>>>,
    pub skin_files: Option<Arc<Vec<SkinFile>>>,
    pub weapon_specs: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
    pub projectile_specs: Option<Arc<BTreeMap<String, LoadedSpecRecord>>>,
}

impl CoreCache {
    fn empty() -> Self {
        Self {
            csv_tables: BTreeMap::new(),
            fields: None,
            graphics: None,
            ship_files: None,
            variant_files: None,
            skin_files: None,
            weapon_specs: None,
            projectile_specs: None,
        }
    }
}

#[derive(Clone, Default)]
pub(in crate::services::project) struct CoreSourceData {
    pub ship_files: Arc<BTreeMap<String, LoadedSpecRecord>>,
    pub variant_files: Arc<Vec<VariantFile>>,
    pub weapon_specs: Arc<BTreeMap<String, LoadedSpecRecord>>,
}
use super::{
    documents::load_spec_records_from,
    json_documents::{load_skin_files_from, load_variant_files_from},
};

struct CoreCacheEntry {
    data: CoreCache,
    dirty: bool,
    sources: super::super::sources::SourceReader,
}

static CORE_CACHES: LazyLock<Mutex<BTreeMap<String, Arc<Mutex<CoreCacheEntry>>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));
static CORE_FLIGHTS: LazyLock<Mutex<BTreeMap<String, Arc<CoreFlight>>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

#[cfg(test)]
pub(in crate::services::project) fn release_test_roots(root: &Path) -> Vec<String> {
    let mut errors = Vec::new();
    let root = crate::models::windows_path_key(&root.to_string_lossy());
    match CORE_CACHES.lock() {
        Ok(mut caches) => caches.retain(|path, _| {
            !Path::new(&crate::models::windows_path_key(path)).starts_with(&root)
        }),
        Err(error) => errors.push(format!("release test Core cache {root}: {error}")),
    }
    match CORE_FLIGHTS.lock() {
        Ok(flights) => {
            for path in flights
                .keys()
                .filter(|path| Path::new(&crate::models::windows_path_key(path)).starts_with(&root))
            {
                errors.push(format!("unfinished Core read: {path}"));
            }
        }
        Err(error) => errors.push(format!("inspect test Core reads {root}: {error}")),
    }
    errors
}

struct CoreFlight {
    product: &'static str,
    result: Mutex<Option<Result<(), SharedCoreError>>>,
    ready: Condvar,
}

#[derive(Clone)]
struct SharedCoreError {
    code: &'static str,
    message: String,
    location: Option<crate::errors::ErrorLocation>,
}

impl SharedCoreError {
    fn from_error(error: &AppError) -> Self {
        Self {
            code: error.code(),
            message: error.to_string(),
            location: error.location().cloned(),
        }
    }

    fn into_error(self) -> AppError {
        let base = AppError::message(self.code, self.message);
        match self.location {
            Some(location) => AppError::Located {
                location,
                source: Box::new(base),
            },
            None => base,
        }
    }
}

/// Lock the core-cache registry; poison maps to the shared AppError form.
fn lock_core_caches() -> AppResult<MutexGuard<'static, BTreeMap<String, Arc<Mutex<CoreCacheEntry>>>>>
{
    CORE_CACHES
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core cache lock poisoned"))
}

pub(in crate::services::project) fn invalidate_core_cache(starsector_root: &str) -> AppResult<()> {
    let cache_key = core_cache_key(starsector_root)?;
    // Persist what was built in memory before dropping, so the next open
    // reuses it (the content fingerprint still guards against stale sources).
    if let Err(error) = flush_core_cache(starsector_root) {
        crate::diagnostics::record(format!("core cache flush failed: {error}"));
    }
    lock_core_caches()?.remove(&cache_key);
    Ok(())
}

/// Persists the in-memory core cache once, and only when something loaded
/// since the last flush; a save failure is recorded and never propagated.
pub(crate) fn flush_core_cache(starsector_root: &str) -> AppResult<()> {
    let cache_key = core_cache_key(starsector_root)?;
    let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() else {
        return Ok(());
    };
    let mut entry = lock_core_cache(&cache)?;
    if entry.dirty {
        entry.sources.flush();
        entry.dirty = false;
    }
    Ok(())
}

fn core_cache_handle(starsector_root: &str) -> AppResult<Arc<Mutex<CoreCacheEntry>>> {
    let cache_key = core_cache_key(starsector_root)?;
    let flight_key = format!("root:{cache_key}");
    loop {
        if let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() {
            return Ok(cache);
        }
        let (flight, leader) = begin_core_flight(flight_key.clone(), "root")?;
        if !leader {
            wait_core_flight(&flight)?;
            continue;
        }
        let result = (|| {
            if let Some(cache) = lock_core_caches()?.get(&cache_key).cloned() {
                return Ok(cache);
            }
            #[cfg(test)]
            crate::io::work::record("core-create", Path::new(starsector_root));
            let cache = Arc::new(Mutex::new(CoreCacheEntry {
                data: CoreCache::empty(),
                dirty: false,
                sources: super::super::sources::SourceReader::new(&core_dir(starsector_root)?)?,
            }));
            lock_core_caches()?.insert(cache_key.clone(), cache.clone());
            Ok(cache)
        })();
        finish_core_flight(
            &flight_key,
            &flight,
            result
                .as_ref()
                .map(|_| ())
                .map_err(SharedCoreError::from_error),
        );
        return result;
    }
}

fn lock_core_cache(handle: &Mutex<CoreCacheEntry>) -> AppResult<MutexGuard<'_, CoreCacheEntry>> {
    handle
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core cache lock poisoned"))
}

pub(in crate::services::project) fn read_core_json_layer(
    game: &str,
    relative: &str,
) -> AppResult<Option<crate::models::JsonSourceLayer>> {
    let handle = core_cache_handle(game)?;
    let mut entry = lock_core_cache(&handle)?;
    let path = entry.sources.path(relative)?;
    if !path.is_file() {
        return Ok(None);
    }
    let data = entry.sources.json(&path)?;
    Ok(Some(crate::models::JsonSourceLayer {
        source: EntityFileLocation {
            reference: None,
            source: ResourceSource::Core,
            root: core_dir(game)?.to_string_lossy().into(),
            rel_path: relative.into(),
            path: path.to_string_lossy().into(),
        },
        version: entry.sources.versions[relative].clone(),
        data,
        replace: false,
    }))
}

fn begin_core_flight(key: String, product: &'static str) -> AppResult<(Arc<CoreFlight>, bool)> {
    let mut flights = CORE_FLIGHTS
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core flight lock poisoned"))?;
    if let Some(flight) = flights.get(&key) {
        return Ok((flight.clone(), false));
    }
    let flight = Arc::new(CoreFlight {
        product,
        result: Mutex::new(None),
        ready: Condvar::new(),
    });
    flights.insert(key, flight.clone());
    Ok((flight, true))
}

fn finish_core_flight(key: &str, flight: &Arc<CoreFlight>, result: Result<(), SharedCoreError>) {
    if let Ok(mut state) = flight.result.lock() {
        *state = Some(result);
        flight.ready.notify_all();
    }
    if let Ok(mut flights) = CORE_FLIGHTS.lock()
        && flights
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, flight))
    {
        flights.remove(key);
    }
}

fn wait_core_flight(flight: &Arc<CoreFlight>) -> AppResult<()> {
    let mut state = flight
        .result
        .lock()
        .map_err(|_| AppError::message("cache.lock_poisoned", "core flight result poisoned"))?;
    while state.is_none() {
        state = flight
            .ready
            .wait(state)
            .map_err(|_| AppError::message("cache.lock_poisoned", "core flight wait poisoned"))?;
    }
    match state.as_ref().expect("completed core flight") {
        Ok(()) => Ok(()),
        Err(error) => Err(error.clone().into_error()),
    }
}

/// Hit path clones the `Arc` (no deep copy); a miss loads the asset from disk,
/// stores an `Arc` into the in-memory cache and marks it dirty for the next
/// flush. Persistence never happens inside a query.
fn get_or_load_core<T, G, S, L>(
    starsector_root: &str,
    product: &'static str,
    get: G,
    store: S,
    load: L,
) -> AppResult<Arc<T>>
where
    G: Fn(&CoreCache) -> Option<&Arc<T>>,
    S: Fn(&mut CoreCache, Arc<T>),
    L: FnOnce(&mut super::super::sources::SourceReader) -> AppResult<T>,
{
    let cache = core_cache_handle(starsector_root)?;
    let mut load = Some(load);
    // Source products hand off parsed files before the next product forks them.
    let lane = match product {
        "fields" | "ships" | "weapons" | "projectiles" | "variants" | "skins" | "csv" => "sources",
        _ => product,
    };
    let flight_key = format!("{:p}:{lane}", Arc::as_ptr(&cache));
    loop {
        if let Some(value) = get(&lock_core_cache(&cache)?.data) {
            return Ok(value.clone());
        }
        let (flight, leader) = begin_core_flight(flight_key.clone(), product)?;
        if !leader {
            let result = wait_core_flight(&flight);
            if flight.product == product {
                result?;
            }
            continue;
        }
        let result = (|| {
            if let Some(value) = get(&lock_core_cache(&cache)?.data) {
                return Ok(value.clone());
            }
            let mut sources = lock_core_cache(&cache)?.sources.fork_loaded();
            #[cfg(test)]
            crate::io::work::record("core-product", &Path::new(starsector_root).join(product));
            let value = Arc::new(load.take().expect("core loader")(&mut sources)?);
            let mut entry = lock_core_cache(&cache)?;
            store(&mut entry.data, value.clone());
            entry.sources.absorb(sources);
            entry.dirty = true;
            Ok(value)
        })();
        match &result {
            Ok(_) => finish_core_flight(&flight_key, &flight, Ok(())),
            Err(error) => finish_core_flight(
                &flight_key,
                &flight,
                Err(SharedCoreError::from_error(error)),
            ),
        }
        return result;
    }
}

fn core_cache_key(starsector_root: &str) -> AppResult<String> {
    let root = FsRootBoundary::new(Path::new(starsector_root), "starsector root")?;
    Ok(root
        .root()
        .to_string_lossy()
        .replace('\\', "/")
        .to_ascii_lowercase())
}

pub(crate) fn core_dir(starsector_root: &str) -> AppResult<PathBuf> {
    let root = FsRootBoundary::new(Path::new(starsector_root), "starsector root")?;
    Ok(root.root().join("starsector-core"))
}

pub(crate) fn load_core_fields(
    starsector_root: &str,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    get_or_load_core(
        starsector_root,
        "fields",
        |cache| cache.fields.as_ref(),
        |cache, fields| cache.fields = Some(fields),
        load_core_fields_from,
    )
    .map(|fields| (*fields).clone())
}

fn load_core_fields_from(
    sources: &mut super::super::sources::SourceReader,
) -> AppResult<BTreeMap<String, Vec<DiscoveredField>>> {
    let mut result = BTreeMap::new();
    for (key, directory, extension) in [
        ("faction", "data/world/factions", "faction"),
        ("ship", "data/hulls", "ship"),
        ("weapon", "data/weapons", "wpn"),
    ] {
        let mut fields = BTreeMap::<String, DiscoveredFieldType>::new();
        for (path, value) in sources.walk(directory, extension)? {
            let Value::Object(object) = value else {
                return Err(AppError::message(
                    "schema.field_source_not_object",
                    format!(
                        "core field source must be a JSON object: {}",
                        path.display()
                    ),
                ));
            };
            for (field, value) in &object {
                fields
                    .entry(field.clone())
                    .or_insert_with(|| infer_core_field_type(value));
            }
        }
        if !fields.is_empty() {
            result.insert(
                key.to_string(),
                fields
                    .into_iter()
                    .map(|(key, field_type)| DiscoveredField {
                        key,
                        field_type,
                        origin: ResourceSource::Core,
                    })
                    .collect(),
            );
        }
    }
    Ok(result)
}

fn infer_core_field_type(value: &Value) -> DiscoveredFieldType {
    match value {
        Value::Bool(_) => DiscoveredFieldType::Boolean,
        Value::Number(number) => {
            if number.is_i64() || number.is_u64() {
                DiscoveredFieldType::Integer
            } else {
                DiscoveredFieldType::Float
            }
        }
        Value::String(value) => {
            if value.starts_with("graphics/") {
                DiscoveredFieldType::PathImage
            } else {
                DiscoveredFieldType::String
            }
        }
        Value::Array(values) => {
            if values.is_empty() {
                return DiscoveredFieldType::StringArray;
            }
            if (values.len() == 3 || values.len() == 4)
                && values.iter().all(|value| value.is_i64() || value.is_u64())
                && values.iter().all(|value| {
                    value
                        .as_i64()
                        .is_some_and(|number| (0..=255).contains(&number))
                })
            {
                return DiscoveredFieldType::ColorRgba;
            }
            if values.iter().all(Value::is_string) {
                DiscoveredFieldType::StringArray
            } else if values.iter().all(Value::is_object) {
                DiscoveredFieldType::ArrayOfObject
            } else {
                DiscoveredFieldType::StringArray
            }
        }
        Value::Object(object) => {
            if object.get("tags").is_some_and(Value::is_array) {
                DiscoveredFieldType::TagSelect
            } else {
                DiscoveredFieldType::Object
            }
        }
        Value::Null => DiscoveredFieldType::String,
    }
}

pub(crate) fn load_core_graphics(starsector_root: &str) -> AppResult<Vec<String>> {
    get_or_load_core(
        starsector_root,
        "graphics",
        |cache| cache.graphics.as_ref(),
        |cache, graphics| cache.graphics = Some(graphics),
        load_core_graphics_from,
    )
    .map(|graphics| (*graphics).clone())
}

fn load_core_graphics_from(
    sources: &mut super::super::sources::SourceReader,
) -> AppResult<Vec<String>> {
    let dir = sources.path("graphics")?;
    if !dir.exists() {
        return Ok(vec![]);
    }
    let mut paths = Vec::new();
    for entry in walkdir::WalkDir::new(&dir) {
        let entry = entry.map_err(|error| {
            AppError::message("io.walk_failed", format!("遍历原版图片目录失败: {error}"))
        })?;
        validate_walk_entry(entry.path(), "core graphics")?;
        if !entry.file_type().is_file() {
            continue;
        }
        if !matches!(
            entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str()),
            Some("png" | "jpg" | "jpeg" | "gif")
        ) {
            continue;
        }
        paths.push(entry.into_path());
    }
    paths.sort();
    Ok(paths
        .iter()
        .map(|path| forward_slash_relative_path(sources.root(), path))
        .collect())
}

pub(crate) fn load_core_csv_table(
    starsector_root: &str,
    relative_path: &str,
) -> AppResult<Option<Arc<CsvTable>>> {
    let core_dir = core_dir(starsector_root)?;
    if !core_dir.exists() {
        return Ok(None);
    }
    get_or_load_core(
        starsector_root,
        "csv",
        |cache| cache.csv_tables.get(relative_path),
        |cache, csv| {
            cache.csv_tables.insert(relative_path.to_string(), csv);
        },
        |sources| sources.csv(&sources.path(relative_path)?),
    )
    .map(Some)
}

pub(crate) fn load_core_ship_files(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        "ships",
        |cache| cache.ship_files.as_ref(),
        |cache, files| cache.ship_files = Some(files),
        |sources| {
            load_spec_records_from(
                sources,
                "data/hulls",
                "ship",
                "hullId",
                ResourceSource::Core,
            )
        },
    )
}

pub(crate) fn load_core_weapon_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        "weapons",
        |cache| cache.weapon_specs.as_ref(),
        |cache, specs| cache.weapon_specs = Some(specs),
        |sources| {
            load_spec_records_from(sources, "data/weapons", "wpn", "id", ResourceSource::Core)
        },
    )
}

pub(crate) fn load_core_projectile_specs(
    starsector_root: &str,
) -> AppResult<Arc<BTreeMap<String, LoadedSpecRecord>>> {
    get_or_load_core(
        starsector_root,
        "projectiles",
        |cache| cache.projectile_specs.as_ref(),
        |cache, specs| cache.projectile_specs = Some(specs),
        |sources| {
            load_spec_records_from(
                sources,
                "data/weapons/proj",
                "proj",
                "id",
                ResourceSource::Core,
            )
        },
    )
}

pub(crate) fn load_core_variant_files(starsector_root: &str) -> AppResult<Arc<Vec<VariantFile>>> {
    get_or_load_core(
        starsector_root,
        "variants",
        |cache| cache.variant_files.as_ref(),
        |cache, files| cache.variant_files = Some(files),
        |sources| Ok(load_variant_files_from(sources)?.0),
    )
}

pub(crate) fn load_core_skin_files(starsector_root: &str) -> AppResult<Arc<Vec<SkinFile>>> {
    get_or_load_core(
        starsector_root,
        "skins",
        |cache| cache.skin_files.as_ref(),
        |cache, files| cache.skin_files = Some(files),
        |sources| Ok(load_skin_files_from(sources)?.0),
    )
}

pub(crate) fn load_core_source_data(
    starsector_root: &str,
    requirements: CoreSourceRequirements,
) -> AppResult<CoreSourceData> {
    let mut data = CoreSourceData::default();
    if requirements.ships {
        data.ship_files = load_core_ship_files(starsector_root)?;
    }
    if requirements.weapons {
        data.weapon_specs = load_core_weapon_specs(starsector_root)?;
    }
    if requirements.variants {
        data.variant_files = load_core_variant_files(starsector_root)?;
    }
    Ok(data)
}

pub(in crate::services::project) fn invalidate_core_sources(
    root: &str,
    sources: &[crate::models::InvalidatedResourceScope],
) -> AppResult<()> {
    if !sources
        .iter()
        .any(|source| source.source == ResourceSource::Core)
    {
        return Ok(());
    }
    let key = core_cache_key(root)?;
    let Some(handle) = lock_core_caches()?.get(&key).cloned() else {
        return Ok(());
    };
    let mut data = lock_core_cache(&handle)?.data.clone();
    for source in sources
        .iter()
        .filter(|source| source.source == ResourceSource::Core)
    {
        let matches = |path: &str| {
            crate::io::relative_path_contains(&source.rel_path, path)
                || crate::io::relative_path_contains(path, &source.rel_path)
        };
        data.csv_tables
            .retain(|relative_path, _| !matches(relative_path));
        if matches("data/world/factions") || matches("data/hulls") || matches("data/weapons") {
            data.fields = None;
        }
        if matches("graphics") {
            data.graphics = None;
        }
        if matches("data/hulls") {
            data.ship_files = None;
        }
        if matches("data/variants") {
            data.variant_files = None;
        }
        if matches("data/hulls/skins") {
            data.skin_files = None;
        }
        if matches("data/weapons") {
            data.weapon_specs = None;
        }
        if matches("data/weapons/proj") {
            data.projectile_specs = None;
        }
    }
    lock_core_caches()?.insert(
        key,
        Arc::new(Mutex::new(CoreCacheEntry {
            data,
            dirty: true,
            sources: super::super::sources::SourceReader::new(&core_dir(root)?)?,
        })),
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use std::{
        fs,
        sync::{
            Arc, Barrier,
            atomic::{AtomicUsize, Ordering},
        },
        thread,
        time::Duration,
    };

    fn read_product(root: &str, product: &str) -> AppResult<()> {
        match product {
            "fields" => load_core_fields(root).map(|_| ()),
            "graphics" => load_core_graphics(root).map(|_| ()),
            "ships" => load_core_ship_files(root).map(|_| ()),
            "weapons" => load_core_weapon_specs(root).map(|_| ()),
            "projectiles" => load_core_projectile_specs(root).map(|_| ()),
            "variants" => load_core_variant_files(root).map(|_| ()),
            "skins" => load_core_skin_files(root).map(|_| ()),
            "csv" => load_core_csv_table(root, "data/hulls/ship_data.csv").map(|_| ()),
            _ => unreachable!(),
        }
    }

    #[test]
    fn real_core_products_construct_and_load_once_per_root_lifetime() {
        for product in [
            "fields",
            "graphics",
            "ships",
            "weapons",
            "projectiles",
            "variants",
            "skins",
            "csv",
        ] {
            let root = project_workspace(&format!("core_product_work_{product}"));
            for (relative, content) in [
                ("data/hulls/sample.ship", r#"{"hullId":"sample"}"#),
                ("data/weapons/sample.wpn", r#"{"id":"sample"}"#),
                ("data/weapons/proj/sample.proj", r#"{"id":"sample"}"#),
                (
                    "data/variants/sample.variant",
                    r#"{"variantId":"sample","hullId":"sample"}"#,
                ),
                (
                    "data/hulls/skins/sample.skin",
                    r#"{"skinHullId":"sample","baseHullId":"sample"}"#,
                ),
                ("data/hulls/ship_data.csv", "id,name\nsample,Sample\n"),
                ("graphics/sample.png", "image"),
            ] {
                let path = root.join("starsector-core").join(relative);
                fs::create_dir_all(path.parent().unwrap()).unwrap();
                fs::write(path, content).unwrap();
            }
            let barrier = Arc::new(Barrier::new(8));
            let text = root.to_string_lossy().to_string();
            let workers: Vec<_> = (0..8)
                .map(|_| {
                    let root = text.clone();
                    let barrier = barrier.clone();
                    thread::spawn(move || {
                        barrier.wait();
                        read_product(&root, product).unwrap();
                    })
                })
                .collect();
            for worker in workers {
                worker.join().unwrap();
            }
            read_product(&text, product).unwrap();
            assert_eq!(crate::io::work::count("core-create", &root), 1, "{product}");
            assert_eq!(
                crate::io::work::count("core-product", &root.join(product)),
                1,
                "{product}"
            );
            if product == "ships" {
                load_core_fields(&text).unwrap();
                let path = root.join("starsector-core/data/hulls/sample.ship");
                assert_eq!(crate::io::work::count("read", &path), 1);
                assert_eq!(crate::io::work::count("parse", &path), 1);
            }
            invalidate_core_cache(&text).unwrap();
            read_product(&text, product).unwrap();
            read_product(&text, product).unwrap();
            assert_eq!(crate::io::work::count("core-create", &root), 2, "{product}");
            assert_eq!(
                crate::io::work::count("core-product", &root.join(product)),
                2,
                "{product}"
            );
            invalidate_core_cache(&text).unwrap();
            root.close().unwrap();
        }
    }

    #[test]
    fn concurrent_fields_and_ship_products_share_file_reads_and_parses() {
        let root = project_workspace("core_cross_product_work");
        let path = root.join("starsector-core/data/hulls/sample.ship");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, r#"{"hullId":"sample","width":20}"#).unwrap();
        let barrier = Barrier::new(2);
        thread::scope(|scope| {
            let fields = scope.spawn(|| {
                barrier.wait();
                load_core_fields(&root.to_string_lossy()).unwrap();
            });
            let ships = scope.spawn(|| {
                barrier.wait();
                load_core_ship_files(&root.to_string_lossy()).unwrap();
            });
            fields.join().unwrap();
            ships.join().unwrap();
        });
        assert_eq!(crate::io::work::count("read", &path), 1);
        assert_eq!(crate::io::work::count("parse", &path), 1);
        invalidate_core_cache(&root.to_string_lossy()).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn fields_and_graphics_are_cached_with_the_core_root() {
        let root = project_workspace("core_shared_products");
        let core = root.join("starsector-core");
        fs::create_dir_all(core.join("data/hulls")).unwrap();
        fs::create_dir_all(core.join("graphics/ships")).unwrap();
        fs::write(
            core.join("data/hulls/demo.ship"),
            r#"{"hullId":"demo","width":20,"spriteName":"graphics/ships/demo.png"}"#,
        )
        .unwrap();
        fs::write(core.join("graphics/ships/demo.png"), [1u8, 2, 3]).unwrap();

        let fields = load_core_fields(&root.to_string_lossy()).unwrap();
        let graphics = load_core_graphics(&root.to_string_lossy()).unwrap();
        let repeated_fields = load_core_fields(&root.to_string_lossy()).unwrap();
        let repeated_graphics = load_core_graphics(&root.to_string_lossy()).unwrap();
        let handle = core_cache_handle(&root.to_string_lossy()).unwrap();
        let cache = lock_core_cache(&handle).unwrap();

        assert!(fields.contains_key("ship"));
        assert_eq!(
            serde_json::to_string(&fields).unwrap(),
            serde_json::to_string(&repeated_fields).unwrap()
        );
        assert_eq!(graphics, vec!["graphics/ships/demo.png"]);
        assert_eq!(graphics, repeated_graphics);
        assert!(cache.data.fields.is_some());
        assert!(cache.data.graphics.is_some());
        drop(cache);
        invalidate_core_cache(&root.to_string_lossy()).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn refreshed_product_loads_before_the_old_flight_finishes() {
        let root = project_workspace("core_refresh_flight");
        fs::create_dir_all(root.join("starsector-core/graphics")).unwrap();
        let text = root.to_string_lossy().to_string();
        let worker_root = text.clone();
        let (started, ready) = std::sync::mpsc::channel();
        let (release, released) = std::sync::mpsc::channel();
        let old = thread::spawn(move || {
            get_or_load_core(
                &worker_root,
                "graphics",
                |cache| cache.graphics.as_ref(),
                |cache, value| cache.graphics = Some(value),
                |_| {
                    started.send(()).unwrap();
                    released.recv_timeout(Duration::from_secs(30)).unwrap();
                    Ok(vec!["graphics/old.png".to_string()])
                },
            )
            .unwrap()
        });
        let started_result = ready.recv_timeout(Duration::from_secs(30));
        if let Err(error) = started_result {
            drop(release);
            let worker_result = old.join();
            panic!("Core loader did not start: {error}; worker={worker_result:?}");
        }
        invalidate_core_sources(
            &text,
            &[crate::models::InvalidatedResourceScope {
                source: ResourceSource::Core,
                rel_path: "graphics".to_string(),
            }],
        )
        .unwrap();
        fs::write(root.join("starsector-core/graphics/new.png"), [1u8]).unwrap();
        let new_root = text.clone();
        let (completed, completion) = std::sync::mpsc::channel();
        let current = thread::spawn(move || {
            completed.send(load_core_graphics(&new_root)).unwrap();
        });
        let result = completion.recv_timeout(Duration::from_secs(5));
        release.send(()).unwrap();
        let old_result = old.join();
        let current_result = current.join();
        old_result.unwrap();
        current_result.unwrap();
        assert_eq!(result.unwrap().unwrap(), vec!["graphics/new.png"]);
        assert_eq!(load_core_graphics(&text).unwrap(), vec!["graphics/new.png"]);
        invalidate_core_cache(&text).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn concurrent_core_product_loads_share_one_loader() {
        let root = project_workspace("core_single_flight");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        let root_text = root.to_string_lossy().to_string();
        let barrier = Arc::new(Barrier::new(2));
        let loads = Arc::new(AtomicUsize::new(0));
        let worker = |root_text: String, barrier: Arc<Barrier>, loads: Arc<AtomicUsize>| {
            thread::spawn(move || {
                barrier.wait();
                get_or_load_core(
                    &root_text,
                    "single-flight-test",
                    |cache| cache.graphics.as_ref(),
                    |cache, graphics| cache.graphics = Some(graphics),
                    |_| {
                        loads.fetch_add(1, Ordering::Relaxed);
                        thread::sleep(Duration::from_millis(20));
                        Ok(vec!["graphics/demo.png".to_string()])
                    },
                )
            })
        };
        let first = worker(root_text.clone(), barrier.clone(), loads.clone());
        let second = worker(root_text.clone(), barrier, loads.clone());
        let first_result = first.join();
        let second_result = second.join();
        assert!(first_result.unwrap().is_ok());
        assert!(second_result.unwrap().is_ok());
        assert_eq!(loads.load(Ordering::Relaxed), 1);
        invalidate_core_cache(&root_text).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn core_catalogs_share_root_identity_and_reopen_independently() {
        let root = project_workspace("core_catalog_root_identity");
        let first_root = root.join("first");
        let second_root = root.join("second");
        for (game_root, id) in [(&first_root, "first"), (&second_root, "second")] {
            let hull_dir = game_root.join("starsector-core/data/hulls");
            fs::create_dir_all(&hull_dir).unwrap();
            fs::write(
                hull_dir.join("demo.ship"),
                format!(r#"{{"hullId":"{id}"}}"#),
            )
            .unwrap();
        }
        let first = load_core_ship_files(&first_root.to_string_lossy()).unwrap();
        let same = load_core_ship_files(&first_root.join(".").to_string_lossy()).unwrap();
        let second = load_core_ship_files(&second_root.to_string_lossy()).unwrap();
        assert!(Arc::ptr_eq(&first, &same));
        assert!(!Arc::ptr_eq(&first, &second));
        assert!(first.contains_key("first"));
        assert!(second.contains_key("second"));

        invalidate_core_cache(&first_root.to_string_lossy()).unwrap();
        let reopened = load_core_ship_files(&first_root.to_string_lossy()).unwrap();
        let unaffected = load_core_ship_files(&second_root.to_string_lossy()).unwrap();
        assert!(!Arc::ptr_eq(&first, &reopened));
        assert!(reopened.contains_key("first"));
        assert!(Arc::ptr_eq(&second, &unaffected));

        invalidate_core_cache(&first_root.to_string_lossy()).unwrap();
        invalidate_core_cache(&second_root.to_string_lossy()).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn source_invalidation_reloads_affected_catalog_and_preserves_other_types() {
        let root = project_workspace("core_catalog_source_invalidation");
        let hull_dir = root.join("starsector-core/data/hulls");
        let projectile_dir = root.join("starsector-core/data/weapons/proj");
        fs::create_dir_all(&hull_dir).unwrap();
        fs::create_dir_all(&projectile_dir).unwrap();
        let hull_path = hull_dir.join("demo.ship");
        fs::write(&hull_path, r#"{"hullId":"demo","spriteName":"before"}"#).unwrap();
        fs::write(projectile_dir.join("demo.proj"), r#"{"id":"demo"}"#).unwrap();
        let root_text = root.to_string_lossy();
        let ships = load_core_ship_files(&root_text).unwrap();
        let projectiles = load_core_projectile_specs(&root_text).unwrap();
        fs::write(&hull_path, r#"{"hullId":"demo","spriteName":"after"}"#).unwrap();

        invalidate_core_sources(
            &root_text,
            &[crate::models::InvalidatedResourceScope {
                source: ResourceSource::Core,
                rel_path: "data/hulls/demo.ship".to_string(),
            }],
        )
        .unwrap();
        let refreshed = load_core_ship_files(&root_text).unwrap();
        let unaffected = load_core_projectile_specs(&root_text).unwrap();
        assert!(!Arc::ptr_eq(&ships, &refreshed));
        assert_eq!(ships["demo"].data["spriteName"], "before");
        assert_eq!(refreshed["demo"].data["spriteName"], "after");
        assert!(Arc::ptr_eq(&projectiles, &unaffected));

        invalidate_core_cache(&root_text).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn overlapping_family_loads_preserve_each_loaded_catalog() {
        let root = project_workspace("core_overlapping_catalogs");
        let projectile_dir = root.join("starsector-core/data/weapons/proj");
        fs::create_dir_all(&projectile_dir).unwrap();
        fs::write(projectile_dir.join("demo.proj"), r#"{"id":"demo"}"#).unwrap();
        let root_text = root.to_string_lossy();
        let ships = get_or_load_core(
            &root_text,
            "test-ships",
            |cache| cache.ship_files.as_ref(),
            |cache, files| cache.ship_files = Some(files),
            |_| {
                load_core_projectile_specs(&root_text)?;
                Ok(BTreeMap::<String, LoadedSpecRecord>::new())
            },
        )
        .unwrap();
        let handle = core_cache_handle(&root_text).unwrap();
        {
            let snapshot = lock_core_cache(&handle).unwrap();
            assert!(
                snapshot
                    .data
                    .ship_files
                    .as_ref()
                    .is_some_and(|value| Arc::ptr_eq(value, &ships))
            );
            assert!(
                snapshot
                    .data
                    .projectile_specs
                    .as_ref()
                    .is_some_and(|value| value.contains_key("demo"))
            );
        }
        invalidate_core_cache(&root_text).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn released_catalog_does_not_publish_into_a_reopened_root() {
        let root = project_workspace("core_released_catalog");
        fs::create_dir_all(root.join("starsector-core")).unwrap();
        let root_text = root.to_string_lossy();
        get_or_load_core(
            &root_text,
            "test-ships",
            |cache| cache.ship_files.as_ref(),
            |cache, files| cache.ship_files = Some(files),
            |_| {
                invalidate_core_cache(&root_text)?;
                load_core_projectile_specs(&root_text)?;
                Ok(BTreeMap::<String, LoadedSpecRecord>::new())
            },
        )
        .unwrap();
        let handle = core_cache_handle(&root_text).unwrap();
        {
            let snapshot = lock_core_cache(&handle).unwrap();
            assert!(snapshot.data.ship_files.is_none());
            assert!(snapshot.data.projectile_specs.is_some());
        }
        invalidate_core_cache(&root_text).unwrap();
        root.close().unwrap();
    }

    #[test]
    fn core_cache_rejects_parent_dir_root() {
        let root = project_workspace("core_cache_parent_dir_root");
        let escaped = root.literal_path("..");

        let error = load_core_ship_files(&escaped.to_string_lossy())
            .unwrap_err()
            .to_string();

        assert!(error.contains("invalid starsector root path"));
        root.close().unwrap();
    }

    #[test]
    fn core_cache_key_normalizes_root_identity() {
        let root = project_workspace("core_cache_key");
        let left = core_cache_key(&root.to_string_lossy()).unwrap();
        let right = core_cache_key(&root.join(".").to_string_lossy()).unwrap();

        assert_eq!(left, right);
        root.close().unwrap();
    }

    #[test]
    fn persistent_core_cache_rejects_changed_source_content() {
        if crate::test_support::isolated_test() {
            return;
        }
        let root = project_workspace("persistent_core_cache");
        let hull_dir = root.join("starsector-core/data/hulls");
        fs::create_dir_all(&hull_dir).unwrap();
        crate::io::write_utf8_no_bom(
            &hull_dir.join("demo.ship"),
            r#"{"hullId":"demo","spriteName":"before"}"#,
        )
        .unwrap();
        super::super::super::sources::configure_persistent_index_cache(&root.outer().join("cache"))
            .unwrap();
        crate::io::write_utf8_no_bom(
            &hull_dir.join("ship_data.csv"),
            "name,id\n#disabled,demo\n\"#quoted\",demo\n #space,space\n",
        )
        .unwrap();

        let loaded = load_core_ship_files(&root.to_string_lossy()).unwrap();
        let table = load_core_csv_table(&root.to_string_lossy(), "data/hulls/ship_data.csv")
            .unwrap()
            .unwrap();
        assert_eq!(
            table
                .rows
                .iter()
                .map(|row| row.is_comment)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
        // Loads only dirty the in-memory cache; the flush (open/close path)
        // is what lands the build on disk.
        flush_core_cache(&root.to_string_lossy()).unwrap();
        invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let stored_table = load_core_csv_table(&root.to_string_lossy(), "data/hulls/ship_data.csv")
            .unwrap()
            .unwrap();
        assert_eq!(stored_table.rows[1].data["name"], "#quoted");
        assert!(!stored_table.rows[1].is_comment);
        invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let restored = load_core_csv_table(&root.to_string_lossy(), "data/hulls/ship_data.csv")
            .unwrap()
            .unwrap();
        assert_eq!(
            restored
                .rows
                .iter()
                .map(|row| row.is_comment)
                .collect::<Vec<_>>(),
            [true, false, false]
        );
        crate::io::write_utf8_no_bom(
            &hull_dir.join("demo.ship"),
            r#"{"hullId":"demo","spriteName":"after"}"#,
        )
        .unwrap();
        invalidate_core_cache(&root.to_string_lossy()).unwrap();
        let changed = load_core_ship_files(&root.to_string_lossy()).unwrap();

        assert_eq!(loaded["demo"].data["spriteName"], "before");
        assert_eq!(changed["demo"].data["spriteName"], "after");
        root.close().unwrap();
    }
}
