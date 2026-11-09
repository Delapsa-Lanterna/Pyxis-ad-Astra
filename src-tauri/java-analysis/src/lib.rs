//! Java 17 analysis, pinned dependencies and explicit instance ownership.
pub mod dependencies;
pub mod model;
mod paths;
pub mod process;
pub mod runtime;
pub use model::{Artifact, Builtin, Error, Manifest, Package, PackageFile, Result};
pub use process::Engine;
pub use runtime::{AnalysisEvent, AnalysisPaths, AnalysisRuntime, EventSink};
fn invalid(message: impl Into<String>) -> Error {
    Error::Invalid(message.into())
}
