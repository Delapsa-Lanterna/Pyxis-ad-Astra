use serde::{Deserialize, Serialize};
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
        kind: super::JointEditKind,
        mod_root: String,
        id: String,
    },
    Spec {
        session_id: String,
        kind: super::SpecEditorKind,
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
pub fn windows_path_key(path: &str) -> String {
    let normalized = path.replace('\\', "/").to_lowercase();
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum WeaponFirePreviewSource {
    Saved,
    Draft {
        weapon: serde_json::Map<String, serde_json::Value>,
    },
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
            weapon.insert("id".into(), serde_json::Value::String(id.clone()));
        }
    }
    pub fn matches(&self, identity: &WindowIdentity) -> bool {
        if let (
            Self::ImmersiveEditor { row_key },
            WindowIdentity::Immersive {
                kind: super::JointEditKind::Wing,
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
    Main,
    Managed {
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
}
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CloseResult {
    pub status: CloseStatus,
    pub destroyed_windows: Vec<String>,
    pub released_sessions: Vec<String>,
    pub diagnostic: Option<crate::errors::ErrorDiagnostic>,
}

#[derive(Debug, Clone, Copy, Serialize, Default, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CloseStatus {
    Closed,
    #[default]
    Cancelled,
    Failed,
}
