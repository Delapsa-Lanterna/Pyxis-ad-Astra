use crate::errors::{AppError, AppResult};
use crate::io::{FsRootBoundary, canonical_path};
use pyxis_java_analysis::{AnalysisRequest, AnalysisResponse, AnalysisRuntime, java_path};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Manager, Runtime};

fn normalize_path(path: &mut String, label: &str) -> AppResult<()> {
    *path = java_path(&canonical_path(Path::new(path), label)?)
        .to_string_lossy()
        .into_owned();
    Ok(())
}

fn normalize_sources(sources: &mut [String]) -> AppResult<()> {
    for source in sources {
        *source = java_path(FsRootBoundary::new(Path::new(source), "Java source root")?.root())
            .to_string_lossy()
            .into_owned();
    }
    Ok(())
}

fn normalize_classpath(classpath: &mut [String], java_home: &mut String) -> AppResult<()> {
    for jar in classpath {
        normalize_path(jar, "Java classpath")?;
    }
    normalize_path(java_home, "Java home")
}

pub(super) fn send(
    runtime: &AnalysisRuntime,
    instance: &str,
    mut request: AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    normalize_request(&mut request)?;
    runtime.request(instance, &request).map_err(Into::into)
}

fn normalize_request(request: &mut AnalysisRequest) -> AppResult<()> {
    match request {
        AnalysisRequest::Open {
            sources,
            classpath,
            java_home,
            ..
        } => {
            normalize_sources(sources)?;
            normalize_classpath(classpath, java_home)?;
        }
        AnalysisRequest::Configure {
            sources,
            classpath,
            java_home,
            ..
        } => {
            if let Some(sources) = sources {
                normalize_sources(sources)?;
            }
            normalize_classpath(classpath, java_home)?;
        }
        AnalysisRequest::RefreshSources {
            paths, retained, ..
        } => {
            for path in paths.iter_mut().chain(retained) {
                normalize_path(path, "Java source path")?;
            }
        }
        AnalysisRequest::Update { files, .. } => {
            for file in files {
                normalize_path(&mut file.file, "Java source file")?;
                if let Some(target) = &mut file.target {
                    normalize_path(target, "Java source file")?;
                }
            }
        }
        AnalysisRequest::Inspect { file, .. } if file.starts_with("jar:") => {}
        AnalysisRequest::Query { file, .. }
        | AnalysisRequest::Inspect { file, .. }
        | AnalysisRequest::Assist { file, .. } => normalize_path(file, "Java source file")?,
        AnalysisRequest::EditorUpdate { documents, .. } => {
            for document in documents {
                normalize_path(&mut document.file, "Java source file")?;
                if let Some(previous) = &mut document.previous_file {
                    normalize_path(previous, "Java source file")?;
                }
            }
        }
        _ => {}
    }
    Ok(())
}

pub fn request<R: Runtime>(
    app: &AppHandle<R>,
    instance: &str,
    request: AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    send(&app.state::<Arc<AnalysisRuntime>>(), instance, request)
}

pub(super) fn checked_response(response: AnalysisResponse) -> AppResult<AnalysisResponse> {
    if let Some(error) = &response.error {
        let code = if error.code == "engine.source_unavailable" {
            "engine.source_unavailable"
        } else {
            "java_analysis.operation_failed"
        };
        let failure = AppError::message(code, serde_json::to_string(error)?);
        return Err(if let Some(path) = &error.file {
            failure.at_path(Path::new(path))
        } else {
            failure
        });
    }
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::{checked_response, normalize_request};
    use crate::test_support::TestWorkspace;
    use pyxis_java_analysis::{AnalysisRequest, FileChange, FileChangeAction};
    use serde_json::json;

    #[test]
    fn source_availability_preserves_the_editor_error_code() {
        for (engine, expected) in [
            ("engine.source_unavailable", "engine.source_unavailable"),
            ("engine.stale_project", "java_analysis.operation_failed"),
        ] {
            let response = serde_json::from_value(json!({
                "id": "editor", "error": {
                    "code": engine, "type": "Failure", "message": "Source query failed",
                    "project": "sample", "file": "Source.java"
                }
            }))
            .unwrap();
            let error = checked_response(response).unwrap_err();
            assert_eq!(error.code(), expected);
            assert_eq!(
                error.location().unwrap().path.as_deref(),
                Some("Source.java")
            );
        }
    }

    #[test]
    fn path_normalization_retains_the_owned_source_allocation() {
        let work = TestWorkspace::new("java_owned_request");
        let source = "x".repeat(10 * 1024 * 1024);
        let pointer = source.as_ptr();
        let mut request = AnalysisRequest::Update {
            id: json!(1),
            project: "sample".into(),
            expected_revision: 1,
            files: vec![FileChange {
                action: FileChangeAction::Add,
                file: work.join("New.java").to_string_lossy().into_owned(),
                target: None,
                source: Some(source),
                version: Some(1),
            }],
        };
        normalize_request(&mut request).unwrap();
        let AnalysisRequest::Update { files, .. } = request else {
            panic!("update request");
        };
        assert_eq!(files[0].source.as_ref().unwrap().as_ptr(), pointer);
        assert_eq!(files[0].source.as_ref().unwrap().len(), 10 * 1024 * 1024);
        work.close().unwrap();
    }
}
