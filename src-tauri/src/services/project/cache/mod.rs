pub(super) mod core;
pub(super) mod csv;
pub(super) mod media;
pub(super) mod persistent;
pub(super) mod spec_files;
pub(super) mod spec_records;
pub(crate) use spec_records::load_spec_records;

use crate::{
    errors::{AppError, AppResult},
    models::ProjectSessionId,
};
use std::{
    collections::BTreeMap,
    sync::{Arc, LazyLock, Mutex},
};

use super::model::ProjectSession;

pub(super) use core::invalidate_core_cache;
pub(crate) use core::{
    flush_core_cache, load_core_csv_table, load_core_projectile_specs, load_core_ship_files,
    load_core_skin_files, load_core_source_data, load_core_variant_files,
};
pub(crate) use csv::{
    ensure_registered_table_rows, ensure_session_table_rows, loaded_csv_rows,
    loaded_registered_csv_rows, registered_session_table,
};
pub(super) use media::clear_sprite_media_for_session;

#[derive(Clone)]
pub(super) struct RegisteredSession {
    pub root: String,
    pub handle: Arc<Mutex<ProjectSession>>,
}

static PROJECT_SESSIONS: LazyLock<Mutex<BTreeMap<ProjectSessionId, RegisteredSession>>> =
    LazyLock::new(|| Mutex::new(BTreeMap::new()));

pub(super) fn sessions() -> &'static Mutex<BTreeMap<ProjectSessionId, RegisteredSession>> {
    &PROJECT_SESSIONS
}

/// Lock the session registry; poison maps to the shared AppError form. The
/// registry lock is only ever held for map insert/remove/get plus Arc clones.
pub(super) fn lock_registry()
-> AppResult<std::sync::MutexGuard<'static, BTreeMap<ProjectSessionId, RegisteredSession>>> {
    sessions()
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

/// The registry lock is only ever held for map insert/remove/get plus the Arc
/// clone returned here; all session work — including disk IO — happens on the
/// per-session lock so one session can never block another.
pub(crate) fn session_handle(session_id: &str) -> AppResult<Arc<Mutex<ProjectSession>>> {
    lock_registry()?
        .get(session_id)
        .map(|registered| registered.handle.clone())
        .ok_or_else(|| {
            AppError::message(
                "session.unknown",
                format!("unknown project session: {session_id}"),
            )
        })
}

/// Lock a session handle, mapping poisoning to the shared AppError form.
pub(crate) fn lock_session(
    handle: &Mutex<ProjectSession>,
) -> AppResult<std::sync::MutexGuard<'_, ProjectSession>> {
    handle
        .lock()
        .map_err(|_| AppError::message("session.lock_poisoned", "project session lock poisoned"))
}

pub(crate) fn lock_ready_session(
    handle: &Mutex<ProjectSession>,
) -> AppResult<std::sync::MutexGuard<'_, ProjectSession>> {
    let session = lock_session(handle)?;
    if session.projection_pending {
        return Err(AppError::message(
            "session.projection_pending",
            "项目已写盘，等待会话投影同步",
        ));
    }
    Ok(session)
}
