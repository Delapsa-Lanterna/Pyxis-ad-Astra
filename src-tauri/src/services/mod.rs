pub mod app_config;
pub mod app_lifecycle;
pub mod app_log;
pub mod app_settings;
pub mod code_editor;
pub mod directory_opening;
pub mod file_history;
pub mod java_analysis;
pub mod java_project;
pub mod json_file;
pub mod misc_config;
pub mod mod_creation;
pub mod performance_monitor;
pub mod project;
pub mod project_save;
pub mod project_session;
pub mod project_sync;
pub mod source_watch;
pub mod spec_editor;
pub mod system_open;
pub mod text_editor;
pub mod text_file_editing;
pub mod windows;
pub mod workspace_persistence;
pub mod write_transactions;

#[cfg(test)]
mod schema_tests;

pub(crate) use project::query::csv_validation::query_csv_validation;
#[cfg(test)]
pub(crate) use project::query::csv_window::query_csv_table_window;
pub(crate) use project::query::csv_window::{
    query_csv_row_preview, query_csv_row_resources, query_csv_source_index, query_csv_table_index,
    query_csv_table_rows,
};
pub(crate) use project::query::entities::{query_entity, query_entity_list};
pub(crate) use project::query::entity_targets::{
    query_entity_edit_target, query_entity_identity_intent, query_file_entity_target,
};
pub(crate) use project::query::file_browser::{
    query_file_directory, query_file_search, query_file_text_target,
};
pub(crate) use project::query::hull_references::query_hull_references;
pub(crate) use project::query::joint_edit::{
    prepare_joint_edit, query_joint_edit_request, query_variant_catalog,
};
pub(crate) use project::query::json_layers::query_json_composition;
pub(crate) use project::query::json_layers::read_json_document;
pub(crate) use project::query::json_recovery::prepare_json_source_recovery;
pub(crate) use project::query::resources::{
    query_draft_resources, query_engine_render_assets, query_resource_data_urls,
};
pub(crate) use project::query::source_catalog::images::query_image_source_options;
pub(crate) use project::query::source_catalog::values::query_source_option_catalog;
pub(crate) use project::resources::core_assets::{
    query_core_root, scan_core_fields, scan_core_graphics,
};
pub(crate) use project::resources::fonts::query_original_font;
pub(crate) use project::resources::media_cache::{
    clear_session_media, configure_media_cache, invalidate_source_media,
};
pub(crate) use project::resources::sprites::resolve_mod_relative_path;
#[cfg(test)]
pub(crate) use project::write::csv_patch::save_csv_patch_snapshot;
pub(crate) use project::write::entity_write::associated_spec_preparation::prepare_csv_associated_specs;
#[cfg(test)]
pub(crate) use project::write::entity_write::content::save_entity_spec;
#[cfg(test)]
pub(crate) use project::write::entity_write::single_files::json_file_save_context;
pub(crate) use project::write::entity_write::single_files::{
    create_json_entity_file, delete_json_entity_file, save_file_entity,
};
#[cfg(test)]
pub(crate) use project::write::joint_edit::prepare_joint_save;

pub(crate) use project::write::entity_write::replace_paths::stage_replace_paths;
