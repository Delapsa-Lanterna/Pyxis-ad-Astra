use super::super::model::ProjectSession;
use crate::errors::{AppError, AppResult};
use crate::models::ProjectSessionId;
use crate::services::project::model::ReferenceView;
use std::collections::BTreeMap;
use std::sync::{Arc, LazyLock, Mutex, MutexGuard};

#[derive(Clone)]
pub(in crate::services::project) struct RegisteredSession {
    pub session_id: String,
    pub root: String,
    pub handle: Arc<Mutex<ProjectSession>>,
    pub reference: Option<Arc<ReferenceView>>,
}

static PROJECT_SESSIONS: LazyLock<Mutex<BTreeMap<ProjectSessionId, RegisteredSession>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(in crate::services::project) fn sessions()
-> &'static Mutex<BTreeMap<ProjectSessionId, RegisteredSession>> {
    &PROJECT_SESSIONS
}

/// Lock the session registry; poison maps to the shared AppError form. The
/// registry lock is only ever held for map insert/remove/get plus Arc clones.
pub(in crate::services::project) fn lock_registry()
-> AppResult<MutexGuard<'static, BTreeMap<ProjectSessionId, RegisteredSession>>> {
    sessions()
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

/// The registry lock is only ever held for map insert/remove/get plus the Arc
/// clone returned here; all session work — including disk IO — happens on the
/// per-session lock so one session can never block another.
pub(crate) fn session_handle(session_id: &str) -> AppResult<RegisteredSession> {
    lock_registry()?.get(session_id).cloned().ok_or_else(|| {
        AppError::message(
            "session.unknown",
            format!("unknown project session: {session_id}"),
        )
    })
}

/// Lock a session handle, mapping poisoning to the shared AppError form.
pub(crate) fn lock_session(
    handle: &RegisteredSession,
) -> AppResult<MutexGuard<'_, ProjectSession>> {
    handle
        .handle
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

pub(super) fn lock_projected_session(
    handle: &RegisteredSession,
) -> AppResult<MutexGuard<'_, ProjectSession>> {
    let session = lock_session(handle)?;
    if session.projection_pending {
        return Err(AppError::message(
            "session.projection_pending",
            "项目已写盘，等待会话投影同步",
        ));
    }
    Ok(session)
}

/// Unregister a session and return its root only when no same-root registrations remain.
pub(crate) fn unregister_project_session(session_id: &str) -> AppResult<Option<String>> {
    let mut registered = lock_registry()?;
    let removed = registered.remove(session_id);
    let last_for_root = removed
        .as_ref()
        .is_some_and(|removed| !registered.values().any(|entry| entry.root == removed.root));
    drop(registered);
    Ok(removed.filter(|_| last_for_root).map(|entry| entry.root))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::project::test_support::project_workspace;
    use crate::services::project::{
        PerformanceTrace, open_project_session_traced, reference_sources_changed,
    };

    #[test]
    fn unregister_returns_only_the_last_registered_root_and_keeps_captured_handles() {
        let root = project_workspace("unregister_root");
        let mut trace = PerformanceTrace::new("unregister.fixture");
        let first = open_project_session_traced(&root, None, &mut trace).unwrap();
        let second = open_project_session_traced(&root, None, &mut trace).unwrap();
        let captured = session_handle(&first.session_id).unwrap();
        let first_result = unregister_project_session(&first.session_id).unwrap();
        reference_sources_changed(Some(&first.session_id)).unwrap();
        let duplicate = unregister_project_session(&first.session_id).unwrap();
        let last_result = unregister_project_session(&second.session_id).unwrap();
        reference_sources_changed(Some(&second.session_id)).unwrap();
        assert!(first_result.is_none());
        assert!(duplicate.is_none());
        assert_eq!(last_result, Some(first.mod_root));
        assert_eq!(
            lock_session(&captured).unwrap().manifest.session_id,
            first.session_id
        );
        assert!(session_handle(&first.session_id).is_err());
        root.close().unwrap();
    }
}
