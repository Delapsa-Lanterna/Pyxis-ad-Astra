use super::configuration::{build_files, fingerprint, persist};
use super::snapshot::{describe, refresh_task};
use super::{JavaProject, artifacts, build, environment, gradle, process, unavailable};
use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::java_project::{JavaProjectOperation, JavaProjectSnapshot, JavaTaskPhase};
use crate::services::project;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Default)]
pub(super) struct TaskReceipt {
    result: Mutex<Option<JavaProjectSnapshot>>,
    changed: Condvar,
}
impl TaskReceipt {
    fn deliver(&self, snapshot: JavaProjectSnapshot) -> AppResult<()> {
        *self.result.lock().map_err(unavailable)? = Some(snapshot);
        self.changed.notify_all();
        Ok(())
    }
    pub(super) fn wait(&self) -> AppResult<JavaProjectSnapshot> {
        let mut result = self.result.lock().map_err(unavailable)?;
        while result.is_none() {
            result = self.changed.wait(result).map_err(unavailable)?;
        }
        Ok(result
            .as_ref()
            .expect("completed task owns its receipt")
            .clone())
    }
}

pub(super) fn log(entry: &JavaProject) -> AppResult<PathBuf> {
    Ok(PathBuf::from(
        entry
            .state
            .lock()
            .map_err(unavailable)?
            .snapshot
            .task_result
            .log_path
            .as_ref()
            .expect("running task owns its log"),
    ))
}
pub(super) fn stage(entry: &JavaProject, task: &str) -> AppResult<()> {
    let mut state = entry.state.lock().map_err(unavailable)?;
    state.snapshot.task_result.task = task.into();
    state.snapshot.revision += 1;
    diagnostics::debug("java_project.task_stage", || {
        json!({"sessionId":entry.session,"taskId":state.snapshot.task_result.task_id,"task":task})
            .to_string()
    });
    Ok(())
}
pub(super) fn run_process(entry: &JavaProject, command: &mut Command, log: &Path) -> AppResult<()> {
    let status = process::run(entry, command, log)?;
    entry
        .state
        .lock()
        .map_err(unavailable)?
        .snapshot
        .task_result
        .exit_code = status.code();
    if entry.cancelled.load(Ordering::Acquire) {
        return Err(AppError::message(
            "java_project.cancelled",
            "Project operation cancelled",
        ));
    }
    if status.success() {
        return Ok(());
    }
    let output = process::tail(log)?;
    let offline = output.contains("offline mode") || output.contains("No cached version");
    let error = AppError::message(
        if offline {
            "java_project.offline"
        } else {
            "java_project.execution"
        },
        format!("工程任务退出：{status}，详情见任务输出。"),
    );
    let locations = process::locations(&output);
    Err(if let Some(location) = locations.first() {
        error
            .at_path(location.path.as_ref().expect("parsed diagnostic path"))
            .at_position(location.line.expect("parsed diagnostic line"), None)
    } else {
        error.at_path(log)
    })
}
pub(super) fn operate(
    entry: &Arc<JavaProject>,
    owner: &str,
    operation: &JavaProjectOperation,
    expected: Option<&str>,
) -> AppResult<JavaProjectSnapshot> {
    let snapshot = describe(entry, true)?;
    let captured = snapshot.configuration.clone();
    let online = match operation {
        JavaProjectOperation::Sync { online } | JavaProjectOperation::Build { online, .. } => {
            *online
        }
        JavaProjectOperation::Detect => false,
    };
    let id = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock")
        .as_nanos()
        .to_string();
    let log = entry
        .file
        .parent()
        .expect("project directory")
        .join(format!("operation-{id}.log"));
    let receipt = {
        let mut state = entry.state.lock().map_err(unavailable)?;
        if expected.is_some_and(|expected| expected != state.snapshot.configuration) {
            return Err(AppError::message(
                "java_project.stale",
                "已确认的工程配置已变化，请重新确认",
            ));
        }
        if state.snapshot.active {
            if state.snapshot.task_result.operation.as_ref() != Some(operation) {
                return Err(AppError::message(
                    "java_project.busy",
                    "当前项目已有运行中的任务",
                ));
            }
            diagnostics::debug("java_project.task_joined", || {
                json!({"sessionId":entry.session,"taskId":state.snapshot.task_result.task_id})
                    .to_string()
            });
            // Waiters retain this receipt while the project slot accepts later tasks.
            let receipt = state
                .receipt
                .as_ref()
                .expect("active task owns its receipt")
                .clone();
            drop(state);
            return receipt.wait();
        }
        if state.stored.settings != snapshot.settings
            || state.snapshot.sources != snapshot.sources
            || state.snapshot.artifacts != snapshot.artifacts
            || state.snapshot.libraries != snapshot.libraries
            || state.snapshot.configuration != captured
            || (matches!(operation, JavaProjectOperation::Build { .. }) && snapshot.stale)
        {
            return Err(AppError::message(
                "java_project.stale",
                "工程配置已变化，请重新同步并确认构建",
            ));
        }
        entry.cancelled.store(false, Ordering::Release);
        state.owner = owner.into();
        state.snapshot.task_result.operation = Some(operation.clone());
        state.snapshot.task_result.task_mode = snapshot.settings.build_mode;
        state.snapshot.task_result.task_id = Some(id.clone());
        state.snapshot.active = true;
        state.snapshot.task_result.phase = JavaTaskPhase::Running;
        state.snapshot.task_result.task.clear();
        state.snapshot.task_result.exit_code = None;
        state.snapshot.task_result.error = None;
        state.snapshot.output.clear();
        state.snapshot.task_result.log_path = Some(io::forward_slash_path(&log));
        state.snapshot.revision += 1;
        let receipt = Arc::new(TaskReceipt::default());
        state.receipt = Some(Arc::clone(&receipt));
        receipt
    };
    let started = Instant::now();
    diagnostics::info("java_project.task_started", &json!({"sessionId":entry.session,"taskId":id,"operation":operation,"modRoot":snapshot.mod_root}).to_string());
    let result = (|| {
        fs::create_dir_all(log.parent().expect("task log parent"))?;
        io::write_utf8_no_bom(&log, "")?;
        match operation {
            JavaProjectOperation::Build {
                tasks, arguments, ..
            } => {
                let (result, versions) = build::run(entry, &snapshot, tasks, arguments, online)?;
                let mut state = entry.state.lock().map_err(unavailable)?;
                let mut stored = state.stored.clone();
                let previous = stored.build.replace(result);
                stored.build_versions = versions;
                stored.build_configuration.clone_from(&captured);
                persist(entry, &stored)?;
                state.stored = stored;
                drop(state);
                if let Some(previous) = previous {
                    artifacts::release(entry, &previous.id)?;
                }
            }
            JavaProjectOperation::Sync { .. } | JavaProjectOperation::Detect => {
                stage(
                    entry,
                    if matches!(operation, JavaProjectOperation::Detect) {
                        "检测环境"
                    } else {
                        "同步项目配置"
                    },
                )?;
                if let Some(model) = gradle::synchronize(
                    entry,
                    &snapshot,
                    online,
                    matches!(operation, JavaProjectOperation::Detect),
                )? {
                    let manifest = project::current_project_manifest(&entry.session)?;
                    let stamp = fingerprint(
                        &manifest,
                        &environment::selected_java_path(&entry.session)?,
                        &snapshot.settings,
                        &build_files(&manifest.mod_root)?,
                    )?;
                    if stamp != captured {
                        return Err(AppError::message(
                            "java_project.stale",
                            "同步期间工程配置已变化，请重新同步",
                        ));
                    }
                    let mut state = entry.state.lock().map_err(unavailable)?;
                    let mut stored = state.stored.clone();
                    stored.model = Some(model);
                    stored.fingerprint = stamp;
                    persist(entry, &stored)?;
                    state.stored = stored;
                }
            }
        }
        Ok(())
    })()
    .and_then(|()| refresh_task(entry).map(|_| ()));
    if result.is_err() && matches!(operation, JavaProjectOperation::Build { .. }) {
        artifacts::release(entry, &id)?;
    }
    let output = process::tail(&log);
    let mut state = entry.state.lock().map_err(unavailable)?;
    if let Ok(output) = &output {
        state.snapshot.output.clone_from(output);
        state.snapshot.locations = process::locations(output);
    }
    let result = result.and(output);
    state.snapshot.task_result.phase = if entry.cancelled.load(Ordering::Acquire) {
        JavaTaskPhase::Cancelled
    } else if result.is_ok() {
        JavaTaskPhase::Succeeded
    } else {
        JavaTaskPhase::Failed
    };
    if let Err(error) = result
        && state.snapshot.task_result.phase != JavaTaskPhase::Cancelled
    {
        if !online
            && matches!(
                error.code(),
                "java_project.offline" | "java_project.wrapper_download"
            )
        {
            state.snapshot.task_result.phase = JavaTaskPhase::OfflineFailed;
        }
        state.snapshot.task_result.error = Some(error.diagnostic());
        let context = json!({"sessionId":entry.session,"taskId":id,"modRoot":snapshot.mod_root});
        if error.code().starts_with("java_project.") && error.code() != "java_project.state" {
            diagnostics::failure("java_project.task_failed", error, context);
        } else {
            diagnostics::fault("java_project.task_failed", error, context);
        }
    }
    state.snapshot.task_result.milliseconds = started.elapsed().as_secs_f64() * 1000.;
    state.stored.last_task = Some(state.snapshot.task_result.clone());
    let persisted = persist(entry, &state.stored);
    if let Err(error) = persisted {
        diagnostics::fault(
            "java_project.task_persistence_failed",
            AppError::message(error.code(), error.to_string()),
            json!({"sessionId":entry.session,"taskId":id}),
        );
        state.snapshot.task_result.phase = JavaTaskPhase::Failed;
        state.snapshot.task_result.error = Some(error.diagnostic());
        let diagnostic = state.snapshot.task_result.error.clone();
        let stored = state
            .stored
            .last_task
            .as_mut()
            .expect("finished task owns its result");
        stored.phase = JavaTaskPhase::Failed;
        stored.error = diagnostic;
    }
    state.snapshot.active = false;
    state.snapshot.revision += 1;
    entry.changed.notify_all();
    diagnostics::info("java_project.task_completed", &json!({"sessionId":entry.session,"taskId":id,"task":state.snapshot.task_result.task,"phase":state.snapshot.task_result.phase,"exitCode":state.snapshot.task_result.exit_code,"milliseconds":state.snapshot.task_result.milliseconds,"artifactBytes":state.stored.build.as_ref().filter(|build|build.id==id).map(|build|build.artifacts.iter().map(|artifact|artifact.bytes).sum::<u64>())}).to_string());
    let result = state.snapshot.clone();
    receipt.deliver(result.clone())?;
    state.receipt = None;
    state.owner.clear();
    Ok(result)
}

