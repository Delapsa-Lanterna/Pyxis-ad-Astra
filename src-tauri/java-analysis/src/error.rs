use reqwest::Error as HttpError;
use serde_json::Error as JsonError;
use std::io::Error as IoError;
use std::result::Result as StdResult;
use zip::result::ZipError;
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Java component operation cancelled")]
    Cancelled,
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Io(#[from] IoError),
    #[error(transparent)]
    Json(#[from] JsonError),
    #[error(transparent)]
    Http(#[from] HttpError),
    #[error(transparent)]
    Zip(#[from] ZipError),
}
pub type Result<T> = StdResult<T, Error>;
