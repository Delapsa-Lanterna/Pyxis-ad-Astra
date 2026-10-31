pub(crate) mod work_counts;
use std::{
    fs,
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
};

static WORKSPACE_SEQUENCE: AtomicU64 = AtomicU64::new(0);
type WorkspaceCleanup = fn(&Path) -> Vec<String>;

#[derive(Clone, Debug)]
pub(crate) struct TestWorkspace {
    owned: Arc<WorkspaceFiles>,
    path: PathBuf,
}

#[derive(Debug)]
struct WorkspaceFiles {
    root: PathBuf,
    test: String,
    cleanup: Option<WorkspaceCleanup>,
    finished: AtomicBool,
    failed: AtomicBool,
}

impl TestWorkspace {
    pub fn as_path(&self) -> &Path {
        &self.path
    }
    pub fn new(label: &str) -> Self {
        let parent = std::env::var_os("PYXIS_TEST_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        loop {
            let sequence = WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
            let root = parent.join(format!(
                "pyxis_test_{}_{sequence}_{label}",
                std::process::id()
            ));
            match fs::create_dir(&root) {
                Ok(()) => {
                    let path = root.join("root");
                    let workspace = Self {
                        owned: Arc::new(WorkspaceFiles {
                            root,
                            test: std::thread::current().name().unwrap_or(label).to_string(),
                            cleanup: None,
                            finished: AtomicBool::new(false),
                            failed: AtomicBool::new(false),
                        }),
                        path,
                    };
                    fs::create_dir(&workspace.path).expect("create owned test root");
                    return workspace;
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create test workspace {}: {error}", root.display()),
            }
        }
    }

    pub fn with_cleanup(mut self, cleanup: WorkspaceCleanup) -> Self {
        Arc::get_mut(&mut self.owned)
            .expect("new workspace has one owner")
            .cleanup = Some(cleanup);
        self
    }

    pub fn file(name: &str) -> Self {
        let mut workspace = Self::new("file");
        workspace.path = workspace.path.join(name);
        workspace
    }

    pub fn outer(&self) -> &Path {
        &self.owned.root
    }

    /// Keeps deliberately invalid input intact under Windows verbatim paths.
    pub fn literal_path(&self, suffix: &str) -> PathBuf {
        let mut path = self.path.as_os_str().to_os_string();
        path.push(std::path::MAIN_SEPARATOR.to_string());
        path.push(suffix.replace('/', std::path::MAIN_SEPARATOR_STR));
        PathBuf::from(path)
    }

    pub fn close(self) -> Result<(), String> {
        let errors = self.owned.finish(false);
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }

    pub fn directory_link(name: &str, relative: &str) -> std::io::Result<(Self, PathBuf, PathBuf)> {
        let workspace = Self::new(name);
        let outside = workspace.outer().join("outside");
        fs::create_dir(&outside)?;
        let link = workspace.join(relative);
        fs::create_dir_all(link.parent().expect("link has an owned parent"))?;
        create_dir_link(&outside, &link)?;
        Ok((workspace, outside, link))
    }

    pub fn file_link(name: &str, relative: &str) -> std::io::Result<(Self, PathBuf, PathBuf)> {
        let workspace = Self::new(name);
        let outside = workspace.outer().join("outside.wpn");
        fs::write(&outside, b"")?;
        let link = workspace.join(relative);
        fs::create_dir_all(link.parent().expect("link has an owned parent"))?;
        create_file_link(&outside, &link)?;
        Ok((workspace, outside, link))
    }

    #[cfg(windows)]
    pub fn junction(name: &str, relative: &str) -> (Self, PathBuf, PathBuf) {
        Self::try_junction(name, relative).expect("actual junction fixture")
    }

    #[cfg(windows)]
    fn try_junction(name: &str, relative: &str) -> std::io::Result<(Self, PathBuf, PathBuf)> {
        let workspace = Self::new(name);
        let outside = workspace.outer().join("outside");
        fs::create_dir(&outside)?;
        let link = workspace.join(relative);
        fs::create_dir_all(link.parent().expect("junction has an owned parent"))?;
        let output = std::process::Command::new("cmd")
            .args(["/c", "mklink", "/J"])
            .arg(link.to_string_lossy().replace('/', "\\"))
            .arg(outside.to_string_lossy().replace('/', "\\"))
            .output()?;
        if !output.status.success() {
            return Err(std::io::Error::other(format!(
                "junction {}: {} {}",
                link.display(),
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        Ok((workspace, outside, link))
    }
}

impl std::ops::Deref for TestWorkspace {
    type Target = Path;
    fn deref(&self) -> &Path {
        &self.path
    }
}

impl AsRef<Path> for TestWorkspace {
    fn as_ref(&self) -> &Path {
        &self.path
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        if std::thread::panicking() {
            self.owned.failed.store(true, Ordering::Relaxed);
        }
    }
}

impl WorkspaceFiles {
    fn finish(&self, failed: bool) -> Vec<String> {
        if self.finished.swap(true, Ordering::Relaxed) {
            return Vec::new();
        }
        let mut errors = self
            .cleanup
            .map(|release| release(&self.root))
            .unwrap_or_default();
        let retained = (failed || self.failed.load(Ordering::Relaxed))
            && std::env::var_os("PYXIS_KEEP_FAILED").is_some();
        if retained {
            eprintln!(
                "TEST_WORKSPACE_RETAINED test={} path={}",
                self.test,
                self.root.display()
            );
        } else {
            errors.extend(remove_test_tree(&self.root));
        }
        if !errors.is_empty() || retained || failed || self.failed.load(Ordering::Relaxed) {
            let report = serde_json::json!({"test":self.test,"path":self.root,"retained":retained,"errors":errors});
            eprintln!("TEST_WORKSPACE_RESULT {report}");
            if let Some(directory) = std::env::var_os("PYXIS_TEST_REPORTS") {
                let sequence = WORKSPACE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
                let path = PathBuf::from(directory)
                    .join(format!("{}-{sequence}.json", std::process::id()));
                if let Err(error) = fs::write(&path, report.to_string()) {
                    eprintln!("TEST_WORKSPACE_REPORT_ERROR {}: {error}", path.display());
                }
            }
        }
        errors
    }
}

impl Drop for WorkspaceFiles {
    fn drop(&mut self) {
        self.finish(std::thread::panicking());
    }
}

pub(crate) fn remove_test_tree(path: &Path) -> Vec<String> {
    let mut errors = Vec::new();
    let mut links = Vec::new();
    let mut files = Vec::new();
    let mut directories = Vec::new();
    collect_test_entries(path, &mut links, &mut files, &mut directories, &mut errors);
    for (path, directory) in links {
        let removed = if directory {
            fs::remove_dir(&path)
        } else {
            fs::remove_file(&path)
        };
        if let Err(error) = removed {
            errors.push(format!("unlink {}: {error}", path.display()));
        }
    }
    for path in files {
        if let Err(error) = fs::remove_file(&path) {
            errors.push(format!("remove file {}: {error}", path.display()));
        }
    }
    for path in directories.into_iter().rev() {
        if let Err(error) = fs::remove_dir(&path) {
            errors.push(format!("remove directory {}: {error}", path.display()));
        }
    }
    errors
}

fn collect_test_entries(
    path: &Path,
    links: &mut Vec<(PathBuf, bool)>,
    files: &mut Vec<PathBuf>,
    directories: &mut Vec<PathBuf>,
    errors: &mut Vec<String>,
) {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            errors.push(format!("inspect {}: {error}", path.display()));
            return;
        }
    };
    #[cfg(windows)]
    let (linked, directory) = {
        use std::os::windows::fs::MetadataExt;
        (
            metadata.file_attributes() & 0x400 != 0,
            metadata.file_attributes() & 0x10 != 0,
        )
    };
    #[cfg(not(windows))]
    let (linked, directory) = (metadata.file_type().is_symlink(), metadata.is_dir());
    if linked {
        links.push((path.to_path_buf(), directory));
    } else if directory {
        directories.push(path.to_path_buf());
        match fs::read_dir(path) {
            Ok(entries) => {
                for entry in entries {
                    match entry {
                        Ok(entry) => {
                            collect_test_entries(&entry.path(), links, files, directories, errors)
                        }
                        Err(error) => errors.push(format!("enumerate {}: {error}", path.display())),
                    }
                }
            }
            Err(error) => errors.push(format!("enumerate {}: {error}", path.display())),
        }
    } else {
        files.push(path.to_path_buf());
    }
}

pub(crate) fn isolated_test() -> bool {
    let name = std::thread::current()
        .name()
        .expect("named test thread")
        .to_string();
    if std::env::var("PYXIS_ISOLATED_TEST").as_deref() == Ok(&name) {
        return false;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", &name, "--nocapture"])
        .env("PYXIS_ISOLATED_TEST", &name)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "isolated {name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    true
}

#[cfg(windows)]
pub(crate) fn short_path(path: &Path) -> PathBuf {
    try_short_path(path).expect("actual short path fixture")
}

#[cfg(windows)]
fn try_short_path(path: &Path) -> std::io::Result<PathBuf> {
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    let input = path
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect::<Vec<_>>();
    let mut output = vec![0; 32768];
    let length = unsafe {
        windows_sys::Win32::Storage::FileSystem::GetShortPathNameW(
            input.as_ptr(),
            output.as_mut_ptr(),
            output.len() as u32,
        )
    };
    if length == 0 || length as usize >= output.len() {
        return Err(std::io::Error::last_os_error());
    }
    let short = PathBuf::from(std::ffi::OsString::from_wide(&output[..length as usize]));
    assert_eq!(short.canonicalize().unwrap(), path.canonicalize().unwrap());
    Ok(short)
}

#[cfg(windows)]
fn create_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_dir(target, link)
}

#[cfg(unix)]
fn create_dir_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(windows, unix)))]
fn create_dir_link(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "directory links are unsupported on this platform",
    ))
}

#[cfg(windows)]
fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::windows::fs::symlink_file(target, link)
}

#[cfg(unix)]
fn create_file_link(target: &Path, link: &Path) -> std::io::Result<()> {
    std::os::unix::fs::symlink(target, link)
}

#[cfg(not(any(windows, unix)))]
fn create_file_link(_target: &Path, _link: &Path) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "file links are unsupported on this platform",
    ))
}

#[path = "test_support_tests.rs"]
mod tests;