pub(super) fn cancel(entry: &JavaProject) -> AppResult<()> {
    entry.cancelled.store(true, Ordering::Release);
    let mut state = entry.state.lock().map_err(unavailable)?;
    while state.snapshot.active {
        state = entry.changed.wait(state).map_err(unavailable)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::TaskReceipt;
    use crate::models::java_project::{JavaProjectSnapshot, JavaTaskResult};
    use std::sync::{Arc, Barrier};
    use std::thread;
    #[test]
    fn delayed_waiter_keeps_its_receipt_after_a_later_task_completes() {
        let receipt = Arc::new(TaskReceipt::default());
        let gate = Arc::new(Barrier::new(2));
        let owned = Arc::clone(&receipt);
        let ready = Arc::clone(&gate);
        let waiter = thread::spawn(move || {
            ready.wait();
            owned.wait().unwrap()
        });
        receipt
            .deliver(JavaProjectSnapshot {
                task_result: JavaTaskResult {
                    task_id: Some("first".into()),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap();
        let next = TaskReceipt::default();
        next.deliver(JavaProjectSnapshot {
            task_result: JavaTaskResult {
                task_id: Some("next".into()),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
        gate.wait();
        assert_eq!(
            waiter.join().unwrap().task_result.task_id.as_deref(),
            Some("first")
        );
        assert_eq!(
            next.wait().unwrap().task_result.task_id.as_deref(),
            Some("next")
        );
    }
}
