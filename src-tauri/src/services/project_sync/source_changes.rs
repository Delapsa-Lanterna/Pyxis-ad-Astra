use super::{SaveTask, enqueue, execute_queued, publish_references, saves};
use crate::errors::{AppError, AppResult, ErrorDiagnostic};
use crate::io::FsRootBoundary;
use crate::models::{
    CommittedSessionUpdate, EntityIdentityChange, ProjectManifest, ProjectSyncDelivery,
    ResourceSource, SourceSyncState, WriteResult, windows_path_key,
};
use crate::services::project::PerformanceTrace;
use crate::services::source_watch::{self, SourceChangeBatch, SourceSubscription};
use crate::services::{project, project_session, windows};
use crate::{diagnostics, io, services};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, LazyLock, Mutex};
use std::thread;
use std::time::Instant;
use tauri::AppHandle;

pub(super) struct RootSubscription {
    watch: SourceSubscription,
    source: ResourceSource,
}
pub(super) static SOURCE_WATCHES: LazyLock<Mutex<BTreeMap<String, RootSubscription>>> =
    LazyLock::new(Default::default);
static SOURCE_REQUEST: AtomicU64 = AtomicU64::new(0);
struct QueuedSource {
    batch: SourceChangeBatch,
    task: Option<Arc<SaveTask>>,
}
type SourceBatches = (Mutex<BTreeMap<String, Option<QueuedSource>>>, Condvar);
static SOURCE_BATCHES: LazyLock<SourceBatches> = LazyLock::new(Default::default);

pub(super) fn enqueue_source_batch(batch: SourceChangeBatch) {
    let root = batch.root.clone();
    let result = (|| -> AppResult<()> {
        let key = windows_path_key(&root);
        let mut lanes = SOURCE_BATCHES
            .0
            .lock()
            .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?;
        if let Some(Some(queued)) = lanes.get_mut(&key) {
            queued.batch.paths.extend(batch.paths);
            queued.batch.renames.extend(batch.renames);
            queued.batch.rescan |= batch.rescan;
            if batch.diagnostic.is_some() {
                queued.batch.diagnostic = batch.diagnostic;
            }
            return Ok(());
        }
        let task = project::registered_mod_session(&root)?
            .map(|session_id| {
                enqueue(
                    "source-watch",
                    format!("source:{}", SOURCE_REQUEST.fetch_add(1, Ordering::Relaxed)),
                    &root,
                    Some(&session_id),
                )
            })
            .transpose()?;
        let running = lanes
            .insert(key.clone(), Some(QueuedSource { batch, task }))
            .is_some();
        if running {
            return Ok(());
        }
        drop(lanes);
        thread::spawn(move || {
            loop {
                let queued = {
                    let mut lanes = SOURCE_BATCHES
                        .0
                        .lock()
                        .expect("source lanes remain available");
                    match lanes
                        .get_mut(&key)
                        .expect("source worker owns its lane")
                        .take()
                    {
                        Some(queued) => queued,
                        None => {
                            lanes.remove(&key);
                            SOURCE_BATCHES.1.notify_all();
                            return;
                        }
                    }
                };
                consume_queued_source_batch(queued.batch, queued.task);
            }
        });
        Ok(())
    })();
    if let Err(error) = result {
        diagnostics::failure("source.enqueue_failed", error, json!({"root":root}));
    }
}

pub(super) fn wait_source_batches(root: &str) -> AppResult<()> {
    let mut lanes = SOURCE_BATCHES
        .0
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?;
    while lanes.contains_key(&windows_path_key(root)) {
        lanes = SOURCE_BATCHES
            .1
            .wait(lanes)
            .map_err(|_| AppError::message("source.watch_lock", "来源监听等待失败"))?;
    }
    Ok(())
}
#[cfg(test)]
pub(super) fn source_batch_running(root: &str) -> bool {
    SOURCE_BATCHES
        .0
        .lock()
        .unwrap()
        .get(&windows_path_key(root))
        .is_some_and(Option::is_none)
}

