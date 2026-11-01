use crate::errors::AppResult;
use crate::models::{
    DetectDirectoryPayload, GameOverviewData, OpenDirectoryResult, ScanGameOverviewPayload,
};
use crate::services::directory_opening;
use std::path::Path;

#[command_macros::command(async)]
pub fn detect_directory(payload: DetectDirectoryPayload) -> AppResult<OpenDirectoryResult> {
    directory_opening::detect_directory(
        Path::new(&payload.path),
        payload.known_starsector_root.as_deref(),
    )
}

#[command_macros::command(async)]
pub fn scan_game_overview(payload: ScanGameOverviewPayload) -> AppResult<GameOverviewData> {
    directory_opening::scan_game_overview(Path::new(&payload.starsector_root))
}
