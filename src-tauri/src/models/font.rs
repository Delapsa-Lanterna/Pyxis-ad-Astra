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
