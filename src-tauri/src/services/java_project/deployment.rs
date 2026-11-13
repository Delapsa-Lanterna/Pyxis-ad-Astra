use super::{artifacts, entry, unavailable};
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::{self, FileChangeSetBuilder, FsRootBoundary};
use crate::models::java_project::{JavaDeploy, JavaDeployPreview};
use crate::models::{WindowIdentity, WriteResult};
use crate::services::project;
use base64::{Engine as _, engine::general_purpose::STANDARD};
use serde_json::json;
use std::fs;
use std::path::Path;

pub fn preview(
    identity: WindowIdentity,
    artifact: &str,
    target: &str,
) -> AppResult<JavaDeployPreview> {
    let WindowIdentity::CodeEditor {
        session_id,
        mod_root,
    } = identity
    else {
        return Err(AppError::message(
            "java_project.window",
            "Code editor window required",
        ));
    };
    project::ensure_project_session_mod_root(&session_id, &mod_root)?;
    let entry = entry(&session_id)?;
    let source = artifacts::artifact(&entry, artifact)?;
    let manifest = project::current_project_manifest(&session_id)?;
    let boundary = FsRootBoundary::new(Path::new(&mod_root), "Deploy root")?;
    let path = boundary.resolve_relative_target(target, "Deploy target")?;
    let settings = entry
        .state
        .lock()
        .map_err(unavailable)?
        .stored
        .settings
        .clone();
    let declared = manifest
        .mod_info
        .as_ref()
        .and_then(|info| info.get("jars"))
        .map(|value| serde_json::from_value::<Vec<String>>(value.clone()))
        .transpose()?
        .unwrap_or_default();
    if !artifacts::deploy_targets(&settings, &declared)
        .iter()
        .any(|candidate| {
            boundary
                .resolve_relative_target(candidate, "Deploy target")
                .is_ok_and(|candidate| candidate == path)
        })
    {
        return Err(AppError::message(
            "java_project.deploy_target",
            "请选择主 JAR 或 Mod 信息中的加载目标",
        ));
    }
    let exists = path.exists();
    let target_bytes = if exists {
        fs::metadata(&path)?.len()
    } else {
        0
    };
    Ok(JavaDeployPreview {
        source,
        request: JavaDeploy {
            session_id,
            mod_root,
            artifact: artifact.into(),
            target: target.into(),
            base_versions: vec![io::file_version(&path)?],
        },
        exists,
        target_bytes,
    })
}
pub fn write(input: &JavaDeploy) -> AppResult<WriteResult> {
    let artifact = preview(
        WindowIdentity::CodeEditor {
            session_id: input.session_id.clone(),
            mod_root: input.mod_root.clone(),
        },
        &input.artifact,
        &input.target,
    )?
    .source;
    if !Path::new(&artifact.path)
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("jar"))
    {
        return Err(AppError::message(
            "java_project.jar",
            "请选择 JAR 产物进行部署",
        ));
    }
    let (version, bytes) = io::read_authorized_bytes(Path::new(&artifact.path))?;
    if version.fingerprint.as_ref() != Some(&artifact.fingerprint) {
        return Err(AppError::message(
            "java_project.artifact_changed",
            "产物已被修改，请重新构建或选择",
        ));
    }
    let mut changes = FileChangeSetBuilder::new(Path::new(&input.mod_root))?;
    changes.file(&input.target, None, Some(STANDARD.encode(bytes)))?;
    let result = WriteResult::from_changes(changes.apply()?);
    diagnostics::info("java_project.deployment_written", &json!({"sessionId":input.session_id,"artifactId":artifact.id,"target":input.target,"bytes":artifact.bytes,"changes":result.changes.len()}).to_string());
    Ok(result)
}
