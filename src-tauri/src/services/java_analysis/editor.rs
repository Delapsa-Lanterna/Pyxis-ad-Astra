use super::requests::checked_response;
use super::{close_for_session, references_changed, request_for_session, start_for_session};
use crate::errors::{AppError, AppResult};
use crate::io::FsRootBoundary;
use crate::models::WindowIdentity;
use crate::services::java_project::environment;
use crate::services::java_project::inputs::JavaInputExtras;
use pyxis_java_analysis::AnalysisRequest;
use pyxis_java_analysis::protocol::DocumentEdit;
use serde::Deserialize;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::{LazyLock, Mutex};
use tauri::{AppHandle, Runtime};

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum EditorAction {
    Assist {
        file: String,
        offset: u32,
        purpose: String,
        name: Option<String>,
        #[serde(default)]
        choices: BTreeMap<String, String>,
        #[serde(default)]
        revision: u64,
    },
    Start,
    Configure,
    Close,
    Sync {
        documents: Vec<DocumentEdit>,
    },
    Inspect {
        file: String,
        offset: u32,
        purpose: String,
    },
}
static OWNERS: LazyLock<Mutex<BTreeMap<String, String>>> = LazyLock::new(Default::default);

pub fn release<R: Runtime>(app: &AppHandle<R>, label: &str) -> AppResult<()> {
    let session = OWNERS
        .lock()
        .map_err(|_| {
            AppError::message("java_analysis.owner_lock", "Java editor owner unavailable")
        })?
        .remove(label);
    if let Some(session) = session {
        close_for_session(app, &session)?;
    }
    Ok(())
}

pub fn execute<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    identity: WindowIdentity,
    action: EditorAction,
) -> AppResult<Value> {
    let WindowIdentity::CodeEditor {
        session_id,
        mod_root,
    } = identity
    else {
        return Err(AppError::message(
            "java_analysis.owner_mismatch",
            "Java queries require a code editor window",
        ));
    };
    match action {
        EditorAction::Configure => {
            references_changed(app)?;
            Ok(Value::Null)
        }
        EditorAction::Close => {
            release(app, label)?;
            Ok(Value::Null)
        }
        EditorAction::Start => {
            release(app, label)?;
            let java = environment::selected_java_path(&session_id)?.ok_or_else(|| {
                AppError::message(
                    "java_analysis.game_missing",
                    "Select a Java runtime (17 or newer) in settings",
                )
            })?;
            OWNERS
                .lock()
                .map_err(|_| {
                    AppError::message("java_analysis.owner_lock", "Java editor owner unavailable")
                })?
                .insert(label.into(), session_id.clone());
            let result = start_for_session(
                app,
                &session_id,
                Path::new(&java),
                JavaInputExtras::default(),
            );
            if result.is_err() {
                release(app, label)?;
            }
            result?;
            if !OWNERS
                .lock()
                .map_err(|_| {
                    AppError::message("java_analysis.owner_lock", "Java editor owner unavailable")
                })?
                .contains_key(label)
            {
                close_for_session(app, &session_id)?;
            }
            Ok(json!({"ready":true}))
        }
        action => {
            let request = match action {
                EditorAction::Sync { documents } => {
                    let root = FsRootBoundary::new(Path::new(&mod_root), "Java editor Mod")?;
                    for document in &documents {
                        root.resolve_absolute(Path::new(&document.file), "Java editor source")?;
                        if let Some(previous) = &document.previous_file {
                            root.resolve_absolute(Path::new(previous), "Java editor source")?;
                        }
                    }
                    AnalysisRequest::EditorUpdate {
                        id: json!(label),
                        project: format!("session:{session_id}"),
                        expected_revision: 0,
                        documents,
                    }
                }
                EditorAction::Inspect {
                    file,
                    offset,
                    purpose,
                } => AnalysisRequest::Inspect {
                    id: json!(label),
                    project: format!("session:{session_id}"),
                    revision: 0,
                    file,
                    offset,
                    purpose,
                },
                EditorAction::Assist {
                    file,
                    offset,
                    purpose,
                    name,
                    choices,
                    revision,
                } => AnalysisRequest::Assist {
                    id: json!(label),
                    project: format!("session:{session_id}"),
                    revision,
                    file,
                    offset,
                    purpose,
                    name,
                    choices,
                },
                _ => unreachable!("lifecycle actions are handled above"),
            };
            Ok(serde_json::to_value(checked_response(
                request_for_session(app, &session_id, request)?,
            )?)?)
        }
    }
}
