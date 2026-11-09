use std::fs;
use std::path::PathBuf;
use std::process;
use std::sync::atomic::{AtomicU64, Ordering};

static SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub struct TestWorkspace(pub PathBuf);

impl TestWorkspace {
    pub fn new() -> Self {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../target/java-analysis/test-workspaces")
            .join(format!(
                "{}-{}",
                process::id(),
                SEQUENCE.fetch_add(1, Ordering::Relaxed)
            ));
        fs::create_dir_all(&root).unwrap();
        Self(root)
    }

    pub fn close(self) {
        fs::remove_dir_all(&self.0).unwrap();
    }
}

impl Drop for TestWorkspace {
    fn drop(&mut self) {
        if self.0.exists()
            && let Err(error) = fs::remove_dir_all(&self.0)
        {
            eprintln!("test cleanup failed: {error}");
        }
    }
}
