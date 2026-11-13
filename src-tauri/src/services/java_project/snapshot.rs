use super::configuration::{build_files, fingerprint, paths};
use super::{JavaProject, artifacts, environment, gradle, inputs, process, unavailable};
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::java_project::{JavaBuildMode, JavaProjectSnapshot};
use crate::services::project;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use std::path::Path;
use std::sync::atomic::Ordering;

pub(super) fn describe(entry: &JavaProject, refresh: bool) -> AppResult<JavaProjectSnapshot> {
    read_description(entry, refresh, false)
}
pub(super) fn refresh_task(entry: &JavaProject) -> AppResult<JavaProjectSnapshot> {
    read_description(entry, true, true)
}
fn read_description(
    entry: &JavaProject,
    refresh: bool,
    completing: bool,
) -> AppResult<JavaProjectSnapshot> {
    let manifest = project::current_project_manifest(&entry.session)?;
    let java = environment::selected_java_path(&entry.session)?;
    let state = entry.state.lock().map_err(unavailable)?;
    if state.snapshot.active && !completing {
        let mut snapshot = state.snapshot.clone();
        drop(state);
        if let Some(path) = &snapshot.task_result.log_path
            && Path::new(path).is_file()
        {
            snapshot.output = process::tail(Path::new(path))?;
            snapshot.locations = process::locations(&snapshot.output);
        }
        return Ok(snapshot);
    }
    let generation = entry.input_generation.load(Ordering::Acquire);
    let invalidated = generation != state.input_generation;
    if !refresh && !invalidated && state.snapshot.revision > 0 && java == state.snapshot.java_path {
        return Ok(state.snapshot.clone());
    }
    let stored = state.stored.clone();
    let previous = state.snapshot.clone();
    drop(state);
    let root = &manifest.mod_root;
    let files = build_files(root)?;
    let stamp = fingerprint(&manifest, &java, &stored.settings, &files)?;
    let settings = stored.settings.clone();
    let mode = if Path::new(root)
        .file_name()
        .is_some_and(|name| name == "starsector-core")
    {
        "core"
    } else if settings.build_mode == JavaBuildMode::Gradle {
        "gradle"
    } else {
        "manual"
    };
    let model = stored.model.as_ref().filter(|_| mode == "gradle");
    let selected = model.and_then(|model| {
        model
            .projects
            .iter()
            .find(|project| settings.project.as_ref() == Some(&project.path))
            .or_else(|| model.projects.iter().find(|project| project.path == ":"))
            .or_else(|| (model.projects.len() == 1).then(|| &model.projects[0]))
    });
    let defaults = if Path::new(root).join("src").is_dir() {
        vec!["src".into()]
    } else {
        Vec::new()
    };
    let sources = if let Some(selected) = selected {
        paths(root, &selected.sources)?
    } else if model.is_some() {
        Vec::new()
    } else {
        paths(root, settings.sources.as_ref().unwrap_or(&defaults))?
    };
    let libraries = if let Some(selected) = selected {
        selected.libraries.clone()
    } else {
        paths(root, &settings.libraries)?
    };
    let game_jars: Vec<String> = manifest
        .mod_info
        .as_ref()
        .and_then(|info| info.get("jars"))
        .map(|jars| serde_json::from_value(jars.clone()))
        .transpose()?
        .unwrap_or_default();
    let primary = artifacts::primary_jar(&settings, &game_jars);
    let artifacts = if mode == "gradle" {
        selected
            .map(|selected| selected.artifacts.clone())
            .unwrap_or_default()
    } else {
        primary.clone().into_iter().collect()
    };
    let source_count = inputs::source_files(&sources)?.len();
    let missing = sources
        .iter()
        .chain(libraries.iter())
        .chain(game_jars.iter())
        .filter(|path| !Path::new(root).join(path).exists())
        .cloned()
        .collect();
    let mut snapshot = previous.clone();
    snapshot.revision += 1;
    snapshot.mod_root = io::forward_slash_path(Path::new(root));
    let info = manifest.mod_info.as_ref();
    snapshot.version = info
        .and_then(|info| info.get("version"))
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string())
        })
        .unwrap_or_default();
    snapshot.mode = mode.into();
    snapshot.sources = sources;
    snapshot.libraries = libraries;
    snapshot.game_jars = game_jars;
    snapshot.artifacts = artifacts;
    snapshot.tasks = model.map(|model| model.tasks.clone()).unwrap_or_default();
    snapshot.choices = model
        .map(|model| {
            model
                .projects
                .iter()
                .map(|project| project.path.clone())
                .collect()
        })
        .unwrap_or_default();
    snapshot.selected_project = selected.map(|project| project.path.clone());
    snapshot.source_count = source_count;
    snapshot.missing = missing;
    snapshot.java_path = java;
    snapshot.gradle = None;
    snapshot.gradle_error = None;
    if mode == "gradle" {
        match gradle::installation(Path::new(root), &settings.gradle) {
            Ok(installation) => snapshot.gradle = Some(installation),
            Err(error) => snapshot.gradle_error = Some(error.diagnostic()),
        }
    }
    snapshot.target = DEFAULT_LANGUAGE.into();
    snapshot.build_files = files;
    snapshot.stale = mode == "gradle" && (model.is_none() || stamp != stored.fingerprint);
    snapshot.configuration_error = None;
    if model.is_some_and(|model| model.projects.len() > 1) && selected.is_none() {
        snapshot.configuration_error = Some(
            AppError::message("java_project.selection", "请选择需要使用的 Java 子项目")
                .diagnostic(),
        );
    }
    if snapshot.configuration_error.is_some() && previous.mode == "gradle" {
        snapshot.sources.clone_from(&previous.sources);
        snapshot.libraries.clone_from(&previous.libraries);
        snapshot.source_count = previous.source_count;
    }
    snapshot.settings = settings;
    snapshot.configuration.clone_from(&stamp);
    snapshot.primary_jar = primary;
    snapshot.deploy_targets = artifacts::deploy_targets(&snapshot.settings, &snapshot.game_jars);
    snapshot.build.clone_from(&stored.build);
    let same_build = previous.build.as_ref().map(|build| &build.id)
        == snapshot.build.as_ref().map(|build| &build.id);
    if let Some(build) = &mut snapshot.build {
        build.inputs_changed |= same_build
            && previous
                .build
                .as_ref()
                .is_some_and(|previous| previous.inputs_changed);
        if invalidated || stamp != stored.build_configuration {
            build.inputs_changed |= stamp != stored.build_configuration
                || stored
                    .build_versions
                    .iter()
                    .map(|version| io::file_version(Path::new(&version.path)))
                    .collect::<AppResult<Vec<_>>>()?
                    != stored.build_versions;
        }
    }
    let mut state = entry.state.lock().map_err(unavailable)?;
    if state.snapshot.revision != previous.revision {
        drop(state);
        return describe(entry, false);
    }
    state.snapshot = snapshot.clone();
    state.input_generation = generation;
    Ok(snapshot)
}
