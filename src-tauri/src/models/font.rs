use super::{ProjectSessionId, required_nullable_non_empty_string};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum FontId {
    #[serde(rename = "insignia15LTaa")]
    Insignia15LTaa,
    #[serde(rename = "insignia21LTaa")]
    Insignia21LTaa,
    Orbitron12condensed,
    Orbitron20aa,
    Orbitron20aabold,
    Orbitron24aa,
    Orbitron24aabold,
    Victor10,
    Victor14,
}

impl FontId {
    pub fn name(self) -> &'static str {
        match self {
            Self::Insignia15LTaa => "insignia15LTaa",
            Self::Insignia21LTaa => "insignia21LTaa",
            Self::Orbitron12condensed => "orbitron12condensed",
            Self::Orbitron20aa => "orbitron20aa",
            Self::Orbitron20aabold => "orbitron20aabold",
            Self::Orbitron24aa => "orbitron24aa",
            Self::Orbitron24aabold => "orbitron24aabold",
            Self::Victor10 => "victor10",
            Self::Victor14 => "victor14",
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OriginalFontPage {
    pub id: u32,
    pub path: String,
    pub data_url: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "camelCase")]
pub enum OriginalFontResult {
    Unavailable,
    Available {
        root: String,
        #[serde(rename = "fontId")]
        font_id: FontId,
        path: String,
        definition: String,
        pages: Vec<OriginalFontPage>,
    },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryOriginalFontPayload {
    pub session_id: ProjectSessionId,
    #[serde(deserialize_with = "required_nullable_non_empty_string")]
    pub font_directory: Option<String>,
    pub font_id: crate::models::font::FontId,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn original_font_payload_normalizes_directory_values() {
        let base = json!({"sessionId": "font-session", "fontId": "insignia15LTaa"});
        assert!(serde_json::from_value::<QueryOriginalFontPayload>(base.clone()).is_err());
        for (root, expected) in [
            (serde_json::Value::Null, None),
            (json!("  "), None),
            (json!(" G:/core "), Some("G:/core")),
        ] {
            let mut value = base.clone();
            value["fontDirectory"] = root;
            let payload =
                serde_json::from_value::<QueryOriginalFontPayload>(value.clone()).unwrap();
            assert_eq!(payload.session_id, "font-session");
            assert_eq!(payload.font_id.name(), "insignia15LTaa");
            assert_eq!(payload.font_directory.as_deref(), expected);
        }
    }
}
