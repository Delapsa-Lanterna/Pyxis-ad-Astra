use crate::dependencies;
use crate::transfer::TransferControl;
use crate::{
    AnalysisPaths, AnalysisRequest, AnalysisResponse, Engine, Error, Package, Result, invalid,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::ErrorKind;
use std::mem;
use std::path::{Path, PathBuf};
use std::process;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

const CATALOG: &str = include_str!("../resources/catalog.json");
const BUILTIN: &[u8] = include_bytes!("../resources/builtin.json");
const LAUNCHER: &[u8] = include_bytes!("../resources/launcher.jar");
const ENGINE: &[u8] = include_bytes!("../resources/engine.jar");

pub struct AnalysisEvent {
    pub code: &'static str,
    pub instance: Option<String>,
    pub error: Option<String>,
    pub context: Value,
    pub fault: bool,
}
pub type EventSink = Arc<dyn Fn(AnalysisEvent) + Send + Sync>;

struct Instance {
    engine: Option<Engine>,
    workspace: PathBuf,
}

#[derive(Default)]
struct State {
    dependency_directory: PathBuf,
    instances: BTreeMap<String, Arc<Mutex<Instance>>>,
    projects: BTreeMap<String, BTreeSet<String>>,
    sequence: u64,
    closed: bool,
}

/// Owns dependency installation and analysis instances configured by the supplied root.
pub struct AnalysisRuntime {
    paths: AnalysisPaths,
    package: Package,
    state: Mutex<State>,
    events: EventSink,
}

impl AnalysisRuntime {
    /// Loads the installation directory without creating directories, downloading or starting Java.
    pub fn new(config_root: &Path, events: EventSink) -> Result<Self> {
        let mut paths = AnalysisPaths::new(config_root);
        match fs::read(paths.root.join("dependencies.json")) {
            Ok(bytes) => paths.dependencies = serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        Ok(Self {
            state: Mutex::new(State {
                dependency_directory: paths.dependencies.clone(),
                ..State::default()
            }),
            paths,
            package: serde_json::from_str(CATALOG)?,
            events,
        })
    }

    /// Returns startup paths; dependency_directory supplies the active installation root.
    pub fn paths(&self) -> &AnalysisPaths {
        &self.paths
    }
    pub fn dependency_directory(&self) -> Result<PathBuf> {
        Ok(self.state()?.dependency_directory.clone())
    }

    /// Persists the installation root while all analysis instances are released.
    pub fn set_dependency_directory(&self, directory: &Path) -> Result<()> {
        let mut state = self.state()?;
        if !state.instances.is_empty() {
            return Err(invalid("Java instances still hold dependencies"));
        }
        fs::create_dir_all(&self.paths.root)?;
        fs::write(
            self.paths.root.join("dependencies.json"),
            serde_json::to_vec(directory)?,
        )?;
        state.dependency_directory = directory.to_path_buf();
        Ok(())
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
            error: result
                .as_ref()
                .err()
                .filter(|error| !matches!(error, Error::Cancelled))
                .map(ToString::to_string),
            context: json!({"dependencySet":self.package.version,"jars":self.package.artifacts.len(),"cancelled":matches!(result, Err(Error::Cancelled))}),
            fault: result.is_err(),
        });
    }

    pub fn install(&self) -> Result<PathBuf> {
        self.install_with_control(&TransferControl::default())
    }

    pub fn install_with_control(&self, control: &TransferControl) -> Result<PathBuf> {
        let result = dependencies::install_with_control(
            &self.dependency_directory()?,
            &self.package,
            control,
        );
        self.record("java_analysis.install", None, &result);
        result
    }

    pub fn import(&self, archive: &Path) -> Result<PathBuf> {
        self.import_with_control(archive, &TransferControl::default())
    }

    pub fn import_with_control(
        &self,
        archive: &Path,
        control: &TransferControl,
    ) -> Result<PathBuf> {
        let result = dependencies::import_with_control(
            &self.dependency_directory()?,
            archive,
            &self.package,
            control,
        );
        self.record("java_analysis.import", None, &result);
        result
    }

    pub fn installed(&self) -> Result<bool> {
        match dependencies::status(&self.dependency_directory()?, &self.package.version)? {
            Some(manifest) if manifest == self.package.manifest() => Ok(true),
            Some(_) => Err(invalid(
                "Installed dependency identity differs from the fixed inventory",
            )),
            None => Ok(false),
        }
    }

    pub fn instance_count(&self) -> Result<usize> {
        Ok(self.state()?.instances.len())
    }

    pub fn managed_counts(&self) -> Result<(usize, usize)> {
        let state = self.state()?;
        Ok((
            state.instances.len(),
            state.projects.values().map(BTreeSet::len).sum(),
        ))
    }

    pub fn remove_dependencies(&self) -> Result<()> {
        let state = self.state()?;
        if !state.instances.is_empty() {
            return Err(invalid("Java instances still hold dependencies"));
        }
        let result = dependencies::remove(&state.dependency_directory, &self.package.version);
        self.record("java_analysis.remove", None, &result);
        result
    }

    /// Starts an instance from prepared application resources and installed, pinned libraries.
    pub fn start(&self, java: &Path) -> Result<String> {
        let mut state = self.state()?;
        let dependencies = state.dependency_directory.join(&self.package.version);
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
                &dependencies,
                &workspace,
                &self.paths.logs.join(format!("{id}.log")),
            )
        })();
        match result {
            Ok(engine) => {
                instance_state.engine = Some(engine);
                self.record("java_analysis.start", Some(&id), &Ok(()));
                Ok(id)
            }
            Err(error) => {
                if let Ok(mut state) = self.state() {
                    state.instances.remove(&id);
                }
                if workspace.exists() {
                    let cleanup = fs::remove_dir_all(workspace).map_err(Into::into);
                    if cleanup.is_err() {
                        self.record("java_analysis.cleanup_failed", Some(&id), &cleanup);
                    }
                }
                self.record::<()>(
                    "java_analysis.start_failed",
                    Some(&id),
                    &Err(invalid(error.to_string())),
                );
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
            if response.error.is_none() {
                match request {
                    AnalysisRequest::Open { project, .. } => {
                        let mut registry = self.state()?;
                        if registry.instances.contains_key(instance) {
                            registry
                                .projects
                                .entry(instance.into())
                                .or_default()
                                .insert(project.clone());
                        }
                    }
                    AnalysisRequest::Close { project, .. } => {
                        if let Some(projects) = self.state()?.projects.get_mut(instance) {
                            projects.remove(project);
                        }
                    }
                    _ => {}
                }
            }
        }
        let mut context = request.context();
        context["queueWaitMilliseconds"] = json!(queue_wait);
        if let Ok(response) = &result {
            context["requestMilliseconds"] = json!(response.request_milliseconds);
            context["responseBytes"] = json!(response.response_bytes);
            if let Some(error) = &response.error {
                context["engineCode"] = json!(error.code);
                context["engineType"] = json!(error.error_type);
                context["offset"] = json!(error.offset);
                if let Some(file) = &error.file {
                    context["path"] = json!(file);
                }
            }
        }
        (self.events)(AnalysisEvent {
            code: "java_analysis.request",
            instance: Some(instance.into()),
            context,
            error: match &result {
                Err(error) => Some(error.to_string()),
                Ok(response) => response
                    .error
                    .as_ref()
                    .map(|error| format!("{}: {}", error.code, error.message)),
            },
            fault: result.is_err(),
        });
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
        state.projects.remove(id);
        drop(state);
        self.release(id, instance)
    }

    pub fn project_count(&self) -> Result<usize> {
        Ok(self.managed_counts()?.1)
    }

    /// Stops instances while retaining the runtime for subsequent explicit starts.
    pub fn close_all(&self) -> Result<()> {
        let mut state = self.state()?;
        let instances = mem::take(&mut state.instances);
        state.projects.clear();
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

    /// Stops new work and waits for every already-created instance before returning.
    pub fn shutdown(&self) -> Result<()> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| invalid("Java analysis runtime lock poisoned"))?;
        state.closed = true;
        let instances = mem::take(&mut state.instances);
        state.projects.clear();
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
