pub mod app_config;
pub mod app_lifecycle;
pub mod app_log;
pub mod app_paths;
pub mod app_settings;
pub mod config_entity;
pub mod config_family;
pub mod directory_opening;
pub mod spec_editor;

pub mod file_editor;
pub mod file_history;
pub mod mod_creation;
pub mod project;
pub mod project_session;
pub mod schema;
pub mod system_open;
pub mod windows;
pub mod workspace_persistence;
pub mod write_transactions;

pub(crate) use project::query::csv_window::{query_csv_row_preview, query_csv_table_window};
pub(crate) use project::query::entities::{query_entity, query_entity_list};
pub(crate) use project::query::entity_targets::{
    query_entity_edit_target, query_entity_identity_intent, query_file_entity_target,
    require_csv_version_scope, require_entity_version_scope,
};
pub(crate) use project::query::hull_references::query_hull_references;
pub(crate) use project::query::joint_edit::{
    prepare_joint_edit, query_joint_edit_request, query_variant_catalog,
};
pub(crate) use project::query::mod_file_browser::{
    query_mod_directory, query_mod_file_search, query_mod_text_file_target,
};
pub(crate) use project::query::resources::{query_draft_resources, query_resource_data_urls};
pub(crate) use project::query::source_options::query_csv_source_options;
pub(crate) use project::resources::core_graphics::scan_core_graphics;
pub(crate) use project::resources::fonts::query_original_font;
pub(crate) use project::resources::sprites::resolve_mod_relative_path;
pub(crate) use project::write::csv_patch::save_csv_patch_snapshot;
pub(crate) use project::write::entity_identity::{
    save_entity_spec, save_entity_text, save_variant_entity,
};
pub(crate) use project::write::faction_identity::{delete_faction_entity, save_faction_entity};
pub(crate) use project::write::joint_edit::save_joint_edit;
