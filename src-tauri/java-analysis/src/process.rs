use crate::dependencies::{compatible, inspect, matches_file};
use crate::model::Builtin;
use crate::paths::{java_path, relative};
use crate::{Result, invalid};
use reqwest::Url;
use serde_json::{Value, json};
use std::env::join_paths;
use std::fs::{self, File};
use std::io::Result as IoResult;
use std::io::{BufRead, BufReader, Write};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::thread::{self, JoinHandle};
use std::time::Duration;
pub struct Engine {
    child: Child,
    input: Option<ChildStdin>,
    output: Receiver<IoResult<String>>,
    reader: Option<JoinHandle<()>>,
    closed: bool,
}

impl Engine {
    /// Starts the application-owned Java host with its pinned external dependency set.
    pub fn start(
        java: &Path,
        builtin: &Path,
        package: &Path,
        workspace: &Path,
        log: &Path,
    ) -> Result<Self> {
        let manifest = inspect(package)?;
        let builtin = builtin.canonicalize()?;
        let host: Builtin = serde_json::from_reader(File::open(builtin.join("builtin.json"))?)?;
        compatible(&host.version, host.protocol, host.java)?;
        if manifest != host.dependencies {
            return Err(invalid("Dependencies do not match the built-in host lock"));
        }
        for file in &host.files {
            matches_file(
                &builtin.join(relative(&file.path)?),
                file.bytes,
                &file.sha256,
            )?;
        }
        for required in [&host.launcher, &host.bundle] {
            if !host.files.iter().any(|file| file.path == *required) {
                return Err(invalid("Unlisted built-in Java host file"));
            }
        }
        if !manifest
            .files
            .iter()
            .any(|file| file.path == host.framework)
        {
            return Err(invalid("Unlisted framework dependency"));
        }
        let package = package.canonicalize()?;
        fs::create_dir_all(workspace)?;
        let workspace = workspace.canonicalize()?;
        let configuration = workspace.join("configuration");
        fs::create_dir_all(&configuration)?;
        let mut bundles = manifest
            .bundles
            .iter()
            .map(|bundle| {
                let url = Url::from_file_path(package.join(bundle))
                    .map_err(|_| invalid("Invalid bundle URL"))?;
                Ok(format!("reference:{url}@start"))
            })
            .collect::<Result<Vec<_>>>()?;
        let own_bundle = Url::from_file_path(builtin.join(&host.bundle))
            .map_err(|_| invalid("Invalid built-in bundle URL"))?;
        bundles.push(format!("reference:{own_bundle}@start"));
        let install_area =
            Url::from_directory_path(&package).map_err(|_| invalid("Invalid install URL"))?;
        fs::write(
            configuration.join("config.ini"),
            format!(
                "osgi.bundles={}\nosgi.bundles.defaultStartLevel=4\nosgi.install.area={}\neclipse.application=com.delapsalanterna.pyxis.javaanalysis.engine\nosgi.noShutdown=false\n",
                bundles.join(","),
                install_area
            ),
        )?;
        let stderr = File::create(log)?;
        let mut command = Command::new(java);
        command
            .arg("-Xms32m")
            .arg("-Xmx512m")
            .arg("-Dfile.encoding=UTF-8")
            .arg("-cp")
            .arg(
                join_paths([
                    java_path(&builtin.join(&host.launcher)),
                    java_path(&package.join(&host.framework)),
                ])
                .map_err(|error| invalid(error.to_string()))?,
            )
            .arg("com.delapsalanterna.pyxis.javaanalysis.Launcher")
            .arg("-configuration")
            .arg(java_path(&configuration))
            .arg("-data")
            .arg(java_path(&workspace.join("data")))
            .arg("-nosplash")
            .current_dir(
                java.parent()
                    .ok_or_else(|| invalid("Java executable must have a parent directory"))?,
            )
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(stderr);
        #[cfg(windows)]
        {
            command.creation_flags(0x08000000);
        }
        let mut child = command.spawn()?;
        let input = child.stdin.take().expect("piped engine input");
        let stdout = child.stdout.take().expect("piped engine output");
        let (sender, output) = mpsc::channel();
        let reader = thread::spawn(move || {
            for line in BufReader::new(stdout).lines() {
                if sender.send(line).is_err() {
                    break;
                }
            }
        });
        let mut engine = Self {
            child,
            input: Some(input),
            output,
            reader: Some(reader),
            closed: false,
        };
        let hello = engine.request(&json!({"id":"host-handshake", "op":"hello"}))?;
        if hello["result"]["protocol"] != manifest.protocol
            || hello["result"]["java"] != 17
            || hello["result"]["engine"] != host.version
        {
            return Err(invalid(
                "Engine handshake does not match package requirements",
            ));
        }
        Ok(engine)
    }

    pub fn process_id(&self) -> u32 {
        self.child.id()
    }

    /// Executes a request and preserves its request identity and structured engine errors.
    pub fn request(&mut self, request: &Value) -> Result<Value> {
        let input = self
            .input
            .as_mut()
            .ok_or_else(|| invalid("Engine is closed"))?;
        serde_json::to_writer(&mut *input, request)?;
        input.write_all(b"\n")?;
        input.flush()?;
        let line = self
            .output
            .recv_timeout(Duration::from_secs(180))
            .map_err(|error| invalid(format!("Engine response failed: {error}")))??;
        let response: Value = serde_json::from_str(&line)?;
        if response.get("id") != request.get("id") {
            return Err(invalid(format!(
                "Engine response identity mismatch: {line}"
            )));
        }
        Ok(response)
    }

    /// Performs protocol shutdown, closes stdin, waits for JVM exit and joins the reader.
    pub fn close(mut self) -> Result<()> {
        let response = self.request(&json!({"id":"host-shutdown", "op":"shutdown"}))?;
        if response.get("error").is_some() {
            return Err(invalid(response.to_string()));
        }
        self.input.take();
        let status = self.child.wait()?;
        self.reader
            .take()
            .expect("engine reader owned until close")
            .join()
            .map_err(|_| invalid("Engine reader panicked"))?;
        self.closed = true;
        if !status.success() {
            return Err(invalid(format!("Engine exit failed: {status}")));
        }
        Ok(())
    }
}

impl Drop for Engine {
    fn drop(&mut self) {
        if !self.closed {
            self.input.take();
            if let Err(error) = self.child.kill() {
                eprintln!("engine cleanup: {error}");
            }
            if let Err(error) = self.child.wait() {
                eprintln!("engine wait: {error}");
            }
            if let Some(reader) = self.reader.take()
                && reader.join().is_err()
            {
                eprintln!("engine reader cleanup failed");
            }
        }
    }
}