pub fn begin_source_watch(root: &Path) -> AppResult<SourceSubscription> {
    source_watch::subscribe(root, enqueue_source_batch)
}
pub fn open_project_session(
    app: AppHandle,
    mod_root: String,
    core: Option<String>,
) -> AppResult<ProjectManifest> {
    let (root, core) = project_session::resolve_project_session_roots(app, mod_root, core)?;
    let subscription = begin_source_watch(&root);
    let core_subscription = core.as_deref().map(|root| {
        project::core_dir(&root.to_string_lossy()).and_then(|root| begin_source_watch(&root))
    });
    let manifest = project::open_project_session_traced(
        &root,
        core.as_deref(),
        &mut PerformanceTrace::new("project.openSession"),
    )?;
    if let Err(error) = subscription.and_then(|subscription| {
        retain_source_watch(
            manifest.session_id.clone(),
            subscription,
            ResourceSource::Mod,
        )
    }) {
        diagnostics::failure(
            "source.watch_registration_failed",
            error,
            json!({"root":manifest.mod_root,"sessionId":manifest.session_id}),
        );
    }
    if let Some(subscription) = core_subscription
        && let Err(error) = subscription.and_then(|subscription| {
            retain_source_watch(
                format!("core:{}", manifest.session_id),
                subscription,
                ResourceSource::Core,
            )
        })
    {
        diagnostics::failure(
            "source.watch_registration_failed",
            error,
            json!({"root":manifest.starsector_root}),
        );
    }
    Ok(manifest)
}
pub fn set_window_core_subscription(label: &str, game: Option<&str>) -> AppResult<()> {
    let canonical = game
        .map(|game| {
            FsRootBoundary::new(Path::new(game), "starsector root")
                .map(|boundary| boundary.root().to_string_lossy().into_owned())
        })
        .transpose()?;
    let game = canonical.as_deref();
    let subscription = game
        .map(|game| project::core_dir(game).and_then(|root| begin_source_watch(&root)))
        .transpose()?;
    let mut state = saves()?;
    state
        .windows
        .get_mut(label)
        .ok_or_else(|| AppError::message("source.watch_closed", "来源窗口已释放"))?
        .core_root = game.map(str::to_string);
    if let Some(subscription) = &subscription
        && let Some(delivery) = state
            .source_states
            .get(&windows_path_key(subscription.root()))
    {
        state.windows[label].channel.send(delivery.clone())?;
    }
    drop(state);
    let owner = format!("core-window:{label}");
    match subscription {
        Some(subscription) => retain_source_watch(owner, subscription, ResourceSource::Core),
        None => release_source_watch(&owner),
    }
}
pub fn retain_source_watch(
    owner: String,
    mut subscription: SourceSubscription,
    source: ResourceSource,
) -> AppResult<()> {
    let mut watched = SOURCE_WATCHES
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?;
    subscription.activate()?;
    let previous = watched.insert(
        owner,
        RootSubscription {
            watch: subscription,
            source,
        },
    );
    drop(watched);
    finish_source_release(previous)
}
pub fn retry_source_watch(label: &str, root: &str) -> AppResult<()> {
    let path = io::canonical_path(Path::new(root), "watch root")?;
    let root = &*path.to_string_lossy();
    if !saves()?.windows.get(label).is_some_and(|window| {
        window.belongs_to(root)
            || window.core_root.as_ref().is_some_and(|game| {
                windows_path_key(&Path::new(game).join("starsector-core").to_string_lossy())
                    == windows_path_key(root)
            })
    }) {
        return Err(AppError::message(
            "source.watch_scope",
            "来源监听不属于当前窗口",
        ));
    }
    publish_source_status(root, SourceSyncState::Scanning, None)?;
    let result = (|| {
        let watched = SOURCE_WATCHES
            .lock()
            .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?;
        watched
            .values()
            .find(|subscription| {
                windows_path_key(subscription.watch.root()) == windows_path_key(root)
            })
            .ok_or_else(|| AppError::message("source.watch_closed", "来源监听已释放"))?
            .watch
            .retry()
    })();
    if let Err(error) = &result {
        publish_source_status(root, SourceSyncState::Failed, Some(error.diagnostic()))?;
    }
    result
}
pub(super) fn release_source_watch(owner: &str) -> AppResult<()> {
    let subscription = SOURCE_WATCHES
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?
        .remove(owner);
    finish_source_release(subscription)
}
fn finish_source_release(subscription: Option<RootSubscription>) -> AppResult<()> {
    let root = subscription
        .as_ref()
        .map(|subscription| subscription.watch.root().to_string());
    drop(subscription);
    if let Some(root) = root {
        let watched = SOURCE_WATCHES
            .lock()
            .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?;
        let retained = watched.values().any(|subscription| {
            windows_path_key(subscription.watch.root()) == windows_path_key(&root)
        });
        drop(watched);
        if !retained {
            wait_source_batches(&root)?;
            publish_source_status(&root, SourceSyncState::Released, None)?;
        }
    }
    Ok(())
}
pub(super) fn publish_source_status(
    root: &str,
    state: SourceSyncState,
    diagnostic: Option<ErrorDiagnostic>,
) -> AppResult<()> {
    let registered_source = SOURCE_WATCHES
        .lock()
        .map_err(|_| AppError::message("source.watch_lock", "来源监听状态不可用"))?
        .values()
        .find(|subscription| windows_path_key(subscription.watch.root()) == windows_path_key(root))
        .map(|subscription| subscription.source);
    let source = match registered_source {
        Some(source) => source,
        None if project::registered_mod_session(root)?.is_some() => ResourceSource::Mod,
        None => ResourceSource::Core,
    };
    let mut saves = saves()?;
    if matches!(state, SourceSyncState::Watching)
        && diagnostic.is_none()
        && matches!(saves.source_states.get(&windows_path_key(root)),Some(ProjectSyncDelivery::SourceStatus{source:prior,state:SourceSyncState::Watching,diagnostic:None,..}) if *prior==source)
    {
        return Ok(());
    }
    let delivery = ProjectSyncDelivery::SourceStatus {
        root: root.into(),
        source,
        state,
        diagnostic,
    };
    if matches!(state, SourceSyncState::Released) {
        saves.source_states.remove(&windows_path_key(root));
    } else {
        saves
            .source_states
            .insert(windows_path_key(root), delivery.clone());
    }
    for window in saves.windows.values().filter(|window| {
        window.belongs_to(root)
            || window.core_root.as_ref().is_some_and(|game| {
                windows_path_key(&Path::new(game).join("starsector-core").to_string_lossy())
                    == windows_path_key(root)
            })
    }) {
        if let Err(error) = window.channel.send(delivery.clone()) {
            diagnostics::failure("source.status_delivery_failed", error, json!({"root":root}));
        }
    }
    Ok(())
}
#[cfg(test)]
pub(super) fn consume_source_batch(batch: SourceChangeBatch) {
    consume_queued_source_batch(batch, None);
}
fn consume_queued_source_batch(batch: SourceChangeBatch, queued: Option<Arc<SaveTask>>) {
    let root = batch.root.clone();
    let started = Instant::now();
    let result = (|| -> AppResult<()> {
        if let Some(diagnostic) = &batch.diagnostic {
            publish_source_status(&root, SourceSyncState::Failed, Some(diagnostic.clone()))?;
        }
        consume_core_batch(&batch)?;
        let mut manifests = Vec::new();
        for manifest in project::registered_manifests(&root, ResourceSource::Mod)? {
            if windows::accepts_save("source-watch", Some(&manifest.session_id))? {
                manifests.push(manifest);
            }
        }
        let Some(first) = manifests.first() else {
            if let Some(task) = &queued {
                execute_queued(
                    task.clone(),
                    &root,
                    task.session_id.as_deref(),
                    "refresh",
                    |_, _| Ok(WriteResult::<()>::from_changes(Vec::new())),
                )?;
            }
            return Ok(());
        };
        let task = match queued {
            Some(task) => task,
            None => enqueue(
                "source-watch",
                format!("source:{}", SOURCE_REQUEST.fetch_add(1, Ordering::Relaxed)),
                &root,
                Some(&first.session_id),
            )?,
        };
        let paths = batch
            .paths
            .iter()
            .map(|path| path.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let result = execute_queued(task, &root, Some(&first.session_id), "refresh", |_, _| {
            let mut paths = paths.clone();
            let mut targets = Vec::new();
            for manifest in &manifests {
                if batch.rescan {
                    paths.extend(windows::project_source_paths(&manifest.session_id)?);
                }
                targets.extend(
                    project::loaded_source_targets(&manifest.session_id)?
                        .into_iter()
                        .map(|target| (manifest.session_id.clone(), target)),
                );
            }
            let ids = manifests
                .iter()
                .map(|manifest| manifest.session_id.clone())
                .collect::<Vec<_>>();
            let mut result = project::refresh_mod_root_sources(&root, &ids, &paths, batch.rescan)?;
            let renames = batch
                .renames
                .iter()
                .map(|(before, after)| {
                    (
                        before.to_string_lossy().into_owned(),
                        after.to_string_lossy().into_owned(),
                    )
                })
                .collect::<Vec<_>>();
            if !renames.is_empty() {
                for update in &mut result.session_updates {
                    Arc::make_mut(&mut update.content).invalidation.renames = Some(renames.clone());
                }
            }
            for (session_id, before) in targets {
                let key = windows_path_key(&before.write.path);
                let renamed = renames.iter().find_map(|(old, new)| {
                    Path::new(&key)
                        .strip_prefix(windows_path_key(old))
                        .ok()
                        .map(|suffix| {
                            if suffix.as_os_str().is_empty() {
                                Path::new(new).to_path_buf()
                            } else {
                                Path::new(new).join(suffix)
                            }
                        })
                });
                let affected = result
                    .invalidation
                    .paths
                    .iter()
                    .any(|path| io::relative_path_contains(&windows_path_key(path), &key));
                if let Some(after_path) = renamed
                    .or_else(|| affected.then(|| Path::new(&before.write.path).to_path_buf()))
                    && let Some(after) = services::query_file_entity_target(
                        &session_id,
                        &after_path.to_string_lossy(),
                    )?
                    && before.kind == after.target.kind
                    && (before.id != after.target.id
                        || windows_path_key(&before.write.path)
                            != windows_path_key(&after.target.write.path))
                    && !result
                        .identity_changes
                        .iter()
                        .any(|change| change.before == before && change.after == after.target)
                {
                    result.identity_changes.push(EntityIdentityChange {
                        before,
                        after: after.target,
                    });
                }
            }
            Ok(result)
        })?;
        for update in &result.session_updates {
            if let Some(snapshot) = project::reference_sources_changed(Some(&update.session_id))? {
                publish_references(snapshot, project::reference_updates()?)?;
            }
        }
        publish_source_status(
            &root,
            if batch.diagnostic.is_some() {
                SourceSyncState::Failed
            } else {
                SourceSyncState::Watching
            },
            batch.diagnostic.clone(),
        )
    })();
    diagnostics::debug("source.batch", || {
        json!({"root":root,"paths":batch.paths,"renames":batch.renames,
            "rescan":batch.rescan,"elapsedMs":started.elapsed().as_millis(),
            "success":result.is_ok()})
        .to_string()
    });
    if let Err(error) = result {
        if let Err(delivery) =
            publish_source_status(&root, SourceSyncState::Failed, Some(error.diagnostic()))
        {
            diagnostics::failure(
                "source.status_delivery_failed",
                delivery,
                json!({"root":root}),
            );
        }
        diagnostics::failure("source.refresh_failed", error, json!({"root":root}));
    }
}
pub(super) fn consume_core_batch(batch: &SourceChangeBatch) -> AppResult<()> {
    let manifests = project::registered_manifests(&batch.root, ResourceSource::Core)?;
    let watched = saves()?;
    let game = manifests
        .first()
        .and_then(|manifest| manifest.starsector_root.clone())
        .or_else(|| {
            watched
                .windows
                .values()
                .filter_map(|window| window.core_root.as_ref())
                .find(|game| {
                    windows_path_key(&Path::new(game).join("starsector-core").to_string_lossy())
                        == windows_path_key(&batch.root)
                })
                .cloned()
        });
    drop(watched);
    let Some(game) = game else {
        return Ok(());
    };
    let sources = {
        let _lease = io::acquire_root_write_lock(Path::new(&batch.root))?;
        let boundary = FsRootBoundary::new(Path::new(&batch.root), "core root")?;
        let paths = if batch.rescan {
            vec!["data".into(), "graphics".into()]
        } else {
            batch
                .paths
                .iter()
                .map(|path| {
                    boundary
                        .resolve_changed_path_to_relative(&path.to_string_lossy(), "core source")
                })
                .collect::<AppResult<Vec<_>>>()?
                .into_iter()
                .flatten()
                .collect()
        };
        project::prepare_core_source_refresh(&game, &paths, batch.rescan)?
    };
    if sources.is_empty() {
        return publish_source_status(
            &batch.root,
            if batch.diagnostic.is_some() {
                SourceSyncState::Failed
            } else {
                SourceSyncState::Watching
            },
            batch.diagnostic.clone(),
        );
    }
    for window in saves()?.windows.values().filter(|window| {
        window
            .core_root
            .as_ref()
            .is_some_and(|root| windows_path_key(root) == windows_path_key(&game))
    }) {
        if let Err(error) = window.channel.send(ProjectSyncDelivery::CoreChanged {
            root: game.clone(),
            sources: sources.clone(),
        }) {
            diagnostics::failure("source.core_delivery_failed", error, json!({"root":game}));
        }
    }
    thread::scope(|scope| {
        let jobs = manifests
            .into_iter()
            .map(|manifest| {
                let sources = &sources;
                scope.spawn(move || -> AppResult<()> {
                    if !windows::accepts_save("source-watch", Some(&manifest.session_id))? {
                        return Ok(());
                    }
                    let request =
                        format!("source:{}", SOURCE_REQUEST.fetch_add(1, Ordering::Relaxed));
                    let task = enqueue(
                        "source-watch",
                        request,
                        &manifest.mod_root,
                        Some(&manifest.session_id),
                    )?;
                    execute_queued(
                        task,
                        &manifest.mod_root,
                        Some(&manifest.session_id),
                        "refresh",
                        |_, _| {
                            let update =
                                project::refresh_core_session(&manifest.session_id, sources)?;
                            let mut result = WriteResult::<()>::from_changes(Vec::new());
                            result.session_updates.push(CommittedSessionUpdate {
                                session_id: manifest.session_id.clone(),
                                mod_root: manifest.mod_root.clone(),
                                content: Arc::new(update),
                            });
                            Ok(result)
                        },
                    )?;
                    Ok(())
                })
            })
            .collect::<Vec<_>>();
        jobs.into_iter()
            .map(|job| {
                job.join().map_err(|_| {
                    AppError::message("source.refresh_failed", "原版来源更新任务失败")
                })?
            })
            .collect::<AppResult<Vec<_>>>()
    })?;
    publish_source_status(
        &batch.root,
        if batch.diagnostic.is_some() {
            SourceSyncState::Failed
        } else {
            SourceSyncState::Watching
        },
        batch.diagnostic.clone(),
    )
}
