use super::{ComponentManagement, ManagementAction, ManagementOperation};
use crate::errors::{AppError, AppResult};
use crate::services::java_analysis::environment::probe_java;
use crate::services::java_analysis::sessions::stop_owned_analysis;
use pyxis_java_analysis::AnalysisRequest;
use pyxis_java_analysis::protocol::AnalysisResult;
use pyxis_java_analysis::versions::DEFAULT_LANGUAGE;
use serde_json::json;
use std::fs;
use std::path::Path;
use std::time::Instant;

impl ComponentManagement {
    pub(super) fn inspect(&self) -> AppResult<(String, u64)> {
        let installation = match self.runtime.installed() {
            Ok(true) => "installed",
            Ok(false) => "missing",
            Err(_) => "damaged",
        };
        let stage = self
            .runtime
            .paths()
            .dependencies
            .join(format!("{}.staging", self.runtime.package().version));
        fn size(path: &Path) -> AppResult<u64> {
            if !path.exists() {
                return Ok(0);
            }
            let mut bytes = 0;
            for entry in fs::read_dir(path)? {
                let entry = entry?;
                let kind = entry.file_type()?;
                if kind.is_symlink() {
                    return Err(AppError::message(
                        "java_analysis.staging_link",
                        "Staging links are unsupported",
                    ));
                }
                bytes += if kind.is_dir() {
                    size(&entry.path())?
                } else {
                    entry.metadata()?.len()
                };
            }
            Ok(bytes)
        }
        Ok((installation.into(), size(&stage)?))
    }
    pub(super) fn perform(&self, operation: &ManagementOperation) -> AppResult<()> {
        let action = &operation.action;
        let control = &operation.control;
        control.check()?;
        match action {
            ManagementAction::Refresh => {}
            ManagementAction::Download => {
                self.require_idle_runtime()?;
                self.runtime.install_with_control(control)?;
            }
            ManagementAction::Import { archive } => {
                self.require_idle_runtime()?;
                self.runtime
                    .import_with_control(Path::new(archive), control)?;
            }
            ManagementAction::Probe { java_path } | ManagementAction::Test { java_path } => {
                let started = Instant::now();
                let mut environment = probe_java(Path::new(java_path), control)?;
                if matches!(action, ManagementAction::Test { .. }) {
                    let instance = self.runtime.start(Path::new(java_path))?;
                    let result = (|| -> AppResult<()> {
                        control.check()?;
                        let response = self.runtime.request(
                            &instance,
                            &AnalysisRequest::Parse {
                                id: json!("environment-test"),
                                source: "record Satellite(int radius) {}".into(),
                                version: 1,
                                language: Some(DEFAULT_LANGUAGE.into()),
                            },
                        )?;
                        if !matches!(response.result,Some(AnalysisResult::Syntax(ref syntax)) if syntax.errors==0)
                        {
                            return Err(AppError::message(
                                "java_analysis.self_check",
                                "Java AST self-check failed",
                            ));
                        }
                        Ok(())
                    })();
                    let release = self.runtime.close(&instance);
                    result?;
                    release?;
                    environment.log_path = Some(
                        self.runtime
                            .paths()
                            .logs
                            .join(format!("{instance}.log"))
                            .to_string_lossy()
                            .into_owned(),
                    );
                    control.check()?;
                }
                environment.milliseconds = started.elapsed().as_secs_f64() * 1000.0;
                let mut state = self.state()?;
                if state
                    .current
                    .as_ref()
                    .is_some_and(|active| active.key == operation.key)
                {
                    state.snapshot.environment = Some(environment);
                    Self::publish(&mut state);
                }
            }
            ManagementAction::Stop => stop_owned_analysis(&self.runtime)?,
            ManagementAction::Remove => {
                self.require_idle_runtime()?;
                self.runtime.remove_dependencies()?;
            }
        }
        Ok(())
    }
    fn require_idle_runtime(&self) -> AppResult<()> {
        if self.runtime.instance_count()? > 0 {
            return Err(AppError::message(
                "java_analysis.in_use",
                "Stop Java analysis before changing dependencies",
            ));
        }
        Ok(())
    }
}
