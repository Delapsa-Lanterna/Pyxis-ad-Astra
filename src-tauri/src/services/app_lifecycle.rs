use crate::{
    errors::{AppError, AppResult, ErrorDiagnostic},
    models::{CloseIntent, ClosePhase, CloseResult, CloseScope, CloseStatus},
    services::{project, project_session, windows},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Condvar, LazyLock, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Emitter, Manager};
#[derive(Default)]
struct Progress {
    phase: Option<ClosePhase>,
    waiting: BTreeSet<String>,
    cancelled: bool,
    diagnostic: Option<ErrorDiagnostic>,
    destroying: BTreeSet<String>,
    destroyed: BTreeSet<String>,
    result: Option<CloseResult>,
    released_sessions: Vec<String>,
}
impl Operation {
    fn state(&self) -> AppResult<std::sync::MutexGuard<'_, Progress>> {
        self.progress.lock().map_err(|_| poisoned())
    }
}
struct Operation {
    only_if_clean: bool,
    owner: String,
    scope: CloseScope,
    labels: Vec<String>,
    progress: Mutex<Progress>,
    changed: Condvar,
}
static OPERATIONS: LazyLock<Mutex<BTreeMap<u64, Arc<Operation>>>> = LazyLock::new(Default::default);
static READY: LazyLock<(Mutex<BTreeMap<String, bool>>, Condvar)> = LazyLock::new(Default::default);
static SEQUENCE: AtomicU64 = AtomicU64::new(0);
fn poisoned() -> AppError {
    AppError::message("lifecycle.state_poisoned", "关闭状态不可用")
}
pub fn ready(label: &str) -> AppResult<()> {
    READY
        .0
        .lock()
        .map_err(|_| poisoned())?
        .insert(label.into(), true);
    READY.1.notify_all();
    Ok(())
}
pub fn loading(label: &str) -> AppResult<()> {
    READY.0.lock().map_err(|_| poisoned())?.remove(label);
    Ok(())
}
pub fn startup_failed(label: &str) -> AppResult<()> {
    READY
        .0
        .lock()
        .map_err(|_| poisoned())?
        .insert(label.into(), false);
    READY.1.notify_all();
    Ok(())
}
pub fn reply(
    label: &str,
    id: u64,
    phase: ClosePhase,
    accepted: bool,
    diagnostic: Option<ErrorDiagnostic>,
) -> AppResult<()> {
    if let Some(operation) = OPERATIONS.lock().map_err(|_| poisoned())?.get(&id) {
        let mut state = operation.state()?;
        if state.phase == Some(phase) && state.waiting.remove(label) {
            state.cancelled |= !accepted || diagnostic.is_some();
            if diagnostic.is_some() {
                state.diagnostic = diagnostic;
            }
            operation.changed.notify_all();
        }
    }
    Ok(())
}
pub fn destroyed(label: &str) -> AppResult<()> {
    READY.0.lock().map_err(|_| poisoned())?.remove(label);
    READY.1.notify_all();
    for operation in OPERATIONS.lock().map_err(|_| poisoned())?.values() {
        let mut state = operation.state()?;
        state.destroyed.insert(label.into());
        if state.waiting.remove(label) && !state.destroying.contains(label) {
            state.cancelled = true;
        }
        if operation.owner == label && !state.destroying.contains(label) && state.result.is_none() {
            state.cancelled = true;
        }
        operation.changed.notify_all();
    }
    Ok(())
}
fn phase(
    app: &tauri::AppHandle,
    id: u64,
    operation: &Operation,
    phase: ClosePhase,
    labels: &[String],
) -> AppResult<bool> {
    {
        let mut state = operation.state()?;
        if state.cancelled {
            return Ok(false);
        }
        state.phase = Some(phase);
        state.waiting = labels
            .iter()
            .filter(|label| !state.destroyed.contains(*label))
            .cloned()
            .collect();
    }
    for label in labels {
        if operation.state()?.destroyed.contains(label) {
            continue;
        }
        if label != "main" && !windows::wait_ready(label)? {
            destroyed(label)?;
            continue;
        }
        let mut ready = READY.0.lock().map_err(|_| poisoned())?;
        while !ready.contains_key(label) && app.get_webview_window(label).is_some() {
            if operation.state()?.cancelled {
                return Ok(false);
            }
            ready = READY.1.wait(ready).map_err(|_| poisoned())?;
        }
        let failed = ready.get(label) == Some(&false);
        drop(ready);
        if failed {
            operation.state()?.waiting.remove(label);
            continue;
        }
        if let Some(window) = app.get_webview_window(label) {
            if phase == ClosePhase::Confirm {
                window.show()?;
                window.unminimize()?;
                window.set_focus()?;
            }
            app.emit_to(
                label,
                "window-lifecycle-close-requested",
                CloseIntent {
                    only_if_clean: operation.only_if_clean,
                    operation_id: id,
                    phase,
                    scope: operation.scope.clone(),
                    released_sessions: operation.state()?.released_sessions.clone(),
                },
            )?;
        } else {
            destroyed(label)?;
        }
    }
    let mut state = operation.state()?;
    while !state.waiting.is_empty() && !state.cancelled {
        state = operation.changed.wait(state).map_err(|_| poisoned())?;
    }
    Ok(!state.cancelled)
}
fn destroy(app: &tauri::AppHandle, operation: &Operation, label: &str) -> AppResult<()> {
    operation.state()?.destroying.insert(label.into());
    if let Some(window) = app.get_webview_window(label) {
        window.destroy()?;
    } else {
        destroyed(label)?;
    }
    let mut state = operation.state()?;
    while !state.destroyed.contains(label) {
        state = operation.changed.wait(state).map_err(|_| poisoned())?;
    }
    Ok(())
}
fn child_windows(operation: &Operation) -> impl Iterator<Item = &String> {
    operation
        .labels
        .iter()
        .filter(|label| label.as_str() != "main")
}
pub fn request_close(
    app: &tauri::AppHandle,
    owner: &str,
    scope: CloseScope,
) -> AppResult<CloseResult> {
    Ok(
        execute_close(app, owner, scope, false).unwrap_or_else(|error| CloseResult {
            status: CloseStatus::Failed,
            diagnostic: Some(error.diagnostic()),
            ..Default::default()
        }),
    )
}
pub fn close_clean_window(app: &tauri::AppHandle, label: &str) -> AppResult<CloseResult> {
    execute_close(app, label, CloseScope::Window, true)
}
fn execute_close(
    app: &tauri::AppHandle,
    owner: &str,
    mut scope: CloseScope,
    only_if_clean: bool,
) -> AppResult<CloseResult> {
    if owner == "main" && scope == CloseScope::Window {
        scope = CloseScope::Application;
    }
    if owner != "main" && scope != CloseScope::Window {
        return Err(AppError::message(
            "lifecycle.owner_mismatch",
            "关闭范围不属于当前窗口",
        ));
    }
    if let CloseScope::Sessions { session_ids } = &mut scope {
        session_ids.sort();
        session_ids.dedup();
    }
    let (id, operation, execute, parent) = loop {
        let mut operations = OPERATIONS.lock().map_err(|_| poisoned())?;
        if let Some((id, operation)) = operations
            .iter()
            .find(|(_, op)| op.owner == owner && op.scope == scope)
        {
            break (*id, operation.clone(), false, None);
        } else {
            let id = SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
            let parent = if only_if_clean {
                operations
                    .iter()
                    .find(|(_, operation)| {
                        operation.labels.iter().any(|label| label == owner)
                            && matches!(
                                operation.state().map(|state| state.phase),
                                Ok(Some(ClosePhase::Hold | ClosePhase::Settle))
                            )
                    })
                    .map(|(id, operation)| (*id, operation.clone()))
            } else {
                None
            };
            let labels =
                match windows::hold_close(id, owner, &scope, parent.as_ref().map(|(id, _)| *id))? {
                    Ok(labels) => labels,
                    Err(blocking) => {
                        let blocking = operations[&blocking].clone();
                        drop(operations);
                        let mut state = blocking.state()?;
                        while state.result.is_none() {
                            state = blocking.changed.wait(state).map_err(|_| poisoned())?;
                        }
                        continue;
                    }
                };
            if let Some((_, parent)) = &parent {
                parent.state()?.destroying.insert(owner.into());
            }
            let operation = Arc::new(Operation {
                only_if_clean,
                owner: owner.into(),
                scope,
                labels,
                progress: Mutex::new(Progress::default()),
                changed: Condvar::new(),
            });
            operations.insert(id, operation.clone());
            break (id, operation, true, parent);
        }
    };
    if !execute {
        let mut state = operation.state()?;
        while state.result.is_none() {
            state = operation.changed.wait(state).map_err(|_| poisoned())?;
        }
        return Ok(state.result.clone().expect("completed close result"));
    }
    let mut result = CloseResult {
        status: CloseStatus::Cancelled,
        ..Default::default()
    };
    let mut opening = None;
    let mut confirmed = false;
    let executed = (|| -> AppResult<()> {
        opening = (operation.scope == CloseScope::Application)
            .then(project::hold_session_openings)
            .transpose()?;
        for step in [ClosePhase::Hold, ClosePhase::Settle, ClosePhase::Prepare] {
            if !phase(app, id, &operation, step, &operation.labels)? {
                return Ok(());
            }
        }
        let main = vec!["main".into()];
        if operation.scope != CloseScope::Window
            && !phase(app, id, &operation, ClosePhase::Confirm, &main)?
        {
            return Ok(());
        }
        for label in child_windows(&operation) {
            if !phase(
                app,
                id,
                &operation,
                ClosePhase::Confirm,
                std::slice::from_ref(label),
            )? {
                return Ok(());
            }
        }
        for label in child_windows(&operation) {
            if !phase(
                app,
                id,
                &operation,
                ClosePhase::Flush,
                std::slice::from_ref(label),
            )? {
                return Ok(());
            }
        }
        if operation.scope == CloseScope::Application
            && !phase(app, id, &operation, ClosePhase::Flush, &main)?
        {
            return Ok(());
        }
        confirmed = true;
        for label in child_windows(&operation) {
            destroy(app, &operation, label)?;
        }
        if !operation.state()?.cancelled {
            result.status = CloseStatus::Closed;
        }
        Ok(())
    })();
    let release = (|| -> AppResult<()> {
        if confirmed {
            let sessions = match &operation.scope {
                CloseScope::Sessions { session_ids } => session_ids.clone(),
                CloseScope::Application => project::registered_session_ids()?,
                CloseScope::Window => Vec::new(),
            };
            for session in sessions {
                if windows::session_has_windows(&session)? {
                    continue;
                }
                project_session::release_project_session(session.clone())?;
                operation.state()?.released_sessions.push(session.clone());
                result.released_sessions.push(session);
            }
            if executed.is_ok()
                && !operation.state()?.cancelled
                && operation.scope == CloseScope::Application
            {
                destroy(app, &operation, "main")?;
            }
        }
        Ok(())
    })();
    if let Some(diagnostic) = executed
        .err()
        .or(release.err())
        .map(|error| error.diagnostic())
        .or(operation.state()?.diagnostic.clone())
    {
        result.status = CloseStatus::Failed;
        result.diagnostic = Some(diagnostic);
    }
    {
        let mut state = operation.state()?;
        result.destroyed_windows = operation
            .labels
            .iter()
            .filter(|label| state.destroyed.contains(*label))
            .cloned()
            .collect();
        state.cancelled = false;
    }
    if let Err(error) = phase(app, id, &operation, ClosePhase::Resume, &operation.labels) {
        result.status = CloseStatus::Failed;
        result.diagnostic = Some(error.diagnostic());
    }
    if let Some(diagnostic) = operation.state()?.diagnostic.clone() {
        result.status = CloseStatus::Failed;
        result.diagnostic = Some(diagnostic);
    }
    windows::release_close(id)?;
    if let Some((_, parent)) = parent {
        parent.state()?.destroying.remove(owner);
    }
    drop(opening);
    if let Some(window) = app.get_webview_window(owner)
        && let Err(error) = window.set_focus()
    {
        crate::diagnostics::record(format!("close focus restore: {error}"));
    }
    {
        let mut state = operation.state()?;
        state.result = Some(result.clone());
        operation.changed.notify_all();
    }
    OPERATIONS.lock().map_err(|_| poisoned())?.remove(&id);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn child_window_stages_include_every_managed_window() {
        let operation = Operation {
            only_if_clean: false,
            owner: "main".into(),
            scope: CloseScope::Application,
            labels: vec!["main".into(), "managed-1".into(), "managed-2".into()],
            progress: Mutex::new(Progress::default()),
            changed: Condvar::new(),
        };
        assert_eq!(
            child_windows(&operation)
                .map(String::as_str)
                .collect::<Vec<_>>(),
            ["managed-1", "managed-2"]
        );
    }
    #[test]
    fn close_replies_bind_participant_and_phase_and_expected_destroy_preserves_scope() {
        let id = SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
        let operation = Arc::new(Operation {
            owner: "close-fixture-owner".into(),
            scope: CloseScope::Application,
            labels: vec!["close-fixture-child".into()],
            only_if_clean: false,
            progress: Mutex::new(Progress::default()),
            changed: Condvar::new(),
        });
        {
            let mut state = operation.state().unwrap();
            state.phase = Some(ClosePhase::Prepare);
            state.waiting.insert("close-fixture-child".into());
        }
        OPERATIONS.lock().unwrap().insert(id, operation.clone());
        reply("other-fixture", id, ClosePhase::Prepare, false, None).unwrap();
        reply("close-fixture-child", id, ClosePhase::Confirm, false, None).unwrap();
        assert_eq!(operation.state().unwrap().waiting.len(), 1);
        reply("close-fixture-child", id, ClosePhase::Prepare, true, None).unwrap();
        assert!(operation.state().unwrap().waiting.is_empty());
        {
            let mut state = operation.state().unwrap();
            state.waiting.insert("close-fixture-child".into());
            state.destroying.insert("close-fixture-child".into());
        }
        destroyed("close-fixture-child").unwrap();
        assert!(!operation.state().unwrap().cancelled);
        assert!(
            operation
                .state()
                .unwrap()
                .destroyed
                .contains("close-fixture-child")
        );
        destroyed("close-fixture-owner").unwrap();
        assert!(operation.state().unwrap().cancelled);
        OPERATIONS.lock().unwrap().remove(&id);
    }
}
