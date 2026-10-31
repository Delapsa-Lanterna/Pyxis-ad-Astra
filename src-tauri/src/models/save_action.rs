use super::{
    CsvSave, FileReplay, FileVersion, IndexedConfigDelete, IndexedConfigSave, JointEditSubmission,
    JsonFileDelete, JsonFileSave, JsonSourceRestore, MiscConfigDelete, MiscConfigWrite,
    ModInfoSave, SaveEdit, SessionModScope, SourceRefresh, SpecSave, TextSave, TextTranscode,
};
use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequest {
    pub id: String,
    pub edits: Vec<SaveEdit>,
    pub action: SaveAction,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", content = "input", rename_all = "snake_case")]
pub enum SaveAction {
    SaveEditorSpec(SpecSave),
    SaveTextFile(TextSave),
    TranscodeFileToUtf8(TextTranscode),
    SaveCsvPatch(CsvSave),
    SaveJointEdit(Box<JointEditSubmission>),
    SaveModInfo(ModInfoSave),
    SaveIndexedConfigEntity(IndexedConfigSave),
    CreateIndexedConfigEntity(IndexedConfigSave),
    DeleteIndexedConfigEntity(IndexedConfigDelete),
    SaveVariantEntity(JsonFileSave),
    CreateVariantEntity(JsonFileSave),
    DeleteVariantEntity(JsonFileDelete),
    SaveSkinEntity(JsonFileSave),
    CreateSkinEntity(JsonFileSave),
    DeleteSkinEntity(JsonFileDelete),
    RecreateJsonSources(JsonSourceRestore),
    SaveMiscConfig(MiscConfigWrite),
    DeleteMiscConfig(MiscConfigDelete),
    ApplyFileChangeSet(FileReplay),
    RefreshProjectSources(SourceRefresh),
}

impl SaveAction {
    pub fn scope(&self) -> Option<&dyn SessionModScope> {
        Some(match self {
            Self::SaveEditorSpec(input) => input,
            Self::SaveTextFile(input) => input,
            Self::TranscodeFileToUtf8(input) => input,
            Self::SaveCsvPatch(input) => input,
            Self::SaveJointEdit(input) => input.as_ref(),
            Self::SaveModInfo(input) => input,
            Self::SaveIndexedConfigEntity(input) | Self::CreateIndexedConfigEntity(input) => input,
            Self::DeleteIndexedConfigEntity(input) => input,
            Self::SaveVariantEntity(input)
            | Self::CreateVariantEntity(input)
            | Self::SaveSkinEntity(input)
            | Self::CreateSkinEntity(input) => input,
            Self::DeleteVariantEntity(input) | Self::DeleteSkinEntity(input) => input,
            Self::RecreateJsonSources(input) => input,
            Self::SaveMiscConfig(input) => input,
            Self::DeleteMiscConfig(input) => input,
            Self::ApplyFileChangeSet(input) => input,
            Self::RefreshProjectSources(_) => return None,
        })
    }

    pub fn versions(&mut self) -> &mut [FileVersion] {
        match self {
            Self::SaveEditorSpec(input) => &mut input.base_versions,
            Self::SaveTextFile(input) => &mut input.base_versions,
            Self::TranscodeFileToUtf8(input) => &mut input.base_versions,
            Self::SaveCsvPatch(input) => &mut input.base_versions,
            Self::SaveJointEdit(input) => &mut input.base_versions,
            Self::SaveModInfo(input) => &mut input.base_versions,
            Self::SaveIndexedConfigEntity(input) | Self::CreateIndexedConfigEntity(input) => {
                &mut input.base_versions
            }
            Self::DeleteIndexedConfigEntity(input) => &mut input.base_versions,
            Self::SaveVariantEntity(input)
            | Self::CreateVariantEntity(input)
            | Self::SaveSkinEntity(input)
            | Self::CreateSkinEntity(input) => &mut input.base_versions,
            Self::DeleteVariantEntity(input) | Self::DeleteSkinEntity(input) => {
                &mut input.base_versions
            }
            Self::RecreateJsonSources(input) => &mut input.plan.base_versions,
            Self::SaveMiscConfig(input) => &mut input.base_versions,
            Self::DeleteMiscConfig(input) => &mut input.base_versions,
            Self::ApplyFileChangeSet(_) | Self::RefreshProjectSources(_) => &mut [],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn save_requests_keep_the_original_request_identity() {
        let payload: SaveRequest = serde_json::from_value(json!({
            "id":"request-7", "edits":[],
            "action":{"kind":"refresh_project_sources","input":{"sessionId":"session","sources":[]}}
        }))
        .unwrap();
        assert_eq!(payload.id, "request-7");
        assert!(payload.edits.is_empty());
        assert!(
            matches!(payload.action, SaveAction::RefreshProjectSources(input) if input.session_id == "session" && input.sources.is_empty())
        );
    }
}
