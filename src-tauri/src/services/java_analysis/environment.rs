use crate::diagnostics;
use crate::errors::{AppError, AppResult};
use crate::io::canonical_path;
use pyxis_java_analysis::java_path;
use pyxis_java_analysis::transfer::TransferControl;
use pyxis_java_analysis::versions::REQUIRED_JAVA;
use serde::Serialize;
use serde_json::json;
use std::io::Read;
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JavaEnvironment {
    pub path: String,
    pub version: String,
    pub milliseconds: f64,
    pub released: bool,
    pub log_path: Option<String>,
}

/// Verifies the selected executable before the application stores or starts it.
pub fn probe_java(path: &Path, control: &TransferControl) -> AppResult<JavaEnvironment> {
    let path = canonical_path(path, "Java executable")?;
    let started = Instant::now();
    let mut command = Command::new(&path);
    command
        .args(["-XshowSettings:properties", "-version"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command.spawn().map_err(|error| {
        AppError::context("Start Java version probe", error.into()).at_path(&path)
    })?;
    let mut stdout = child.stdout.take().expect("piped probe output");
    let mut stderr = child.stderr.take().expect("piped probe diagnostics");
    let output_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.read_to_end(&mut bytes).map(|_| bytes)
    });
    let diagnostic_reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr.read_to_end(&mut bytes).map(|_| bytes)
    });
    let result = (|| -> AppResult<()> {
        loop {
            control.check()?;
            if child.try_wait()?.is_some() {
                return Ok(());
            }
            if started.elapsed() > Duration::from_secs(15) {
                return Err(AppError::message(
                    "java_analysis.java_timeout",
                    "Java version probe timed out",
                )
                .at_path(&path));
            }
            thread::sleep(Duration::from_millis(20));
        }
    })();
    if result.is_err()
        && let Err(error) = child.kill()
    {
        diagnostics::failure("java_analysis.probe_release", error, json!({"path":path}));
    }
    let status = child.wait();
    let output = output_reader
        .join()
        .map_err(|_| AppError::message("java_analysis.probe_reader", "Java output reader failed"));
    let diagnostics = diagnostic_reader.join().map_err(|_| {
        AppError::message(
            "java_analysis.probe_reader",
            "Java diagnostic reader failed",
        )
    });
    result?;
    let status = status?;
    let output = output??;
    let diagnostics = diagnostics??;
    let text =
        String::from_utf8_lossy(&output).to_string() + &String::from_utf8_lossy(&diagnostics);
    let version = text
        .lines()
        .find_map(|line| line.trim().strip_prefix("java.specification.version = "))
        .map(str::trim);
    let required_java = REQUIRED_JAVA.to_string();
    if !status.success() || version != Some(required_java.as_str()) {
        return Err(AppError::message(
            "java_analysis.java_version",
            format!("Java {required_java} is required: {text}"),
        )
        .at_path(&path));
    }
    Ok(JavaEnvironment {
        path: java_path(&path).to_string_lossy().to_string(),
        version: version.expect("verified specification version").into(),
        milliseconds: started.elapsed().as_secs_f64() * 1000.0,
        released: true,
        log_path: None,
    })
}
