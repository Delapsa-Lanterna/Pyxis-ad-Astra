use crate::models::EntityEditTarget;
use base64::DecodeError;
use csv::Error as CsvError;
use serde::ser::SerializeStruct;
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Error as SerdeJsonError;
use std::io::Error;
use std::path::Path;
use tauri::Error as TauriError;

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ErrorLocation {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub row_key: Option<Box<str>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<Box<str>>,
    pub path: Option<String>,
    pub line: Option<usize>,
    pub column: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ErrorDiagnostic {
    pub code: String,
    pub message: String,
    pub location: Option<Box<ErrorLocation>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FieldProblem {
    pub severity: String,
    pub code: String,
    pub path: String,
    pub message: String,
    pub location: Option<Box<ErrorLocation>>,
}

fn problem_messages(issues: &[FieldProblem]) -> String {
    issues
        .iter()
        .map(|issue| {
            issue
                .location
                .as_ref()
                .and_then(|location| location.path.as_ref())
                .map_or_else(
                    || issue.message.clone(),
                    |path| format!("{path}: {}", issue.message),
                )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JsonRewriteFile {
    pub path: String,
    pub reason: String,
    pub source_fingerprint: String,
}

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("{}", problem_messages(.issues))]
    Validation {
        code: &'static str,
        issues: Vec<FieldProblem>,
    },
    #[error("{source}")]
    Located {
        location: ErrorLocation,
        source: Box<AppError>,
    },
    #[error("{message}")]
    Message { code: &'static str, message: String },
    #[error("{context}: {source}")]
    Context {
        context: String,
        source: Box<AppError>,
    },
    #[error("{0}")]
    Io(#[from] Error),
    #[error("{0}")]
    Csv(#[from] CsvError),
    #[error("{0}")]
    Json(#[from] SerdeJsonError),
    #[error("{0}")]
    Base64(#[from] DecodeError),
    #[error("{0}")]
    Tauri(#[from] TauriError),
    #[error("JSON 格式保留需要确认")]
    JsonRewriteRequired { files: Vec<JsonRewriteFile> },
    #[error("实体目标已存在")]
    EntityTargetExists { target: Box<EntityEditTarget> },
    #[error("保存来源缺失，需要确认重建")]
    SaveSourcesMissing { paths: Vec<String> },
}

impl AppError {
    /// `code` is the stable wire identifier the frontend maps to user-facing
    /// copy; `message` is diagnostics-only context and never user-facing.
    pub fn message(code: &'static str, message: impl Into<String>) -> Self {
        Self::Message {
            code,
            message: message.into(),
        }
    }

    pub fn context(context: impl Into<String>, source: AppError) -> Self {
        Self::Context {
            context: context.into(),
            source: Box::new(source),
        }
    }

    pub fn code(&self) -> &'static str {
        match self {
            Self::Validation { code, .. } => code,
            Self::Message { code, .. } => code,
            Self::Context { source, .. } => source.code(),
            Self::Located { source, .. } => source.code(),
            Self::Io(_) => "io.unexpected",
            Self::Csv(_) => "parse.csv",
            Self::Json(_) => "parse.json",
            Self::Base64(_) => "data.base64",
            Self::Tauri(_) => "window.native",
            Self::JsonRewriteRequired { .. } => "json.rewrite_confirmation_required",
            Self::EntityTargetExists { .. } => "spec.target_exists",
            Self::SaveSourcesMissing { .. } => "write.sources_missing",
        }
    }

    pub fn location(&self) -> Option<&ErrorLocation> {
        match self {
            Self::Validation { issues, .. } => {
                issues.first().and_then(|issue| issue.location.as_deref())
            }
            Self::Located { location, .. } => Some(location),
            Self::Context { source, .. } => source.location(),
            _ => None,
        }
    }

    pub fn at_path(mut self, path: impl AsRef<Path>) -> Self {
        if let Self::Validation { issues, .. } = &mut self {
            for issue in issues {
                issue.location.get_or_insert_with(Default::default).path =
                    Some(path.as_ref().to_string_lossy().into_owned());
            }
            return self;
        }
        let mut location = self.location().cloned().unwrap_or_default();
        location.path = Some(path.as_ref().to_string_lossy().into_owned());
        Self::Located {
            location,
            source: Box::new(self),
        }
    }

    pub fn at_position(self, line: usize, column: Option<usize>) -> Self {
        let location = ErrorLocation {
            row_key: self
                .location()
                .and_then(|location| location.row_key.clone()),
            field: self.location().and_then(|location| location.field.clone()),
            path: self.location().and_then(|location| location.path.clone()),
            line: Some(line),
            column,
        };
        Self::Located {
            location,
            source: Box::new(self),
        }
    }

    pub fn diagnostic(&self) -> ErrorDiagnostic {
        ErrorDiagnostic {
            code: self.code().to_string(),
            message: self.to_string(),
            location: self.location().cloned().map(Box::new),
        }
    }

    pub fn at_field(self, field: impl Into<String>) -> Self {
        let mut location = self.location().cloned().unwrap_or_default();
        location.field = Some(field.into().into_boxed_str());
        Self::Located {
            location,
            source: Box::new(self),
        }
    }
    pub fn at_row(self, key: &str) -> Self {
        let mut location = self.location().cloned().unwrap_or_default();
        location.row_key = Some(key.into());
        Self::Located {
            location,
            source: Box::new(self),
        }
    }

    fn rewrite_files(&self) -> Option<&[JsonRewriteFile]> {
        match self {
            Self::JsonRewriteRequired { files } => Some(files),
            Self::Context { source, .. } | Self::Located { source, .. } => source.rewrite_files(),
            _ => None,
        }
    }

    fn validation_issues(&self) -> Option<&[FieldProblem]> {
        match self {
            Self::Validation { issues, .. } => Some(issues),
            Self::Context { source, .. } | Self::Located { source, .. } => {
                source.validation_issues()
            }
            _ => None,
        }
    }
    pub fn field_problems(&self) -> Vec<FieldProblem> {
        let mut issues = self.validation_issues().map_or_else(
            || {
                vec![FieldProblem {
                    severity: "error".into(),
                    code: self.code().into(),
                    path: self
                        .location()
                        .and_then(|location| location.field.as_deref())
                        .unwrap_or("保存")
                        .into(),
                    message: self.to_string(),
                    location: self.location().cloned().map(Box::new),
                }]
            },
            |issues| issues.to_vec(),
        );
        for issue in &mut issues {
            let location = issue.location.get_or_insert_with(Default::default);
            if location.path.is_none() {
                location.path = self.location().and_then(|location| location.path.clone());
            }
        }
        issues
    }

    fn conflicting_target(&self) -> Option<&EntityEditTarget> {
        match self {
            Self::EntityTargetExists { target } => Some(target),
            Self::Context { source, .. } | Self::Located { source, .. } => {
                source.conflicting_target()
            }
            _ => None,
        }
    }
}

impl Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut state = serializer.serialize_struct("AppError", 4)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.serialize_field("location", &self.location())?;
        if self.validation_issues().is_some() {
            state.serialize_field("issues", &self.field_problems())?;
        }
        if let Some(files) = self.rewrite_files() {
            state.serialize_field("files", files)?;
        }
        if let Some(target) = self.conflicting_target() {
            state.serialize_field("target", target)?;
        }
        if let Self::SaveSourcesMissing { paths } = self {
            state.serialize_field("paths", paths)?;
        }
        state.end()
    }
}

#[cfg(test)]
mod tests {
    #[cfg(test)]
    use crate::models::EntityEditTarget;
    #[cfg(test)]
    use csv::Error as CsvError;
    #[cfg(test)]
    use serde_json::Value;
    #[cfg(test)]
    use std::io::{Error, ErrorKind};

    use super::*;

    #[test]
    fn message_error_keeps_its_stable_code() {
        let error = AppError::message("config.id_invalid", "bad id");
        assert_eq!(error.code(), "config.id_invalid");
        assert_eq!(error.to_string(), "bad id");
    }

    #[test]
    fn context_errors_surface_the_source_code_through_layers() {
        let source = AppError::message("parse.csv", "row broken");
        let outer = AppError::context("保存失败", AppError::context("写盘失败", source));
        assert_eq!(outer.code(), "parse.csv");
        assert_eq!(outer.to_string(), "保存失败: 写盘失败: row broken");
    }

    #[test]
    fn foreign_errors_map_to_fixed_fallback_codes() {
        let io_error = AppError::from(Error::new(ErrorKind::NotFound, "gone"));
        assert_eq!(io_error.code(), "io.unexpected");

        let csv_error = AppError::from(CsvError::from(Error::new(ErrorKind::InvalidData, "bad")));
        assert_eq!(csv_error.code(), "parse.csv");

        let json_error = AppError::from(serde_json::from_slice::<Value>(b"{").unwrap_err());
        assert_eq!(json_error.code(), "parse.json");
    }

    #[test]
    fn serializes_into_the_wire_code_message_shape() {
        let error = AppError::context("outer", AppError::message("spec.missing", "inner detail"));
        let value = serde_json::to_value(&error).expect("serializable");
        assert_eq!(value["code"], "spec.missing");
        assert_eq!(value["message"], "outer: inner detail");
        assert!(value["location"].is_null());
    }
    #[test]
    fn field_location_survives_file_position_and_context_wrapping() {
        let error = AppError::context(
            "save",
            AppError::message("config.shape_invalid", "invalid field")
                .at_field("groups[2][\"power\"]")
                .at_row("descriptions:row:2"),
        )
        .at_path("demo.variant")
        .at_position(4, Some(9));
        let wire = serde_json::to_value(error).unwrap();
        assert_eq!(wire["code"], "config.shape_invalid");
        assert_eq!(wire["location"]["field"], "groups[2][\"power\"]");
        assert_eq!(wire["location"]["path"], "demo.variant");
        assert_eq!(wire["location"]["line"], 4);
        assert_eq!(wire["location"]["column"], 9);
        assert_eq!(wire["location"]["rowKey"], "descriptions:row:2");
    }

    #[test]
    fn wrapped_identity_conflicts_keep_the_authoritative_target_payload() {
        let target: EntityEditTarget = serde_json::from_value(serde_json::json!({
            "kind":"ship", "id":"Alpha", "state":"existing", "linkedRecord":null,
            "source":{"source":"mod","root":"D:/Mod","path":"D:/Mod/nested/custom.ship","relPath":"nested/custom.ship"},
            "write":{"source":"mod","root":"D:/Mod","path":"D:/Mod/nested/custom.ship","relPath":"nested/custom.ship"}
        })).unwrap();
        let error = AppError::context(
            "prepare",
            AppError::EntityTargetExists {
                target: Box::new(target),
            },
        )
        .at_path("D:/Mod/nested/custom.ship");
        let wire = serde_json::to_value(error).unwrap();
        assert_eq!(wire["code"], "spec.target_exists");
        assert_eq!(wire["target"]["id"], "Alpha");
        assert_eq!(wire["target"]["write"]["path"], "D:/Mod/nested/custom.ship");
        assert_eq!(wire["location"]["path"], "D:/Mod/nested/custom.ship");
    }

    #[test]
    fn wrappers_preserve_diagnostic_location_and_rewrite_payload() {
        let error = AppError::context(
            "save",
            AppError::message("parse.json_syntax", "raw").at_position(3, Some(8)),
        )
        .at_path("demo.skin");
        let diagnostic = error.diagnostic();
        assert_eq!(diagnostic.code, "parse.json_syntax");
        assert_eq!(diagnostic.message, "save: raw");
        assert_eq!(
            diagnostic.location,
            Some(Box::new(ErrorLocation {
                row_key: None,
                field: None,
                path: Some("demo.skin".into()),
                line: Some(3),
                column: Some(8)
            }))
        );
        let rewrite = AppError::context(
            "save",
            AppError::JsonRewriteRequired {
                files: vec![JsonRewriteFile {
                    path: "demo.json".into(),
                    reason: "shape".into(),
                    source_fingerprint: "v1".into(),
                }],
            },
        )
        .at_path("demo.json");
        let wire = serde_json::to_value(rewrite).unwrap();
        assert_eq!(wire["files"][0]["sourceFingerprint"], "v1");
        assert_eq!(wire["location"]["path"], "demo.json");
    }
}
