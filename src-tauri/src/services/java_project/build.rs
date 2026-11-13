use super::inputs::{JavaInputExtras, inputs_for_session, source_files};
use super::process::JAVA_ENCODING;
use super::{JavaProject, gradle, tasks, unavailable};
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::io::FsRootBoundary;
use crate::models::java_project::{JavaArtifact, JavaBuildResult, JavaProjectSnapshot};
use crate::models::{FileVersion, windows_path_key};
use pyxis_java_analysis::java_path;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::time::Instant;

pub(super) fn stamp(
    snapshot: &JavaProjectSnapshot,
    libraries: &[String],
) -> AppResult<Vec<FileVersion>> {
    snapshot
        .sources
        .iter()
        .map(PathBuf::from)
        .chain(snapshot.build_files.iter().map(PathBuf::from))
        .chain(libraries.iter().map(PathBuf::from))
        .map(|path| io::file_version(&path))
        .collect()
}
pub(super) fn run(
    entry: &JavaProject,
    snapshot: &JavaProjectSnapshot,
    requested: &[String],
    arguments: &[String],
    online: bool,
) -> AppResult<(JavaBuildResult, Vec<FileVersion>)> {
    let started = Instant::now();
    let mut before = stamp(snapshot, &[])?;
    let classpath = if snapshot.mode == "gradle" {
        before.extend(
            snapshot
                .libraries
                .iter()
                .map(|path| io::file_version(Path::new(path)))
                .collect::<AppResult<Vec<_>>>()?,
        );
        snapshot.libraries.clone()
    } else {
        let mut inputs = inputs_for_session(&entry.session, &JavaInputExtras::default())?;
        let boundary = FsRootBoundary::new(Path::new(&snapshot.mod_root), "Build root")?;
        let output = snapshot
            .primary_jar
            .as_ref()
            .map(|path| boundary.resolve_relative_target(path, "Build output"))
            .transpose()?;
        inputs.classpath.retain(|path| {
            output.as_ref().is_none_or(|output| {
                windows_path_key(path) != windows_path_key(&output.to_string_lossy())
            })
        });
        before.extend(inputs.jar_versions.into_iter().filter(|version| {
            inputs
                .classpath
                .iter()
                .any(|path| windows_path_key(path) == windows_path_key(&version.path))
        }));
        inputs.classpath
    };
    let files = source_files(&snapshot.sources)?;
    let id = entry
        .state
        .lock()
        .map_err(unavailable)?
        .snapshot
        .task_result
        .task_id
        .clone()
        .expect("running build owns an identity");
    let jar_bytes = classpath
        .iter()
        .map(|path| fs::metadata(path).map(|metadata| metadata.len()))
        .sum::<Result<u64, _>>()?;
    diagnostics::debug("java_project.build_inputs", || {
        json!({"sessionId":entry.session,"taskId":id,"sources":files.len(),"sourceRoots":snapshot.sources.len(),"jars":classpath.len(),"jarBytes":jar_bytes,"milliseconds":started.elapsed().as_secs_f64()*1000.}).to_string()
    });
    let directory = entry
        .file
        .parent()
        .expect("project configuration directory")
        .join(format!("build-{id}"));
    fs::create_dir_all(&directory)?;
    let log = tasks::log(entry)?;
    let result = (|| {
        let (task, paths, inputs_changed, extra_inputs) = if snapshot.mode == "gradle" {
            let task = requested
                .iter()
                .chain(arguments)
                .cloned()
                .collect::<Vec<_>>()
                .join(" ");
            tasks::stage(entry, &task)?;
            let model = gradle::run_task(entry, snapshot, online, requested, arguments)?;
            (
                task,
                model.outputs,
                model.inputs_changed,
                model
                    .input_files
                    .into_iter()
                    .chain(
                        model
                            .projects
                            .into_iter()
                            .flat_map(|project| project.resources),
                    )
                    .collect::<Vec<_>>(),
            )
        } else {
            tasks::stage(entry, "javac + jar")?;
            (
                "javac + jar".into(),
                vec![manual(
                    entry, snapshot, &directory, &log, &classpath, &files,
                )?],
                false,
                Vec::new(),
            )
        };
        if entry.cancelled.load(Ordering::Acquire) {
            return Err(AppError::message("java_project.cancelled", "构建已取消"));
        }
        let artifacts = paths
            .into_iter()
            .enumerate()
            .map(|(index, path)| {
                let bytes = fs::metadata(&path)?.len();
                let version = io::file_version(Path::new(&path))?;
                Ok(JavaArtifact {
                    id: format!("{id}:{index}"),
                    path,
                    bytes,
                    fingerprint: version.fingerprint.expect("existing artifact"),
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        let mut after = stamp(snapshot, &classpath)?;
        let changed = inputs_changed || before != after;
        for path in extra_inputs {
            let canonical = io::canonical_path(Path::new(&path), "Gradle input")?;
            if !snapshot
                .sources
                .iter()
                .any(|root| canonical.starts_with(Path::new(root)))
                && !after
                    .iter()
                    .any(|version| windows_path_key(&version.path) == windows_path_key(&path))
            {
                after.push(io::file_version(&canonical)?);
            }
        }
        Ok((
            JavaBuildResult {
                mode: snapshot.settings.build_mode,
                id,
                task,
                artifacts,
                inputs_changed: changed,
                milliseconds: started.elapsed().as_secs_f64() * 1000.,
            },
            after,
        ))
    })();
    if result.is_err() || snapshot.mode == "gradle" {
        fs::remove_dir_all(&directory)?;
    }
    result
}
pub(super) fn manual(
    entry: &JavaProject,
    snapshot: &JavaProjectSnapshot,
    directory: &Path,
    log: &Path,
    classpath: &[String],
    files: &[PathBuf],
) -> AppResult<String> {
    let java = snapshot
        .java_path
        .as_ref()
        .ok_or_else(|| AppError::message("java_project.jdk", "请在设置中选择完整 JDK (至少 17)"))?;
    let java = java_path(&io::canonical_path(Path::new(java), "Build Java")?);
    let bin = java.parent().expect("Java bin");
    let javac = bin.join("javac.exe");
    let jar = bin.join("jar.exe");
    if !javac.is_file() || !jar.is_file() {
        return Err(AppError::message(
            "java_project.jdk",
            "此操作需要完整 JDK，请在设置中选择其 java.exe (至少 17)",
        ));
    }
    if files.is_empty() {
        return Err(AppError::message(
            "java_project.source",
            "工程没有 Java 源文件",
        ));
    }
    let target = snapshot
        .primary_jar
        .as_ref()
        .ok_or_else(|| AppError::message("java_project.jar", "请先设置主 JAR 路径"))?;
    let primary = Path::new(&snapshot.mod_root).join(target);
    let classes = directory.join("classes");
    fs::create_dir(&classes)?;
    let quoted = |path: &Path| format!("\"{}\"", io::forward_slash_path(&java_path(path)));
    let arguments = directory.join("sources.args");
    io::write_utf8_no_bom(
        &arguments,
        &files
            .iter()
            .map(|path| quoted(path))
            .collect::<Vec<_>>()
            .join("\n"),
    )?;
    tasks::run_process(
        entry,
        Command::new(&javac)
            .args(JAVA_ENCODING.map(|option| format!("-J{option}")))
            .args([
                "--release",
                &snapshot.target,
                "-encoding",
                "UTF-8",
                "-proc:none",
                "-implicit:none",
                "-d",
            ])
            .arg(&classes)
            .arg("-classpath")
            .arg(classpath.join(";"))
            .arg(format!("@{}", arguments.display())),
        log,
    )?;
    let output = directory.join(primary.file_name().expect("JAR filename"));
    tasks::run_process(
        entry,
        Command::new(&jar)
            .args(JAVA_ENCODING.map(|option| format!("-J{option}")))
            .args(["--create", "--file"])
            .arg(&output)
            .arg("-C")
            .arg(&classes)
            .arg("."),
        log,
    )?;
    fs::remove_dir_all(classes)?;
    fs::remove_file(arguments)?;
    Ok(io::forward_slash_path(&output))
}
