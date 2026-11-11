use crate::errors::{AppError, AppResult};
use crate::io::{self, FsRootBoundary};
use crate::models::WindowIdentity;
use crate::models::code_editor::{CodeEditorSource, CodeEditorSources};
use crate::services::{java_analysis, project};
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
        let source = java_analysis::source_root(&manifest)?;
        let read_only = id != session_id;
        if source.is_some() {
            result
                .analysis_roots
                .push(source.clone().expect("existing source root"));
        }
        if read_only && source.is_none() {
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
        result.sources.push(CodeEditorSource {
            session_id: id,
            mod_root: io::forward_slash_path(boundary.root()),
            label,
            directory: read_only.then(|| "src".into()),
            read_only,
        });
    }
    Ok(result)
}
