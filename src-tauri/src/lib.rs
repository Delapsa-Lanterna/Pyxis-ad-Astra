use crate::models::CloseScope;
#[cfg(windows)]
use crate::services::windows::auxiliary;
use crate::services::{
    app_lifecycle, app_log, code_editor, performance_monitor, project_sync, windows,
};
use serde_json::json;
pub use services::java_analysis;
use services::java_analysis::editor as java_editor;
use std::sync::Arc;
use tauri::ipc::Invoke;
use tauri::{Builder, Emitter, Manager, RunEvent, WindowEvent, async_runtime};

mod app_data_dir;
mod commands;
mod diagnostics;
mod domain;
mod errors;
mod io;
mod models;
mod parsers;
mod services;

#[cfg(test)]
pub(crate) mod test_support;

pub fn run() {
    Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .on_window_event(|window, event| {
            #[cfg(windows)]
            if let WindowEvent::Focused(active) = event
                && let Some(webview) = window.app_handle().get_webview_window(window.label())
            {
                windows::set_window_memory_target(webview, *active);
            }
            if matches!(event, WindowEvent::Destroyed) {
                diagnostics::debug("window.destroyed", || format!("window={}", window.label()));
            }
            if matches!(event, WindowEvent::CloseRequested { .. }) {
                diagnostics::debug("window.close_requested", || {
                    format!("window={}", window.label())
                });
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let app = window.app_handle().clone();
                let owner = window.label().to_owned();
                async_runtime::spawn_blocking(move || {
                    if let Err(error) =
                        app_lifecycle::request_close(&app, &owner, CloseScope::Window)
                    {
                        diagnostics::failure(
                            "window.close_failed",
                            error,
                            json!({"window":owner,"scope":"window"}),
                        );
                    }
                });
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = windows::release_window(window.label())
            {
                diagnostics::failure(
                    "window.registration_release_failed",
                    error,
                    json!({"window":window.label()}),
                );
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = project_sync::release_window(window.label())
            {
                diagnostics::failure(
                    "save.window_release_failed",
                    error,
                    json!({"window":window.label()}),
                );
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = code_editor::release_window(window.label())
            {
                diagnostics::failure(
                    "code_editor.release",
                    error,
                    json!({"window":window.label()}),
                );
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = app_lifecycle::destroyed(window.label())
            {
                diagnostics::failure(
                    "window.close_release_failed",
                    error,
                    json!({"window":window.label()}),
                );
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = java_editor::release(window.app_handle(), window.label())
            {
                diagnostics::failure(
                    "java_analysis.editor_release",
                    error,
                    json!({"window":window.label()}),
                );
            }
            if matches!(event, WindowEvent::Destroyed)
                && let Err(error) = window.app_handle().emit(
                    "managed-window-released",
                    serde_json::json!({"label": window.label()}),
                )
            {
                diagnostics::failure(
                    "window.release_notification_failed",
                    error,
                    json!({"window":window.label()}),
                );
            }
        })
        .setup(|app| {
            #[cfg(windows)]
            auxiliary::install(&app.config().identifier)?;
            app_log::start_native_writer(app.handle().clone());
            diagnostics::install(Arc::new(move |entry| {
                let _ = app_log::append_app_log(entry);
            }));
            java_analysis::initialize(app.handle())?;
            #[cfg(windows)]
            for window in app.webview_windows().into_values() {
                windows::set_window_memory_target(window, false);
            }
            Ok(())
        })
        .invoke_handler({
            let handler: Box<dyn Fn(Invoke) -> bool + Send + Sync> =
                Box::new(command_macros::generate_handler![
                    commands::performance_monitor_batch,
                    commands::performance_monitor_report,
                    commands::request_window,
                    commands::open_code_editor,
                    commands::subscribe_code_editor,
                    commands::finish_code_editor_open,
                    commands::register_window_save_receiver,
                    commands::unregister_window_save_receiver,
                    commands::request_window_save,
                    commands::reply_window_save,
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
                    commands::query_csv_validation,
                    commands::query_csv_table_rows,
                    commands::query_csv_source_options,
                    commands::query_image_source_options,
                    commands::query_csv_row_preview,
                    commands::query_csv_row_resources,
                    commands::prepare_csv_associated_specs,
                    commands::query_hull_references,
                    commands::query_entity,
                    commands::query_misc_config_files,
                    commands::read_json_document,
                    commands::query_misc_config_file,
                    commands::query_file_directory,
                    commands::query_file_search,
                    commands::query_file_text_target,
                    commands::query_joint_edit,
                    commands::prepare_joint_edit,
                    commands::query_entity_list,
                    commands::query_draft_resources,
                    commands::query_engine_render_assets,
                    commands::query_resource_data_urls,
                    commands::invalidate_project_session,
                    commands::register_save_window,
                    commands::set_reference_sources,
                    commands::subscribe_java_analysis,
                    commands::unsubscribe_java_analysis,
                    commands::manage_java_analysis,
                    commands::cancel_java_analysis,
                    commands::open_java_analysis_directory,
                    commands::java_analysis_context,
                    commands::java_editor,
                    commands::unregister_save_window,
                    commands::abandon_project_saves,
                    commands::resolve_save_sources,
                    commands::retry_project_save,
                    commands::retry_source_watch,
                    commands::set_window_core_subscription,
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
                    commands::query_core_root,
                    commands::scan_core_graphics,
                    commands::query_original_font,
                    commands::load_text_file,
                    commands::follow_text_identity,
                    commands::load_imported_editor_spec_file,
                ]);
            handler
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if matches!(event, RunEvent::Exit) {
                if let Err(error) = java_analysis::shutdown(app) {
                    diagnostics::failure(
                        "java_analysis.exit_failed",
                        error,
                        json!({"scope":"application"}),
                    );
                }
                performance_monitor::shutdown();
                diagnostics::info("app.exited", concat!("version=", env!("CARGO_PKG_VERSION")));
                let _ = app_log::flush_native_logs(app.clone());
            }
        });
}
