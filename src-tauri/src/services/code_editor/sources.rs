use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::WindowIdentity;
use crate::models::code_editor::{CodeEditorSource, CodeEditorSources};
use crate::services::{java_project, project};
use std::path::Path;

pub fn sources(identity: WindowIdentity) -> AppResult<CodeEditorSources> {
    let WindowIdentity::CodeEditor {
        session_id,
        mod_root,
    } = identity
    else {
        return Err(AppError::message(
            "code_editor.window_identity",
            "Code editor window required",
        ));
    };
    project::ensure_project_session_mod_root(&session_id, &mod_root)?;
    let references = project::reference_sources()?;
    let mut sessions = vec![session_id.clone()];
    sessions.extend(
        references
            .sources
            .into_iter()
            .map(|source| source.session_id)
            .filter(|id| id != &session_id),
    );
    let mut result = CodeEditorSources {
        revision: references.revision,
        sources: Vec::new(),
        analysis_roots: Vec::new(),
    };
    for id in sessions {
        let manifest = project::current_project_manifest(&id)?;
        let boundary = FsRootBoundary::new(Path::new(&manifest.mod_root), "Code project")?;
        let roots = java_project::configured_inputs(&manifest)?.0;
        let read_only = id != session_id;
        result.analysis_roots.extend(roots.clone());
        if read_only && roots.is_empty() {
            continue;
        }
        let label = manifest
            .mod_info
            .as_ref()
            .and_then(|info| info.get("name"))
            .and_then(|name| name.as_str())
            .map(str::to_owned)
            .unwrap_or_else(|| {
                if boundary
                    .root()
                    .file_name()
                    .is_some_and(|name| name == "starsector-core")
                {
                    return "Core".into();
                }
                boundary
                    .root()
                    .file_name()
                    .expect("project root name")
                    .to_string_lossy()
                    .into_owned()
            });
        for directory in if read_only {
            roots
                .iter()
                .map(|root| -> AppResult<Option<String>> {
                    Ok(Some(
                        io::canonical_path(Path::new(root), "Reference source root")?
                            .strip_prefix(boundary.root())
                            .map(io::forward_slash_path)
                            .map_err(|error| {
                                AppError::message("code_editor.source_root", error.to_string())
                            })?,
                    ))
                })
                .collect::<AppResult<Vec<_>>>()?
        } else {
            vec![None]
        } {
            result.sources.push(CodeEditorSource {
                session_id: id.clone(),
                mod_root: io::forward_slash_path(boundary.root()),
                label: if read_only && roots.len() > 1 {
                    format!(
                        "{label} / {}",
                        directory.as_deref().expect("reference directory")
                    )
                } else {
                    label.clone()
                },
                directory,
                read_only,
            });
        }
    }
    Ok(result)
}
