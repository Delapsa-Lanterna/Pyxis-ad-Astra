import type { DetectDirectoryPayload, ScanGameOverviewPayload, GameOverviewData, OpenDirectoryResult } from '@/shared/types';
import { invokeCommand } from '@/shared/runtime/command.runtime';
import { pickDirectoryDialog } from '@/shared/runtime/dialog.runtime';

export function pickDirectory(): Promise<string | null> {
  return pickDirectoryDialog('选择 Starsector 游戏目录或 Mod 目录');
}

export function detectDirectoryTarget(path: string, knownStarsectorRoot: string | null): Promise<OpenDirectoryResult> {
  return invokeCommand('detect_directory', { payload: { path, knownStarsectorRoot } satisfies DetectDirectoryPayload });
}

export function scanDirectoryGameOverview(starsectorRoot: string): Promise<GameOverviewData> {
  return invokeCommand('scan_game_overview', { payload: { starsectorRoot } satisfies ScanGameOverviewPayload });
}
