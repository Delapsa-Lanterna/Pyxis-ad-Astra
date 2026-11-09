use crate::dependencies;
use crate::{AnalysisRequest, AnalysisResponse, Engine, Package, Result, invalid};
use serde::Serialize;
use std::collections::BTreeMap;
use std::fs;
use std::mem;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const CATALOG: &str = include_str!("../resources/catalog.json");
const BUILTIN: &[u8] = include_bytes!("../resources/builtin.json");
const LAUNCHER: &[u8] = include_bytes!("../resources/launcher.jar");
const ENGINE: &[u8] = include_bytes!("../resources/engine.jar");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisPaths {
    pub root: PathBuf,
    pub dependencies: PathBuf,
    pub workspaces: PathBuf,
    pub logs: PathBuf,
}

impl AnalysisPaths {
    pub fn new(config_root: &Path) -> Self {
        let root = config_root.join("java-analysis");
        Self {
            dependencies: root.join("dependencies"),
            workspaces: root.join("workspaces"),
            logs: root.join("logs"),
            root,
        }
    }
}

pub struct AnalysisEvent {
    pub code: &'static str,
    pub instance: Option<String>,
    pub error: Option<String>,
}
pub type EventSink = Arc<dyn Fn(AnalysisEvent) + Send + Sync>;

struct Instance {
    engine: Option<Engine>,
    workspace: PathBuf,
}

#[derive(Default)]
struct State {
    instances: BTreeMap<String, Arc<Mutex<Instance>>>,
    sequence: u64,
    closed: bool,
}

/// Owns lazy installation and all analysis instances beneath the supplied configuration root.
pub struct AnalysisRuntime {
    paths: AnalysisPaths,
    package: Package,
    state: Mutex<State>,
    events: EventSink,
}

impl AnalysisRuntime {
    /// Constructs descriptors without creating directories, downloading or starting Java.
    pub fn new(config_root: &Path, events: EventSink) -> Result<Self> {
        Ok(Self {
            paths: AnalysisPaths::new(config_root),
            package: serde_json::from_str(CATALOG)?,
            state: Mutex::new(State::default()),
            events,
        })
    }

    pub fn paths(&self) -> &AnalysisPaths {
        &self.paths
    }
    pub fn package(&self) -> &Package {
        &self.package
    }

