use super::{references, registry};
use crate::errors::AppResult;
use crate::services::project::model::ProjectSession;

/// Capture reference views before locking the receiver so mutually referencing
/// sessions never hold each other's session locks.
pub(crate) fn lock_ready_session(
    handle: &registry::RegisteredSession,
) -> AppResult<std::sync::MutexGuard<'_, ProjectSession>> {
    let (revision, views) = references::prepare(&handle.session_id)?;
    let mut session = registry::lock_projected_session(handle)?;
    session.reference_revision = revision;
    session.references = views;
    Ok(session)
}
