//! Java 17 analysis, pinned dependencies and explicit instance ownership.
pub mod dependencies;
pub mod model;
mod paths;
pub mod process;
pub mod protocol;
pub mod runtime;
pub mod transfer;
pub use model::{
    AnalysisError, AnalysisRequest, AnalysisResponse, Artifact, Builtin, Error, FileChange,
    FileChangeAction, Manifest, Package, PackageFile, Result,
};
pub use paths::java_path;
pub use process::Engine;
pub use runtime::{AnalysisEvent, AnalysisPaths, AnalysisRuntime, EventSink};
fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}
