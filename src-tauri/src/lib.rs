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

use models::AppLogEntry;
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
            if matches!(event, tauri::WindowEvent::Destroyed) {
                diagnostics::debug("window.destroyed", || format!("window={}", window.label()));
            }
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                diagnostics::debug("window.close_requested", || {
                    format!("window={}", window.label())
                });
            }
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
                && let Err(error) = services::project_sync::release_window(window.label())
            {
                diagnostics::record(format!("release save delivery: {error}"));
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
            services::app_log::start_native_writer(app.handle().clone());
            diagnostics::install(std::sync::Arc::new(move |level, code, message| {
                let _ = services::app_log::append_app_log(AppLogEntry {
                    level,
                    code: Some(code.to_string()),
                    message: Some(message.to_string()),
                    path: None,
                    line: None,
                    fields: None,
                });
            }));
            Ok(())
        })
        .invoke_handler({
            let handler: Box<dyn Fn(tauri::ipc::Invoke) -> bool + Send + Sync> =
                Box::new(command_macros::generate_handler![
                    commands::performance_monitor_batch,
                    commands::performance_monitor_report,
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
                    commands::save_project,
                    commands::query_entity_edit_target,
                    commands::prepare_json_source_recovery,
                    commands::query_entity_identity_intent,
                    commands::clear_file_history,
                    commands::open_project_session,
                    commands::close_project_session,
                    commands::query_csv_table_index,
                    commands::query_csv_table_rows,
                    commands::query_csv_source_options,
                    commands::query_image_source_options,
                    commands::query_csv_row_preview,
                    commands::query_hull_references,
                    commands::query_entity,
                    commands::query_misc_config_files,
                    commands::query_misc_config_file,
                    commands::query_mod_directory,
                    commands::query_mod_file_search,
                    commands::query_mod_text_file_target,
                    commands::query_joint_edit,
                    commands::prepare_joint_edit,
                    commands::query_entity_list,
                    commands::query_draft_resources,
                    commands::query_engine_render_assets,
                    commands::query_resource_data_urls,
                    commands::invalidate_project_session,
                    commands::register_save_window,
                    commands::unregister_save_window,
                    commands::abandon_project_saves,
                    commands::resolve_save_sources,
                    commands::retry_project_save,
                    commands::wait_project_saves,
                    commands::invalidate_core_cache,
                    commands::detect_directory,
                    commands::scan_game_overview,
                    commands::create_mod,
                    commands::resolve_mod_relative_path,
                    commands::load_workspace,
                    commands::save_workspace,
                    commands::append_app_logs,
                    commands::stop_app_log,
                    commands::get_app_log_status,
                    commands::open_config_dir,
                    commands::clear_app_log_file,
                    commands::read_settings,
                    commands::read_default_settings,
                    commands::save_settings,
                    commands::query_system_fonts,
                    commands::scan_core_fields,
                    commands::scan_core_graphics,
                    commands::query_original_font,
                    commands::load_editable_file,
                    commands::query_text_identity_intent,
                    commands::follow_text_identity,
                    commands::load_imported_editor_spec_file,
                ]);
            handler
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                services::performance_monitor::shutdown();
                diagnostics::info("app.exited", concat!("version=", env!("CARGO_PKG_VERSION")));
                let _ = services::app_log::flush_native_logs(app.clone());
            }
        });
}
