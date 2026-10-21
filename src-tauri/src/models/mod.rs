pub mod app_log;
pub mod app_settings;
pub mod cache_limits;
pub mod config_entity;
pub mod core_assets;
pub mod directory_opening;
pub mod entity_query;
pub mod file_changes;
pub mod file_editor;
pub mod file_history;
pub mod font;
pub mod joint_edit;
pub mod json_file;
pub mod json_recovery;
pub mod mod_creation;
pub mod mod_file_browser;
pub mod project_identity;
pub mod project_session;
pub mod resources;
pub mod schema;
pub mod spec_editor;
pub mod table_save;
pub mod tables;
pub mod text;
pub mod window;
pub mod workspace_persistence;
pub mod write_commit;

use serde::{Deserialize, Deserializer};

pub use app_log::*;
pub use app_settings::*;
pub use cache_limits::*;
pub use config_entity::*;
pub use core_assets::*;
pub use directory_opening::*;
pub use entity_query::*;
pub use file_changes::*;
pub use file_editor::*;
pub use file_history::*;
pub use font::*;
pub use joint_edit::*;
pub use json_file::*;
pub use json_recovery::*;
pub use mod_creation::*;
pub use mod_file_browser::*;
pub use project_identity::*;
pub use project_session::*;
pub use resources::*;
pub use schema::*;
pub use spec_editor::*;
pub use table_save::*;
pub use tables::*;
pub(crate) use text::*;
pub use window::*;
pub use workspace_persistence::*;
pub use write_commit::*;

pub fn required_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

pub fn required_nullable_non_empty_string<'de, D>(
    deserializer: D,
) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(normalize_optional_non_empty_string)
}

pub fn optional_non_empty_string<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(normalize_optional_non_empty_string)
}

fn normalize_optional_non_empty_string(value: Option<String>) -> Option<String> {
    value.and_then(|text| {
        let trimmed = text.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub(crate) fn push_unique_all<T: PartialEq>(target: &mut Vec<T>, values: Vec<T>) {
    for value in values {
        if !target.contains(&value) {
            target.push(value);
        }
    }
}