    fn state(&self) -> Result<MutexGuard<'_, State>> {
        let state = self
            .state
            .lock()
            .map_err(|_| invalid("Java analysis runtime lock poisoned"))?;
        if state.closed {
            return Err(invalid("Java analysis runtime is closed"));
        }
        Ok(state)
    }

    fn record<T>(&self, code: &'static str, instance: Option<&str>, result: &Result<T>) {
        (self.events)(AnalysisEvent {
            code,
            instance: instance.map(str::to_owned),
            error: result.as_ref().err().map(ToString::to_string),
        });
    }

    pub fn install(&self) -> Result<PathBuf> {
        drop(self.state()?);
        let result = dependencies::install(&self.paths.dependencies, &self.package);
        self.record("java_analysis.install", None, &result);
        result
    }

    pub fn import(&self, archive: &Path) -> Result<PathBuf> {
        drop(self.state()?);
        let result = dependencies::import(&self.paths.dependencies, archive, &self.package);
        self.record("java_analysis.import", None, &result);
        result
    }

    pub fn installed(&self) -> Result<bool> {
        drop(self.state()?);
        Ok(dependencies::status(&self.paths.dependencies, &self.package.version)?.is_some())
    }

    pub fn instance_count(&self) -> Result<usize> {
        Ok(self.state()?.instances.len())
    }

    pub fn remove_dependencies(&self) -> Result<()> {
        let state = self.state()?;
        if !state.instances.is_empty() {
            return Err(invalid("Java instances still hold dependencies"));
        }
        let result = dependencies::remove(&self.paths.dependencies, &self.package.version);
        self.record("java_analysis.remove", None, &result);
        result
    }

    /// Starts an instance from prepared application resources and installed, pinned libraries.
    pub fn start(&self, java: &Path) -> Result<String> {
        let mut state = self.state()?;
        state.sequence += 1;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| invalid(error.to_string()))?
            .as_nanos();
        let id = format!("instance-{}-{timestamp}-{}", process::id(), state.sequence);
        let workspace = self.paths.workspaces.join(&id);
        let instance = Arc::new(Mutex::new(Instance {
            engine: None,
            workspace: workspace.clone(),
        }));
        let mut instance_state = instance
            .lock()
            .map_err(|_| invalid("Java instance lock poisoned"))?;
        state.instances.insert(id.clone(), Arc::clone(&instance));
        drop(state);
        let result = (|| {
            fs::create_dir_all(&self.paths.workspaces)?;
            fs::create_dir_all(&self.paths.logs)?;
            fs::create_dir(&workspace)?;
            let builtin = workspace.join("builtin");
            fs::create_dir(&builtin)?;
            for (name, bytes) in [
                ("builtin.json", BUILTIN),
                ("launcher.jar", LAUNCHER),
                ("engine.jar", ENGINE),
            ] {
                fs::write(builtin.join(name), bytes)?;
            }
            Engine::start(
                java,
                &builtin,
                &self.paths.dependencies.join(&self.package.version),
                &workspace,
                &self.paths.logs.join(format!("{id}.log")),
            )
        })();
        self.record("java_analysis.start", Some(&id), &result);
        match result {
            Ok(engine) => {
                instance_state.engine = Some(engine);
                Ok(id)
            }
            Err(error) => {
                if let Ok(mut state) = self.state() {
                    state.instances.remove(&id);
                }
                if workspace.exists() {
                    fs::remove_dir_all(workspace)?;
                }
                Err(error)
            }
        }
    }

    pub fn request(&self, instance: &str, request: &AnalysisRequest) -> Result<AnalysisResponse> {
        let instance_state = self
            .state()?
            .instances
            .get(instance)
            .cloned()
            .ok_or_else(|| invalid("Unknown Java analysis instance"))?;
        let queued = Instant::now();
        let mut state = instance_state
            .lock()
            .map_err(|_| invalid("Java instance lock poisoned"))?;
        let queue_wait = queued.elapsed().as_secs_f64() * 1000.0;
        let mut result = state
            .engine
            .as_mut()
            .ok_or_else(|| invalid("Java instance is closed"))?
            .request(request);
        if let Ok(response) = &mut result {
            response.queue_wait_milliseconds = queue_wait;
        }
        if let Ok(response) = &result
            && let Some(error) = &response.error
        {
            let failure = Err(invalid(format!("{}: {}", error.code, error.message)));
            self.record::<()>("java_analysis.request", Some(instance), &failure);
        } else {
            self.record("java_analysis.request", Some(instance), &result);
        }
        result
    }

    fn release(&self, id: &str, instance: Arc<Mutex<Instance>>) -> Result<()> {
        let mut instance = instance
            .lock()
            .map_err(|_| invalid("Java instance lock poisoned"))?;
        let result = instance.engine.take().map_or(Ok(()), Engine::close);
        let cleanup = fs::remove_dir_all(&instance.workspace).map_err(Into::into);
        let result = result.and(cleanup);
        self.record("java_analysis.release", Some(id), &result);
        result
    }

    pub fn close(&self, id: &str) -> Result<()> {
        let mut state = self.state()?;
        let instance = state
            .instances
            .remove(id)
            .ok_or_else(|| invalid("Unknown Java analysis instance"))?;
        drop(state);
        self.release(id, instance)
    }

    /// Stops new work and waits for every already-created instance before returning.
    pub fn shutdown(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Java analysis runtime lock poisoned"))?;
        state.closed = true;
        let instances = mem::take(&mut state.instances);
        drop(state);
        let mut failures = Vec::new();
        for (id, instance) in instances {
            if let Err(error) = self.release(&id, instance) {
                failures.push(error.to_string());
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(invalid(failures.join("\n")))
        }
    }
}

impl Drop for AnalysisRuntime {
    fn drop(&mut self) {
        if let Err(error) = self.shutdown() {
            self.record::<()>("java_analysis.shutdown", None, &Err(error));
        }
    }
}
