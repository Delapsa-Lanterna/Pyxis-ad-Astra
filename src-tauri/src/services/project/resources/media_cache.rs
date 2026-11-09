use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::models::{CacheLimits, CacheSize, windows_path_key};
use serde_json::json;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::SystemTime;

#[cfg(test)]
pub(in crate::services::project) fn media_capacity_for_test() -> usize {
    CacheLimits::default().backend_media.entries as usize
}

struct CachedSpriteMedia {
    resolved_path: PathBuf,
    modified: SystemTime,
    length: u64,
    data_url: String,
}

struct SpriteMediaCacheState {
    limits: CacheSize,
    entries: HashMap<(String, String), CachedSpriteMedia>,
    order: VecDeque<(String, String)>,
    bytes: usize,
}

impl SpriteMediaCacheState {
    fn configure(&mut self, limits: &CacheSize) {
        self.limits = limits.clone();
        self.trim();
    }

    fn touch(&mut self, key: &(String, String)) {
        self.order.retain(|entry| entry != key);
        self.order.push_back(key.clone());
    }

    fn remove(&mut self, key: &(String, String)) {
        if let Some(entry) = self.entries.remove(key) {
            self.bytes -= entry.data_url.len();
        }
        self.order.retain(|entry| entry != key);
    }

    fn insert(&mut self, key: (String, String), entry: CachedSpriteMedia) {
        self.remove(&key);
        self.bytes += entry.data_url.len();
        self.entries.insert(key.clone(), entry);
        self.touch(&key);
        self.trim();
    }

    fn trim(&mut self) {
        while self.entries.len() > self.limits.entries as usize
            || self.bytes > self.limits.mib as usize * 1024 * 1024
        {
            let Some(oldest) = self.order.front().cloned() else {
                break;
            };
            self.remove(&oldest);
            diagnostics::debug("cache.backend_evicted", || {
                format!(
                    "cache=media session={} resource={} remaining={} bytes={}",
                    oldest.0,
                    oldest.1,
                    self.entries.len(),
                    self.bytes
                )
            });
        }
    }
}

fn sprite_media_cache() -> &'static Mutex<SpriteMediaCacheState> {
    static CACHE: LazyLock<Mutex<SpriteMediaCacheState>> = LazyLock::new(|| {
        Mutex::new(SpriteMediaCacheState {
            limits: CacheLimits::default().backend_media,
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        })
    });
    &CACHE
}

pub(crate) fn configure_media_cache(limits: &CacheSize) -> AppResult<()> {
    let mut cache = sprite_media_cache()
        .lock()
        .map_err(|_| AppError::message("settings.lock_poisoned", "media cache lock poisoned"))?;
    cache.configure(limits);
    Ok(())
}

/// Returns the cached data URL and actual path while the underlying file is unchanged;
/// any stat or modification mismatch is a miss so edits show up immediately.
pub(in crate::services::project) fn lookup_data_url(
    session_id: &str,
    resource_key: &str,
) -> Option<(String, String)> {
    let mut cache = match sprite_media_cache().lock() {
        Ok(cache) => cache,
        Err(_) => {
            diagnostics::failure(
                "cache.media_lookup_failed",
                AppError::message("cache.lock_poisoned", "sprite media cache lock poisoned"),
                json!({"sessionId":session_id,"resource":resource_key}),
            );
            return None;
        }
    };
    let cache_key = (session_id.to_string(), resource_key.to_string());
    let entry = cache.entries.get(&cache_key)?;
    let current = fs::metadata(&entry.resolved_path)
        .ok()
        .is_some_and(|metadata| {
            metadata.modified().ok() == Some(entry.modified) && metadata.len() == entry.length
        });
    if !current {
        cache.remove(&cache_key);
        return None;
    }
    let data_url = entry.data_url.clone();
    let resolved_path = entry.resolved_path.to_string_lossy().into_owned();
    cache.touch(&cache_key);
    Some((data_url, resolved_path))
}

pub(in crate::services::project) fn insert_entry(
    session_id: &str,
    resource_key: &str,
    resolved_path: PathBuf,
    modified: SystemTime,
    length: u64,
    data_url: String,
) {
    let Ok(mut cache) = sprite_media_cache().lock() else {
        diagnostics::failure(
            "cache.media_insert_failed",
            AppError::message("cache.lock_poisoned", "sprite media cache lock poisoned"),
            json!({"sessionId":session_id,"resource":resource_key,"path":resolved_path}),
        );
        return;
    };
    let cache_key = (session_id.to_string(), resource_key.to_string());
    cache.insert(
        cache_key,
        CachedSpriteMedia {
            resolved_path,
            modified,
            length,
            data_url,
        },
    );
}

