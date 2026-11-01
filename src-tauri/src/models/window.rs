use crate::errors::ErrorDiagnostic;
use crate::models::{JointEditKind, SpecEditorKind};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::sync::LazyLock;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditWriteTarget {
    pub session_id: String,
    pub mod_root: String,
    pub path: String,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum WindowIdentity {
    Immersive {
        session_id: String,
        kind: JointEditKind,
        mod_root: String,
        id: String,
    },
    Spec {
        session_id: String,
        kind: SpecEditorKind,
        mod_root: String,
        id: String,
    },
    #[serde(rename = "weapon-fire-preview")]
    WeaponFirePreview {
        session_id: String,
        mod_root: String,
        id: String,
    },
    File {
        session_id: String,
        mod_root: String,
        path: String,
    },
    Recovery {
        mod_root: Option<String>,
        path: String,
    },
}
impl WindowIdentity {
    pub fn comparison_key(&self) -> Self {
        let mut key = self.clone();
        match &mut key {
            Self::File { mod_root, path, .. } => {
                *mod_root = windows_path_key(mod_root);
                *path = windows_path_key(path);
            }
            Self::Recovery { mod_root, path } => {
                *mod_root = mod_root.as_deref().map(windows_path_key);
                *path = windows_path_key(path);
            }
            Self::Spec { mod_root, .. }
            | Self::Immersive { mod_root, .. }
            | Self::WeaponFirePreview { mod_root, .. } => *mod_root = windows_path_key(mod_root),
        }
        key
    }
    pub fn mod_root(&self) -> Option<&str> {
        match self {
            Self::Spec { mod_root, .. }
            | Self::Immersive { mod_root, .. }
            | Self::WeaponFirePreview { mod_root, .. }
            | Self::File { mod_root, .. } => Some(mod_root),
            Self::Recovery { mod_root, .. } => mod_root.as_deref(),
        }
    }
    pub fn session_id(&self) -> Option<&str> {
        match self {
            Self::Spec { session_id, .. }
            | Self::Immersive { session_id, .. }
            | Self::WeaponFirePreview { session_id, .. }
            | Self::File { session_id, .. } => Some(session_id),
            Self::Recovery { .. } => None,
        }
    }
}
#[cfg(windows)]
#[link(name = "ntdll")]
unsafe extern "system" {
    fn RtlUpcaseUnicodeChar(source: u16) -> u16;
}

static WINDOWS_PATH_CASE: LazyLock<Vec<u16>> = LazyLock::new(|| {
    (0..=u16::MAX)
        .map(|unit| {
            // Windows ordinal ignore-case maps UTF-16 units without Unicode expansion.
            #[cfg(windows)]
            let mapped = unsafe { RtlUpcaseUnicodeChar(unit) };
            #[cfg(not(windows))]
            let mapped = unit;
            if (65..=90).contains(&mapped) {
                mapped + 32
            } else {
                mapped
            }
        })
        .collect()
});

pub fn windows_path_case_map() -> &'static [(u16, u16)] {
    static MAPPING: LazyLock<Vec<(u16, u16)>> = LazyLock::new(|| {
        (0..=u16::MAX)
            .filter_map(|unit| {
                let mapped = WINDOWS_PATH_CASE[usize::from(unit)];
                (mapped != unit).then_some((unit, mapped))
            })
            .collect()
    });
    &MAPPING
}

pub fn windows_path_case(path: &str) -> String {
    let units = path
        .encode_utf16()
        .map(|unit| WINDOWS_PATH_CASE[usize::from(unit)])
        .collect::<Vec<_>>();
    String::from_utf16(&units).expect("Windows case mapping preserves UTF-16 validity")
}

