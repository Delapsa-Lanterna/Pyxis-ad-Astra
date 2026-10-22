mod app_config;
mod app_lifecycle;
mod app_log;
mod app_settings;
mod config_entity;
mod core_assets;
mod directory_opening;
mod entity_query;
mod file_editor;
mod file_history;
mod font;
mod hull_reference;
mod joint_edit;
mod json_file;
mod json_recovery;
mod mod_creation;
mod mod_file_browser;
mod project_session;
mod project_sync;
mod resources;
mod source_options;
mod spec_editor;
mod tables;
mod windows;
mod workspace_persistence;

use crate::{errors::AppResult, models::SessionModScope, services};

pub use app_config::*;
pub use app_lifecycle::*;
pub use app_log::*;
pub use app_settings::*;
pub use config_entity::*;
pub use core_assets::*;
pub use directory_opening::*;
pub use entity_query::*;
pub use file_editor::*;
pub use file_history::*;
pub use font::*;
pub use hull_reference::*;
pub use joint_edit::*;
pub use json_file::*;
pub use json_recovery::*;
pub use mod_creation::*;
pub use mod_file_browser::*;
pub use project_session::*;
pub use project_sync::*;
pub use resources::*;
pub use source_options::*;
pub use spec_editor::*;
pub use tables::*;
pub use windows::*;
pub use workspace_persistence::*;

/// The single ownership guard for every command payload carrying
/// `sessionId + modRoot`; payloads with an optional session (recovery editor)
/// skip the check when no session is attached.
pub(crate) fn ensure_session_mod_scope<T: SessionModScope>(payload: &T) -> AppResult<()> {
    if let Some(session_id) = payload.session_id() {
        services::project::ensure_project_session_mod_root(session_id, payload.mod_root())?;
    }
    Ok(())
}
mod performance_monitor;
pub use performance_monitor::*;
