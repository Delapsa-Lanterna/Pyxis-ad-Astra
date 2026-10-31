#![cfg(test)]

use crate::test_support::TestWorkspace;
use std::path::Path;

pub(crate) fn project_workspace(label: &str) -> TestWorkspace {
    TestWorkspace::new(label).with_cleanup(release_workspace)
}

pub(crate) fn release_workspace(root: &Path) -> Vec<String> {
    let root = match root.canonicalize() {
        Ok(root) => root,
        Err(error) => {
            return vec![format!(
                "resolve test workspace {}: {error}",
                root.display()
            )];
        }
    };
    let root_key = crate::models::windows_path_key(&root.to_string_lossy());
    let mut errors = Vec::new();
    let sessions = match super::session::lock_registry() {
        Ok(registry) => registry
            .iter()
            .filter(|(_, session)| {
                Path::new(&crate::models::windows_path_key(&session.root)).starts_with(&root_key)
            })
            .map(|(id, _)| id.clone())
            .collect::<Vec<_>>(),
        Err(error) => return vec![format!("release test sessions {}: {error}", root.display())],
    };
    for id in sessions {
        if let Err(error) = super::session::close_project_session(id) {
            errors.push(format!("close test session {}: {error}", root.display()));
        }
    }
    errors.extend(super::sources::core::release_test_roots(&root));
    errors
}

mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn project_workspace_releases_its_registered_sessions_on_unwind() {
        let mut owned = PathBuf::new();
        let mut session = String::new();
        let failure = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let root = project_workspace("session_unwind");
            owned = root.outer().to_path_buf();
            let manifest = crate::services::project::open_project_session_traced(
                &root,
                None,
                &mut crate::services::project::PerformanceTrace::new("test.cleanup"),
            )
            .unwrap();
            session = manifest.session_id;
            panic!("controlled assertion failure");
        }));
        assert!(failure.is_err());
        assert!(
            !crate::services::project::registered_session_ids()
                .unwrap()
                .contains(&session)
        );
        if std::env::var_os("PYXIS_KEEP_FAILED").is_none() {
            assert!(!owned.exists());
        }
    }
}