pub fn windows_path_key(path: &str) -> String {
    let normalized = windows_path_case(&path.replace('\\', "/"));
    let normalized = if let Some(unc) = normalized.strip_prefix("//?/unc/") {
        format!("//{unc}")
    } else {
        normalized
            .strip_prefix("//?/")
            .unwrap_or(&normalized)
            .to_string()
    };
    let prefix = if normalized.starts_with("//") {
        "//"
    } else if normalized.starts_with('/') {
        "/"
    } else {
        ""
    };
    format!(
        "{prefix}{}",
        normalized
            .split('/')
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join("/")
    )
}

#[cfg(all(test, windows))]
mod windows_path_tests {
    use super::*;
    #[cfg(test)]
    #[cfg(test)]
    use serde_json::Value;
    #[cfg(test)]
    use std::ptr;
    #[cfg(test)]
    use std::time::Instant;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn CompareStringOrdinal(
            a: *const u16,
            a_len: i32,
            b: *const u16,
            b_len: i32,
            ignore_case: i32,
        ) -> i32;
    }
    fn windows_compare(a: &[u16], b: &[u16]) -> i32 {
        let result = unsafe {
            CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1)
        };
        assert_ne!(result, 0);
        result
    }
    #[test]
    fn windows_mapping_matches_all_utf16_units_and_collisions() {
        let started = Instant::now();
        let mapping = windows_path_case_map();
        let initialization = started.elapsed();
        for unit in 0..=u16::MAX {
            let mapped = WINDOWS_PATH_CASE[usize::from(unit)];
            assert_eq!(windows_compare(&[unit], &[mapped]), 2, "{unit:04X}");
            assert_eq!(WINDOWS_PATH_CASE[usize::from(mapped)], mapped);
        }
        let mut units = (0..=u16::MAX).collect::<Vec<_>>();
        units.sort_by(|a, b| windows_compare(&[*a], &[*b]).cmp(&2));
        for pair in units.windows(2) {
            assert_eq!(
                windows_compare(&pair[..1], &pair[1..]) == 2,
                WINDOWS_PATH_CASE[usize::from(pair[0])] == WINDOWS_PATH_CASE[usize::from(pair[1])]
            );
        }
        assert!(ptr::eq(windows_path_case_map(), windows_path_case_map()));
        println!(
            "WINDOWS_PATH_CASE_MAP {}",
            serde_json::to_string(mapping).unwrap()
        );
        println!(
            "WINDOWS_PATH_METRICS {}",
            serde_json::json!({"entries":mapping.len(),"jsonBytes":serde_json::to_vec(mapping).unwrap().len(),"initializationMicros":initialization.as_micros()})
        );
    }
    #[test]
    fn windows_unicode_keys_preserve_samples_and_identity() {
        let samples: Vec<Value> = serde_json::from_str(include_str!(
            "../../../src/test/fixtures/windows-path-cases.json"
        ))
        .unwrap();
        for sample in samples {
            let a = sample["first"].as_str().unwrap();
            let b = sample["second"].as_str().unwrap();
            let same = sample["same"].as_bool().unwrap();
            if a.ends_with(".variant") {
                assert_eq!(
                    windows_compare(
                        &a.encode_utf16().collect::<Vec<_>>(),
                        &b.encode_utf16().collect::<Vec<_>>()
                    ) == 2,
                    same
                );
            }
            assert_eq!(windows_path_key(a) == windows_path_key(b), same);
            assert_eq!(
                windows_path_case(a).encode_utf16().count(),
                a.encode_utf16().count()
            );
            let first = WindowIdentity::Recovery {
                mod_root: None,
                path: a.into(),
            };
            let second = WindowIdentity::Recovery {
                mod_root: None,
                path: b.into(),
            };
            assert_eq!(first.comparison_key() == second.comparison_key(), same);
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WeaponFirePreviewSource {
    Saved,
    Draft { weapon: Map<String, Value> },
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWindowLocation {
    pub context_label: Option<String>,
    pub context_severity: Option<String>,
    pub message: Option<String>,
    pub line: Option<u64>,
    pub column: Option<u64>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum ManagedWindowInput {
    Editor { starsector_root: Option<String> },
    FileEditor { location: FileWindowLocation },
    ImmersiveEditor { row_key: Option<String> },
    WeaponFirePreview { source: WeaponFirePreviewSource },
}
impl ManagedWindowInput {
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Editor { .. } => "editor",
            Self::FileEditor { .. } => "file-editor",
            Self::ImmersiveEditor { .. } => "immersive-editor",
            Self::WeaponFirePreview { .. } => "weapon-fire-preview",
        }
    }
    pub fn retarget(&mut self, identity: &WindowIdentity) {
        if let (
            Self::WeaponFirePreview {
                source: WeaponFirePreviewSource::Draft { weapon },
            },
            WindowIdentity::WeaponFirePreview { id, .. },
        ) = (self, identity)
        {
            weapon.insert("id".into(), Value::String(id.clone()));
        }
    }
    pub fn matches(&self, identity: &WindowIdentity) -> bool {
        if let (
            Self::ImmersiveEditor { row_key },
            WindowIdentity::Immersive {
                kind: JointEditKind::Wing,
                ..
            },
        ) = (self, identity)
        {
            return row_key.as_ref().is_some_and(|key| !key.is_empty());
        }
        matches!(
            (self, identity),
            (Self::Editor { .. }, WindowIdentity::Spec { .. })
                | (
                    Self::FileEditor { .. },
                    WindowIdentity::File { .. } | WindowIdentity::Recovery { .. }
                )
                | (
                    Self::ImmersiveEditor { .. },
                    WindowIdentity::Immersive { .. }
                )
                | (
                    Self::WeaponFirePreview { .. },
                    WindowIdentity::WeaponFirePreview { .. }
                )
        )
    }
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowRequest {
    pub identity: WindowIdentity,
    pub title: String,
    pub input: ManagedWindowInput,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowContext {
    pub kind: &'static str,
    pub label: String,
    pub revision: u64,
    pub request_id: u64,
    pub receiver_generation: u64,
    pub identity: WindowIdentity,
    pub title: String,
    pub input: ManagedWindowInput,
}
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WindowBootstrap {
    Main {
        #[serde(rename = "windowsPathCaseMap")]
        windows_path_case_map: &'static [(u16, u16)],
    },
    Managed {
        #[serde(rename = "windowsPathCaseMap")]
        windows_path_case_map: &'static [(u16, u16)],
        context: Box<ManagedWindowContext>,
        restoring: bool,
        #[serde(rename = "modName")]
        mod_name: String,
    },
}
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WindowRequestStatus {
    Accepted,
    Superseded,
    Cancelled,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRequestReceipt {
    pub label: String,
    pub request_id: u64,
    pub status: WindowRequestStatus,
}
#[derive(Debug, Default, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedWindowStatus {
    pub dirty: bool,
    pub saving: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CloseScope {
    Window,
    Sessions { session_ids: Vec<String> },
    Application,
}
impl CloseScope {
    pub fn overlaps(&self, other: &Self) -> bool {
        match (self, other) {
            (Self::Application, _) | (_, Self::Application) => true,
            (Self::Sessions { session_ids: a }, Self::Sessions { session_ids: b }) => {
                a.iter().any(|id| b.contains(id))
            }
            _ => false,
        }
    }
}
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ClosePhase {
    Hold,
    Settle,
    Prepare,
    Confirm,
    Flush,
    Resume,
}
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloseIntent {
    pub only_if_clean: bool,
    pub operation_id: u64,
    pub phase: ClosePhase,
    pub scope: CloseScope,
    pub released_sessions: Vec<String>,
}
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloseResult {
    pub status: CloseStatus,
    pub destroyed_windows: Vec<String>,
    pub released_sessions: Vec<String>,
    pub diagnostic: Option<ErrorDiagnostic>,
}

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CloseStatus {
    Closed,
    #[default]
    Cancelled,
    Failed,
}
