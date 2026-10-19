use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheSize {
    pub entries: u32,
    #[serde(rename = "MiB")]
    pub mib: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FontCacheLimits {
    pub glyph_entries_per_page: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct CacheLimits {
    pub media_data: CacheSize,
    pub decoded_images: CacheSize,
    pub thumbnails: CacheSize,
    pub backend_media: CacheSize,
    pub queries: BTreeMap<String, u32>,
    pub fonts: FontCacheLimits,
}

impl Default for CacheLimits {
    fn default() -> Self {
        Self {
            media_data: CacheSize {
                entries: 2048,
                mib: 64,
            },
            decoded_images: CacheSize {
                entries: 1024,
                mib: 96,
            },
            thumbnails: CacheSize {
                entries: 2048,
                mib: 32,
            },
            backend_media: CacheSize {
                entries: 512,
                mib: 64,
            },
            queries: [
                ("joint-edit-catalog", 16),
                ("joint-edit-candidate", 128),
                ("csv-table-window", 80),
                ("csv-source-options", 240),
                ("csv-row-preview", 400),
                ("hull-references", 128),
                ("entity-detail", 128),
                ("entity-list", 128),
            ]
            .into_iter()
            .map(|(name, count)| (name.to_string(), count))
            .collect(),
            fonts: FontCacheLimits {
                glyph_entries_per_page: 512,
            },
        }
    }
}

impl CacheLimits {
    pub fn values(&self) -> Vec<(&str, u32, u32)> {
        let mut values = vec![
            ("mediaData.entries", self.media_data.entries, 65536),
            ("mediaData.MiB", self.media_data.mib, 4096),
            ("decodedImages.entries", self.decoded_images.entries, 65536),
            ("decodedImages.MiB", self.decoded_images.mib, 4096),
            ("thumbnails.entries", self.thumbnails.entries, 65536),
            ("thumbnails.MiB", self.thumbnails.mib, 4096),
            ("backendMedia.entries", self.backend_media.entries, 65536),
            ("backendMedia.MiB", self.backend_media.mib, 4096),
            (
                "fonts.glyphEntriesPerPage",
                self.fonts.glyph_entries_per_page,
                65536,
            ),
        ];
        values.extend(
            self.queries
                .iter()
                .map(|(key, value)| (key.as_str(), *value, 65536)),
        );
        values
    }
}
