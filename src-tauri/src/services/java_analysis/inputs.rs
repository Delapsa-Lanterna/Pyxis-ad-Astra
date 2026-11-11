use crate::errors::{AppError, AppResult};
use crate::io;
use crate::io::{FsRootBoundary, canonical_path};
use crate::models::ProjectManifest;
use crate::services::project;
use pyxis_java_analysis::java_path;
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AnalysisExtras {
    pub sources: Vec<String>,
    pub jars: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisInputs {
    pub session_id: String,
    pub mod_root: String,
    pub sources: Vec<String>,
    pub classpath: Vec<String>,
    pub java_home: String,
    pub referenced_sessions: Vec<String>,
    pub missing_dependencies: Vec<String>,
    pub missing_jars: Vec<String>,
    pub jar_fingerprints: Vec<Option<String>>,
}

fn append(values: &mut Vec<String>, path: &Path) {
    let value = java_path(path).to_string_lossy().to_string();
    if !values.contains(&value) {
        values.push(value);
    }
}

fn require_referenceable_mod(path: &Path, manifests: &[ProjectManifest]) -> AppResult<()> {
    for parent in path.ancestors() {
        if parent.join("mod_info.json").is_file() {
            if manifests
                .iter()
                .any(|manifest| Path::new(&manifest.mod_root) == parent)
            {
                return Ok(());
            }
            return Err(AppError::message(
                "java_analysis.reference_required",
                "Supplemental Mod inputs require a published reference",
            )
            .at_path(parent));
        }
    }
    Ok(())
}

pub(crate) fn source_root(manifest: &ProjectManifest) -> AppResult<Option<String>> {
    let boundary = FsRootBoundary::new(Path::new(&manifest.mod_root), "Java Mod root")?;
    let source = boundary.resolve_relative("src", "Java source root")?;
    Ok(source
        .is_dir()
        .then(|| java_path(&source).to_string_lossy().into_owned()))
}

fn add_manifest(input: &mut AnalysisInputs, manifest: &ProjectManifest) -> AppResult<()> {
    let boundary = FsRootBoundary::new(Path::new(&manifest.mod_root), "Java Mod root")?;
    if let Some(source) = source_root(manifest)? {
        append(&mut input.sources, Path::new(&source));
    }
    if let Some(jars) = manifest.mod_info.as_ref().and_then(|info| info.get("jars")) {
        for value in jars.as_array().ok_or_else(|| {
            AppError::message("java_analysis.jar_list", "Mod jars must be an array")
        })? {
            let relative = value.as_str().ok_or_else(|| {
                AppError::message("java_analysis.jar_path", "Mod jar must be a path")
            })?;
            let path = boundary.resolve_relative(relative, "Mod Java library")?;
            if path.is_file() {
                append(&mut input.classpath, &path);
            } else {
                input
                    .missing_jars
                    .push(java_path(&path).to_string_lossy().to_string());
            }
        }
    }
    Ok(())
}

/// Captures the ready project's actual game and all currently referenceable Mod inputs.
pub fn inputs_for_session(session_id: &str, extras: &AnalysisExtras) -> AppResult<AnalysisInputs> {
    let manifest = project::current_project_manifest(session_id)?;
    let game = manifest.starsector_root.as_ref().ok_or_else(|| {
        AppError::message(
            "java_analysis.game_root_required",
            "Java analysis requires a game root",
        )
    })?;
    let game_boundary = FsRootBoundary::new(Path::new(game), "Java game root")?;
    let java_home = game_boundary.resolve_relative("jre", "Java standard library")?;
    let mut input = AnalysisInputs {
        session_id: session_id.into(),
        mod_root: manifest.mod_root.clone(),
        sources: Vec::new(),
        classpath: Vec::new(),
        java_home: java_path(&java_home).to_string_lossy().to_string(),
        referenced_sessions: Vec::new(),
        missing_dependencies: Vec::new(),
        missing_jars: Vec::new(),
        jar_fingerprints: Vec::new(),
    };
    let mut manifests = vec![manifest];
    for reference in project::reference_sources()?.sources {
        if reference.session_id == session_id {
            continue;
        }
        let reference_manifest = project::current_project_manifest(&reference.session_id)?;
        input.referenced_sessions.push(reference.session_id);
        manifests.push(reference_manifest);
    }
    let ids: BTreeSet<_> = manifests
        .iter()
        .filter_map(|manifest| manifest.mod_info.as_ref()?.get("id")?.as_str())
        .collect();
    for manifest in &manifests {
        add_manifest(&mut input, manifest)?;
        if let Some(dependencies) = manifest
            .mod_info
            .as_ref()
            .and_then(|info| info.get("dependencies"))
            .and_then(Value::as_array)
        {
            for id in dependencies
                .iter()
                .filter_map(|dependency| dependency.get("id").and_then(Value::as_str))
            {
                if !ids.contains(id)
                    && !input
                        .missing_dependencies
                        .iter()
                        .any(|missing| missing == id)
                {
                    input.missing_dependencies.push(id.into());
                }
            }
        }
    }
    let core = game_boundary.resolve_relative("starsector-core", "Java game libraries")?;
    let mut jars = fs::read_dir(&core)
        .map_err(|error| {
            AppError::context("Read Java game libraries", error.into()).at_path(&core)
        })?
        .map(|entry| entry.map(|entry| entry.path()))
        .collect::<Result<Vec<_>, _>>()?;
    jars.sort();
    for path in jars {
        if path.extension().is_some_and(|extension| extension == "jar") {
            let path = canonical_path(&path, "Java game library")?;
            append(&mut input.classpath, &path);
        }
    }
    for source in &extras.sources {
        let boundary = FsRootBoundary::new(Path::new(source), "Supplemental Java source")?;
        require_referenceable_mod(boundary.root(), &manifests)?;
        append(&mut input.sources, boundary.root());
    }
    for jar in &extras.jars {
        let path = canonical_path(Path::new(jar), "Supplemental Java library")?;
        require_referenceable_mod(&path, &manifests)?;
        append(&mut input.classpath, &path);
    }
    input.jar_fingerprints = input
        .classpath
        .iter()
        .map(|path| io::file_version(Path::new(path)).map(|version| version.fingerprint))
        .collect::<AppResult<Vec<_>>>()?;
    Ok(input)
}
