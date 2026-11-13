use super::JavaProject;
use crate::errors::{AppError, AppResult, ErrorLocation};
use std::fs::{File, OpenOptions};
use std::io::{Error, Read, Seek, SeekFrom};
#[cfg(windows)]
use std::os::windows::{io::AsRawHandle, process::CommandExt};
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::ptr;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
#[cfg(windows)]
use windows_sys::Win32::{
    Foundation::{CloseHandle, HANDLE},
    System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, TerminateJobObject},
};
pub(super) const JAVA_ENCODING: [&str; 5] = [
    "-Dfile.encoding=UTF-8",
    "-Dstdout.encoding=UTF-8",
    "-Dstderr.encoding=UTF-8",
    "-Dsun.stdout.encoding=UTF-8",
    "-Dsun.stderr.encoding=UTF-8",
];

pub(super) fn run(entry: &JavaProject, command: &mut Command, log: &Path) -> AppResult<ExitStatus> {
    let output = OpenOptions::new().create(true).append(true).open(log)?;
    command
        .stdout(Stdio::from(output.try_clone()?))
        .stderr(Stdio::from(output));
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let mut child = command
        .spawn()
        .map_err(|error| AppError::context("Start project operation", error.into()).at_path(log))?;
    #[cfg(windows)]
    let job = match Job::attach(child.as_raw_handle()) {
        Ok(job) => job,
        Err(error) => {
            child.kill()?;
            child.wait()?;
            return Err(error);
        }
    };
    let result = loop {
        if entry.cancelled.load(Ordering::Acquire) {
            #[cfg(windows)]
            job.terminate()?;
            #[cfg(not(windows))]
            child.kill()?;
            break child.wait();
        }
        if let Some(status) = child.try_wait()? {
            break Ok(status);
        }
        thread::sleep(Duration::from_millis(30));
    };
    result.map_err(Into::into)
}

pub(super) fn tail(path: &Path) -> AppResult<String> {
    let mut file = File::open(path)?;
    let length = file.metadata()?.len();
    file.seek(SeekFrom::Start(length.saturating_sub(8192)))?;
    let mut bytes = Vec::new();
    file.read_to_end(&mut bytes)?;
    let start = bytes
        .iter()
        .position(|byte| byte & 0xc0 != 0x80)
        .unwrap_or(bytes.len());
    Ok(String::from_utf8_lossy(&bytes[start..]).into_owned())
}
pub(super) fn locations(output: &str) -> Vec<ErrorLocation> {
    let mut locations = Vec::new();
    for text in output.lines() {
        let position = text
            .strip_prefix("Build file '")
            .or_else(|| text.strip_prefix("Settings file '"))
            .and_then(|text| text.split_once("' line: "))
            .map(|(path, line)| (path.to_owned(), line));
        let position = position.or_else(|| {
            [".java:", ".gradle.kts:", ".gradle:"]
                .iter()
                .find_map(|suffix| {
                    text.split_once(suffix).map(|(path, line)| {
                        (
                            format!("{}{}", path.trim(), suffix.trim_end_matches(':')),
                            line,
                        )
                    })
                })
        });
        if let Some((path, position)) = position
            && Path::new(&path).is_absolute()
            && let Some(line) = position
                .split([':', ' '])
                .next()
                .and_then(|line| line.parse::<usize>().ok())
        {
            let location = ErrorLocation {
                path: Some(path),
                line: Some(line),
                ..Default::default()
            };
            if !locations.contains(&location) {
                locations.push(location);
            }
        }
    }
    locations
}
#[cfg(windows)]
struct Job(HANDLE);
#[cfg(windows)]
impl Job {
    fn attach(process: HANDLE) -> AppResult<Self> {
        // The job owns only this invocation's descendants, including disposable Gradle JVMs.
        let job = unsafe { CreateJobObjectW(ptr::null(), ptr::null()) };
        if job.is_null() {
            return Err(Error::last_os_error().into());
        }
        let owned = Self(job);
        if unsafe { AssignProcessToJobObject(job, process) } == 0 {
            return Err(Error::last_os_error().into());
        }
        Ok(owned)
    }
    fn terminate(&self) -> AppResult<()> {
        if unsafe { TerminateJobObject(self.0, 1) } == 0 {
            return Err(Error::last_os_error().into());
        }
        Ok(())
    }
}
#[cfg(windows)]
impl Drop for Job {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
