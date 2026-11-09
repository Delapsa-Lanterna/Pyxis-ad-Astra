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
    request: &AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    let mut request = request.clone();
    match &mut request {
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
        AnalysisRequest::Update { files, .. } => {
            for file in files {
                normalize_path(&mut file.file, "Java source file")?;
                if let Some(target) = &mut file.target {
                    normalize_path(target, "Java source file")?;
                }
            }
        }
        AnalysisRequest::Query { file, .. } => normalize_path(file, "Java source file")?,
        _ => {}
    }
    runtime.request(instance, &request).map_err(Into::into)
}

pub fn request<R: Runtime>(
    app: &AppHandle<R>,
    instance: &str,
    request: &AnalysisRequest,
) -> AppResult<AnalysisResponse> {
    send(&app.state::<Arc<AnalysisRuntime>>(), instance, request)
}

pub(super) fn checked_response(response: AnalysisResponse) -> AppResult<AnalysisResponse> {
    if let Some(error) = &response.error {
        let failure = AppError::message(
            "java_analysis.operation_failed",
            serde_json::to_string(error)?,
        );
        return Err(if let Some(path) = &error.file {
            failure.at_path(Path::new(path))
        } else {
            failure
        });
    }
    Ok(response)
}
