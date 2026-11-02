pub mod app_config;
pub mod app_lifecycle;
pub mod app_log;
pub mod app_settings;
pub mod config_entity;
pub mod directory_opening;
pub mod json_file;
pub mod misc_config;
pub mod spec_editor;

#[cfg(test)]
mod schema_tests;

pub mod file_editor;
pub mod file_history;
pub mod mod_creation;
pub mod project;
pub mod project_save;
pub mod project_session;
pub mod project_sync;
pub mod system_open;
pub mod windows;
pub mod workspace_persistence;
pub mod write_transactions;

pub(crate) use project::query::csv_associated_specs::prepare_csv_associated_specs;
#[cfg(test)]
pub(crate) use project::query::csv_window::query_csv_table_window;
pub(crate) use project::query::csv_window::read_project_csv;
pub(crate) use project::query::csv_window::{
    query_csv_row_preview, query_csv_table_index, query_csv_table_rows,
};
pub(crate) use project::query::entities::{query_entity, query_entity_list};
pub(crate) use project::query::entity_targets::{
    query_entity_edit_target, query_entity_identity_intent, query_file_entity_target,
    require_csv_version_scope, require_entity_version_scope,
};
pub(crate) use project::query::hull_references::query_hull_references;
pub(crate) use project::query::joint_edit::{
    prepare_joint_edit, query_joint_edit_request, query_variant_catalog,
};
pub(crate) use project::query::json_recovery::prepare_json_source_recovery;
pub(crate) use project::query::mod_file_browser::{
    query_mod_directory, query_mod_file_search, query_mod_text_file_target,
};
pub(crate) use project::query::resources::{
    query_draft_resources, query_engine_render_assets, query_resource_data_urls,
};
pub(crate) use project::query::source_options::query_csv_source_options;
pub(crate) use project::query::source_options::query_image_source_options;
pub(crate) use project::resources::core_assets::{
    query_core_root, scan_core_fields, scan_core_graphics,
};
pub(crate) use project::resources::fonts::query_original_font;
pub(crate) use project::resources::sprites::resolve_mod_relative_path;
pub(crate) use project::write::csv_patch::save_csv_patch_snapshot;
pub(crate) use project::write::csv_patch::{prepare_csv_save, write_csv_request};
pub(crate) use project::write::entity_write::content::save_entity_spec;
pub(crate) use project::write::entity_write::content::{prepare_spec_save, write_spec_request};
pub(crate) use project::write::entity_write::faction_index::delete_faction_entity;
pub(crate) use project::write::entity_write::single_files::{
    save_variant_entity, validate_skin_engine_changes,
};
pub(crate) use project::write::faction_identity::save_faction_entity;
pub(crate) use project::write::joint_edit::prepare_joint_save;
pub(crate) use project::write::joint_edit::save_joint_edit;
pub(crate) use project::write::json_recovery::restore_source_request;

pub use project::write::json_recovery::recreate_json_sources;
pub mod performance_monitor;

pub(crate) use project::write::entity_write::single_files::{
    JsonEntityFileInput, create_json_entity_file, delete_json_entity_file, save_json_entity_file,
    spec_entity_definition,
};
