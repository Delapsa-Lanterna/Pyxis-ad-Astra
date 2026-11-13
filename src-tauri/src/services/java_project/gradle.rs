use super::process::JAVA_ENCODING;
use super::{JavaProject, process, tasks};
use crate::errors::{AppError, AppResult};
use crate::io;
use crate::models::java_project::{
    GradleModel, JavaGradleInstallation, JavaGradleSource, JavaProjectSnapshot,
};
use crate::parsers;
use pyxis_java_analysis::java_path;
use std::env;
use std::fs;
use std::io::Error;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::ptr;
#[cfg(windows)]
use windows_core::w;
#[cfg(windows)]
use windows_sys::Win32::Security::Cryptography::CryptHashCertificate2;

fn installed_gradle(selected: &Option<String>) -> AppResult<PathBuf> {
    if let Some(path) = selected {
        return io::canonical_path(Path::new(path), "Gradle executable");
    }
    for directory in env::split_paths(&env::var_os("PATH").unwrap_or_default()) {
        for name in ["gradle.bat", "gradle"] {
            let path = directory.join(name);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    Err(AppError::message(
        "java_project.gradle_missing",
        "Select an installed Gradle executable or provide the project's Gradle Wrapper",
    ))
}
pub(super) fn installation(
    root: &Path,
    selected: &Option<String>,
) -> AppResult<JavaGradleInstallation> {
    let wrapper = root.join("gradlew.bat");
    let (path, source) = if wrapper.is_file() {
        (wrapper, JavaGradleSource::Wrapper)
    } else {
        (
            installed_gradle(selected)?,
            if selected.is_some() {
                JavaGradleSource::Selected
            } else {
                JavaGradleSource::System
            },
        )
    };
    Ok(JavaGradleInstallation {
        path: io::forward_slash_path(&java_path(&io::canonical_path(&path, "Gradle executable")?)),
        source,
    })
}
fn property(text: &str, name: &str) -> Option<String> {
    text.lines()
        .filter_map(|line| line.split_once('='))
        .find(|(key, _)| key.trim() == name)
        .map(|(_, value)| value.trim().replace("\\:", ":").replace("\\=", "="))
}
#[cfg(windows)]
fn wrapper_hash(url: &str) -> AppResult<String> {
    let mut hash = [0u8; 16];
    let mut size = 16;
    if unsafe {
        CryptHashCertificate2(
            w!("MD5").as_ptr(),
            0,
            ptr::null(),
            url.as_ptr(),
            url.len() as u32,
            hash.as_mut_ptr(),
            &mut size,
        )
    } == 0
    {
        return Err(Error::last_os_error().into());
    }
    let mut value = u128::from_be_bytes(hash);
    let mut result = String::new();
    while value > 0 {
        result.insert(
            0,
            char::from_digit((value % 36) as u32, 36).expect("base 36 digit"),
        );
        value /= 36;
    }
    Ok(result)
}
fn wrapper_cached(root: &Path) -> AppResult<bool> {
    let text = io::read_utf8_no_bom(&root.join("gradle/wrapper/gradle-wrapper.properties"))?;
    let url = property(&text, "distributionUrl").ok_or_else(|| {
        AppError::message(
            "java_project.wrapper_url",
            "Wrapper distributionUrl is missing",
        )
    })?;
    #[cfg(windows)]
    let hash = wrapper_hash(&url)?;
    #[cfg(not(windows))]
    let hash = String::new();
    let name = url.rsplit('/').next().expect("distribution filename");
    let home = env::var_os("GRADLE_USER_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(
                env::var_os("USERPROFILE")
                    .or_else(|| env::var_os("HOME"))
                    .expect("user profile"),
            )
            .join(".gradle")
        });
    let base = if property(&text, "distributionBase").as_deref() == Some("PROJECT") {
        root.to_path_buf()
    } else {
        home
    };
    let cached = base
        .join(property(&text, "distributionPath").unwrap_or_else(|| "wrapper/dists".into()))
        .join(name.trim_end_matches(".zip"))
        .join(hash);
    Ok(cached.join(format!("{name}.ok")).is_file())
}
pub(super) fn synchronize(
    entry: &JavaProject,
    snapshot: &JavaProjectSnapshot,
    online: bool,
    detect: bool,
) -> AppResult<Option<GradleModel>> {
    execute(entry, snapshot, online, detect, None)
}
pub(super) fn run_task(
    entry: &JavaProject,
    snapshot: &JavaProjectSnapshot,
    online: bool,
    tasks: &[String],
    arguments: &[String],
) -> AppResult<GradleModel> {
    execute(entry, snapshot, online, false, Some((tasks, arguments)))?
        .ok_or_else(|| AppError::message("java_project.model", "Gradle 未交付构建结果"))
}
fn execute(
    entry: &JavaProject,
    snapshot: &JavaProjectSnapshot,
    online: bool,
    detect: bool,
    invocation: Option<(&[String], &[String])>,
) -> AppResult<Option<GradleModel>> {
    let java = snapshot.java_path.as_ref().ok_or_else(|| {
        AppError::message(
            "java_project.java_missing",
            "请在设置中选择 Java 运行环境 (至少 17)",
        )
    })?;
    let java = java_path(&io::canonical_path(Path::new(java), "Project Java")?);
    let home = java
        .parent()
        .and_then(Path::parent)
        .expect("Java executable home");
    let root_path = java_path(&io::canonical_path(
        Path::new(&snapshot.mod_root),
        "Gradle project root",
    )?);
    let root = root_path.as_path();
    let criteria = root.join("gradle/gradle-daemon-jvm.properties");
    if !detect && criteria.is_file() {
        return Err(AppError::message(
            "java_project.java_criteria",
            "项目的 Gradle JVM 选择会覆盖主程序 Java 设置，请在此文件中调整后重新同步",
        )
        .at_path(&criteria));
    }
    let directory = entry
        .file
        .parent()
        .expect("project configuration directory");
    fs::create_dir_all(directory)?;
    let log = tasks::log(entry)?;
    let work = log.with_extension("work");
    fs::create_dir(&work)?;
    let result = (|| {
        if detect && snapshot.mode != "gradle" {
            tasks::run_process(
                entry,
                Command::new(&java).args(["-XshowSettings:properties", "-version"]),
                &log,
            )?;
            return Ok(None);
        }
        let selected = installation(root, &snapshot.settings.gradle)?;
        if matches!(selected.source, JavaGradleSource::Wrapper) && !online && !wrapper_cached(root)?
        {
            return Err(AppError::message(
                "java_project.wrapper_download",
                "本机缺少项目指定的 Gradle 缓存，请允许下载后重试",
            ));
        }
        let script = work.join("model.gradle");
        io::write_utf8_no_bom(&script, include_str!("model.gradle"))?;
        let model = work.join("model.json");
        let mut command = Command::new(&selected.path);
        command
            .current_dir(root)
            .env("JAVA_HOME", home)
            .env(
                "JAVA_TOOL_OPTIONS",
                format!(
                    "{} {}",
                    env::var("JAVA_TOOL_OPTIONS").unwrap_or_default(),
                    JAVA_ENCODING.join(" ")
                ),
            )
            .arg("--no-daemon")
            .arg("--console=plain")
            .arg("--no-configuration-cache")
            .arg(format!("-Dorg.gradle.java.home={}", home.display()))
            .arg("-Dorg.gradle.java.installations.auto-detect=false")
            .arg("-Dorg.gradle.java.installations.auto-download=false")
            .arg(format!(
                "-Dorg.gradle.java.installations.paths={}",
                home.display()
            ))
            .arg(format!("-Dpyxis.javaHome={}", home.display()))
            .arg(format!("-Dpyxis.target={}", snapshot.target))
            .arg(format!("-Dpyxis.model={}", model.display()))
            .arg("--init-script")
            .arg(script);
        if detect {
            tasks::run_process(entry, command.arg("--version"), &log)?;
            if !process::tail(&log)?
                .lines()
                .any(|line| line.starts_with("Gradle "))
            {
                return Err(AppError::message(
                    "java_project.gradle_invalid",
                    "所选程序未返回有效的 Gradle 版本，请选择 Gradle 安装或项目 Wrapper",
                )
                .at_path(&selected.path));
            }
            return Ok(None);
        }
        if let Some((tasks, arguments)) = invocation {
            command.args(tasks).args(arguments).arg("-Dpyxis.run=true");
        } else {
            command.arg("pyxisProjectModel");
        }
        if !online {
            command.arg("--offline");
        }
        tasks::run_process(entry, &mut command, &log)?;
        if invocation.is_some_and(|(_, arguments)| {
            arguments.iter().any(|argument| {
                ["--version", "-v", "--help", "-h", "--status", "--stop"]
                    .contains(&argument.as_str())
            })
        }) {
            return Ok(Some(GradleModel {
                java_home: io::forward_slash_path(home),
                ..Default::default()
            }));
        }
        let model: GradleModel = parsers::parse_persisted_json(&io::read_utf8_no_bom(&model)?)?;
        if io::canonical_path(home, "Selected Java home")?
            != io::canonical_path(Path::new(&model.java_home), "Gradle Java home")?
        {
            return Err(AppError::message(
                "java_project.java_mismatch",
                "Gradle used a different Java home",
            ));
        }
        Ok(Some(model))
    })();
    fs::remove_dir_all(&work)?;
    result
}
