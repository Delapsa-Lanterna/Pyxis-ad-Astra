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
    pub weapons: BTreeMap<String, String>,
    pub sprite: Option<ResourceRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JointReferenceSettings {
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
