use super::ResourceSource;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredField {
    pub key: String,
    #[serde(rename = "type")]
    pub field_type: DiscoveredFieldType,
    pub origin: ResourceSource,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum DiscoveredFieldType {
    Boolean,
    Integer,
    Float,
    String,
    PathImage,
    StringArray,
    ColorRgba,
    ArrayOfObject,
    TagSelect,
    Object,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CoreScanPayload {
    pub starsector_root: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoreRootPayload {
    pub session_id: Option<String>,
    pub starsector_root: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InvalidateCoreCachePayload {
    pub starsector_root: String,
}
