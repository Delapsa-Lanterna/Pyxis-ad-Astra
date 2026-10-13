use super::{
    CsvTableKey, EntityEditTarget, EntityFileLocation, EntityKind, FileVersion, JsonWriteOptions,
    ResourceRef, SessionModScope,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "camelCase")]
pub enum JointEditKind {
    Ship,
    Weapon,
    Wing,
    Variant,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct JointEditRoot {
    pub session_id: String,
    pub mod_root: String,
    pub kind: JointEditKind,
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditQuery {
    pub root: JointEditRoot,
    pub row_key: Option<String>,
    pub values: Option<BTreeMap<String, JointValue>>,
    pub new_sources: Vec<JointSourceCreate>,
    pub catalog: Option<JointVariantCatalogKind>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum JointVariantCatalogKind {
    Weapons,
    Wings,
    Hullmods,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointVariantEntry {
    pub id: String,
    pub label: String,
    pub data: Value,
    pub spec: Option<Value>,
    pub spec_source: Option<EntityFileLocation>,
    pub spec_version: Option<FileVersion>,
    pub source: EntityFileLocation,
    pub source_version: FileVersion,
    pub resource_refs: BTreeMap<String, ResourceRef>,
    pub preview: Option<JointVariantPreview>,
    pub projectile: Option<JointPreviewSpec>,
    pub primary_role: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointPreviewSpec {
    pub kind: EntityKind,
    pub id: String,
    pub data: Value,
    pub resource_refs: BTreeMap<String, ResourceRef>,
    pub source: Option<EntityFileLocation>,
    pub source_version: Option<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointVariantPreview {
    pub hull: JointHullProjection,
    pub spec: Value,
    pub specs: Vec<JointPreviewSpec>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointVariantCatalogRead {
    pub root: JointEditRoot,
    pub reference_settings: JointReferenceSettings,
    pub catalog: JointVariantCatalog,
}

#[derive(Debug, Serialize)]
#[serde(untagged)]
pub enum JointEditReadResult {
    Snapshot(Box<JointEditSnapshot>),
    Catalog(JointVariantCatalogRead),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointVariantCatalog {
    pub kind: JointVariantCatalogKind,
    pub entries: Vec<JointVariantEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointSourceCreate {
    pub kind: EntityKind,
    pub id: String,
}

impl SessionModScope for JointEditRoot {
    fn session_id(&self) -> Option<&String> {
        Some(&self.session_id)
    }
    fn mod_root(&self) -> &str {
        &self.mod_root
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum JointRecordTarget {
    Spec {
        target: EntityEditTarget,
    },
    Csv {
        table: CsvTableKey,
        row_key: String,
        identity: BTreeMap<String, String>,
        write: EntityFileLocation,
    },
    Text {
        write: EntityFileLocation,
    },
}

impl JointRecordTarget {
    pub fn write(&self) -> &EntityFileLocation {
        match self {
            Self::Spec { target } => &target.write,
            Self::Csv { write, .. } | Self::Text { write } => write,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "state", content = "value", rename_all = "camelCase")]
pub enum JointValue {
    Missing,
    Present(Value),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditRecord {
    pub key: String,
    pub target: JointRecordTarget,
    pub source: Option<EntityFileLocation>,
    pub source_version: Option<FileVersion>,
    pub value: JointValue,
    pub base_versions: Vec<FileVersion>,
    pub resource_refs: BTreeMap<String, ResourceRef>,
    pub referenced_by: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditSnapshot {
    pub root: JointEditRoot,
    pub bindings: BTreeMap<String, String>,
    pub reference_settings: JointReferenceSettings,
    pub records: Vec<JointEditRecord>,
    pub base_versions: Vec<FileVersion>,
    pub hull: Option<JointHullProjection>,
    pub new_sources: Vec<JointSourceCreate>,
    pub variants: BTreeMap<String, JointHullProjection>,
    pub catalog: Option<JointVariantCatalog>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointFieldBinding {
    pub record_key: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointHullProjection {
    pub variant_key: String,
    pub hull_key: String,
    pub skin_keys: Vec<String>,
    pub fields: BTreeMap<String, JointFieldBinding>,
    pub display_bindings: BTreeMap<String, String>,
    pub weapons: BTreeMap<String, String>,
    pub sprite: Option<ResourceRef>,
    pub slots: Vec<Value>,
    pub built_in_weapons: BTreeMap<String, String>,
    pub built_in_mods: Vec<String>,
    pub built_in_wings: Vec<String>,
    pub modules: Vec<JointModuleBinding>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointModuleBinding {
    pub slot_id: String,
    pub variant_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointReferenceSettings {
    pub resources: BTreeMap<String, ResourceRef>,
    pub values: BTreeMap<String, Value>,
    pub versions: Vec<FileVersion>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditDraft {
    pub baseline: JointEditSnapshot,
    pub values: BTreeMap<String, JointValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditConflict {
    pub record_key: String,
    pub path: Vec<String>,
    pub baseline: JointValue,
    pub disk: JointValue,
    pub draft: JointValue,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditPrepared {
    pub snapshot: JointEditSnapshot,
    pub values: BTreeMap<String, JointValue>,
    pub conflicts: Vec<JointEditConflict>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointEditSubmission {
    pub snapshot: JointEditSnapshot,
    pub values: BTreeMap<String, JointValue>,
    pub base_versions: Vec<FileVersion>,
    pub json_write: JsonWriteOptions,
    pub create_overrides: Vec<String>,
}

impl SessionModScope for JointEditSubmission {
    fn session_id(&self) -> Option<&String> {
        Some(&self.snapshot.root.session_id)
    }
    fn mod_root(&self) -> &str {
        &self.snapshot.root.mod_root
    }
}
