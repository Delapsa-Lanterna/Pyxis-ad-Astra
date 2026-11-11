use super::ProjectSessionId;
use super::serde_fields::deserialize_nullable;
use crate::models::{EntityKind, FileVersion, project_identity};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextTranscode {
    pub base_versions: Vec<FileVersion>,
    #[serde(deserialize_with = "deserialize_nullable")]
    pub session_id: Option<ProjectSessionId>,
    pub mod_root: String,
    pub path: String,
    pub encoding: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FollowTextIdentityPayload {
    pub kind: EntityKind,
    pub text: String,
    pub next_id: String,
}

project_identity::impl_session_mod_scope_optional!(TextTranscode);
