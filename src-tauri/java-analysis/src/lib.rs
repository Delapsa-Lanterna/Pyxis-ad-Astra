//! Java 17 analysis, pinned dependencies and explicit instance ownership.
pub mod dependencies;
mod error;
mod package;
mod paths;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod transfer;
pub mod versions;
pub use error::{Error, Result};
pub use package::{Artifact, Builtin, Manifest, Package, PackageFile};
pub use paths::java_path;
pub use process::Engine;
pub use protocol::{
    AnalysisError, AnalysisRequest, AnalysisResponse, FileChange, FileChangeAction,
};
pub use runtime::{AnalysisEvent, AnalysisPaths, AnalysisRuntime, EventSink};
fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}