pub(crate) fn invalidate_source_media(root: &str, paths: &[String]) -> AppResult<()> {
    let scopes = paths
        .iter()
        .map(|path| windows_path_key(&Path::new(root).join(path).to_string_lossy()))
        .collect::<Vec<_>>();
    let mut cache = sprite_media_cache()
        .lock()
        .map_err(|_| AppError::message("resource.media_lock", "媒体缓存不可用"))?;
    let keys = cache
        .entries
        .iter()
        .filter(|(_, entry)| {
            let path = windows_path_key(&entry.resolved_path.to_string_lossy());
            scopes
                .iter()
                .any(|scope| Path::new(&path).starts_with(scope))
        })
        .map(|(key, _)| key.clone())
        .collect::<Vec<_>>();
    for key in keys {
        cache.remove(&key);
    }
    Ok(())
}
pub(crate) fn clear_session_media(session_id: &str) {
    let Ok(mut cache) = sprite_media_cache().lock() else {
        diagnostics::failure(
            "cache.media_release_failed",
            AppError::message("cache.lock_poisoned", "sprite media cache lock poisoned"),
            json!({"sessionId":session_id}),
        );
        return;
    };
    let keys = cache
        .entries
        .keys()
        .filter(|key| key.0 == session_id)
        .cloned()
        .collect::<Vec<_>>();
    for key in keys {
        cache.remove(&key);
    }
}

#[cfg(test)]
pub(in crate::services::project) fn cached_sprite_media_contains(
    session_id: &str,
    resource_key: &str,
) -> bool {
    let Ok(cache) = sprite_media_cache().lock() else {
        diagnostics::failure(
            "cache.media_lookup_failed",
            AppError::message("cache.lock_poisoned", "sprite media cache lock poisoned"),
            json!({"sessionId":session_id,"resource":resource_key}),
        );
        return false;
    };
    cache
        .entries
        .contains_key(&(session_id.to_string(), resource_key.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::CacheLimits;
    #[cfg(test)]
    use crate::models::CacheSize;

    #[test]
    fn zero_media_limits_keep_returned_content_outside_idle_cache() {
        let mut cache = state();
        cache.limits.entries = 0;
        cache.insert(key(0), entry(1));
        assert!(cache.entries.is_empty());
        cache.limits.entries = 1;
        cache.limits.mib = 0;
        cache.insert(key(0), entry(1));
        assert!(cache.entries.is_empty());
    }

    fn state() -> SpriteMediaCacheState {
        SpriteMediaCacheState {
            limits: CacheLimits::default().backend_media,
            entries: HashMap::new(),
            order: VecDeque::new(),
            bytes: 0,
        }
    }

    fn entry(bytes: usize) -> CachedSpriteMedia {
        CachedSpriteMedia {
            resolved_path: PathBuf::new(),
            modified: SystemTime::UNIX_EPOCH,
            length: bytes as u64,
            data_url: "a".repeat(bytes),
        }
    }

    fn key(index: usize) -> (String, String) {
        ("session".to_string(), index.to_string())
    }

    #[test]
    fn media_cache_access_and_replacement_update_lru_order() {
        let mut cache = state();
        let capacity = cache.limits.entries as usize;
        for index in 0..capacity {
            cache.insert(key(index), entry(1));
        }
        cache.touch(&key(0));
        cache.insert(key(capacity), entry(1));
        assert!(cache.entries.contains_key(&key(0)));
        assert!(!cache.entries.contains_key(&key(1)));
        cache.insert(key(2), entry(2));
        assert_eq!(cache.order.back(), Some(&key(2)));
        assert_eq!(cache.bytes, capacity + 1);
        let delivered = cache.entries[&key(2)].data_url.clone();
        cache.configure(&CacheSize { entries: 1, mib: 1 });
        assert_eq!(cache.entries.len(), 1);
        assert!(cache.entries.contains_key(&key(2)));
        cache.configure(&CacheSize { entries: 4, mib: 0 });
        assert_eq!(cache.bytes, 0);
        assert!(cache.entries.is_empty());
        assert_eq!(delivered, "aa");
    }

    #[test]
    fn media_cache_enforces_byte_budget_and_releases_removals() {
        let mut cache = state();
        let bytes = cache.limits.mib as usize * 1024 * 1024;
        cache.insert(key(0), entry(bytes / 2));
        cache.insert(key(1), entry(bytes / 2));
        cache.touch(&key(0));
        cache.insert(key(2), entry(1));
        assert!(cache.entries.contains_key(&key(0)));
        assert!(!cache.entries.contains_key(&key(1)));
        assert_eq!(cache.bytes, bytes / 2 + 1);
        cache.remove(&key(0));
        assert_eq!(cache.bytes, 1);
        cache.insert(key(3), entry(bytes + 1));
        assert!(cache.entries.is_empty());
        assert_eq!(cache.bytes, 0);
    }
}
