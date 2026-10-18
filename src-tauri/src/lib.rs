mod commands;
mod diagnostics;
mod domain;
mod errors;
mod io;
mod models;
mod parsers;
mod services;

#[cfg(test)]
pub(crate) mod testutil;

use models::{AppLogEntry, AppLogLevel};
use tauri::{Emitter, Manager};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let owner = window.label().to_owned();
                tauri::async_runtime::spawn_blocking(move || {
                    if let Err(error) = services::app_lifecycle::request_close(
                        &app,
                        &owner,
                        models::CloseScope::Window,
                    ) {
                        diagnostics::record(format!("native close request: {error}"));
                    }
                });
            }
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = services::windows::release_window(window.label())
            {
                diagnostics::record(format!("release window registration: {error}"));
            }
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = services::app_lifecycle::destroyed(window.label())
            {
                diagnostics::record(format!("close lifecycle release: {error}"));
            }
            if matches!(event, tauri::WindowEvent::Destroyed)
                && let Err(error) = window.app_handle().emit(
                    "managed-window-released",
                    serde_json::json!({"label": window.label()}),
                )
            {
                diagnostics::record(format!("notify window release: {error}"));
            }
        })
        .setup(|app| {
            #[cfg(windows)]
            services::windows::auxiliary::install(&app.config().identifier)?;
            let handle = app.handle().clone();
            diagnostics::install(Box::new(move |message| {
                let _ = services::app_log::append_app_log(
                    handle.clone(),
                    AppLogEntry {
                        level: AppLogLevel::Warning,
                        code: Some("diagnostics".to_string()),
                        message: Some(message.to_string()),
                        path: None,
                        line: None,
                        fields: None,
                    },
                );
            }));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::request_window,
            commands::request_close,
            commands::reply_close,
            commands::ready_close,
            commands::get_window_bootstrap,
            commands::get_current_window_context,
            commands::get_current_window_request,
            commands::accept_window_request,
            commands::fail_window_request,
            commands::fail_window_startup,
            commands::focus_managed_window,
            commands::update_edit_target_registration,
            commands::query_edit_target_owners,
            commands::reserve_edit_targets,
            commands::focus_edit_target_owner,
            commands::update_managed_window_status,
            commands::reserve_window_targets,
            commands::release_window_targets,
            commands::retarget_managed_window,
            commands::query_file_history,
            commands::query_entity_edit_target,
            commands::query_entity_identity_intent,
            commands::clear_file_history,
            commands::open_project_session,
            commands::close_project_session,
            commands::query_csv_table_index,
            commands::query_csv_table_rows,
            commands::query_csv_source_options,
            commands::query_csv_row_preview,
            commands::query_hull_references,
            commands::query_entity,
            commands::query_mod_directory,
            commands::query_mod_file_search,
            commands::query_mod_text_file_target,
            commands::query_joint_edit,
            commands::prepare_joint_edit,
            commands::save_joint_edit,
            commands::query_entity_list,
            commands::query_draft_resources,
            commands::query_resource_data_urls,
            commands::invalidate_project_session,
            commands::refresh_project_sources,
            commands::synchronize_committed_write,
            commands::invalidate_core_cache,
            commands::detect_directory,
            commands::scan_game_overview,
            commands::create_mod,
            commands::save_csv_patch,
            commands::resolve_mod_relative_path,
            commands::load_workspace,
            commands::save_workspace,
            commands::append_app_log,
            commands::get_app_log_status,
            commands::open_config_dir,
            commands::open_app_log_file,
            commands::clear_config_files,
            commands::clear_app_log_file,
            commands::read_settings,
            commands::save_settings,
            commands::query_system_fonts,
            commands::save_indexed_config_entity,
            commands::create_indexed_config_entity,
            commands::delete_indexed_config_entity,
            commands::save_variant_entity,
            commands::create_variant_entity,
            commands::delete_variant_entity,
            commands::save_skin_entity,
            commands::create_skin_entity,
            commands::delete_skin_entity,
            commands::scan_core_fields,
            commands::scan_core_graphics,
            commands::query_original_font,
            commands::load_editable_file,
            commands::query_text_identity_intent,
            commands::follow_text_identity,
            commands::load_imported_editor_spec_file,
            commands::save_text_file,
            commands::transcode_file_to_utf8,
            commands::save_editor_spec,
            commands::save_mod_info,
            commands::apply_file_change_set,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
