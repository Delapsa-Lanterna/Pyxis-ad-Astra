#![cfg(test)]

use crate::testutil::TestWorkspace;
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
    let sessions = match super::cache::lock_registry() {
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
